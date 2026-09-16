import type { NativeTabsRuntime } from "./runtime.ts";
import { placeContentHost } from "./viewport.ts";

interface ContentHost {
  host: HTMLElement;
  native: NativeTabsRuntime;
  id: string;
  visible?: boolean;
  changed(visible: boolean): void;
}

const observers = new WeakMap<Document, ContentHostObserver>();
const motionEvents = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"] as const;

/** One coalesced geometry pass for all retained content in this document. */
class ContentHostObserver {
  readonly hosts = new Set<ContentHost>();
  readonly #document: Document;
  readonly #view: Window & typeof globalThis;
  readonly #resize: ResizeObserver;
  readonly #mutation: MutationObserver;
  #targets = new Set<Element>();
  #frame: number | undefined;

  constructor(document: Document) {
    this.#document = document;
    this.#view = document.defaultView!;
    this.#resize = new this.#view.ResizeObserver(this.invalidate);
    this.#mutation = new this.#view.MutationObserver(this.invalidate);
    this.#view.addEventListener("resize", this.invalidate);
    this.#view.visualViewport?.addEventListener("resize", this.invalidate);
    this.#view.visualViewport?.addEventListener("scroll", this.invalidate);
    document.addEventListener("scroll", this.#layoutEvent, true);
    document.addEventListener("visibilitychange", this.#visibility);
    for (const event of motionEvents) document.addEventListener(event, this.#layoutEvent, true);
  }

  readonly invalidate = (): void => {
    if (this.#frame !== undefined || this.hosts.size === 0 || this.#document.visibilityState === "hidden") return;
    this.#frame = this.#view.requestAnimationFrame(this.#update);
  };

  readonly #layoutEvent = (event: Event): void => {
    // Scrolling editors and decorative animations inside content do not move
    // its seat. Only layout ancestors and occluding floats can do that.
    if (event.target === this.#document || this.#targets.has(event.target as Element)) this.invalidate();
  };

  readonly #visibility = (): void => {
    if (this.#document.visibilityState === "hidden") this.#cancelFrame();
    else this.invalidate();
  };

  #cancelFrame(): void {
    if (this.#frame !== undefined) this.#view.cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
  }

  readonly #update = (): void => {
    this.#frame = undefined;
    const targets = new Set<Element>();
    const seats = new Map<ContentHost, HTMLElement | undefined>();
    const addAncestors = (element: Element): void => {
      for (let current: Element | null = element; current; current = current.parentElement) targets.add(current);
    };
    for (const entry of this.hosts) {
      const seat = entry.native.viewport(entry.id);
      seats.set(entry, seat);
      if (seat) addAncestors(seat);
    }
    if (targets.size > 0) {
      for (const floating of this.#document.querySelectorAll("[data-sidebar-right-float-host], [data-sidebar-right-float-host] [data-dockkit-float]")) addAncestors(floating);
      // A drop scrim in a sibling native pane also occludes retained content.
      // Dockkit puts the scrim directly in the pane's final (body) child.
      for (const pane of this.#document.querySelectorAll("[data-sidebar-right-panel] [data-dockkit-pane]")) addAncestors(pane.lastElementChild ?? pane);
    }
    this.#observe(targets);
    for (const [entry, seat] of seats) {
      const visible = placeContentHost(entry.host, seat);
      if (visible !== entry.visible) { entry.visible = visible; entry.changed(visible); }
    }
    // Transforms can animate without resize or mutation notifications. Follow
    // finite layout animations, then sleep; floats report drag style changes.
    if ([...targets].some(target => target.getAnimations().some(animation =>
      (animation.playState === "running" || animation.pending) &&
      animation.effect?.getComputedTiming().endTime !== Infinity))) this.invalidate();
  };

  #observe(targets: Set<Element>): void {
    if (targets.size === this.#targets.size && [...targets].every(target => this.#targets.has(target))) return;
    for (const target of this.#targets) if (!targets.has(target)) this.#resize.unobserve(target);
    this.#mutation.disconnect();
    for (const target of targets) {
      if (!this.#targets.has(target)) this.#resize.observe(target);
      // Observe the layout chain itself, not streamed messages, editor contents
      // or our portalled hosts. Child changes discover new floats and scrims.
      this.#mutation.observe(target, { attributes: true, childList: true });
    }
    this.#targets = targets;
  }

  dispose(): void {
    this.#cancelFrame();
    this.#resize.disconnect();
    this.#mutation.disconnect();
    this.#view.removeEventListener("resize", this.invalidate);
    this.#view.visualViewport?.removeEventListener("resize", this.invalidate);
    this.#view.visualViewport?.removeEventListener("scroll", this.invalidate);
    this.#document.removeEventListener("scroll", this.#layoutEvent, true);
    this.#document.removeEventListener("visibilitychange", this.#visibility);
    for (const event of motionEvents) this.#document.removeEventListener(event, this.#layoutEvent, true);
  }
}

/** Keep the DOM/WebContents owner stable while its native seat moves. */
export function observeContentHost(
  host: HTMLElement,
  native: NativeTabsRuntime,
  id: string,
  changed: (visible: boolean) => void,
): () => void {
  const document = host.ownerDocument;
  let observer = observers.get(document);
  if (!observer) { observer = new ContentHostObserver(document); observers.set(document, observer); }
  const entry: ContentHost = { host, native, id, changed };
  observer.hosts.add(entry);
  const release = native.subscribe(observer.invalidate);
  observer.invalidate();
  return () => {
    release();
    if (!observer.hosts.delete(entry)) return;
    if (observer.hosts.size === 0) {
      observer.dispose();
      observers.delete(document);
    } else observer.invalidate();
  };
}
