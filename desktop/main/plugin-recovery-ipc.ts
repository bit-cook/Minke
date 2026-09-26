import {
  PLUGIN_SETTINGS_READ_CHANNEL,
  PLUGIN_SAFE_MODE_SET_CHANNEL,
  parsePluginManagementSettings,
  parsePluginSafeModeSetRequest,
  type PluginManagementSettings,
} from "@minke/harness-overlay/plugin-recovery-contract.ts";

interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}
export interface PluginRecovery {
  setSafeMode(enabled: boolean): Promise<void>;
  readSettings(): Promise<PluginManagementSettings>;
}
export interface PluginRecoveryBinding { dispose(): void; }

/** Desktop recovery only; installation and activation belong to DSH. */
export function bindPluginRecoveryIpc(
  ipcMain: IpcMainLike,
  recovery: PluginRecovery,
  authorize: (event: unknown) => boolean,
  restartDesktop: () => void,
): PluginRecoveryBinding {
  const guard = (event: unknown): void => {
    if (!authorize(event)) throw new Error("unauthorized plugin recovery request");
  };
  ipcMain.handle(PLUGIN_SETTINGS_READ_CHANNEL, async event => {
    guard(event);
    return parsePluginManagementSettings(await recovery.readSettings());
  });
  ipcMain.handle(PLUGIN_SAFE_MODE_SET_CHANNEL, async (event, value) => {
    guard(event);
    await recovery.setSafeMode(parsePluginSafeModeSetRequest(value).enabled);
    restartDesktop();
  });
  return {
    dispose() {
      for (const channel of [PLUGIN_SETTINGS_READ_CHANNEL, PLUGIN_SAFE_MODE_SET_CHANNEL]) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
