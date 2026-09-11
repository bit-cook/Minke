/** Rendered formats supported by the pinned DSH document bodies. */
export type FilesDocumentKind = "markdown" | "html";

export function filesDocumentKind(path: string): FilesDocumentKind | undefined {
  const name = path.replaceAll("\\", "/").split("/").at(-1);
  const extension = name?.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  return undefined;
}
