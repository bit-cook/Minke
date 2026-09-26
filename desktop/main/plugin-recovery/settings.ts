import {
  DEFAULT_PLUGIN_MANAGEMENT_SETTINGS,
  parsePluginManagementSettings,
  type PluginManagementSettings,
} from "@minke/harness-overlay/plugin-recovery-contract.ts";

export interface PluginManagementSettingsStore {
  read(): Promise<PluginManagementSettings>;
  write(settings: PluginManagementSettings): Promise<void>;
}

function createTransientSettingsStore():
  PluginManagementSettingsStore {
  let settings = DEFAULT_PLUGIN_MANAGEMENT_SETTINGS;
  return {
    async read() {
      return settings;
    },
    async write(value) {
      settings = parsePluginManagementSettings(value);
    },
  };
}

/**
 * Serializes plugin policy updates so independent renderer actions cannot
 * overwrite one another.
 */
export class PluginManagementRuntime {
  readonly #store: PluginManagementSettingsStore;
  #tail: Promise<void> = Promise.resolve();

  constructor(store?: PluginManagementSettingsStore) {
    this.#store = store ?? createTransientSettingsStore();
  }

  async read(): Promise<PluginManagementSettings> {
    return parsePluginManagementSettings(
      await this.#store.read(),
    );
  }

  migrateDisabled(migrate: (names: readonly string[]) => Promise<void>): Promise<void> {
    return this.#update(async current => {
      if (current.disabledPlugins.length === 0) return current;
      await migrate(current.disabledPlugins);
      return { ...current, disabledPlugins: [] };
    });
  }

  setSafeMode(enabled: boolean): Promise<void> {
    return this.#update((current) => ({
      safeMode: enabled,
      disabledPlugins: current.disabledPlugins,
    }));
  }

  #update(
    update: (
      current: PluginManagementSettings,
    ) => PluginManagementSettings | Promise<PluginManagementSettings>,
  ): Promise<void> {
    const operation = this.#tail.then(async () => {
      const current = await this.read();
      const next = await update(current);
      if (next === current) return;
      await this.#store.write(
        parsePluginManagementSettings(next),
      );
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }
}
