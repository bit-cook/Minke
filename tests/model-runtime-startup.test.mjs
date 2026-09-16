import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { createReconfigureModelRuntimesRequest } from "@lencx/minke-model-runtime/contract";

const require = createRequire(import.meta.url);
const source = buildSync({
  entryPoints: [fileURLToPath(new URL("../packages/model-runtime/src/dsh.ts", import.meta.url))],
  bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
  external: ["@deepseek-ai/*"],
}).outputFiles[0].text;
const schema = require("../vendor/deepseek-harness/vendor/schemastery/lib/index.cjs");

// Execute the production adapter and lifecycle core. Control only the DSH
// boundary, local HTTP/CLI and process channel; no real services are touched.
function fixture(t, { fetch, refusePublication = false } = {}) {
  const module = { exports: {} };
  const port = new EventEmitter();
  Object.assign(port, { env: {}, platform: process.platform, cwd: () => "/fixture" });
  const sent = [];
  port.send = message => { sent.push(message); };
  const warnings = [];
  const mounts = [];
  const updates = [];
  const disposers = [];
  const listeners = new Map();
  const servers = [];
  const ctx = {
    logger: { info() {}, warn: message => warnings.push(message) },
    credentials: { resolve: async () => undefined },
    subprocess: {
      resolveExecutable: async candidate => candidate,
      spawn({ argv }) {
        if (argv[1] === "serve") {
          const done = Promise.withResolvers();
          const server = { stopped: false, done: done.promise, terminate() {
            this.stopped = true;
            done.resolve({ exitCode: 0, signal: null });
          } };
          servers.push(server);
          return server;
        }
        assert.deepEqual(Array.from(argv).slice(1), ["server", "status", "--json"]);
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text: '{"running":true,"port":1234}' }) } },
        };
      },
    },
    plugin(_plugin, config) {
      mounts.push(config);
      return {
        update(next, noSave) {
          assert.equal(noSave, true, "discovery must not overwrite user settings");
          if (refusePublication && Object.keys(next.providers).length > 0) throw new Error("route collision");
          updates.push(next);
        },
        await: async () => {},
      };
    },
    effect(callback) { disposers.push(callback()); },
    on(name, listener) { listeners.set(name, listener); },
  };
  runInNewContext(source, {
    module, exports: module.exports, process: port,
    AbortController, AbortSignal, URL, Response, TextDecoder,
    setTimeout, clearTimeout, fetch,
    require(name) {
      switch (name) {
        case "@deepseek-ai/dsh-credentials": return { credentialRef: value => value };
        case "@deepseek-ai/dsh-launch-environment": return { launchEnvironmentOf: () => ({ get: () => undefined }) };
        case "@deepseek-ai/dsh-llm-pi-ai": return {};
        case "@deepseek-ai/schemastery": return schema;
        default: return require(name);
      }
    },
  });
  let disposal;
  const dispose = () => disposal ??= (async () => {
    for (const callback of disposers.toReversed()) await callback();
  })();
  t.after(dispose);
  return {
    apply: config => module.exports.apply(ctx, config),
    async stream(provider, signal) {
      const next = async function* () { yield { type: "fixture-response", provider }; };
      const stream = listeners.get("llm/stream")({ provider, model: "fixture", signal }, next);
      return await Array.fromAsync(stream);
    },
    dispose, mounts, updates, warnings, servers, port, sent,
  };
}

const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("cloud routes are ready while local startup waits; local requests remain cancellable", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, { fetch: async () => {
    await release.promise;
    return json({ data: [{ id: "local/model" }] });
  } });
  let booted = false;
  const boot = f.apply({ ollama: { enabled: true, lifecycle: "external" } }).then(() => { booted = true; });
  try {
    await nextTurn();
    assert.equal(booted, true, "local discovery must not hold plugin startup");
    assert.equal(f.mounts.length, 1);
    assert.equal(Object.keys(f.mounts[0].providers).length, 0);
    assert.deepEqual(await f.stream("deepseek"), [{ type: "fixture-response", provider: "deepseek" }]);
    const cancellation = new AbortController();
    const local = f.stream("ollama", cancellation.signal);
    cancellation.abort();
    const chunks = await local;
    assert.equal(chunks[0].reason.kind, "aborted");
    assert.equal(f.updates.length, 0);
  } finally {
    release.resolve();
    await boot;
    await nextTurn();
  }
  assert.deepEqual(Array.from(f.updates[0].providers.ollama.models, model => model.id), ["local/model"]);
  assert.deepEqual(await f.stream("ollama"), [{ type: "fixture-response", provider: "ollama" }]);
});

for (const refusePublication of [false, true]) {
  test(`owned startup process is cleaned up after ${refusePublication ? "publication failure" : "disposal during discovery"}`, async t => {
    const release = Promise.withResolvers();
    let reads = 0;
    const f = fixture(t, { refusePublication, fetch: async () => {
      if (++reads === 1) throw new Error("connection refused");
      await release.promise;
      return json({ data: [{ id: "owned/model" }] });
    } });
    const boot = f.apply({ ollama: { enabled: true, lifecycle: "ensure-running" } });
    let disposing;
    try {
      await nextTurn();
      assert.equal(f.servers.length, 1);
      disposing = refusePublication ? undefined : f.dispose();
    } finally {
      release.resolve();
      await boot;
      await nextTurn();
      await disposing;
    }
    assert.equal(f.servers[0].stopped, true);
    assert.equal(f.updates.some(update => Object.keys(update.providers).length > 0), false);
    if (refusePublication) {
      assert.match(f.warnings[0], /route collision/u);
      assert.deepEqual(await f.stream("deepseek"), [{ type: "fixture-response", provider: "deepseek" }]);
      assert.equal((await f.stream("ollama"))[0].reason.kind, "error");
    }
  });
}

test("an auto-start edit admitted during discovery waits for publication before acknowledgement", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, { fetch: async () => {
    await release.promise;
    return json({ data: [{ id: "local/model" }] });
  } });
  const boot = f.apply({ ollama: { enabled: true, lifecycle: "external" } });
  try {
    await nextTurn();
    f.port.emit("message", createReconfigureModelRuntimesRequest(7, {
      lmStudio: { enabled: false }, ollama: { enabled: true },
    }, "apply", "ollama"));
    await nextTurn();
    assert.equal(f.sent.length, 0);
  } finally {
    release.resolve();
    await boot;
    await nextTurn();
  }
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].type, "model-runtimes/reconfigured");
  assert.equal(f.sent[0].requestId, 7);
  assert.deepEqual(Array.from(f.updates.at(-1).providers.ollama.models, model => model.id), ["local/model"]);
});
