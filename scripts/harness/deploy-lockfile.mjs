import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import yaml from "js-yaml";

const slash = path => path.replaceAll("\\", "/");

/** Add the generated root to a disposable copy of the pinned dependency graph. */
export async function writeDeployLockfile(harnessRoot, generatedDir, packages, manifest) {
  const locked = yaml.load(await readFile(join(harnessRoot, "pnpm-lock.yaml"), "utf8"));
  const dependencies = {};
  for (const [name, specifier] of Object.entries(manifest.dependencies)) {
    const workspace = packages.get(name);
    if (workspace) {
      const importer = slash(relative(harnessRoot, workspace.path));
      if (!locked.importers[importer]) throw new Error(`Missing locked workspace ${name}`);
      dependencies[name] = { specifier, version: `link:${slash(relative(generatedDir, workspace.path))}` };
    } else {
      const source = locked.importers["."];
      const entry = source.dependencies?.[name] ?? source.devDependencies?.[name];
      if (!entry || entry.specifier !== specifier) throw new Error(`No exact pinned runtime dependency ${name}@${specifier}`);
      dependencies[name] = structuredClone(entry);
    }
  }
  const importers = Object.fromEntries(Object.entries(locked.importers).map(([path, value]) => [
    slash(relative(generatedDir, resolve(harnessRoot, path))) || ".", value,
  ]));
  importers["."] = { dependencies };
  await writeFile(join(generatedDir, "pnpm-lock.yaml"), yaml.dump({ ...locked, importers }, { lineWidth: -1, noRefs: true }));
}
