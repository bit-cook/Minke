import type { ComponentType } from "react";
import type { HarnessClientContext } from "../../core/context.ts";
import type { TabCreateShortcutBindings } from "../create-shortcuts.ts";
import type { TabsLocaleKey } from "../locales.ts";
import type { TabRendererRegistry } from "../registry.ts";
import type { TabsRuntime } from "../runtime.ts";
import type { NativeSidebarService, NativeTabRegistry } from "./contract.ts";
import { NativeTabGuide } from "./Guide.tsx";
import { NativeTabsCreateMenu } from "./CreateMenu.tsx";
import { NativeTabsRuntime } from "./runtime.ts";
import { NativeTabBody, NativeTabTitle } from "./views.tsx";

const TABS_NAMESPACE = "minke.tabs";

export function installNativeTabs(ctx: HarnessClientContext, runtime: TabsRuntime, renderers: TabRendererRegistry, createShortcuts: TabCreateShortcutBindings): NativeTabsRuntime {
  const native = new NativeTabsRuntime(runtime, renderers);
  ctx.inject?.(["sidebarRight", "sidebarRightTabs"], scope => {
    const sidebar = scope.get("sidebarRight") as NativeSidebarService;
    const registry = scope.get("sidebarRightTabs") as NativeTabRegistry;
    scope.effect(() => {
      const registered = new Map<string, (() => void)[]>();
      const syncTypes = (): void => {
        for (const kind of renderers.kinds()) {
          if (registered.has(kind)) continue;
          const id = `@lencx/minke-harness-overlay/tab/${kind}`;
          registered.set(kind, [
            registry.register({ id, kind: `minke.${kind}`, title: () => kind }),
            ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
              name: "sidebar.right.pane.tab", key: id, inject: () => ({ native }),
            }, NativeTabBody as ComponentType<never>)),
            ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
              name: "sidebar.right.pane.tab.title", key: id, inject: () => ({ runtime, renderers }),
            }, NativeTabTitle as ComponentType<never>)),
          ]);
        }
        for (const [kind, releases] of registered) {
          if (renderers.get(kind)) continue;
          for (const release of releases.reverse()) release();
          registered.delete(kind);
        }
      };
      syncTypes();
      const releaseTypes = renderers.subscribe(syncTypes);
      const injectGuide = () => ({
        native, registry, renderers, createShortcuts,
        currentCwd: () => {
          const sessions = ctx.sessions.list.getSnapshot();
          return sessions.current === undefined ? undefined : sessions.byId[sessions.current]?.cwd;
        },
      });
      const guideId = "@lencx/minke-harness-overlay/tab/launcher";
      const t = ctx.locale.bind<TabsLocaleKey>(TABS_NAMESPACE);
      // Preserve earlier launcher addresses and contribute a doorway so DSH's
      // single-entry seed does not skip Start and open Workspace files directly.
      const releaseLauncher = registry.register({
        id: guideId, kind: "minke.launcher", title: () => t("tab.new"),
        guide: [{ order: 50, title: () => t("tab.new") }],
      });
      const releaseLauncherBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "sidebar.right.pane.tab", key: guideId, locale: TABS_NAMESPACE, inject: injectGuide,
      }, NativeTabGuide as ComponentType<never>));
      const releaseGuide = ctx.slots.inject("sidebar.right.tab.guide", () => ctx.slots.register({
        name: "sidebar.right.tab.guide", id: "@lencx/minke-harness-overlay/tab/guide", locale: TABS_NAMESPACE,
        select: () => renderers.creators().length > 0 ? true : null,
        inject: injectGuide,
      }, NativeTabGuide as ComponentType<never>));
      const releaseConnection = native.connect(sidebar);
      const releaseCreateMenu = ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "@lencx/minke-harness-overlay/tab/create-menu", locale: TABS_NAMESPACE,
        inject: () => ({ ...injectGuide(), sidebar }),
      }, NativeTabsCreateMenu as ComponentType<never>));
      return () => {
        releaseCreateMenu();
        releaseConnection();
        releaseGuide();
        releaseLauncherBody();
        releaseLauncher();
        releaseTypes();
        for (const releases of registered.values()) for (const release of releases.reverse()) release();
      };
    }, "minke-overlay: native Sidebar tabs");
  });
  return native;
}
