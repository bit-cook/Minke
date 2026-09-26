import type { TabsRuntime } from "./runtime.ts";
import type { TabRendererRegistry } from "./registry.ts";
import type { ManagedTab } from "./types.ts";

export interface TabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function savedTab(value: unknown): value is ManagedTab {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && /^(?:bottom-)?tab-\d+$/u.test(row.id)
    && typeof row.kind === "string" && typeof row.key === "string" && row.key.length > 0
    && typeof row.title === "string";
}

/** Per-window content survives refresh; DSH remains the owner of sidebar layout. */
export function persistTabs(tabs: TabsRuntime, renderers: TabRendererRegistry, placement: "right" | "bottom", storage: TabStorage): { start(): () => void } {
  const key = `minke.tabs.content.v1.${placement}`;
  let previous: string | undefined;
  let failed = false;
  try {
    const raw = storage.getItem(key);
    const value: unknown = raw === null ? undefined : JSON.parse(raw);
    if (typeof value === "object" && value !== null && "tabs" in value && Array.isArray(value.tabs)) {
      for (const row of value.tabs) {
        if (!savedTab(row) || row.id.startsWith("bottom-") !== (placement === "bottom")) continue;
        try { renderers.get(row.kind)?.persistence?.restore(row); }
        catch (error) { console.warn("Unable to restore tab content", error); }
      }
      if ("activeId" in value && typeof value.activeId === "string" && tabs.tab(value.activeId)) {
        tabs.projectLayout([], value.activeId, "visible" in value && value.visible === true);
      }
    }
  } catch (error) { console.warn("Unable to read tab content", error); }
  const save = (): void => {
    try {
      const snapshot = tabs.getSnapshot();
      const rows = snapshot.tabs.flatMap(tab => {
        const codec = renderers.get(tab.kind)?.persistence;
        return codec ? [{ ...tab, payload: codec.save(tab) }] : [];
      });
      const serialized = JSON.stringify({ tabs: rows, activeId: snapshot.activeId, visible: snapshot.visible });
      if (serialized === previous) { failed = false; return; }
      storage.setItem(key, serialized);
      previous = serialized;
      failed = false;
    } catch (error) { failed = true; console.warn("Unable to retain tab content for refresh", error); }
  };
  return { start() {
    const unsubscribe = tabs.subscribe(save);
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      save();
      if (failed) event.preventDefault();
    };
    const view = typeof window === "undefined" ? undefined : window;
    view?.addEventListener("beforeunload", beforeUnload);
    save();
    return () => { unsubscribe(); view?.removeEventListener("beforeunload", beforeUnload); };
  } };
}

/** Storage may be disabled by the browser; the active workspace stays usable. */
export function tabSessionStorage(): TabStorage | undefined {
  try { return globalThis.sessionStorage; }
  catch { return undefined; }
}
