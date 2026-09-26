import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  OpenDialogReturnValue,
} from "electron";
import { DIRECTORY_PICK_CHANNEL } from "../directory-picker-contract.ts";

export interface DirectoryPickerBinding {
  dispose(): void;
}

export interface DirectoryPickerOptions {
  currentWindow(): BrowserWindow | undefined;
  /** Enforce the active Harness origin in addition to the owner/frame checks. */
  authorize(event: IpcMainInvokeEvent): boolean;
  showOpenDialog(
    window: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
}

/** Bind DSH's local chooser to the owning desktop window for this app lifetime. */
export function bindDirectoryPickerIpc(
  ipcMain: Pick<IpcMain, "handle" | "removeHandler">,
  options: DirectoryPickerOptions,
): DirectoryPickerBinding {
  const pending = new WeakMap<BrowserWindow, Promise<string | null>>();
  let disposed = false;

  const ownsRequest = (
    window: BrowserWindow,
    event: IpcMainInvokeEvent,
  ): boolean =>
    !disposed &&
    options.currentWindow() === window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame !== null &&
    event.senderFrame === window.webContents.mainFrame &&
    options.authorize(event);

  ipcMain.handle(DIRECTORY_PICK_CHANNEL, async (event) => {
    const window = options.currentWindow();
    if (window === undefined || !ownsRequest(window, event)) {
      throw new Error("unauthorized directory picker request");
    }
    const existing = pending.get(window);
    if (existing !== undefined) return existing;

    // Defer opening until the pending entry exists so repeated requests share
    // both the dialog and its settlement, including synchronous dialog errors.
    const result = Promise.resolve().then(async () => {
      if (!ownsRequest(window, event)) return null;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      const selection = await options.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (!ownsRequest(window, event) || selection.canceled) return null;
      return selection.filePaths[0] || null;
    }).catch((error: unknown) => {
      // Closing a window or disposing the application cancels a pending pick;
      // a live dialog failure still reaches DSH's existing error surface.
      if (!ownsRequest(window, event)) return null;
      throw error;
    }).finally(() => { pending.delete(window); });
    pending.set(window, result);
    return result;
  });

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(DIRECTORY_PICK_CHANNEL);
    },
  });
}
