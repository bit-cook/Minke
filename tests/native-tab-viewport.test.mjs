import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { JSDOM } from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";
import { TabsRuntime } from "@minke/harness-overlay/client/tabs/runtime.ts";
import { TabRendererRegistry } from "@minke/harness-overlay/client/tabs/registry.ts";
import { NativeTabsRuntime } from "@minke/harness-overlay/client/tabs/native/runtime.ts";
import { NativeTabsContent } from "@minke/harness-overlay/client/tabs/native/views.tsx";

async function fixture(run) {
  const dom = new JSDOM('<div id="root"></div><section data-sidebar-right-panel="push"><div id="pane"><div id="seat" data-visible="true"></div></div></section>', { pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const frames = new Map();
  const resizes = new Set();
  const animations = new Map();
  let frameId = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = id => { frames.delete(id); };
  window.ResizeObserver = class {
    targets = new Set();
    constructor(callback) { this.callback = callback; resizes.add(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
  window.HTMLElement.prototype.getAnimations = function () { return animations.get(this) ?? []; };
  const values = {
    window, document, HTMLElement: window.HTMLElement, Node: window.Node,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let root;
  let detach;
  const extraDetach = [];
  try {
    const { createRoot } = await import("react-dom/client");
    const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
    const renderers = new TabRendererRegistry();
    renderers.register({ kind: "files", renderIcon: () => null, renderView: () => createElement("input", { defaultValue: "retained draft" }) });
    const native = new NativeTabsRuntime(tabs, renderers);
    const id = tabs.open({ kind: "files", key: "one", title: "One", payload: {} });
    const seat = document.getElementById("seat");
    const panel = seat.closest("section");
    const box = { left: 200, top: 40, width: 400, height: 300 };
    let reads = 0;
    seat.getBoundingClientRect = () => { reads++; return { ...box, right: box.left + box.width, bottom: box.top + box.height }; };
    seat.checkVisibility = () => !seat.closest("[hidden]");
    detach = native.attachViewport(id, seat);
    root = createRoot(document.getElementById("root"));
    await act(async () => { root.render(createElement(NativeTabsContent, { runtime: tabs, native, renderers, t: key => key })); });
    const host = document.querySelector("[data-minke-tab-instance]");
    const pump = async (count = 4) => {
      for (let index = 0; index < count; index++) await act(async () => {
        await Promise.resolve();
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback(index * 16);
      });
    };
    await pump();
    await run({ window, document, native, seat, panel, host, box, frames, animations, pump, reads: () => reads,
      resize(target = seat) { for (const observer of resizes) if (observer.targets.has(target)) observer.callback([{ target }]); },
      async addTab() {
        const peerSeat = document.createElement("div");
        peerSeat.dataset.visible = "true";
        const peerBox = { left: 620, top: 40, width: 200, height: 300 };
        peerSeat.getBoundingClientRect = () => ({ ...peerBox, right: peerBox.left + peerBox.width, bottom: peerBox.top + peerBox.height });
        peerSeat.checkVisibility = () => true;
        panel.append(peerSeat);
        let peerId;
        let release;
        await act(async () => {
          peerId = tabs.open({ kind: "files", key: "two", title: "Two", payload: {} });
          release = native.attachViewport(peerId, peerSeat);
        });
        extraDetach.push(release);
        await pump();
        return { seat: peerSeat, box: peerBox, host: document.querySelector(`[data-minke-tab-instance="${peerId}"]`),
          async close() {
            await act(async () => { tabs.close(peerId); release(); peerSeat.remove(); });
            await pump();
          },
        };
      },
    });
  } finally {
    if (root) await act(async () => { root.unmount(); });
    detach?.();
    for (const release of extraDetach) release();
    const pendingFrames = frames.size;
    const observedTargets = [...resizes].reduce((count, observer) => count + observer.targets.size, 0);
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    assert.equal(pendingFrames, 0, "unmount cancels pending positioning");
    assert.equal(observedTargets, 0, "unmount releases resize observations");
  }
}

test("retained tab content stops measuring while idle and responds to resize", async () => {
  await fixture(async f => {
    assert.equal(f.host.style.left, "200px");
    assert.equal(f.frames.size, 0, "idle content must not keep an animation loop");
    const reads = f.reads();
    await f.pump(10);
    assert.equal(f.reads(), reads);
    f.box.width = 500;
    f.resize();
    await f.pump();
    assert.equal(f.host.style.width, "500px");
    assert.equal(f.frames.size, 0);
    const mutations = [];
    const observer = new f.window.MutationObserver(records => mutations.push(...records));
    observer.observe(f.host, { attributes: true });
    f.window.dispatchEvent(new f.window.Event("resize"));
    await f.pump();
    observer.disconnect();
    assert.equal(mutations.length, 0, "unchanged geometry does not rewrite styles");
  });
});

test("split content shares one positioning frame and remains live when its peer closes", async () => {
  await fixture(async f => {
    const peer = await f.addTab();
    f.box.width = 350;
    peer.box.left = 570;
    f.resize(f.seat);
    f.resize(peer.seat);
    assert.equal(f.frames.size, 1, "layout invalidations are coalesced across panes");
    await f.pump();
    assert.equal(f.host.style.width, "350px");
    assert.equal(peer.host.style.left, "570px");
    await peer.close();
    f.box.width = 450;
    f.resize();
    await f.pump();
    assert.equal(f.host.style.width, "450px");
    assert.equal(f.frames.size, 0);
  });
});

test("retained tab content follows float movement and occlusion without remounting", async () => {
  await fixture(async f => {
    const input = f.host.querySelector("input");
    input.value = "unsaved edit";
    const layer = f.document.createElement("div");
    layer.dataset.sidebarRightFloatHost = "";
    const floating = f.document.createElement("div");
    floating.dataset.dockkitFloat = "floating";
    floating.style.zIndex = "1";
    layer.append(floating);
    f.document.body.append(layer);
    floating.append(f.seat);
    f.box.left = 80;
    await f.pump();
    assert.equal(f.host.style.left, "80px");
    assert.equal(f.host.style.zIndex, "61");
    const cover = f.document.createElement("div");
    cover.dataset.dockkitFloat = "cover";
    cover.style.zIndex = "2";
    cover.getBoundingClientRect = () => ({ left: 80, top: 40, right: 280, bottom: 340, width: 200, height: 300 });
    layer.append(cover);
    await f.pump();
    assert.match(f.host.style.clipPath, /M 200 0/u);
    f.box.left = 300;
    floating.style.left = "300px";
    await f.pump();
    assert.equal(f.host.style.left, "300px", "same-size moves must be observed");
    assert.match(f.host.style.clipPath, /M 0 0/u);
    assert.equal(f.host.querySelector("input"), input);
    assert.equal(input.value, "unsaved edit");
    assert.equal(f.frames.size, 0);
  });
});

test("retained tab content follows docking scrims, fullscreen and ancestor visibility", async () => {
  await fixture(async f => {
    const sibling = f.document.createElement("section");
    sibling.dataset.dockkitPane = "native-document";
    sibling.innerHTML = "<header></header><div></div>";
    f.panel.append(sibling);
    await f.pump();
    const scrim = f.document.createElement("div");
    scrim.dataset.dockkitDockScrim = "";
    sibling.lastElementChild.append(scrim);
    await f.pump();
    assert.equal(f.host.inert, true);
    scrim.remove();
    f.panel.dataset.sidebarRightPanel = "fullscreen";
    await f.pump();
    assert.equal(f.host.inert, false);
    assert.equal(f.host.style.zIndex, "41");
    f.panel.hidden = true;
    await f.pump();
    assert.equal(f.host.style.visibility, "hidden");
    f.panel.hidden = false;
    await f.pump();
    assert.equal(f.host.style.visibility, "visible");
    assert.equal(f.frames.size, 0);
  });
});

test("retained tab positioning sleeps in a hidden document and resumes on visibility", async () => {
  await fixture(async f => {
    Object.defineProperty(f.document, "visibilityState", { configurable: true, value: "hidden" });
    f.document.dispatchEvent(new f.window.Event("visibilitychange"));
    f.box.left = 340;
    f.resize();
    f.panel.style.width = "700px";
    const reads = f.reads();
    await f.pump();
    assert.equal(f.frames.size, 0);
    assert.equal(f.reads(), reads);
    Object.defineProperty(f.document, "visibilityState", { configurable: true, value: "visible" });
    f.document.dispatchEvent(new f.window.Event("visibilitychange"));
    await f.pump();
    assert.equal(f.host.style.left, "340px");
    assert.equal(f.frames.size, 0);
  });
});

test("retained tab content follows finite transitions and sleeps after cancellation", async () => {
  await fixture(async f => {
    const animation = { playState: "running", effect: { getComputedTiming: () => ({ endTime: 250 }) } };
    f.animations.set(f.panel, [animation]);
    f.panel.dispatchEvent(new f.window.Event("transitionrun", { bubbles: true }));
    f.box.left = 210;
    await f.pump(1);
    assert.equal(f.host.style.left, "210px");
    f.box.left = 220;
    await f.pump(1);
    assert.equal(f.host.style.left, "220px");
    animation.playState = "idle";
    f.panel.dispatchEvent(new f.window.Event("transitioncancel", { bubbles: true }));
    await f.pump();
    assert.equal(f.frames.size, 0);
    f.animations.set(f.panel, [{ playState: "running", effect: { getComputedTiming: () => ({ endTime: Infinity }) } }]);
    f.panel.dispatchEvent(new f.window.Event("animationstart", { bubbles: true }));
    await f.pump();
    assert.equal(f.frames.size, 0, "decorative infinite animations must not restart layout polling");
  });
});
