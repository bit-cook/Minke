import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TabRendererRegistry } from "@minke/harness-overlay/client/tabs/registry.ts";

test("empty Tabs offers Files, Terminal, Browser, and Plugins without chrome", () => {
  const registry = new TabRendererRegistry();
  const created = [];
  registry.register({
    kind: "files",
    createOptions: () => [
      {
        id: "files",
        label: "File manager",
        order: 0,
        icon: null,
        create: () => created.push("files"),
      },
    ],
    renderIcon: () => null,
    renderView: () => null,
  });
  registry.register({
    kind: "web",
    createOptions: () => [
      {
        id: "browser",
        label: "Browser",
        order: 20,
        icon: null,
        create: () => created.push("browser"),
      },
    ],
    renderIcon: () => null,
    renderView: () => null,
  });
  registry.register({
    kind: "plugin-catalog",
    createOptions: () => [
      {
        id: "plugins",
        label: "Plugins",
        order: 30,
        icon: null,
        create: () => created.push("plugins"),
      },
    ],
    renderIcon: () => null,
    renderView: () => null,
  });
  registry.register({
    kind: "terminal",
    createOptions: () => [
      {
        id: "terminal",
        label: "Terminal",
        order: 10,
        icon: null,
        create: () => created.push("terminal"),
      },
    ],
    renderIcon: () => null,
    renderView: () => null,
  });
  assert.deepEqual(
    registry.creators().map((option) => option.id),
    ["files", "terminal", "browser", "plugins"],
  );
  registry.creators().at(-1).create({});
  assert.deepEqual(created, ["plugins"]);

  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const emptySource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsEmptyState.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const stylesCss = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/styles.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    panelSource,
    /const showCreateChooser = !hasTabs;/u,
  );
  assert.match(panelSource, /<TabsEmptyState/u);
  assert.match(panelSource, /hasTabs\s*&&\s*\([\s\S]*minke-tabs-chrome/u);
  assert.match(panelSource, /showCreateChooser\s*&&\s*\(/u);
  assert.match(
    panelSource,
    /active=\{active && !showCreateChooser\}/u,
  );
  assert.match(emptySource, /minke-tabs-empty__option/u);
  assert.match(emptySource, /option\.create\(context\)/u);
  assert.match(emptySource, /onCreated\?\.\(\)/u);
  assert.match(stylesCss, /\.minke-tabs-empty\s*\{/u);
  assert.match(stylesCss, /\.minke-tabs-empty__option\s*\{/u);
  assert.match(
    stylesCss,
    /\.minke-tabs-empty__option\s*\{[\s\S]*?border:\s*1px solid transparent;[\s\S]*?background:\s*var\(--dsw-alias-interactive-bg-hover\);/u,
  );
  assert.doesNotMatch(
    stylesCss,
    /\.minke-tabs-empty__option:hover\s*\{[^}]*transform:/u,
  );
});
