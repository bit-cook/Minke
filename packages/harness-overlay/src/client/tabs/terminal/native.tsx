import type { TabRenderer } from "../types.ts";
import { TerminalIcon } from "./icons.tsx";
import type { TerminalTabsTranslate } from "./locales.ts";

/** Sidebar creation delegates to DSH, including its shell picker and retention. */
export function createNativeTerminalRenderer(open: () => void, t: TerminalTabsTranslate): TabRenderer {
  return {
    kind: "terminal",
    nativeKind: "terminal",
    createOptions: () => [{
      id: "terminal", nativeKind: "terminal", label: t("terminal.create.label"),
      order: 10, icon: <TerminalIcon size={20} />, create: open,
    }],
    renderIcon: () => <TerminalIcon size={13} />,
    renderView: () => null,
  };
}
