import type {
  ManagedTab,
  TabInput,
  TabsHost,
  TabsLayoutDelegate,
  TabsSnapshot,
} from "./types.ts";

function readableTitle(candidate: string, fallback: string): string {
  const title = candidate.replace(/\s+/gu, " ").trim();
  return title === "" ? fallback : title.slice(0, 160);
}

function frozenSnapshot(
  tabs: readonly ManagedTab[],
  activeId: string | undefined,
  visible: boolean,
): TabsSnapshot {
  return Object.freeze({
    tabs: Object.freeze(tabs.map((tab) => Object.freeze({ ...tab }))),
    activeId,
    visible,
  });
}

/**
 * Content-agnostic tab identity and visibility state. Content families own
 * their payloads and controls through renderers registered beside this core.
 */
export class TabsRuntime {
  readonly #host: TabsHost;
  readonly #idPrefix: string;
  readonly #listeners = new Set<() => void>();
  #snapshot = frozenSnapshot([], undefined, false);
  #nextId = 0;
  #disposed = false;
  #layout: TabsLayoutDelegate | undefined;

  constructor(
    host: TabsHost,
    options: { idPrefix?: string } = {},
  ) {
    this.#host = host;
    this.#idPrefix =
      options.idPrefix?.replace(/[^a-z0-9-]/gu, "") ?? "";
  }

  readonly getSnapshot = (): TabsSnapshot => this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Content remains here; a connected shell owns placement and selection. */
  connectLayout(layout: TabsLayoutDelegate): () => void {
    this.#layout = layout;
    return () => {
      if (this.#layout === layout) this.#layout = undefined;
    };
  }

  /** Read projection from the connected shell, never a second layout writer. */
  projectLayout(order: readonly string[], activeId: string | undefined, visible: boolean): void {
    const ranks = new Map(order.map((id, index) => [id, index]));
    const tabs = [...this.#snapshot.tabs].sort((left, right) =>
      (ranks.get(left.id) ?? Infinity) - (ranks.get(right.id) ?? Infinity));
    if (activeId === this.#snapshot.activeId && visible === this.#snapshot.visible &&
      tabs.every((tab, index) => tab.id === this.#snapshot.tabs[index]?.id)) return;
    this.#commit(tabs, activeId, visible);
  }

  open<Payload>(
    input: TabInput<Payload>,
    options: { activate?: boolean } = {},
  ): string | undefined {
    if (
      this.#disposed ||
      input.kind.trim() === "" ||
      input.key.trim() === ""
    ) {
      return undefined;
    }

    const existing = this.#snapshot.tabs.find(
      (tab) => tab.kind === input.kind && tab.key === input.key,
    );
    if (existing !== undefined) {
      if (this.#layout?.open(existing, options.activate !== false)) return existing.id;
      this.#commit(
        this.#snapshot.tabs,
        options.activate === false && this.#snapshot.activeId !== undefined
          ? this.#snapshot.activeId
          : existing.id,
        true,
      );
      this.#host.showPanel();
      return existing.id;
    }

    const id = `${this.#idPrefix}tab-${++this.#nextId}`;
    const tab: ManagedTab<Payload> = {
      id,
      kind: input.kind,
      key: input.key,
      title: readableTitle(input.title, input.kind),
      payload: input.payload,
    };
    const activate =
      options.activate !== false || this.#snapshot.activeId === undefined;
    const delegated = this.#layout?.active === true;
    this.#commit(
      [...this.#snapshot.tabs, tab],
      delegated ? this.#snapshot.activeId : activate ? id : this.#snapshot.activeId,
      delegated ? this.#snapshot.visible : true,
    );
    if (delegated && this.#layout?.open(tab, options.activate !== false)) return id;
    if (delegated) this.#commit(this.#snapshot.tabs, activate ? id : this.#snapshot.activeId, true);
    this.#host.showPanel();
    return id;
  }

  activate(id: string): void {
    if (!this.#snapshot.tabs.some((tab) => tab.id === id)) return;
    if (this.#layout?.activate(id)) return;
    this.#commit(this.#snapshot.tabs, id, true);
    this.#host.showPanel();
  }

  place(
    id: string,
    targetId: string,
    edge: "before" | "after",
  ): void {
    if (id === targetId) return;
    if (this.#layout?.place(id, targetId, edge)) return;
    const moving = this.#snapshot.tabs.find((tab) => tab.id === id);
    if (moving === undefined) return;
    const remaining = this.#snapshot.tabs.filter(
      (tab) => tab.id !== id,
    );
    const targetIndex = remaining.findIndex(
      (tab) => tab.id === targetId,
    );
    if (targetIndex < 0) return;
    const insertion =
      edge === "after" ? targetIndex + 1 : targetIndex;
    const tabs = [...remaining];
    tabs.splice(insertion, 0, moving);
    this.#commit(
      tabs,
      this.#snapshot.activeId,
      this.#snapshot.visible,
    );
  }

  move(id: string, delta: -1 | 1): void {
    const index = this.#snapshot.tabs.findIndex(
      (tab) => tab.id === id,
    );
    const target = this.#snapshot.tabs[index + delta];
    if (index < 0 || target === undefined) return;
    this.place(
      id,
      target.id,
      delta < 0 ? "before" : "after",
    );
  }

  update<Payload>(
    id: string,
    patch: {
      title?: string;
      key?: string;
      payload?: Payload;
    },
  ): void {
    const index = this.#snapshot.tabs.findIndex((tab) => tab.id === id);
    const current = this.#snapshot.tabs[index];
    if (index < 0 || current === undefined) return;
    const next: ManagedTab = {
      ...current,
      ...(patch.title === undefined
        ? {}
        : { title: readableTitle(patch.title, current.title) }),
      ...(patch.key === undefined ? {} : { key: patch.key }),
      ...(patch.payload === undefined ? {} : { payload: patch.payload }),
    };
    const tabs = [...this.#snapshot.tabs];
    tabs[index] = next;
    this.#commit(
      tabs,
      this.#snapshot.activeId,
      this.#snapshot.visible,
    );
  }

  close(id: string): void {
    const index = this.#snapshot.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const delegated = this.#layout?.close(id) ?? false;
    const tabs = this.#snapshot.tabs.filter((tab) => tab.id !== id);
    const activeId =
      this.#snapshot.activeId === id
        ? tabs[Math.min(index, tabs.length - 1)]?.id
        : this.#snapshot.activeId;
    const visible = tabs.length > 0 && this.#snapshot.visible;
    this.#commit(tabs, activeId, visible);
    if (tabs.length === 0 && !delegated) this.#host.hidePanel();
  }

  hide(): void {
    if (this.#layout?.setVisible(false)) return;
    if (!this.#snapshot.visible) return;
    this.#commit(
      this.#snapshot.tabs,
      this.#snapshot.activeId,
      false,
    );
    this.#host.hidePanel();
  }

  show(): void {
    if (this.#disposed) return;
    if (this.#layout?.setVisible(true)) return;
    if (!this.#snapshot.visible) {
      this.#commit(
        this.#snapshot.tabs,
        this.#snapshot.activeId,
        true,
      );
    }
    this.#host.showPanel();
  }

  toggle(): void {
    if (this.#snapshot.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  syncPanel(): void {
    if (this.#snapshot.visible) {
      if (this.#layout?.setVisible(true)) return;
      this.#host.showPanel();
    }
  }

  tab(id: string): ManagedTab | undefined {
    return this.#snapshot.tabs.find((tab) => tab.id === id);
  }

  dispose(): void {
    if (this.#snapshot.visible) {
      this.#snapshot = frozenSnapshot(
        this.#snapshot.tabs,
        this.#snapshot.activeId,
        false,
      );
      this.#host.hidePanel();
    }
    this.#disposed = true;
    this.#listeners.clear();
  }

  #commit(
    tabs: readonly ManagedTab[],
    activeId: string | undefined,
    visible: boolean,
  ): void {
    this.#snapshot = frozenSnapshot(tabs, activeId, visible);
    for (const listener of this.#listeners) listener();
  }
}
