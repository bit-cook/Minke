import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import yaml from "js-yaml";
import { createReconfigureModelRuntimesRequest } from "@lencx/minke-model-runtime/contract";

const require = createRequire(import.meta.url);
const source = buildSync({
  entryPoints: [fileURLToPath(new URL("../packages/model-runtime/src/dsh.ts", import.meta.url))],
  bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
  external: ["@deepseek-ai/*"],
}).outputFiles[0].text;
const schema = require("../vendor/deepseek-harness/vendor/schemastery/lib/index.cjs");

function runNativeTest(pattern) {
  const env = { ...process.env };
  // A nested runner must not inherit the parent's binary test-worker channel.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--expose-internals", "--test", `--test-name-pattern=${pattern}`, fileURLToPath(import.meta.url)], {
    encoding: "utf8", timeout: 15_000, env,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /(?:pass 1|# pass 1)/);
}

async function productModelEntry() {
  const { applyEntryPatches, entryListSchema } = await import("../runtime/host/node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js");
  const parse = async path => yaml.load(await readFile(new URL(path, import.meta.url), "utf8"), { schema: entryListSchema });
  const base = await parse("../runtime/host/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml");
  const product = await parse("../packages/harness-overlay/cordis.patch.yml");
  const warnings = [];
  const saved = { providers: { "saved-provider": { api: "openai-completions", models: [{ id: "saved" }] } } };
  const entries = applyEntryPatches([], [...base, { id: "llm-pi-ai", config: saved }, ...product], (...args) => warnings.push(args));
  const entry = entries.find(row => row.id === "llm-pi-ai");
  assert.equal(entry?.name, "@lencx/minke-model-runtime/dsh", JSON.stringify(warnings));
  assert.deepEqual(entry.config, saved, "the command-line product overlay must preserve native model settings");
  assert.equal(entries.filter(row => row.id === "llm-pi-ai").length, 1);
  return entry;
}

test("the shipped product composition activates local model discovery at the native settings address", productModelEntry);

test("native Profile writes reject unserviceable model settings before persistence", async t => {
  if (process.execArgv.some(arg => arg.includes("register-path-aliases"))) {
    runNativeTest("^native Profile writes");
    return;
  }
  const runtimeRequire = createRequire(new URL("../runtime/host/package.json", import.meta.url));
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
  const [Boot, { default: Editor }, { default: Settings }, { default: Llm }, Adapter] = await Promise.all([
    load("@deepseek-ai/dsh-app-boot"), load("@deepseek-ai/dsh-config-editor"), load("@deepseek-ai/dsh-settings"),
    load("@deepseek-ai/dsh-llm"), load("@lencx/minke-model-runtime/dsh"),
  ]);
  const home = await mkdtemp(join(tmpdir(), "minke-model-settings-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, "profiles", "web");
  Boot.initProfile(dir, ["test-bundle"]);
  const bundle = join(dir, "node_modules", "test-bundle");
  await mkdir(bundle, { recursive: true });
  await writeFile(join(home, "package.json"), '{"name":"test-installation"}');
  await writeFile(join(bundle, "package.json"), JSON.stringify({ name: "test-bundle", version: "1.0.0", dsh: { bundle: { patch: "cordis.patch.yml" } } }));
  const provider = { api: "openai-completions", baseURL: "http://127.0.0.1:1/v1", models: [{ id: "test-model" }] };
  await writeFile(join(bundle, "cordis.patch.yml"), JSON.stringify([{ insert: [
    { id: "config-editor", name: "cordis:editor" }, { id: "settings", name: "cordis:settings" },
    { id: "llm", name: "cordis:llm" }, { id: "llm-pi-ai", name: "cordis:adapter", config: {
      providers: { test: provider }, lmStudio: { enabled: false }, ollama: { enabled: false },
    } },
  ] }]));
  await writeFile(join(dir, "cordis.yml"), "[]\n");
  const profile = { name: "web", startedBundles: ["test-bundle"], dir, patchPath: join(dir, "cordis.patch.yml"), installAnchor: join(home, "package.json"), cwd: home, home, overlays: [] };
  const ctx = await Boot.boot("dsh", join(dir, "cordis.yml"), Boot.readProfilePatches("dsh", profile), ctx => {
    ctx.provide("profileContext", profile);
    ctx.provide("appReady", { onReady: listener => { listener(); return () => {}; } });
    ctx.provide("credentials", { resolve: async () => undefined });
    ctx.provide("subprocess", { resolveExecutable: async () => { throw new Error("unexpected local startup"); } });
    Object.assign(ctx.loader.builtins, { editor: Editor, settings: Settings, llm: Llm, adapter: Adapter });
  });
  t.after(() => ctx.fiber.dispose());
  const before = await readFile(profile.patchPath, "utf8");
  await assert.rejects(ctx.settings.update("llm-pi-ai", { providers: { test: { ...provider, headers: { "X-Test": "a\nb" } } } }), /not valid for Fetch/);
  assert.equal(await readFile(profile.patchPath, "utf8"), before);
  await assert.rejects(ctx.settings.update("llm-pi-ai", { providers: { test: { ...provider, models: [] } } }), /models/);
  assert.equal(await readFile(profile.patchPath, "utf8"), before);
  await ctx.settings.update("llm-pi-ai", { providers: { test: { ...provider, displayName: "Edited" } } });
  await nextTurn();
  const persisted = yaml.load(await readFile(profile.patchPath, "utf8"));
  assert.equal(persisted.find(row => row.id === "llm-pi-ai").config.providers.test.displayName, "Edited");
  assert.equal(ctx.llm.listConfigurableProviders().find(row => row.provider === "test").displayName, "Edited");
});

test("a real Cordis boot starts LM Studio and publishes local models alongside native live provider settings", async t => {
  // The suite's source alias loader redirects dsh-llm into the source tree.
  // This integration must run against one coherent, shipped dependency graph.
  if (process.execArgv.some(arg => arg.includes("register-path-aliases"))) {
    runNativeTest("^a real Cordis boot");
    return;
  }
  const runtimeRequire = createRequire(new URL("../runtime/host/package.json", import.meta.url));
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
  const [{ Context }, { default: Loader }, { default: LlmRuntime }] = await Promise.all([
    load("@deepseek-ai/cordis"), load("@deepseek-ai/cordis-plugin-loader"), load("@deepseek-ai/dsh-llm"),
  ]);
  const entry = await productModelEntry();
  const cliCalls = [];
  let running = false;
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(input);
    assert.equal(url.origin, "http://127.0.0.1:39456");
    if (!running) throw new Error("LM Studio is stopped");
    if (url.pathname === "/v1/models") return json({ data: [{ id: "fixture-local" }] });
    assert.equal(url.pathname, "/api/v1/models");
    return json({ models: [{ key: "fixture-local", type: "llm", max_context_length: 8192, loaded_instances: [] }] });
  });
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide("credentials", { resolve: async () => undefined });
  ctx.provide("subprocess", {
    resolveExecutable: async () => "/fixture/lms",
    spawn({ argv }) {
      cliCalls.push(argv.slice(1));
      const command = argv.slice(1, 3).join(" ");
      assert.ok(command === "server status" || command === "server start", JSON.stringify(argv));
      if (command === "server start") running = true;
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: { readFrom: () => ({ text: JSON.stringify({ running, port: 39456 }) }) } },
      };
    },
  });
  await ctx.plugin(Loader);
  await ctx.plugin(LlmRuntime);
  const profile = { api: "openai-completions", baseURL: "http://127.0.0.1:1/v1", models: [{ id: "saved-cloud" }] };
  const config = {
    providers: { "saved-provider": profile },
    lmStudio: { enabled: true, lifecycle: "ensure-running", command: "/fixture/lms", baseURL: "http://127.0.0.1:39456/v1" },
    ollama: { enabled: false },
  };
  await ctx.loader.root.update([{ ...entry, name: pathToFileURL(runtimeRequire.resolve(entry.name)).href, config }]);
  await ctx.loader.await();
  const waitFor = async provider => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (ctx.llm.listProviders().some(row => row.id === provider)) return;
      await nextTurn();
    }
    assert.fail(`Cordis did not publish provider ${provider}`);
  };
  await waitFor("lm-studio");
  assert.ok(cliCalls.some(args => args[0] === "server" && args[1] === "start"));
  assert.ok(ctx.llm.listProviders().some(row => row.id === "saved-provider"));
  assert.deepEqual((await ctx.llm.listModels("lm-studio")).map(row => row.id), ["fixture-local"]);
  assert.equal(ctx.llm.listConfigurableProviders().find(row => row.provider === "lm-studio").settingsNs, "llm-pi-ai");
  const owner = ctx.loader.resolve("llm-pi-ai");
  assert.equal(owner.options.config.providers["lm-studio"], undefined, "discovery must not become saved configuration");
  await owner.update({ config: { ...config, providers: { "edited-provider": profile } } });
  await waitFor("edited-provider");
  assert.equal(ctx.llm.listProviders().some(row => row.id === "saved-provider"), false);
  assert.ok(ctx.llm.listProviders().some(row => row.id === "lm-studio"));
});

// Execute the production adapter and lifecycle core. Control only the DSH
// boundary, local HTTP/CLI and process channel; no real services are touched.
function fixture(t, { fetch, refusePublication = false, env = {} } = {}) {
  const module = { exports: {} };
  const port = new EventEmitter();
  Object.assign(port, { env, platform: process.platform, cwd: () => "/fixture" });
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
    inject(_names, callback) { callback({ settings: { configure: () => () => {} }, effect() {} }); },
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
    AbortController, AbortSignal, URL, Response, TextDecoder, structuredClone,
    setTimeout, clearTimeout, fetch,
    require(name) {
      switch (name) {
        case "@deepseek-ai/dsh-credentials": return { credentialRef: value => value };
        case "@deepseek-ai/dsh-launch-environment": return { launchEnvironmentOf: () => ({ get: () => undefined }) };
        case "@deepseek-ai/dsh-llm-pi-ai": return { Config: schema.object({ providers: schema.dict(schema.any()).default({}).volatile() }) };
        case "@deepseek-ai/schemastery": return schema;
        default: return require(name);
      }
    },
  });
  let disposal;
  let resolved;
  const dispose = () => disposal ??= (async () => {
    for (const callback of disposers.toReversed()) await callback();
  })();
  t.after(dispose);
  return {
    validate: config => module.exports.Config(config),
    apply: config => {
      resolved = module.exports.Config({ lmStudio: { enabled: false }, ollama: { enabled: false }, ...config });
      return module.exports.apply(ctx, resolved);
    },
    async updateProviders(config, providers) {
      config.providers = providers;
      resolved.providers = { get: () => providers };
      listeners.get("loader/volatile-update")();
      await nextTurn();
    },
    async stream(provider, signal) {
      const next = async function* () { yield { type: "fixture-response", provider }; };
      const stream = listeners.get("llm/stream")({ provider, model: "fixture", signal }, next);
      return await Array.fromAsync(stream);
    },
    dispose, mounts, updates, warnings, servers, port, sent,
  };
}

const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("desktop launch preferences supply local defaults without a provider config overlay", t => {
  const f = fixture(t, { env: {
    MINKE_LM_STUDIO_ENABLED: "1", MINKE_LM_STUDIO_COMMAND: "/fixture/lms",
    LM_STUDIO_BASE_URL: "http://127.0.0.1:39456/v1",
    MINKE_OLLAMA_ENABLED: "0", MINKE_OLLAMA_COMMAND: "/fixture/ollama",
  } });
  const config = f.validate({ providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } } });
  assert.equal(config.lmStudio.enabled, true);
  assert.equal(config.lmStudio.lifecycle, "ensure-running");
  assert.equal(config.lmStudio.command, "/fixture/lms");
  assert.equal(config.lmStudio.baseURL, "http://127.0.0.1:39456/v1");
  assert.equal(config.ollama.enabled, true);
  assert.equal(config.ollama.lifecycle, "external");
  assert.equal(config.providers.get().openai.apiKeyEnv, "OPENAI_API_KEY");
  assert.equal(f.validate({ lmStudio: { enabled: false } }).lmStudio.enabled, false);
});

test("saved providers survive local discovery and native live settings updates", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, { fetch: async () => {
    await release.promise;
    return json({ data: [{ id: "local-model" }] });
  } });
  const config = {
    providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } },
    ollama: { enabled: true, lifecycle: "external" },
  };
  try {
    await f.apply(config);
    assert.equal(f.mounts[0].providers.openai?.apiKeyEnv, "OPENAI_API_KEY");
  } finally {
    release.resolve();
  }
  await f.stream("ollama");
  assert.equal(f.updates.at(-1).providers.openai.apiKeyEnv, "OPENAI_API_KEY");
  assert.ok(f.updates.at(-1).providers.ollama);
  await f.updateProviders(config, { anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" } });
  assert.equal(f.updates.at(-1).providers.openai, undefined);
  assert.equal(f.updates.at(-1).providers.anthropic.apiKeyEnv, "ANTHROPIC_API_KEY");
  assert.ok(f.updates.at(-1).providers.ollama);
  await f.updateProviders(config, { ollama: { baseURL: "http://localhost:11435/v1", models: [] } });
  assert.equal(f.updates.at(-1).providers.ollama.baseURL, "http://localhost:11435/v1");
});

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
