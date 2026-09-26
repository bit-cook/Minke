import {
  migrateDisabledProfileBundles,
  migrateModelProfile,
  type ProfileMigrationOptions,
} from "./profile-migration.ts";
import {
  PluginManagementRuntime,
  type PluginManagementSettingsStore,
} from "./plugin-recovery/settings.ts";

export type {
  PluginManagementSettingsStore,
} from "./plugin-recovery/settings.ts";

export interface PluginRecoveryOptions extends ProfileMigrationOptions {
  settings?: PluginManagementSettingsStore;
}

/**
 * Owns desktop recovery and one-time migration. DSH owns package operations.
 */
export class PluginRecoveryRuntime {
  readonly #options: PluginRecoveryOptions;
  readonly #management: PluginManagementRuntime;

  constructor(options: PluginRecoveryOptions) {
    this.#options = options;
    this.#management = new PluginManagementRuntime(
      options.settings,
    );
  }

  readSettings() { return this.#management.read(); }

  async migrateLegacyProfile() {
    await migrateModelProfile(this.#options);
    await this.#management.migrateDisabled(names => migrateDisabledProfileBundles(this.#options, names));
    return this.#management.read();
  }

  async setSafeMode(enabled: boolean): Promise<void> {
    await this.#management.setSafeMode(enabled);
  }
}
