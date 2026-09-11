import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TabsTranslate } from "../locales.ts";
import type { TabRendererRegistry } from "../registry.ts";
import type { TabsRuntime } from "../runtime.ts";
import type { ManagedTab } from "../types.ts";
import { minkeTabId, type NativeTabInfo } from "./contract.ts";
import type { NativeTabsRuntime } from "./runtime.ts";
import { placeContentHost } from "./viewport.ts";
import { bindDrawerFocus } from "./drawer-focus.ts";

export function NativeTabViewport({ native, id, visible }: {
  native: NativeTabsRuntime; id: string; visible: boolean;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) return native.attachViewport(id, ref.current);
  }, [native, id, visible]);
  return <div ref={ref} className="minke-tabs-native-viewport" data-visible={String(visible)} data-minke-tab-viewport={id} />;
}

export function NativeTabBody({ native, useTabInfo }: {
  native: NativeTabsRuntime; useTabInfo(): NativeTabInfo;
}): ReactNode {
  const { tab } = useTabInfo();
  const id = minkeTabId(tab.contentId);
  return id === undefined ? null : <NativeTabViewport native={native} id={id} visible={tab.visible} />;
}

export function NativeTabTitle({ runtime, renderers, useTabInfo }: {
  runtime: TabsRuntime; renderers: TabRendererRegistry; useTabInfo(): NativeTabInfo;
}): ReactNode {
  useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  useSyncExternalStore(renderers.subscribe, renderers.getSnapshot, renderers.getSnapshot);
  const { tab: record } = useTabInfo();
  const id = minkeTabId(record.contentId);
  const tab = id === undefined ? undefined : runtime.tab(id);
  return <span className="minke-tabs-native-title" id={id === undefined ? undefined : `minke-tab-${id}`} data-minke-tab-title={id}>
    {tab && renderers.get(tab.kind)?.renderIcon(tab)}
    <span>{tab?.title ?? record.title}</span>
  </span>;
}

function ContentInstance({ tab, runtime, native, renderers, t }: {
  tab: ManagedTab; runtime: TabsRuntime; native: NativeTabsRuntime; renderers: TabRendererRegistry; t: TabsTranslate;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const renderer = renderers.get(tab.kind);
  const loading = renderer?.loading?.(tab) === true;
  const toolbar = native.active && (renderer?.renderLeadingActions || renderer?.renderTrailingActions || renderer?.renderToolbarCenter);
  useEffect(() => {
    let frame = 0;
    let lastVisible = false;
    const position = (): void => {
      const host = ref.current;
      if (host) {
        const shown = placeContentHost(host, native.viewport(tab.id));
        if (shown !== lastVisible) { lastVisible = shown; setVisible(shown); }
      }
      // Hidden content has no animation loop; a seat attachment/visibility
      // change wakes it. Only the visible panes follow live drag geometry.
      if (native.viewport(tab.id)) frame = requestAnimationFrame(position);
    };
    const unsubscribe = native.subscribe(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    });
    position();
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  }, [native, tab.id]);
  useEffect(() => {
    if (!visible || native.active || !ref.current) return;
    const panel = native.viewport(tab.id)?.closest<HTMLElement>('.minke-tabs-panel[role="dialog"]');
    if (panel) return bindDrawerFocus(panel, ref.current, () => runtime.hide());
  }, [native, runtime, tab.id, visible, native.active]);

  return <div ref={ref} id={`minke-tab-host-${tab.id}`} className="minke-tabs-native-host" data-minke-tab-instance={tab.id}
    data-kind={tab.kind} aria-label={tab.title} onPointerDownCapture={() => {
      // A click inside a live view must also focus its pane, including floats.
      if (native.active) native.activate(tab.id);
    }}>
    {toolbar && <div className="minke-tabs-toolbar minke-tabs-native-toolbar">
      <div className="minke-tabs-toolbar__nav">{renderer?.renderLeadingActions?.(tab)}</div>
      <div className="minke-tabs-toolbar__center">
        {renderer?.renderToolbarCenter?.(tab, visible) ?? <div className="minke-tabs-toolbar__identity">
          <span className="minke-tabs-toolbar__title">{tab.title}</span>
          <span className="minke-tabs-toolbar__site">{renderer?.subtitle?.(tab)}</span>
        </div>}
      </div>
      <div className="minke-tabs-toolbar__actions">{renderer?.renderTrailingActions?.(tab)}</div>
    </div>}
    {native.active && <div className="minke-tabs-progress" data-loading={loading || undefined}
      role={loading ? "status" : undefined} aria-label={loading ? renderer?.loadingLabel?.(tab) : undefined}>
      <span />
    </div>}
    <div className="minke-tabs-content">
      {renderer?.renderView(tab, visible, visible) ?? <div className="minke-tabs-error" role="alert">{t("error.unsupported.title")}</div>}
    </div>
  </div>;
}

/** One stable DOM owner per content instance, independent of pane/session seats. */
export function NativeTabsContent({ runtime, native, renderers, t }: {
  runtime: TabsRuntime; native: NativeTabsRuntime; renderers: TabRendererRegistry; t: TabsTranslate;
}): ReactNode {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  useSyncExternalStore(native.subscribe, native.getSnapshot, native.getSnapshot);
  useSyncExternalStore(renderers.subscribe, renderers.getSnapshot, renderers.getSnapshot);
  return createPortal(<>{snapshot.tabs.map(tab => <ContentInstance key={tab.id} tab={tab} runtime={runtime} native={native} renderers={renderers} t={t} />)}</>, document.body);
}
