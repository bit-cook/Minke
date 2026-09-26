import { TABS_WEB_PARTITION } from "@minke/harness-overlay/tabs/contract.ts";

export const WEB_GUEST_PREFERENCES = Object.freeze([
  "contextIsolation=yes", "nodeIntegration=no", "sandbox=yes", "webSecurity=yes",
]);

/** Shared security boundary for ordinary browsing and read-only discovery. */
export function configureWebGuest(
  view: { className: string; setAttribute(name: string, value: string): void },
  options: { url: string; label: string; allowPopups: boolean },
): void {
  view.className = "minke-tabs-view__guest";
  if (options.allowPopups) view.setAttribute("allowpopups", "");
  view.setAttribute("src", options.url);
  view.setAttribute("partition", TABS_WEB_PARTITION);
  view.setAttribute("webpreferences", WEB_GUEST_PREFERENCES.join(","));
  view.setAttribute("aria-label", options.label);
}
