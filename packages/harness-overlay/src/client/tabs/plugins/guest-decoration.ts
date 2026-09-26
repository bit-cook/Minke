import type { WebviewTag } from "electron";
import githubCompactCss from "./github-compact.css";
import githubSearchCss from "./github-search.css";
import githubTopicCss from "./github-topic.css";
import { readPluginSearchQuery, removeInsertedWebviewCssSafely } from "./resources.ts";

/** Discovery contributes only GitHub presentation; WebTabView owns the guest. */
export function decoratePluginDiscoveryGuest(view: WebviewTag): () => void {
  let disposed = false;
  let revision = 0;
  let inserted: string[] = [];
  const remove = (keys: readonly string[]) => removeInsertedWebviewCssSafely(view, keys);
  const refresh = async (): Promise<void> => {
    const current = ++revision;
    remove(inserted);
    inserted = [];
    let url: URL;
    try { url = new URL(view.getURL()); }
    catch { return; }
    if (url.protocol !== "https:" || url.hostname !== "github.com") return;
    const sources = /^\/topics\/[^/]+\/?$/u.test(url.pathname)
      ? [githubCompactCss, githubTopicCss]
      : readPluginSearchQuery(url.href) !== undefined
        ? [githubCompactCss, githubSearchCss]
        : [githubCompactCss];
    const next: string[] = [];
    try {
      for (const source of sources) next.push(await view.insertCSS(source));
    } catch { remove(next); return; }
    if (disposed || current !== revision) { remove(next); return; }
    inserted = next;
  };
  const ready = (): void => { void refresh(); };
  const inPage = (event: Electron.DidNavigateInPageEvent): void => {
    if (event.isMainFrame) ready();
  };
  view.addEventListener("dom-ready", ready);
  view.addEventListener("did-navigate-in-page", inPage);
  return () => {
    disposed = true;
    revision++;
    view.removeEventListener("dom-ready", ready);
    view.removeEventListener("did-navigate-in-page", inPage);
    remove(inserted);
  };
}
