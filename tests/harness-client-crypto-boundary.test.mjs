import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import {
  applyHarnessRuntimePatches,
  resolveHarnessRuntimePatches,
  verifyHarnessRuntimePatchesApplied,
} from "../scripts/harness/runtime-patches.mjs";
import {
  inspectHarnessClientArtifact,
  inspectHarnessClientCryptoBoundary,
} from "../scripts/harness/client-crypto-boundary.mjs";

test("the v0.3 secure-context-only UUID call is rejected", () => {
  assert.throws(
    () =>
      inspectHarnessClientArtifact(
        "function mintRpcId() { return RpcId(crypto.randomUUID()); }\n",
        "node_modules/@deepseek-ai/dsh-host-apiproxy/lib/client.js",
      ),
    /secure-context-only crypto\.randomUUID/u,
  );
});

test("the browser-compatible UUID implementation is accepted", () => {
  assert.doesNotThrow(() =>
    inspectHarnessClientArtifact(
      [
        "export function randomUUID() {",
        "  return globalThis.crypto.getRandomValues(new Uint8Array(16));",
        "}",
        "",
      ].join("\n"),
      "node_modules/@deepseek-ai/dsh-util-crypto/lib/client.js",
    ),
  );
});

test("Host-only crypto imports are rejected from browser artifacts", () => {
  assert.throws(
    () =>
      inspectHarnessClientArtifact(
        'import { randomUUID } from "node:crypto";\nrandomUUID();\n',
        "node_modules/@deepseek-ai/example/lib/client.js",
      ),
    /Host-only node:crypto/u,
  );
});

test("the document-preview patch retains PDF identifiers without secure-context crypto", async () => {
  const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const runtimeRoot = await mkdtemp(join(tmpdir(), "minke-preview-crypto-"));
  const artifact = "node_modules/@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js";
  const target = join(runtimeRoot, artifact);
  try {
    const upstream = await readFile(join(projectRoot,
      "vendor/deepseek-harness/packages/client/ui-sidebar-documentpreview/lib/client.js"), "utf8");
    // The unpatched pinned artifact is the negative control for the shipped boundary.
    assert.throws(() => inspectHarnessClientArtifact(upstream, artifact),
      /secure-context-only crypto\.randomUUID/u);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, upstream);
    const patches = await resolveHarnessRuntimePatches(projectRoot, [
      "patches/deepseek-harness/document-preview-browser-crypto.patch",
    ]);
    await applyHarnessRuntimePatches(runtimeRoot, patches);
    await verifyHarnessRuntimePatchesApplied(runtimeRoot, patches);
    const patched = await readFile(target, "utf8");
    assert.doesNotThrow(() => inspectHarnessClientArtifact(patched, artifact));

    // Exercise the pinned PDF.js helper with the Web Crypto surface available on HTTP.
    const helper = patched.match(/function getUuid\(\) \{[\s\S]*?\n\t\t\}/u)?.[0];
    assert.ok(helper, "the bundled PDF.js identifier helper must exist");
    const requests = [];
    const ids = runInNewContext(`${helper}\n[getUuid(), getUuid()]`, {
      crypto: {
        getRandomValues(bytes) {
          requests.push(bytes.length);
          return bytes.fill(requests.length);
        },
      },
      bytesToString: (bytes) => String.fromCharCode(...bytes),
    });
    assert.deepEqual(requests, [32, 32]);
    assert.deepEqual(Array.from(ids), ["\x01".repeat(32), "\x02".repeat(32)]);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("the staged-runtime inspection covers dynamic and static browser code", async () => {
  const runtimeRoot = await mkdtemp(
    join(tmpdir(), "minke-client-crypto-boundary-"),
  );
  const clientBundle = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "example",
    "lib",
    "client.js",
  );
  const frontendBundle = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "dsh-web-frontend",
    "dist",
    "assets",
    "index.js",
  );
  try {
    await mkdir(join(clientBundle, ".."), { recursive: true });
    await mkdir(join(frontendBundle, ".."), { recursive: true });
    await writeFile(
      clientBundle,
      "globalThis.crypto.getRandomValues(new Uint8Array(16));\n",
    );
    await writeFile(frontendBundle, "globalThis.__DSH_BOOT__;\n");

    assert.deepEqual(
      await inspectHarnessClientCryptoBoundary(
        runtimeRoot,
        "@deepseek-ai/dsh-web-frontend",
      ),
      { artifacts: 2 },
    );

    await writeFile(
      clientBundle,
      "globalThis.crypto.randomUUID();\n",
    );
    await assert.rejects(
      inspectHarnessClientCryptoBoundary(
        runtimeRoot,
        "@deepseek-ai/dsh-web-frontend",
      ),
      /secure-context-only crypto\.randomUUID/u,
    );
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
