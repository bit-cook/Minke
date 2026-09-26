import type { ManagedTab } from "../types.ts";
import type { WebTabPayload } from "../web/types.ts";

export type PluginTab = ManagedTab<WebTabPayload>;

export function isPluginTab(tab: ManagedTab): tab is PluginTab {
  return tab.kind === "plugin-catalog";
}
