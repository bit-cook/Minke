interface Rect { left: number; top: number; right: number; bottom: number }

/** Subtract occluding float rectangles without making overlapping clip holes. */
export function subtractRect(source: Rect, cover: Rect): Rect[] {
  const left = Math.max(source.left, cover.left);
  const right = Math.min(source.right, cover.right);
  const top = Math.max(source.top, cover.top);
  const bottom = Math.min(source.bottom, cover.bottom);
  if (left >= right || top >= bottom) return [source];
  return [
    { ...source, bottom: top }, { ...source, top: bottom },
    { left: source.left, right: left, top, bottom },
    { left: right, right: source.right, top, bottom },
  ].filter(rect => rect.left < rect.right && rect.top < rect.bottom);
}

/** Position without moving the DOM owner (reparenting can destroy Electron guests). */
export function placeContentHost(host: HTMLElement, viewport: HTMLElement | undefined): boolean {
  const document = host.ownerDocument;
  const view = document.defaultView!;
  const rect = viewport?.getBoundingClientRect();
  const shown = viewport !== undefined && rect !== undefined && rect.width > 0 && rect.height > 0 &&
    viewport.checkVisibility({ checkVisibilityCSS: true }) &&
    document.querySelector("[data-dockkit-dock-scrim]") === null;
  if (!shown) {
    host.style.visibility = "hidden";
    host.style.pointerEvents = "none";
    host.inert = true;
    return false;
  }
  const float = viewport.closest<HTMLElement>("[data-dockkit-float]");
  const depth = float ? Number(float.style.zIndex) : -1;
  const floats = [...document.querySelectorAll<HTMLElement>("[data-sidebar-right-float-host] [data-dockkit-float]")];
  let visible: Rect[] = [{ left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(view.innerWidth, rect.right), bottom: Math.min(view.innerHeight, rect.bottom) }];
  for (const other of floats) {
    if (other === float || Number(other.style.zIndex) <= depth) continue;
    const cover = other.getBoundingClientRect();
    visible = visible.flatMap(piece => subtractRect(piece, cover));
  }
  const clip = visible.map(piece => {
    const x = piece.left - rect.left, y = piece.top - rect.top;
    const right = piece.right - rect.left, bottom = piece.bottom - rect.top;
    return `M ${x} ${y} H ${right} V ${bottom} H ${x} Z`;
  }).join(" ");
  const fullscreen = viewport.closest('[data-sidebar-right-panel="fullscreen"]') !== null;
  const fallback = viewport.closest(".minke-tabs-panel") !== null;
  Object.assign(host.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    zIndex: float ? "61" : fullscreen ? "41" : fallback ? "21" : "11",
    clipPath: `path("${clip || "M 0 0 Z"}")`,
    visibility: visible.length > 0 ? "visible" : "hidden",
    pointerEvents: visible.length > 0 ? "auto" : "none",
  });
  host.inert = visible.length === 0;
  return visible.length > 0;
}
