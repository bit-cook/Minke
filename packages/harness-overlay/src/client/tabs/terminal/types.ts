import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";

export interface TerminalTabPayload {
  readonly sessionId?: string;
  readonly contentId: string;
  readonly terminalId?: string;
  readonly error?: string;
}

export type TerminalTab = ManagedTab<TerminalTabPayload>;

export function isTerminalTab(tab: ManagedTab): tab is TerminalTab {
  return tab.kind === "terminal";
}
