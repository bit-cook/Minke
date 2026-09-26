import type {
  ReactNode,
} from "react";
import type {
  ManagedTab,
  TabRenderer,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  TerminalTabsController,
} from "./controller.ts";
import {
  TerminalIcon,
} from "./icons.tsx";
import type {
  TerminalTabsTranslate,
} from "./locales.ts";
import {
  TerminalView,
} from "./TerminalView.tsx";
import {
  isTerminalTab,
} from "./types.ts";

export function createTerminalTabRenderer(
  controller: TerminalTabsController,
  t: TerminalTabsTranslate,
): TabRenderer {
  const createTerminal = (): void => {
    controller.create(t("terminal.tab.new"));
  };
  return {
    kind: "terminal",
    persistence: { save: tab => controller.save(tab), restore: tab => controller.restore(tab) },
    createOptions: () => [
      {
        id: "terminal",
        label: t("terminal.create.label"),
        order: 10,
        icon: <TerminalIcon size={20} />,
        create: createTerminal,
      },
    ],
    renderIcon: () => <TerminalIcon size={13} />,
    renderView: (
      tab: ManagedTab,
      active: boolean,
      visible = true,
    ): ReactNode =>
      isTerminalTab(tab)
        ? (
          <TerminalView
            key={tab.id}
            tab={tab}
            active={active}
            visible={visible}
            controller={controller}
            t={t}
          />
        )
        : null,
  };
}
