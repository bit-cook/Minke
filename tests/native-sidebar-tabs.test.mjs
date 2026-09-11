import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { Context } from "@deepseek-ai/cordis";
import * as dockkit from "../vendor/deepseek-harness/packages/client/ui-dockkit/lib/index.js";
import * as store from "../vendor/deepseek-harness/packages/client/store/lib/index.js";
import { applyHarnessRuntimePatches, resolveHarnessRuntimePatches, verifyHarnessRuntimePatchesApplied } from "../scripts/harness/runtime-patches.mjs";
import { TabsRuntime } from "@minke/harness-overlay/client/tabs/runtime.ts";
import { TabRendererRegistry } from "@minke/harness-overlay/client/tabs/registry.ts";
import { NativeTabsRuntime } from "@minke/harness-overlay/client/tabs/native/runtime.ts";
import { nativeContentId } from "@minke/harness-overlay/client/tabs/native/contract.ts";
import { subtractRect } from "@minke/harness-overlay/client/tabs/native/viewport.ts";
import { bindDrawerFocus } from "@minke/harness-overlay/client/tabs/native/drawer-focus.ts";
import { JSDOM } from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";

const projectRoot = resolve(import.meta.dirname, "..");
const runtimeRoot = await mkdtemp(join(tmpdir(), "minke-native-sidebar-"));
const target = join(runtimeRoot, "node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js");
const upstream = await readFile(join(projectRoot, "vendor/deepseek-harness/packages/client/ui-sidebar-right/lib/client.js"), "utf8");
await mkdir(join(target, ".."), { recursive: true });
await writeFile(target, upstream);
const patches = await resolveHarnessRuntimePatches(projectRoot, ["patches/deepseek-harness/sidebar-tab-lifecycle.patch"]);
await applyHarnessRuntimePatches(runtimeRoot, patches);
await verifyHarnessRuntimePatchesApplied(runtimeRoot, patches);
const patched = await readFile(target, "utf8");
await rm(runtimeRoot, { recursive: true, force: true });

const tick = async () => { await new Promise(resolve => setTimeout(resolve, 25)); };

async function boot(source = patched) {
  let plugin;
  const dependencies = {
    react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM,
    "@deepseek-ai/dsh-client-ui-dockkit": dockkit,
    "@deepseek-ai/dsh-client-store": store,
    "@deepseek-ai/dsh-client-ui-primitives": {},
  };
  new Function("window", source)({ __ModuleLoader__: { load({ factory }) {
    plugin = factory(name => {
      assert.ok(name in dependencies, `unhandled native dependency ${name}`);
      return dependencies[name];
    });
  } } });
  const ctx = new Context();
  const registered = [];
  ctx.provide("slots", {
    inject: (_name, callback) => ctx.effect(callback),
    register: (options, component) => {
      const entry = { ...options, component };
      registered.push(entry);
      return () => { registered.splice(registered.indexOf(entry), 1); };
    },
  });
  ctx.provide("locale", { bind: () => key => key, register: () => () => {} });
  ctx.provide("layout", { openRightbar() {}, closeRightbar() {} });
  ctx.provide("resources", { pin() {} });
  const fiber = ctx.plugin(plugin);
  await fiber.await();
  const seat = registered.find(entry => entry.name === "rightbar.session");
  assert.ok(seat);
  const instances = new Map();
  let release;
  const mount = id => {
    release?.();
    if (id === undefined) { release = undefined; return; }
    let instance = instances.get(id);
    if (!instance) { instance = seat.store.create(id); instances.set(id, instance); instance.actions.open(id); }
    const bind = () => ctx.sidebarRight.bind({ sessionId: id, actions: instance.actions, surfaces: instance.getSnapshot().bySession, canSplitPane: () => true });
    let releaseBinding = bind();
    const unsubscribe = instance.subscribe(() => { releaseBinding(); releaseBinding = bind(); });
    release = () => { unsubscribe(); releaseBinding(); };
    return instance;
  };
  return { ctx, instances, mount, async dispose() { release?.(); await fiber.dispose(); } };
}

async function workspace(t, { beforeClose = () => true, source = patched } = {}) {
  const harness = await boot(source);
  const runtime = new TabsRuntime({ showPanel() {}, hidePanel() {} });
  const renderers = new TabRendererRegistry();
  for (const kind of ["web", "files", "terminal"]) {
    renderers.register({ kind, renderIcon: () => null, renderView: () => null, beforeClose });
    harness.ctx.sidebarRightTabs.register({ id: `spec/${kind}`, kind: `minke.${kind}`, title: () => kind });
  }
  harness.ctx.sidebarRightTabs.register({ id: "spec/text", kind: "text", patterns: ["dsh-resource://file/**"], title: () => "Native preview" });
  const native = new NativeTabsRuntime(runtime, renderers);
  const release = native.connect(harness.ctx.sidebarRight);
  t.after(async () => { release(); await harness.dispose(); });
  const instance = harness.mount("session-a");
  await tick();
  const surface = (id = "session-a") => harness.instances.get(id).getSnapshot().bySession[id].layout;
  const record = (id, sessionId) => Object.values(surface(sessionId).tabs).find(tab => tab.contentId === nativeContentId(id));
  return { ...harness, runtime, native, instance, surface, record };
}

test("native tab patch is required by the compatibility contract", async () => {
  const harness = await boot(upstream);
  assert.equal(harness.ctx.sidebarRight.connectMinkeTabs, undefined);
  await harness.dispose();
});

test("custom instances and native previews share the DSH tab list", async t => {
  const w = await workspace(t);
  const first = w.runtime.open({ kind: "web", key: "a", title: "A", payload: { value: 1 } });
  const second = w.runtime.open({ kind: "web", key: "b", title: "B", payload: { value: 2 } });
  assert.notEqual(first, second);
  assert.equal(Object.values(w.surface().tabs).filter(tab => tab.kind === "minke.web").length, 2);
  assert.equal(w.runtime.open({ kind: "web", key: "a", title: "A", payload: {} }), first);
  assert.equal(w.runtime.getSnapshot().activeId, first);
  w.ctx.sidebarRight.openResource("dsh-resource://file/example.md");
  await tick();
  assert.equal(w.runtime.getSnapshot().activeId, undefined);
  assert.equal(w.runtime.getSnapshot().tabs.length, 2);
  assert.equal(Object.values(w.surface().tabs).length, 3);
  w.runtime.close(first);
  await tick();
  assert.equal(Object.values(w.surface().tabs).length, 2);
  assert.equal(Object.values(w.surface().tabs).some(tab => tab.kind === "text"), true);
});

test("background custom opens preserve the selected native document", async t => {
  const w = await workspace(t);
  w.ctx.sidebarRight.openResource("dsh-resource://file/example.md");
  await tick();
  const activeId = w.surface().nodes[w.surface().activePaneId].activeTabId;
  const id = w.runtime.open({ kind: "web", key: "background", title: "Background", payload: {} }, { activate: false });
  assert.ok(w.record(id));
  assert.equal(w.surface().nodes[w.surface().activePaneId].activeTabId, activeId);
  assert.equal(w.runtime.getSnapshot().activeId, undefined);
  assert.equal(w.surface().expanded, true);
});

test("creating from Start replaces its slot in the originating pane", async t => {
  const w = await workspace(t);
  const original = w.runtime.open({ kind: "web", key: "first", title: "First", payload: {} });
  const firstPane = w.surface().activePaneId;
  const secondPane = w.ctx.sidebarRight.split();
  assert.ok(secondPane);
  await tick();
  const guide = w.surface().nodes[secondPane].activeTabId;
  assert.equal(w.surface().tabs[guide].kind, "guide");
  w.ctx.sidebarRight.focus(w.record(original).id);
  let created;
  w.native.createAt(guide, () => {
    created = w.runtime.open({ kind: "terminal", key: "new", title: "Terminal", payload: {} });
  });
  await tick();
  assert.deepEqual(w.surface().nodes[firstPane].tabs, [w.record(original).id]);
  assert.deepEqual(w.surface().nodes[secondPane].tabs, [w.record(created).id]);
  assert.equal(w.surface().tabs[guide], undefined);
  assert.equal(w.surface().activePaneId, secondPane);
});

test("a failing or stale Start creator cannot redirect the next open", async t => {
  const w = await workspace(t);
  w.ctx.sidebarRight.openTab("guide");
  await tick();
  const guide = w.surface().nodes[w.surface().activePaneId].activeTabId;
  assert.throws(() => w.native.createAt(guide, () => { throw new Error("creation failed"); }), /creation failed/);
  const id = w.runtime.open({ kind: "web", key: "next", title: "Next", payload: {} });
  assert.ok(w.record(id));
  assert.ok(w.surface().tabs[guide], "a later independent open must not inherit the failed replacement target");
  let staleCalled = false;
  w.native.createAt("closed-tab", () => { staleCalled = true; });
  assert.equal(staleCalled, false);
});

test("menu creation targets its docked pane and rejects stale menus", async t => {
  const w = await workspace(t);
  const first = w.runtime.open({ kind: "web", key: "first", title: "First", payload: {} });
  const firstPane = w.surface().activePaneId;
  const secondPane = w.ctx.sidebarRight.split();
  assert.ok(secondPane);
  await tick();
  const secondTabs = [...w.surface().nodes[secondPane].tabs];
  let created;
  w.native.createInPane("session-a", firstPane, () => {
    created = w.runtime.open({ kind: "terminal", key: "menu", title: "Terminal", payload: {} });
  });
  await tick();
  assert.deepEqual(w.surface().nodes[firstPane].tabs, [w.record(first).id, w.record(created).id]);
  assert.deepEqual(w.surface().nodes[secondPane].tabs, secondTabs);
  assert.throws(() => w.native.createInPane("session-a", firstPane, () => { throw new Error("failed creator"); }), /failed creator/);
  w.ctx.sidebarRight.focus(secondTabs[0]);
  const next = w.runtime.open({ kind: "web", key: "next", title: "Next", payload: {} });
  await tick();
  assert.ok(w.surface().nodes[secondPane].tabs.includes(w.record(next).id), 'a later open does not inherit a failed menu target');
  w.mount("session-b");
  await tick();
  let called = false;
  w.native.createInPane("session-a", firstPane, () => { called = true; });
  w.native.createInPane("session-b", "removed-pane", () => { called = true; });
  assert.equal(called, false, 'session changes and missing panes invalidate the menu');
});

test("native close, replacement and undo respect an unsaved draft veto", async t => {
  let dirty = true;
  const w = await workspace(t, { beforeClose: () => !dirty });
  const id = w.runtime.open({ kind: "files", key: "draft", title: "Draft", payload: { draft: "unsaved" } });
  const record = w.record(id);
  w.instance.actions.closeTab("session-a", record.id);
  await tick();
  assert.ok(w.record(id));
  w.ctx.sidebarRight.openResource("dsh-resource://file/replacement.md", { replaceTab: record.id });
  await tick();
  assert.equal(Object.values(w.surface().tabs).length, 1);
  assert.equal(w.runtime.tab(id).payload.draft, "unsaved");
  w.instance.actions.undo("session-a");
  await tick();
  assert.ok(w.record(id));
  dirty = false;
  w.instance.actions.closeTab("session-a", record.id);
  await tick();
  assert.equal(w.runtime.tab(id), undefined);
  w.instance.actions.undo("session-a");
  await tick();
  assert.equal(w.record(id), undefined, "undo cannot resurrect a disposed content instance");
});

test("draft protection test detects a disabled native admission check", async t => {
  const source = patched.replace("if (!admit(sessionId, before.layout, after.layout)) return before;", "if (false) return before;");
  const w = await workspace(t, { source, beforeClose: () => false });
  const id = w.runtime.open({ kind: "files", key: "draft", title: "Draft", payload: {} });
  w.instance.actions.closeTab("session-a", w.record(id).id);
  await tick();
  assert.equal(w.runtime.tab(id), undefined, "the negative control must lose the unprotected draft");
});

test("global content survives session changes, split, float, dock and collapse", async t => {
  const w = await workspace(t);
  const payload = { processId: "same-process" };
  const id = w.runtime.open({ kind: "terminal", key: "pty-a", title: "Shell", payload });
  w.ctx.sidebarRight.split();
  await tick();
  w.ctx.sidebarRight.float(w.record(id).id);
  await tick();
  assert.equal(w.surface().floats.length, 1);
  w.runtime.hide();
  w.native.activate(id);
  assert.equal(w.surface().expanded, false, "focusing a floating tab does not reopen the docked column");
  w.ctx.sidebarRight.dock(w.surface().floats[0]);
  await tick();
  assert.equal(w.surface().floats.length, 0);
  w.runtime.hide();
  assert.equal(w.runtime.getSnapshot().visible, false);
  w.runtime.show();
  w.mount("session-b");
  await tick();
  assert.ok(w.record(id, "session-b"));
  assert.equal(w.runtime.tab(id).payload, payload);
  w.mount(undefined);
  await tick();
  assert.equal(w.native.active, false);
  assert.equal(w.runtime.tab(id).payload, payload);
  w.mount("session-a");
  await tick();
  w.instance.actions.closeTab("session-a", w.record(id).id);
  await tick();
  assert.equal(w.runtime.tab(id), undefined);
  assert.equal(w.record(id, "session-b"), undefined);
});

test("extension cleanup removes native seats before local ids can be reused", async t => {
  const harness = await boot();
  t.after(() => harness.dispose());
  harness.ctx.sidebarRightTabs.register({ id: "spec/web", kind: "minke.web", title: () => "Web" });
  harness.mount("session-a");
  const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
  const native = new NativeTabsRuntime(tabs, new TabRendererRegistry());
  const release = native.connect(harness.ctx.sidebarRight);
  await tick();
  tabs.open({ kind: "web", key: "a", title: "A", payload: {} });
  assert.equal(Object.values(harness.instances.get("session-a").getSnapshot().bySession["session-a"].layout.tabs).length, 1);
  release();
  assert.equal(Object.values(harness.instances.get("session-a").getSnapshot().bySession["session-a"].layout.tabs).length, 0);
});

test("overlapping float occlusion leaves disjoint visible rectangles", () => {
  const pieces = subtractRect({ left: 0, top: 0, right: 100, bottom: 100 }, { left: 20, top: 20, right: 80, bottom: 80 });
  const visible = pieces.flatMap(rect => subtractRect(rect, { left: 50, top: 0, right: 100, bottom: 100 }));
  assert.equal(visible.reduce((area, rect) => area + (rect.right - rect.left) * (rect.bottom - rect.top), 0), 3200);
});

test("fallback drawer keyboard navigation includes its stable content host", () => {
  const dom = new JSDOM('<aside data-open><button>Tab</button></aside><div id="content"><input><button>Save</button><input hidden></div>');
  const { document, KeyboardEvent } = dom.window;
  // JSDOM has no layout boxes. Supply the visibility primitive so this test
  // exercises focus routing; Electron covers actual painted host visibility.
  Object.defineProperty(dom.window.HTMLElement.prototype, "checkVisibility", {
    value() { return !this.hidden; },
  });
  const panel = document.querySelector("aside");
  const content = document.querySelector("#content");
  let closed = 0;
  const press = (key, shiftKey = false) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  panel.querySelector("button").focus();
  const enterContent = () => {
    press("Tab");
    assert.equal(document.activeElement, content.querySelector("input"));
  };
  // Without the binding the test must catch the disconnected keyboard scope.
  assert.throws(enterContent, { code: "ERR_ASSERTION" });
  const release = bindDrawerFocus(panel, content, () => { closed += 1; });
  enterContent();
  press("Tab");
  assert.equal(document.activeElement, content.querySelector("button"));
  press("Tab");
  assert.equal(document.activeElement, panel.querySelector("button"));
  press("Tab", true);
  assert.equal(document.activeElement, content.querySelector("button"));
  press("Escape");
  assert.equal(closed, 1);
  release();
  press("Escape");
  assert.equal(closed, 1);
  dom.window.close();
});
