import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_SCHEMA, Type, load } from "js-yaml";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as store from "../vendor/deepseek-harness/packages/client/store/lib/index.js";
import { installFeedback } from "@minke/harness-overlay/client/feedback/install.ts";

const issues = "https://github.com/lencx/Minke/issues/new/choose";

async function fixture() {
  const slots = [], releases = [], decorations = [];
  const dictionaries = new Map();
  const ctx = {
    effect(callback) { const release = callback(); if (release) releases.push(release); },
    inject(_dependencies, callback) { callback(ctx); },
    get(name) { return ctx[name]; },
    provide(name, value) { ctx[name] = value; },
    on() {},
    remote: { messageFeedback: {}, sessionFeedback: {} },
    locale: { register(ns, dicts) { dictionaries.set(ns, dicts); return () => dictionaries.delete(ns); } },
    commandUi: { decorate(entry) { decorations.push(entry); return () => {}; } },
    slots: { inject: (_name, callback) => callback(), register(options) { slots.push(options); return () => {}; } },
  };
  const dependencies = {
    react: React, "react/jsx-runtime": jsx,
    "@deepseek-ai/dsh-client-ui-primitives": {}, "@deepseek-ai/dsh-client-store": store,
  };
  let provider;
  const source = await readFile(new URL("../vendor/deepseek-harness/packages/client/ui-message-feedback/lib/client.js", import.meta.url), "utf8");
  new Function("window", source)({ __ModuleLoader__: { load({ factory }) {
    provider = factory(name => { assert.ok(name in dependencies, name); return dependencies[name]; });
  } } });
  provider.apply(ctx);
  const nativeOpen = ctx.feedbackUi.openSession;
  return { ctx, slots, decorations, nativeOpen, releases };
}

for (const desktop of [false, true]) {
  test(`native menu and /feedback open Minke Issues in ${desktop ? "desktop" : "Web"}`, async () => {
    const { ctx, slots, decorations, nativeOpen, releases } = await fixture();
    const opened = [];
    const browser = {
      ...(desktop ? { minkeDesktop: { tabs: { openExternal: url => opened.push(["desktop", url]) } } } : {}),
      open: (...args) => opened.push(["web", ...args]),
    };
    installFeedback(ctx, browser);
    ctx.feedbackUi.openSession("private-session-id");
    decorations.find(entry => entry.name === "feedback").ui.run({ sessionId: "private-session-id" });
    const expected = desktop ? ["desktop", issues] : ["web", issues, "_blank", "noopener,noreferrer"];
    assert.deepEqual(opened, [expected, expected]);
    const dialog = slots.find(slot => slot.id === "feedback-dialog").inject("private-session-id");
    assert.equal(dialog.hooks.dialog.getSnapshot().target, null, "Minke feedback must not open DSH's upload dialog");
    const message = slots.find(slot => slot.id === "feedback").inject("private-session-id");
    message.openDialog("message-a", "bad");
    assert.equal(dialog.hooks.dialog.getSnapshot().target.kind, "message", "native message ratings remain available");
    for (const release of releases.reverse()) release();
    assert.equal(ctx.feedbackUi.openSession, nativeOpen, "unloading the overlay restores the provider method");
  });
}

test("Minke disables the upstream feedback uploader through native configuration", async () => {
  const schema = DEFAULT_SCHEMA.extend([new Type("tag:yaml.org,2002:js", { kind: "scalar", construct: value => value })]);
  const rows = load(await readFile(new URL("../packages/harness-overlay/cordis.patch.yml", import.meta.url), "utf8"), { schema });
  assert.equal(rows.find(row => row.id === "session-telemetry-otel")?.config?.mode, "DISABLED");
});
