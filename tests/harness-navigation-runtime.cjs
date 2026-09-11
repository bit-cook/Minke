"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const { mkdirSync, mkdtempSync, rmSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");
const { buildSync } = require("esbuild");

const temporaryRoot = mkdtempSync(join(tmpdir(), "minke-navigation-runtime-"));
const userData = join(temporaryRoot, "user-data");
mkdirSync(userData);
app.setPath("userData", userData);
app.on("window-all-closed", () => {});

const bundle = join(temporaryRoot, "harness-lifecycle.cjs");
buildSync({
  bundle: true,
  entryPoints: [join(__dirname, "..", "desktop", "main", "harness-lifecycle.ts")],
  outfile: bundle,
  format: "cjs",
  platform: "node",
});
const { HarnessLifecycle } = require(bundle);

async function checkNavigation({ delayMs, navigationTimeoutMs, retry }) {
  let pageRequests = 0;
  let runtimeStarts = 0;
  let remoteStarts = 0;
  let retryRequests = 0;
  const token = "a".repeat(43);
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (url.searchParams.has("token")) {
      assert.equal(url.searchParams.get("token"), token);
      response.writeHead(303, { location: "/" });
      response.end();
      return;
    }
    if (url.pathname !== "/") {
      response.writeHead(404);
      response.end();
      return;
    }
    pageRequests += 1;
    const timer = setTimeout(() => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Ready</title><p>Page loaded</p>");
    }, pageRequests === 1 ? delayMs : 0);
    response.once("close", () => clearTimeout(timer));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${String(server.address().port)}`;
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const lifecycle = new HarnessLifecycle({
    runtime: {
      async start() {
        runtimeStarts += 1;
        return { origin, authenticatedUrl: `${origin}/?token=${token}`, launchToken: token };
      },
    },
    remote: {
      async detach() {},
      async start() { remoteStarts += 1; },
    },
    ...(navigationTimeoutMs === undefined ? {} : { navigationTimeoutMs }),
    ...(retry === undefined ? {} : {
      async requestNavigationRetry(error) {
        retryRequests += 1;
        assert.equal(error.name, "HarnessNavigationError");
        assert.match(error.message, /did not finish within 1000 ms/u);
        assert.equal(runtimeStarts, 1);
        assert.equal(remoteStarts, 0);
        return retry && retryRequests === 1;
      },
    }),
  });
  try {
    if (retry === false) {
      await assert.rejects(lifecycle.start(window), { name: "HarnessNavigationError" });
      assert.equal(retryRequests, 1);
      assert.equal(remoteStarts, 0);
    } else {
      const startedAt = performance.now();
      assert.equal(await lifecycle.start(window), origin);
      if (retry === undefined) {
        assert.ok(performance.now() - startedAt >= 15_000);
      }
      assert.equal(window.webContents.getTitle(), "Ready");
      assert.deepEqual(
        await window.webContents.executeJavaScript(
          "[document.readyState, document.querySelector('p').textContent]",
        ),
        ["complete", "Page loaded"],
      );
      assert.equal(remoteStarts, 1);
      assert.equal(retryRequests, retry === true ? 1 : 0);
    }
    assert.equal(runtimeStarts, 1);
  } finally {
    window.destroy();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function run() {
  await app.whenReady();
  // Keep the default-budget check independent of the developer's overrides.
  for (const name of Object.keys(process.env)) {
    if (name.toUpperCase() === "MINKE_HARNESS_NAVIGATION_TIMEOUT_MS") delete process.env[name];
  }
  await checkNavigation({ delayMs: 20_000 });
  console.log("PASS: real Electron navigation can take more than 15 seconds");
  await checkNavigation({ delayMs: 5_000, navigationTimeoutMs: 1_000, retry: true });
  console.log("PASS: timed-out navigation reloads without restarting the backend");
  await checkNavigation({ delayMs: 5_000, navigationTimeoutMs: 1_000, retry: false });
  console.log("PASS: declining reload keeps remote access disabled");
}

run().then(
  () => {
    rmSync(temporaryRoot, { recursive: true, force: true });
    app.exit(0);
  },
  error => {
    console.error(error);
    rmSync(temporaryRoot, { recursive: true, force: true });
    app.exit(1);
  },
);
