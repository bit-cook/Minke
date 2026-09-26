import type {
  TabsRuntime,
} from "./runtime.ts";

export interface BottomTabsDefaultCreator {
  create(
    title: string,
  ): string | undefined;
}

export interface BottomTabsToggleOptions {
  readonly defaultTitle: () => string;
  readonly runtime: TabsRuntime;
  readonly terminal?: BottomTabsDefaultCreator;
}

/**
 * Keep every bottom-panel entry point on the same first-open policy.
 * Existing tabs toggle normally; an empty workspace starts a Terminal.
 */
export function createBottomTabsToggle({
  defaultTitle,
  runtime,
  terminal,
}: BottomTabsToggleOptions): () => void {
  return () => {
    const snapshot = runtime.getSnapshot();
    if (snapshot.visible) {
      runtime.hide();
      return;
    }
    if (snapshot.tabs.length === 0 && terminal !== undefined) {
      const tabId = terminal.create(
        defaultTitle(),
      );
      if (tabId !== undefined) return;
    }
    runtime.show();
  };
}
