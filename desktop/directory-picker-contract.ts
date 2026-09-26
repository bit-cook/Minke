/** Local renderer bridge consumed by DSH's native workspace directory flow. */
export const DIRECTORY_PICK_CHANNEL = "minke:directory-pick";

export interface DesktopDirectoryPicker {
  pick(): Promise<string | null>;
}
