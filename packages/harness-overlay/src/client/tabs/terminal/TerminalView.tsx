import { useSyncExternalStore, type ReactNode } from "react";
import type { TerminalTabsController } from "./controller.ts";
import type { TerminalTab } from "./types.ts";
import type { TerminalTabsTranslate } from "./locales.ts";

/** Both placements render the exact screen owned by DSH's terminal plugin. */
export function TerminalView({ tab, active, visible, controller, t }: {
  tab: TerminalTab;
  active: boolean;
  visible: boolean;
  controller: TerminalTabsController;
  t: TerminalTabsTranslate;
}): ReactNode {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const model = controller.model(tab.id);
  const View = controller.ui?.View;
  return <div id={`minke-tab-view-${tab.id}`} className="minke-tabs-view minke-terminal-view"
    role="tabpanel" aria-labelledby={`minke-tab-${tab.id}`} hidden={!active} data-terminal-placement="bottom">
    {model && View ? <View model={model} visible={active && visible} onNewTerminal={() => controller.restart(tab)} /> :
      <div className="minke-terminal-state" role={tab.payload.error ? "alert" : "status"}>
        {tab.payload.error || t("terminal.state.starting")}
      </div>}
  </div>;
}
