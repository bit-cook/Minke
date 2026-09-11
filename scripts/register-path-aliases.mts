import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { resolvePathAlias } from "../config/path-aliases.mts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const harnessSourcePrefix =
  `${pathToFileURL(resolve(projectRoot, "vendor/deepseek-harness")).href}/`;

registerHooks({
  load(url, context, nextLoad) {
    // Upstream source uses TypeScript parameter properties, which Node's
    // strip-only loader cannot execute in source-level compatibility tests.
    if (
      url.endsWith(".tsx") ||
      (url.startsWith(harnessSourcePrefix) && url.endsWith(".ts"))
    ) {
      const filename = fileURLToPath(url);
      const result = transformSync(readFileSync(filename, "utf8"), {
        format: "esm",
        jsx: "automatic",
        loader: url.endsWith(".tsx") ? "tsx" : "ts",
        sourcefile: filename,
        sourcemap: "inline",
        target: "es2022",
      });
      return {
        format: "module",
        shortCircuit: true,
        source: result.code,
      };
    }
    if (url.endsWith(".css")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(
          readFileSync(fileURLToPath(url), "utf8"),
        )};`,
      };
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      resolvePathAlias(specifier, projectRoot) ?? specifier,
      context,
    );
  },
});
