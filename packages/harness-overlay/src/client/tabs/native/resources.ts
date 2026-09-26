import { RemoteError, type RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TabsRuntime } from "../runtime.ts";
import { minkeTabId } from "./contract.ts";

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap {
    "minke/tab-not-found": Record<string, never>;
  }
}

interface TabResource {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
}

/** Public DSH resource-provider contract, without importing its client runtime. */
interface MinkeTabResourceProvider {
  readonly protocol: "minke-tab";
  open(address: string, context: { signal: AbortSignal }): AsyncIterable<RemoteResult<TabResource>>;
}
export interface MinkeTabResources {
  register(provider: MinkeTabResourceProvider): () => void;
}

/** Pins retain a view of the global content; releasing a session pin is not a tab close. */
export function minkeTabResourceProvider(tabs: TabsRuntime): MinkeTabResourceProvider {
  return {
    protocol: "minke-tab",
    async *open(address, { signal }) {
      if (signal.aborted) return;
      const id = minkeTabId(address);
      let revision = 0;
      let wake: (() => void) | undefined;
      const changed = (): void => { revision += 1; wake?.(); };
      const unsubscribe = tabs.subscribe(changed);
      signal.addEventListener("abort", changed, { once: true });
      try {
        while (!signal.aborted) {
          const before = revision;
          const tab = id === undefined ? undefined : tabs.tab(id);
          if (!tab) {
            yield { ok: false, error: new RemoteError("minke/tab-not-found", "The tab has been closed.", {}) };
            return;
          }
          yield { ok: true, value: { id: tab.id, kind: tab.kind, title: tab.title } };
          await new Promise<void>(resolve => {
            wake = resolve;
            if (signal.aborted || revision !== before) resolve();
          });
          wake = undefined;
        }
      } finally {
        unsubscribe();
        signal.removeEventListener("abort", changed);
      }
    },
  };
}
