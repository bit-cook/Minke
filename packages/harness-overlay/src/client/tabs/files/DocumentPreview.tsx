import { createContext, useContext, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { HarnessClientContext } from "../../core/context.ts";
import type { FilesDocumentKind } from "./document-kind.ts";
import type { FilesTabsTranslate } from "./locales.ts";

/** Private face of embedded-document-preview.patch; DSH owns rendering and HTML isolation. */
interface DocumentBodyProps {
  kind: FilesDocumentKind;
  text: string;
  resourceAddress: string;
}

export class FilesDocumentRuntime {
  #body: ComponentType<DocumentBodyProps> | undefined;
  #listeners = new Set<() => void>();
  readonly getSnapshot = () => this.#body;
  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };
  connect(body: ComponentType<DocumentBodyProps>): () => void {
    this.#body = body;
    for (const listener of this.#listeners) listener();
    return () => {
      if (this.#body !== body) return;
      this.#body = undefined;
      for (const listener of this.#listeners) listener();
    };
  }
}

export function installFilesDocumentPreview(ctx: HarnessClientContext): FilesDocumentRuntime {
  const runtime = new FilesDocumentRuntime();
  ctx.inject?.(["minkeDocumentPreview"], scope => {
    const service = scope.get("minkeDocumentPreview") as { Body: ComponentType<DocumentBodyProps> };
    scope.effect(() => runtime.connect(service.Body), "minke-overlay: document preview bodies");
  });
  return runtime;
}

export const FilesDocumentContext = createContext<{
  documents?: FilesDocumentRuntime;
  sessionId: string | undefined;
} | undefined>(undefined);
const emptySubscribe = () => () => {};
const emptySnapshot = () => undefined;

export function FilesDocumentPreview({ path, text, kind, t }: {
  path: string; text: string; kind: FilesDocumentKind; t: FilesTabsTranslate;
}): ReactNode {
  const context = useContext(FilesDocumentContext);
  const Body = useSyncExternalStore(context?.documents?.subscribe ?? emptySubscribe,
    context?.documents?.getSnapshot ?? emptySnapshot, emptySnapshot);
  if (!Body) return <div className="minke-files-preview__state" role="status">{t("files.preview.render.unavailable")}</div>;
  // DSH encodes path segments independently; absolute paths retain their leading slash in a Session address.
  const normalized = path.replaceAll("\\", "/");
  const encoded = (value: string) => value.split("/").map(encodeURIComponent).join("/");
  const resourceAddress = context?.sessionId
    ? `dsh-resource://file/session/${encodeURIComponent(context.sessionId)}/${encoded(normalized)}`
    : `dsh-resource://file/absolute/${encoded(normalized.replace(/^\//u, ""))}`;
  return <div className="minke-files-preview__rendered" data-minke-document-preview={kind}>
    <Body key={resourceAddress} resourceAddress={resourceAddress} text={text} kind={kind} />
  </div>;
}
