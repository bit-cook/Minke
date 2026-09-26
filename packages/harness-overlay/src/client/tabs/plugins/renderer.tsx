import type {
  ReactNode,
} from "react";
import type {
  ManagedTab,
  TabRenderer,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  PluginTabsController,
} from "./controller.ts";
import {
  PluginIcon,
} from "./icons.tsx";
import type {
  PluginsTranslate,
} from "./locales.ts";
import {
  PluginsView,
} from "./PluginsView.tsx";
import {
  isPluginTab,
} from "./types.ts";
import type { WebTabsTranslate } from "../web/locales.ts";

/** Plugin discovery renderer registered beside other Tabs content. */
export function createPluginTabRenderer(
  controller: PluginTabsController,
  t: PluginsTranslate,
  webT: WebTabsTranslate,
): TabRenderer {
  return {
    kind: "plugin-catalog",
    persistence: { save: tab => isPluginTab(tab) ? { url: tab.payload.url } : undefined, restore: tab => controller.restore(tab) },
    createOptions: () => [
      {
        id: "plugins",
        label: t("plugins.create.label"),
        order: 30,
        icon: <PluginIcon size={20} />,
        create: () => {
          controller.create(t("plugins.tab.title"));
        },
      },
    ],
    renderIcon: () => <PluginIcon size={13} />,
    renderView: (
      tab: ManagedTab,
      active: boolean,
    ): ReactNode =>
      isPluginTab(tab)
        ? (
          <PluginsView
            key={tab.id}
            tab={tab}
            active={active}
            controller={controller}
            t={t}
            webT={webT}
          />
        )
        : null,
  };
}
