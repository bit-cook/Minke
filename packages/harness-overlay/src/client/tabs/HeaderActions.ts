import { PanelHeaderIcon } from "../core/HeaderIcons.tsx";
import {
  createElement,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  tabsPanelId,
  type TabsPanelPlacement,
} from "./constants.ts";
import type {
  TabsTranslate,
} from "./locales.ts";
import type {
  TabsRuntime,
} from "./runtime.ts";
import type {
  RightTabsPresentationPort,
} from "./responsive-right-host.ts";
import type { NativeTabsRuntime } from "./native/runtime.ts";

export interface TabsHeaderActionProps {
  native?: NativeTabsRuntime;
  /** Blank sessions have no DSH header corner to reopen a collapsed Sidebar. */
  nativeOpener?: boolean;
  runtimes: Readonly<
    Record<TabsPanelPlacement, TabsRuntime>
  > & {
    readonly toggleBottom?: () => void;
  };
  presentation?: RightTabsPresentationPort;
  t: TabsTranslate;
}

interface SessionListSelection {
  readonly current: string | undefined;
  readonly byId: Readonly<
    Record<string, { readonly blank?: boolean } | undefined>
  >;
}

const ignorePresentationChanges = () => () => {};
const dockedPresentation = () => "docked" as const;

function useRightDrawerOpen(
  runtimes: TabsHeaderActionProps["runtimes"],
  presentation: RightTabsPresentationPort | undefined,
): boolean {
  const rightSnapshot = useSyncExternalStore(
    runtimes.right.subscribe,
    runtimes.right.getSnapshot,
    runtimes.right.getSnapshot,
  );
  const rightPresentation = useSyncExternalStore(
    presentation?.subscribe ?? ignorePresentationChanges,
    presentation?.getSnapshot ?? dockedPresentation,
    presentation?.getSnapshot ?? dockedPresentation,
  );
  return rightSnapshot.visible && rightPresentation === "drawer";
}

interface NewSessionTabsHeaderActionProps
  extends TabsHeaderActionProps {
  useSessions: <T>(
    selector: (state: SessionListSelection) => T,
  ) => T;
}

/** Toggle the independent bottom and right Tabs docks. */
export function TabsHeaderAction({
  native,
  nativeOpener = false,
  runtimes,
  presentation,
  t,
}: TabsHeaderActionProps): ReactNode {
  useSyncExternalStore(native?.subscribe ?? ignorePresentationChanges, native?.getSnapshot ?? (() => 0), () => 0);
  const bottomSnapshot = useSyncExternalStore(
    runtimes.bottom.subscribe,
    runtimes.bottom.getSnapshot,
    runtimes.bottom.getSnapshot,
  );
  const rightDrawerOpen = useRightDrawerOpen(
    runtimes,
    presentation,
  );
  const rightSnapshot = runtimes.right.getSnapshot();
  if (rightDrawerOpen) return null;
  return createElement(
    "div",
    {
      "data-minke-tabs-layout-actions": "",
      role: "group",
      "aria-label": t("header.placement"),
    },
    (["bottom", "right"] as const).filter(placement =>
      placement === "bottom" || !native?.active || (nativeOpener && !rightSnapshot.visible)
    ).map((placement) => {
      const runtime = runtimes[placement];
      const active =
        placement === "bottom"
          ? bottomSnapshot.visible
          : rightSnapshot.visible;
      const label = t(
        placement === "bottom"
          ? active
            ? "header.closeBottom"
            : "header.openBottom"
          : active
            ? "header.closeRight"
            : "header.openRight",
      );
      return createElement(
        "button",
        {
          key: placement,
          type: "button",
          "data-minke-tabs-header-action": "",
          "data-minke-tabs-placement": placement,
          "aria-label": label,
          title: label,
          "aria-controls": placement === "right" && native?.active ? undefined : tabsPanelId(placement),
          "aria-expanded": active,
          "aria-pressed": active,
          onClick: () => {
            if (
              placement === "bottom" &&
              runtimes.toggleBottom !== undefined
            ) {
              runtimes.toggleBottom();
              return;
            }
            runtime.toggle();
          },
        },
        createElement(PanelHeaderIcon, { placement }),
      );
    }),
  );
}

/** Keep the Tabs toggles available while blank Session Header chrome is absent. */
export function NewSessionTabsHeaderAction({
  native,
  runtimes,
  presentation,
  t,
  useSessions,
}: NewSessionTabsHeaderActionProps): ReactNode {
  useSyncExternalStore(native?.subscribe ?? ignorePresentationChanges, native?.getSnapshot ?? (() => 0), () => 0);
  const isNewSession = useSessions((state) => {
    if (state.current === undefined) return true;
    return state.byId[state.current]?.blank === true;
  });
  const rightDrawerOpen = useRightDrawerOpen(
    runtimes,
    presentation,
  );
  if (!isNewSession || rightDrawerOpen) return null;

  return createElement(
    "div",
    {
      "data-minke-new-session-tabs-action": "",
      "data-native-sidebar": native?.active
        ? runtimes.right.getSnapshot().visible ? "open" : "closed"
        : undefined,
    },
    createElement(TabsHeaderAction, {
      native,
      nativeOpener: true,
      runtimes,
      presentation,
      t,
    }),
  );
}
