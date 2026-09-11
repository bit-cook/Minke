import type {
  TabsHost,
} from "./types.ts";

export const MOBILE_TABS_MEDIA_QUERY =
  "(max-width: 900px), (hover: none) and (pointer: coarse)";

export type RightTabsPresentation = "docked" | "drawer";

export interface RightTabsPresentationPort {
  getSnapshot(): RightTabsPresentation;
  subscribe(listener: () => void): () => void;
}

interface RightbarLayoutHost {
  openRightbar(track: boolean, fullscreen: boolean): void;
  closeRightbar(): void;
}

type MatchMediaHost = Pick<Window, "matchMedia">;

export interface ResponsiveRightTabsHostOptions {
  /** Electron keeps its native dock even at a compact window width. */
  readonly drawerEnabled?: boolean;
  readonly view?: MatchMediaHost;
}

/**
 * Owns the start-page/global-panel fallback. The native session Sidebar
 * owns its own frame geometry; this host yields while that seat is mounted.
 */
export class ResponsiveRightTabsHost
  implements TabsHost, RightTabsPresentationPort {
  readonly #layout: RightbarLayoutHost;
  readonly #media: MediaQueryList;
  readonly #drawerEnabled: boolean;
  readonly #listeners = new Set<() => void>();
  #visible = false;
  #disposed = false;
  #nativeActive = false;

  constructor(
    layout: RightbarLayoutHost,
    options: ResponsiveRightTabsHostOptions = {},
  ) {
    this.#layout = layout;
    this.#drawerEnabled = options.drawerEnabled ?? true;
    this.#media = (options.view ?? window).matchMedia(
      MOBILE_TABS_MEDIA_QUERY,
    );
    this.#media.addEventListener(
      "change",
      this.#handlePresentationChange,
    );
  }

  readonly getSnapshot = (): RightTabsPresentation =>
    !this.#nativeActive && this.#drawerEnabled && this.#media.matches
      ? "drawer"
      : "docked";

  /** The native seat owns frame geometry while a session Sidebar is mounted. */
  setNativeActive(active: boolean): void {
    if (this.#nativeActive === active) return;
    this.#nativeActive = active;
    if (active) this.#visible = false;
    for (const listener of this.#listeners) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  showPanel(): void {
    if (this.#nativeActive) return;
    if (this.#disposed) return;
    this.#visible = true;
    this.#applyLayout();
  }

  hidePanel(): void {
    if (this.#nativeActive) return;
    if (this.#disposed) return;
    this.#visible = false;
    this.#layout.closeRightbar();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#media.removeEventListener(
      "change",
      this.#handlePresentationChange,
    );
    if (this.#visible && !this.#nativeActive) {
      this.#layout.closeRightbar();
    }
    this.#visible = false;
    this.#listeners.clear();
  }

  readonly #handlePresentationChange = (): void => {
    if (this.#disposed) return;
    if (this.#visible) this.#applyLayout();
    for (const listener of this.#listeners) listener();
  };

  #applyLayout(): void {
    if (this.#nativeActive) return;
    if (this.getSnapshot() === "drawer") {
      this.#layout.closeRightbar();
    } else {
      this.#layout.openRightbar(true, false);
    }
  }

}
