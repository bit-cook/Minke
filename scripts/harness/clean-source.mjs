import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

// dsh-v0.1.7-rc.2 adds this output to the root project graph but omits it
// from RepositoryCleaner's allowed outputs. Keep the immutable vendor source
// and all of its path/orphan checks; retire this adapter when upstream fixes it.
export function adaptHarnessCleaner(source) {
  const seam = "typesDirectory === nativeEntryOutput";
  if (source.split(seam).length !== 2) {
    throw new Error("Harness cleaner changed; review the desktop keyboard output adapter");
  }
  return source.replace(seam,
    "(typesDirectory === nativeEntryOutput || typesDirectory === join(this.root, 'lib/desktop-keyboard-test-types'))");
}

export async function cleanHarnessSource(harnessRoot) {
  harnessRoot = await realpath(harnessRoot);
  const cleanerUrl = pathToFileURL(resolve(harnessRoot, "scripts/clean.ts")).href;
  const projectUrl = pathToFileURL(resolve(harnessRoot, "scripts/ts-project.ts")).href;
  const hook = registerHooks({
    load(url, context, nextLoad) {
      if (url !== cleanerUrl && url !== projectUrl) return nextLoad(url, context);
      const source = readFileSync(new URL(url), "utf8");
      return {
        shortCircuit: true,
        format: "module",
        source: transformSync(url === cleanerUrl ? adaptHarnessCleaner(source) : source, {
          loader: "ts",
          format: "esm",
          sourcefile: url,
        }).code,
      };
    },
  });
  try {
    const { RepositoryCleaner } = await import(cleanerUrl);
    const removed = await new RepositoryCleaner(harnessRoot).clean();
    console.log(`clean: removed ${removed.length} paths`);
  } finally {
    hook.deregister();
  }
}
