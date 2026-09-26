import { parseFileManagerPreviewResult } from "../../../tabs/files-contract.ts";
import { isAbsoluteLocalPath } from "../../../tabs/web-link-contract.ts";
import { isFilesTab, type FilesTabPayload } from "./types.ts";
import type { ManagedTab } from "../types.ts";

/** Retain the editor draft and its original disk version, never directory/image caches. */
export function saveFilesTab(tab: ManagedTab): unknown {
  if (!isFilesTab(tab)) return undefined;
  const { path, explorerPosition, viewMode, previewWidth, preview } = tab.payload;
  return { path, explorerPosition, viewMode, previewWidth, preview: preview && {
    entry: preview.entry, mode: preview.mode,
    ...(preview.dirty && preview.result?.kind === "text" ? { draft: preview.draft, result: preview.result } : {}),
  } };
}

/** Validate browser-held content before reattaching any file operations. */
export function restoreFilesPayload(value: unknown): FilesTabPayload {
  if (typeof value !== "object" || value === null) throw new Error("Invalid saved Files tab");
  const row = value as Record<string, unknown>;
  if (row.path !== undefined && (typeof row.path !== "string" || !isAbsoluteLocalPath(row.path))) throw new Error("Invalid saved directory");
  const payload: FilesTabPayload = {
    path: row.path as string | undefined, entries: [], tree: {}, loading: true, truncated: false, canGoBack: false, canGoForward: false,
    explorerPosition: row.explorerPosition === "right" ? "right" : "left",
    viewMode: row.viewMode === "tree" ? "tree" : "list",
    ...(typeof row.previewWidth === "number" && Number.isFinite(row.previewWidth) && row.previewWidth > 0 ? { previewWidth: row.previewWidth } : {}),
  };
  if (typeof row.preview !== "object" || row.preview === null) return payload;
  const preview = row.preview as Record<string, unknown>;
  const entry = preview.entry as Record<string, unknown> | undefined;
  if (!entry || typeof entry.path !== "string" || !isAbsoluteLocalPath(entry.path) || typeof entry.name !== "string") return payload;
  const result = preview.result === undefined ? undefined : parseFileManagerPreviewResult(preview.result);
  // The host may resolve a symlink (including macOS /var -> /private/var), so
  // its result path need not equal the user's selected entry path.
  const dirty = typeof preview.draft === "string" && result?.kind === "text" && !result.truncated;
  return { ...payload, preview: {
    entry: { path: entry.path, name: entry.name, kind: "file" },
    mode: preview.mode === "preview" || preview.mode === "diff" ? preview.mode : "source",
    loading: !dirty, saving: false, dirty,
    ...(dirty ? { draft: preview.draft as string, result } : {}),
  } };
}
