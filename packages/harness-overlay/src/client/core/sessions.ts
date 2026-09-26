/** Session catalog fields consumed by Minke's main conversation controls. */
export interface HarnessSessionList {
  readonly byId: Readonly<Record<string, {
    readonly cwd?: string;
    readonly title?: string;
    readonly blank?: boolean;
    readonly retainedBy: Readonly<Record<string, number | undefined>>;
  } | undefined>>;
}

/** Find the main view without selecting a concurrently retained sidebar Session. */
export function mainSessionId(list: HarnessSessionList): string | undefined {
  return Object.entries(list.byId).find(
    ([, session]) => (session?.retainedBy.mainView ?? 0) > 0,
  )?.[0];
}
