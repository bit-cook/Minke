/** Desktop recovery settings. Per-plugin activation belongs to DSH's Profile. */
export const PLUGIN_SAFE_MODE_SET_CHANNEL = "minke:plugin:safe-mode:set";
export const PLUGIN_SETTINGS_READ_CHANNEL = "minke:plugin:settings:read";
const MAX_DISABLED_PLUGINS = 512;
const MAX_PLUGIN_NAME_LENGTH = 214;
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

export interface PluginSafeModeSetRequest { readonly enabled: boolean; }
export interface PluginManagementSettings {
  readonly safeMode: boolean;
  /** Legacy input, cleared only after migrating activation to DSH's Profile. */
  readonly disabledPlugins: readonly string[];
}
export const DEFAULT_PLUGIN_MANAGEMENT_SETTINGS: PluginManagementSettings = Object.freeze({
  safeMode: false, disabledPlugins: Object.freeze([]),
});
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePluginManagementSettings(
  value: unknown,
): PluginManagementSettings {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "safeMode") ||
    !Object.hasOwn(value, "disabledPlugins") ||
    typeof value.safeMode !== "boolean" ||
    !Array.isArray(value.disabledPlugins) ||
    value.disabledPlugins.length > MAX_DISABLED_PLUGINS
  ) {
    throw new TypeError("invalid plugin management settings");
  }
  const disabledPlugins = value.disabledPlugins.map(
    parsePluginName,
  );
  if (new Set(disabledPlugins).size !== disabledPlugins.length) {
    throw new TypeError(
      "plugin management settings contain duplicate disabled plugins",
    );
  }
  return Object.freeze({
    safeMode: value.safeMode,
    disabledPlugins: Object.freeze(disabledPlugins),
  });
}

function parsePluginName(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PLUGIN_NAME_LENGTH ||
    value.trim() !== value ||
    !NPM_PACKAGE_NAME.test(value)
  ) {
    throw new TypeError("invalid plugin name");
  }
  return value;
}

export function parsePluginSafeModeSetRequest(
  value: unknown,
): PluginSafeModeSetRequest {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "enabled") ||
    typeof value.enabled !== "boolean"
  ) {
    throw new TypeError("invalid plugin safe-mode request");
  }
  return Object.freeze({ enabled: value.enabled });
}
