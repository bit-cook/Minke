import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { adaptHarnessCleaner, cleanHarnessSource } from "../scripts/harness/clean-source.mjs";

async function fixture(t, outDir = "lib/desktop-keyboard-test-types") {
  const root = await mkdtemp(join(tmpdir(), "minke-harness-clean-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "node_modules"));
  await mkdir(join(root, "packages"));
  for (const script of ["clean.ts", "ts-project.ts"]) {
    await cp(new URL(`../vendor/deepseek-harness/scripts/${script}`, import.meta.url), join(root, "scripts", script));
  }
  await symlink(resolve("vendor/deepseek-harness/node_modules/typescript"), join(root, "node_modules/typescript"), "junction");
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { outDir }, files: ["source.ts"] }));
  await writeFile(join(root, "source.ts"), "export const keep = true;");
  await mkdir(join(root, "lib/desktop-keyboard-test-types"), { recursive: true });
  await writeFile(join(root, "lib/desktop-keyboard-test-types/output.js"), "generated");
  await writeFile(join(root, "lib/keep.txt"), "unrelated");
  return root;
}

test("the rc.2 cleaner removes only the declared keyboard test output", async t => {
  const root = await fixture(t);
  await cleanHarnessSource(root);
  await assert.rejects(readFile(join(root, "lib/desktop-keyboard-test-types/output.js")), { code: "ENOENT" });
  assert.equal(await readFile(join(root, "lib/keep.txt"), "utf8"), "unrelated");
  assert.equal(await readFile(join(root, "source.ts"), "utf8"), "export const keep = true;");
});

test("the cleaner still refuses unknown output paths before removing anything", async t => {
  const root = await fixture(t, "lib/unrecognized-output");
  await assert.rejects(cleanHarnessSource(root), /expected TypeScript outDir/);
  assert.equal(await readFile(join(root, "lib/desktop-keyboard-test-types/output.js"), "utf8"), "generated");
});

test("an upstream cleaner change requires review before the adapter runs", () => {
  assert.throws(() => adaptHarnessCleaner("changed cleaner"), /Harness cleaner changed/);
});
