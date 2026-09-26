import { useEffect, useRef, useState, type ReactNode } from "react";
import { ToolbarButton } from "../components/ToolbarButton.tsx";
import { WebTabView } from "../web/WebTabView.tsx";
import { renderWebNavigationActions } from "../web/renderer.tsx";
import { ExternalIcon } from "../web/icons.tsx";
import type { WebTabsTranslate } from "../web/locales.ts";
import { PluginBrowserIcon, PluginClearIcon, PluginHomeIcon } from "./icons.tsx";
import type { PluginTabsController } from "./controller.ts";
import type { PluginsTranslate } from "./locales.ts";
import { PLUGIN_DISCOVERY_TOPIC_URL, createPluginSearchUrl, readPluginSearchQuery } from "./resources.ts";
import { decoratePluginDiscoveryGuest } from "./guest-decoration.ts";
import type { PluginTab } from "./types.ts";

export interface PluginsViewProps {
  readonly tab: PluginTab;
  readonly active: boolean;
  readonly controller: PluginTabsController;
  readonly t: PluginsTranslate;
  readonly webT: WebTabsTranslate;
}

/** A search preset around the shared browser, with no independent guest state. */
export function PluginsView({ tab, active, controller, t, webT }: PluginsViewProps): ReactNode {
  const [searchDraft, setSearchDraft] = useState(() => readPluginSearchQuery(tab.payload.url ?? "") ?? "");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const browser = tab.payload;
  const web = controller.web;
  useEffect(() => {
    const query = readPluginSearchQuery(browser.url ?? "");
    if (query !== undefined) setSearchDraft(query);
    else if (browser.url === PLUGIN_DISCOVERY_TOPIC_URL) setSearchDraft("");
  }, [browser.url]);

  return <section className="minke-plugins-page" hidden={!active} aria-label={t("plugins.browser.title")}>
    <div className="minke-plugins-browser__bar">
      <div className="minke-plugins-browser__identity">
        <span><strong>{t("plugins.browser.title")}</strong><small title={browser.url}>{browser.url ?? t("plugins.browser.topic")}</small></span>
      </div>
      <form className="minke-plugins-browser__search" role="search" onSubmit={event => {
        event.preventDefault();
        web.navigate(tab.id, createPluginSearchUrl(searchDraft));
      }}>
        <label className="minke-plugins-visually-hidden" htmlFor={`minke-plugin-search-${tab.id}`}>{t("plugins.browser.searchLabel")}</label>
        <span className="minke-plugins-browser__site-icon" data-loading={browser.loading || undefined} aria-hidden="true"><PluginBrowserIcon /></span>
        <input ref={searchInputRef} id={`minke-plugin-search-${tab.id}`} value={searchDraft} type="search"
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          placeholder={t("plugins.browser.searchPlaceholder")}
          onChange={event => setSearchDraft(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === "Escape" && searchDraft !== "") { event.preventDefault(); setSearchDraft(""); }
          }} />
        {searchDraft !== "" && <button type="button" title={t("plugins.browser.searchClear")} aria-label={t("plugins.browser.searchClear")}
          onClick={() => { setSearchDraft(""); searchInputRef.current?.focus(); }}><PluginClearIcon /></button>}
      </form>
      <div className="minke-plugins-browser__actions">
        {renderWebNavigationActions(tab, webT, web)}
        <ToolbarButton label={t("plugins.browser.home")} onClick={() => { setSearchDraft(""); web.navigate(tab.id, PLUGIN_DISCOVERY_TOPIC_URL); }}><PluginHomeIcon /></ToolbarButton>
        <ToolbarButton label={webT("web.nav.external")} onClick={() => web.openExternal(tab.id)}><ExternalIcon /></ToolbarButton>
      </div>
    </div>
    <WebTabView tab={tab} active={active} controller={web} t={webT}
      decorateGuest={decoratePluginDiscoveryGuest} allowPopups={false} annotations={false} />
  </section>;
}
