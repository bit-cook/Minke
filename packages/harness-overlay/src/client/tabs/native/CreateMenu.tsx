import { useId, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { Compass } from "@lucide/icons";
import { LucideIcon } from "../components/LucideIcon.ts";
import type { TabCreateShortcutBindings } from "../create-shortcuts.ts";
import type { TabsTranslate } from "../locales.ts";
import type { TabRendererRegistry } from "../registry.ts";
import { TabsCreateMenu, type TabsCreateMenuOption } from "../TabsCreateMenu.tsx";
import type { NativeSidebarService, NativeTabRegistry } from "./contract.ts";
import type { NativeTabsRuntime } from "./runtime.ts";

/** Owner props come from the pinned sidebar-add-menu slot, in the clicked pane. */
export interface NativeTabsCreateMenuProps {
  sessionId: string;
  paneId: string;
  anchor: HTMLElement;
  onClose(): void;
  native: NativeTabsRuntime;
  sidebar: NativeSidebarService;
  registry: NativeTabRegistry;
  renderers: TabRendererRegistry;
  createShortcuts: TabCreateShortcutBindings;
  currentCwd(): string | undefined;
  t: TabsTranslate;
}

/** DSH owns the button and layout; this slot only chooses the content to open. */
export function NativeTabsCreateMenu({
  sessionId, paneId, anchor, onClose, native, sidebar, registry, renderers, createShortcuts, currentCwd, t,
}: NativeTabsCreateMenuProps): ReactNode {
  const id = useId();
  const entries = useSyncExternalStore(
    listener => registry.subscribe(listener), () => registry.guide(), () => registry.guide(),
  );
  useSyncExternalStore(renderers.subscribe, renderers.getSnapshot, renderers.getSnapshot);
  useSyncExternalStore(createShortcuts.subscribe, createShortcuts.getSnapshot, createShortcuts.getSnapshot);
  useLayoutEffect(() => {
    const previous = ["aria-haspopup", "aria-expanded", "aria-controls"].map(name => [name, anchor.getAttribute(name)] as const);
    anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "true");
    anchor.setAttribute("aria-controls", id);
    return () => {
      for (const [name, value] of previous) {
        if (value === null) anchor.removeAttribute(name);
        else anchor.setAttribute(name, value);
      }
    };
  }, [anchor, id]);
  const nativeOptions: TabsCreateMenuOption[] = entries
    .filter(entry => entry.kind !== "minke.launcher")
    .map(entry => ({
      id: `dsh:${entry.kind}:${entry.id}`, group: "DSH", label: entry.title(),
      icon: entry.icon ? <entry.icon size={20} /> : <LucideIcon icon={Compass} size={20} />,
      create: () => {
        if (sidebar.mounted.getSnapshot() === sessionId) sidebar.openTab(entry.kind, { paneId });
      },
    }));
  nativeOptions.push({
    id: "dsh:guide", group: "DSH", label: t("tab.start"), icon: <LucideIcon icon={Compass} size={20} />,
    create: () => {
      if (sidebar.mounted.getSnapshot() === sessionId) sidebar.openTab("guide", { paneId });
    },
  });
  const minkeOptions = renderers.creators().filter(option => !option.nativeKind).map(option => ({
    ...option, group: "Minke",
    create: () => native.createInPane(sessionId, paneId, () => option.create({ cwd: currentCwd() })),
  }));
  return <TabsCreateMenu
    anchor={anchor} id={id} context={{}} label={t("tab.new")} onClose={onClose}
    open placement="right" options={[...nativeOptions, ...minkeOptions]}
    shortcutBinding={optionId => createShortcuts.binding("right", optionId)}
    shortcutPlatform={createShortcuts.platform}
  />;
}
