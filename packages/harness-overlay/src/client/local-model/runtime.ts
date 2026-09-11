import {
  DEFAULT_MODEL_RUNTIME_SETTINGS,
  NO_MODEL_RUNTIME_AVAILABILITY,
  LOCAL_MODEL_RUNTIME_IDS,
  parseModelRuntimeSettingsSnapshot,
  parseModelRuntimeServiceState,
  type LocalModelRuntimeId,
  type ModelRuntimeAvailability,
  type ModelRuntimeSettings,
  type ModelRuntimeServiceState,
} from "@lencx/minke-model-runtime/contract";
import type {
  ModelRuntimeSettingsStore,
} from "@minke/harness-overlay/client/desktop/index.ts";

export type LocalModelSettingsErrorKind =
  | "unavailable"
  | "read";

interface LocalModelSaveStatus {
  readonly applying: boolean;
  readonly error: "write" | undefined;
}

type LocalModelSaveStatuses = Readonly<
  Record<LocalModelRuntimeId, LocalModelSaveStatus>
>;

function idleStatuses(): LocalModelSaveStatuses {
  return Object.freeze({
    lmStudio: Object.freeze({ applying: false, error: undefined }),
    ollama: Object.freeze({ applying: false, error: undefined }),
  });
}

export interface LocalModelSettingsSnapshot {
  available: Readonly<ModelRuntimeAvailability>;
  settings: Readonly<ModelRuntimeSettings>;
  editable: boolean;
  status: LocalModelSaveStatuses;
  services: Readonly<Record<LocalModelRuntimeId, ModelRuntimeServiceState | "checking">>;
  error: LocalModelSettingsErrorKind | undefined;
  revision: number;
}

function copySettings(
  value: Readonly<ModelRuntimeSettings>,
): ModelRuntimeSettings {
  return {
    lmStudio: { ...value.lmStudio },
    ollama: { ...value.ollama },
  };
}

/** Tracks each service independently while serializing writes to shared settings. */
export class LocalModelSettingsRuntime {
  readonly store: ModelRuntimeSettingsStore;
  #snapshot: LocalModelSettingsSnapshot = Object.freeze({
    available: Object.freeze({
      ...NO_MODEL_RUNTIME_AVAILABILITY,
    }),
    settings: Object.freeze(copySettings(
      DEFAULT_MODEL_RUNTIME_SETTINGS,
    )),
    editable: false,
    status: idleStatuses(),
    services: Object.freeze({ lmStudio: "checking", ollama: "checking" }),
    error: undefined,
    revision: 0,
  });
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration: Record<LocalModelRuntimeId, number> = {
    lmStudio: 0,
    ollama: 0,
  };
  #persistedSettings = copySettings(
    DEFAULT_MODEL_RUNTIME_SETTINGS,
  );
  #initializePromise: Promise<void> | undefined;
  #statusReads = new Map<LocalModelRuntimeId, Promise<void>>();
  #statusGeneration: Record<LocalModelRuntimeId, number> = { lmStudio: 0, ollama: 0 };
  #disposed = false;

  constructor(store: ModelRuntimeSettingsStore) {
    this.store = store;
  }

  getSnapshot = (): LocalModelSettingsSnapshot =>
    this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  initialize(): Promise<void> {
    if (this.#initializePromise === undefined) {
      let tracked: Promise<void>;
      tracked = this.#initialize().finally(() => {
        if (this.#initializePromise === tracked) {
          this.#initializePromise = undefined;
        }
      });
      this.#initializePromise = tracked;
    }
    return this.#initializePromise;
  }

  retry(): Promise<void> {
    return this.initialize();
  }

  async refreshStatus(id?: LocalModelRuntimeId): Promise<void> {
    if (this.#disposed) return;
    if (id === undefined) {
      await Promise.all(LOCAL_MODEL_RUNTIME_IDS.map((runtimeId) => this.refreshStatus(runtimeId)));
      return;
    }
    if (this.#snapshot.status[id].applying) return;
    const pending = this.#statusReads.get(id);
    if (pending !== undefined) return pending;
    const generation = ++this.#statusGeneration[id];
    const operation = (async () => {
      let state: ModelRuntimeServiceState;
      try {
        state = this.store.readStatus === undefined
          ? "unknown"
          : parseModelRuntimeServiceState(await this.store.readStatus(id));
      } catch {
        state = "unknown";
      }
      if (this.#disposed || generation !== this.#statusGeneration[id]) return;
      if (this.#snapshot.services[id] !== state) {
        this.#publish({ services: { ...this.#snapshot.services, [id]: state } });
      }
    })();
    this.#statusReads.set(id, operation);
    try {
      await operation;
    } finally {
      if (this.#statusReads.get(id) === operation) this.#statusReads.delete(id);
    }
  }

  setEnabled(
    id: LocalModelRuntimeId,
    enabled: boolean,
  ): void {
    if (!this.#snapshot.editable) {
      throw new Error("model runtime settings are not editable");
    }
    if (!this.#snapshot.available[id]) {
      throw new Error(`${id} command is unavailable`);
    }
    this.#commit(id, enabled);
  }

  async flush(): Promise<void> {
    await this.#saveTail;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }

  async #initialize(): Promise<void> {
    if (!this.store.available) {
      this.#publish({
        error: "unavailable",
      });
      return;
    }
    try {
      const snapshot = parseModelRuntimeSettingsSnapshot(
        await this.store.read(),
      );
      if (this.#disposed) return;
      if (snapshot.error === "read") {
        this.#publish({
          available: snapshot.available,
          editable: false,
          error: "read",
        });
        return;
      }
      this.#persistedSettings = copySettings(snapshot.settings);
      this.#publish({
        available: snapshot.available,
        settings: snapshot.settings,
        editable: true,
        error: undefined,
      });
    } catch {
      if (this.#disposed) return;
      this.#publish({
        editable: false,
        error: "read",
      });
    }
  }

  #commit(id: LocalModelRuntimeId, enabled: boolean): void {
    if (enabled === this.#snapshot.settings[id].enabled) return;
    const settings = copySettings(this.#snapshot.settings);
    settings[id] = { enabled };
    // A probe started before this change cannot describe its outcome.
    ++this.#statusGeneration[id];
    this.#statusReads.delete(id);
    this.#publish({
      settings,
      status: this.#statusWith(id, { applying: true, error: undefined }),
      services: { ...this.#snapshot.services, [id]: "checking" },
    });

    const generation = ++this.#saveGeneration[id];
    const operation = this.#saveTail.then(async () => {
      // A queued sibling change must not replay an optimistic value whose
      // save failed while this operation was waiting.
      const payload = copySettings(this.#persistedSettings);
      payload[id] = { enabled };
      await this.store.write(payload, id);
    });
    this.#saveTail = operation.then(
      () => {
        this.#persistedSettings[id] = { enabled };
        if (
          this.#disposed ||
          generation !== this.#saveGeneration[id]
        ) {
          return;
        }
        this.#publish({
          status: this.#statusWith(id, { applying: false, error: undefined }),
        });
        void this.refreshStatus(id);
      },
      () => {
        if (
          this.#disposed ||
          generation !== this.#saveGeneration[id]
        ) {
          return;
        }
        const restored = copySettings(this.#snapshot.settings);
        restored[id] = { ...this.#persistedSettings[id] };
        this.#publish({
          settings: restored,
          status: this.#statusWith(id, { applying: false, error: "write" }),
        });
        void this.refreshStatus(id);
      },
    );
  }

  #statusWith(
    id: LocalModelRuntimeId,
    status: LocalModelSaveStatus,
  ): LocalModelSaveStatuses {
    return Object.freeze({
      ...this.#snapshot.status,
      [id]: Object.freeze(status),
    });
  }

  #publish(
    patch: Partial<
      Omit<LocalModelSettingsSnapshot, "revision">
    >,
  ): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      available: Object.freeze({
        ...(patch.available ?? this.#snapshot.available),
      }),
      settings: Object.freeze(
        copySettings(
          patch.settings ?? this.#snapshot.settings,
        ),
      ),
      services: Object.freeze({ ...(patch.services ?? this.#snapshot.services) }),
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
