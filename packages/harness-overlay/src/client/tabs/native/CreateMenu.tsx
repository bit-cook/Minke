import { useId, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { TabsCreateMenu, type TabsCreateMenuOption } from "../TabsCreateMenu.tsx";
import type { TabCreateShortcutBindings } from "../create-shortcuts.ts";
import type { TabsTranslate } from "../locales.ts";
import type { TabRendererRegistry } from "../registry.ts";
import type { NativeSidebarService, NativeTabRegistry } from "./contract.ts";
import type { NativeTabsRuntime } from "./runtime.ts";

interface CreateRequest {
  readonly anchor: HTMLButtonElement;
  readonly sessionId: string;
  readonly paneId: string;
}

interface NativeTabsCreateMenuProps {
  native: NativeTabsRuntime;
  sidebar: NativeSidebarService;
  registry: NativeTabRegistry;
  renderers: TabRendererRegistry;
  createShortcuts: TabCreateShortcutBindings;
  currentCwd(): string | undefined;
  t: TabsTranslate;
}

/** The pinned DSH add button has a DOM marker but no replacement slot. Route
 * its activation to the shared menu; layout changes still go through DSH. */
export function NativeTabsCreateMenu({ native, sidebar, registry, renderers, createShortcuts, currentCwd, t }: NativeTabsCreateMenuProps): ReactNode {
  const menuId = useId();
  const [request, setRequest] = useState<CreateRequest | null>(null);
  useSyncExternalStore(renderers.subscribe, renderers.getSnapshot, renderers.getSnapshot);
  useSyncExternalStore(createShortcuts.subscribe, createShortcuts.getSnapshot, createShortcuts.getSnapshot);
  const entries = useSyncExternalStore(
    listener => registry.subscribe(listener), () => registry.guide(), () => registry.guide(),
  ).filter(entry => entry.kind !== "minke.launcher");

  useLayoutEffect(() => {
    const selector = "[data-sidebar-right-panel] [data-dockkit-add-tab]";
    const attributes = ["aria-haspopup", "aria-expanded", "aria-controls"] as const;
    const originals = new Map<HTMLButtonElement, (string | null)[]>();
    const restore = (button: HTMLButtonElement, values: readonly (string | null)[]): void => {
      attributes.forEach((name, index) => {
        const value = values[index];
        if (value == null) button.removeAttribute(name);
        else button.setAttribute(name, value);
      });
    };
    const reconcile = (): void => {
      for (const [button, values] of originals) {
        if (button.isConnected) continue;
        restore(button, values);
        originals.delete(button);
      }
      for (const button of document.querySelectorAll<HTMLButtonElement>(selector)) {
        if (!originals.has(button)) originals.set(button, attributes.map(name => button.getAttribute(name)));
        const expanded = request?.anchor === button;
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", String(expanded));
        if (expanded) button.setAttribute("aria-controls", menuId);
        else button.removeAttribute("aria-controls");
      }
      if (request && (!request.anchor.isConnected || !native.canCreateIn(request.sessionId, request.paneId))) {
        setRequest(null);
      }
    };
    const trigger = (event: MouseEvent | KeyboardEvent): void => {
      const keyboard = event instanceof KeyboardEvent;
      if (keyboard && event.key !== "ArrowDown") return;
      const anchor = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>(selector) : null;
      const sessionId = native.sessionId;
      const paneId = anchor?.dataset.dockkitAddTab;
      if (!anchor || !sessionId || !paneId || !native.canCreateIn(sessionId, paneId)) return;
      event.preventDefault();
      event.stopPropagation();
      setRequest(current => !keyboard && current?.anchor === anchor ? null : { anchor, sessionId, paneId });
    };
    reconcile();
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-sidebar-right-open", "data-sidebar-right-panel"],
    });
    const release = native.subscribe(reconcile);
    document.addEventListener("click", trigger, true);
    document.addEventListener("keydown", trigger, true);
    return () => {
      observer.disconnect();
      release();
      document.removeEventListener("click", trigger, true);
      document.removeEventListener("keydown", trigger, true);
      for (const [button, values] of originals) restore(button, values);
    };
  }, [menuId, native, request]);

  if (!request) return null;
  const { sessionId, paneId } = request;
  const options: TabsCreateMenuOption[] = [
    ...entries.map((entry): TabsCreateMenuOption => {
      const Icon = entry.icon;
      return {
        id: `dsh:${entry.providerId}:${entry.id}`, group: "DSH", label: entry.title(),
        icon: Icon ? <Icon size={16} /> : null,
        create: () => {
          if (native.canCreateIn(sessionId, paneId)) sidebar.openTab(entry.kind, { paneId });
        },
      };
    }),
    ...renderers.creators().map((option): TabsCreateMenuOption => ({
      ...option, group: "Minke",
      create: context => native.createInPane(sessionId, paneId, () => option.create(context)),
    })),
  ];
  return <TabsCreateMenu
    anchor={request.anchor} id={menuId} open
    label={t("tab.new")} placement="right" context={{ cwd: currentCwd() }}
    options={options} onClose={() => setRequest(null)}
    shortcutBinding={id => createShortcuts.binding("right", id)}
    shortcutPlatform={createShortcuts.platform}
  />;
}
