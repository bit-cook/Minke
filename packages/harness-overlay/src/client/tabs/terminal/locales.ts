export const terminalTabsZh = {
  "terminal.create.label": "终端",
  "terminal.tab.new": "终端",
  "terminal.state.starting": "正在启动终端…",
} as const;

export type TerminalTabsLocaleKey =
  keyof typeof terminalTabsZh;
export type TerminalTabsTranslate = (
  key: TerminalTabsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const terminalTabsEn: Record<
  TerminalTabsLocaleKey,
  string
> = {
  "terminal.create.label": "Terminal",
  "terminal.tab.new": "Terminal",
  "terminal.state.starting": "Starting terminal…",
};
