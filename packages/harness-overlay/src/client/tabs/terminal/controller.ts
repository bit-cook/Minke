import { mainSessionId } from "../../core/sessions.ts";
import type { HarnessClientContext } from "../../core/context.ts";
import type { TabsRuntime } from "../runtime.ts";
import type { ManagedTab } from "../types.ts";
import type { DshTerminals, DshTerminalModel, DshTerminalUI } from "./dsh.ts";
import { isTerminalTab, type TerminalTab, type TerminalTabPayload } from "./types.ts";

const OWNER = "minke.bottom";
// getRandomValues also works on HTTP origins used by remote Web clients.
function newContentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `minke-terminal:${Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")}`;
}
type Reference = ReturnType<HarnessClientContext["sessions"]["retain"]>;
type Entry = { reference: Reference; model?: DshTerminalModel; unsubscribe?: () => void };

/** Bottom placement only. DSH owns shells, connections, recovery and close. */
export class TerminalTabsController {
  readonly tabs: TabsRuntime;
  readonly sessions: HarnessClientContext["sessions"];
  readonly startSession: () => void;
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<() => void>();
  readonly #releaseTabs: () => void;
  readonly #releaseSessions: () => void;
  #knownTabs = new Map<string, TerminalTab>();
  #service?: DshTerminals;
  #ui?: DshTerminalUI;
  #revision = 0;
  #syncing = false;
  #startingSession = false;
  #disposed = false;

  constructor(tabs: TabsRuntime, sessions: HarnessClientContext["sessions"], startSession: () => void) {
    this.tabs = tabs;
    this.sessions = sessions;
    this.startSession = startSession;
    this.#releaseTabs = tabs.subscribe(() => this.#sync());
    this.#releaseSessions = sessions.list.subscribe(() => this.#sync());
  }

  readonly getSnapshot = (): number => this.#revision;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };
  get ui(): DshTerminalUI | undefined { return this.#ui; }
  model(id: string): DshTerminalModel | undefined { return this.#entries.get(id)?.model; }

  connect(service: DshTerminals, ui: DshTerminalUI): () => void {
    this.#service = service;
    this.#ui = ui;
    this.#sync();
    this.#emit();
    return () => {
      if (this.#service !== service) return;
      this.#service = undefined;
      this.#ui = undefined;
      for (const entry of this.#entries.values()) { entry.unsubscribe?.(); entry.reference.release(); }
      this.#entries.clear();
      service.retainTabs([], OWNER);
      this.#emit();
    };
  }

  create(title: string): string | undefined {
    if (this.#disposed) return;
    const sessionId = mainSessionId(this.sessions.list.getSnapshot());
    const contentId = newContentId();
    const id = this.tabs.open<TerminalTabPayload>({ kind: "terminal", key: contentId, title, payload: { sessionId, contentId } });
    if (!sessionId && !this.#startingSession) {
      this.#startingSession = true;
      this.startSession();
    }
    return id;
  }

  restart(tab: TerminalTab): void {
    const contentId = newContentId();
    this.tabs.open({ kind: "terminal", key: contentId, title: tab.title,
      payload: { sessionId: tab.payload.sessionId, contentId } });
    this.tabs.close(tab.id);
  }

  save(tab: ManagedTab): unknown {
    if (!isTerminalTab(tab)) return undefined;
    return { ...tab.payload, terminalId: this.model(tab.id)?.id ?? tab.payload.terminalId };
  }

  restore(tab: ManagedTab): void {
    const row = tab.payload as Partial<TerminalTabPayload> | null;
    if (!row || typeof row.sessionId !== "string" || typeof row.contentId !== "string" || !row.contentId.startsWith("minke-terminal:") || typeof row.terminalId !== "string") return;
    this.tabs.restore({ ...tab, payload: { sessionId: row.sessionId, contentId: row.contentId, terminalId: row.terminalId } });
  }

  dispose(): void {
    this.#disposed = true;
    this.#releaseTabs();
    this.#releaseSessions();
    for (const entry of this.#entries.values()) { entry.unsubscribe?.(); entry.reference.release(); }
    this.#entries.clear();
    this.#service?.retainTabs([], OWNER);
    this.#listeners.clear();
  }

  #sync(): void {
    const service = this.#service;
    if (!service || this.#syncing || this.#disposed) return;
    this.#syncing = true;
    try {
      const current = mainSessionId(this.sessions.list.getSnapshot());
      if (current) this.#startingSession = false;
      for (const tab of this.tabs.getSnapshot().tabs.filter(isTerminalTab)) {
        if (!tab.payload.sessionId && current) this.tabs.update(tab.id, { payload: { ...tab.payload, sessionId: current } });
      }
      const tabs = this.tabs.getSnapshot().tabs.filter(isTerminalTab);
      for (const [id, previous] of this.#knownTabs) {
        if (tabs.some(tab => tab.id === id)) continue;
        const entry = this.#entries.get(id);
        entry?.unsubscribe?.();
        if (previous.payload.sessionId) {
          service.close(previous.payload.sessionId, id, previous.payload.contentId, entry?.model?.id ?? previous.payload.terminalId);
        }
        entry?.reference.release();
        this.#entries.delete(id);
      }
      this.#knownTabs = new Map(tabs.map(tab => [tab.id, tab]));
      service.retainTabs(tabs.flatMap(tab => tab.payload.sessionId ? [{ sessionId: tab.payload.sessionId, tabId: tab.id, contentId: tab.payload.contentId }] : []), OWNER);
      for (const tab of tabs) {
        const { sessionId } = tab.payload;
        if (!sessionId || this.#entries.has(tab.id) || !this.sessions.list.getSnapshot().byId[sessionId]) continue;
        const reference = this.sessions.retain(sessionId, { source: "minkeTerminal" });
        const entry: Entry = { reference };
        this.#entries.set(tab.id, entry);
        void reference.ready.then(() => {
          if (this.#disposed || this.#service !== service || this.#entries.get(tab.id) !== entry) return;
          const model = service.view(sessionId, tab.id, tab.payload.contentId, tab.payload.terminalId);
          entry.model = model;
          const changed = (): void => {
            const title = model.state.getSnapshot().title || tab.title;
            if (this.tabs.tab(tab.id)?.title !== title) this.tabs.update(tab.id, { title });
            this.#emit();
          };
          entry.unsubscribe = model.state.subscribe(changed);
          // Save the Host identity before a refresh can lose the binding.
          this.tabs.update(tab.id, { payload: { ...tab.payload, terminalId: model.id } });
          changed();
        }).catch(error => {
          if (this.#entries.get(tab.id) === entry) {
            this.tabs.update(tab.id, { payload: { ...tab.payload, error: error instanceof Error ? error.message : String(error) } });
            this.#emit();
          }
        });
      }
    } finally { this.#syncing = false; }
  }

  #emit(): void { this.#revision++; for (const listener of this.#listeners) listener(); }
}
