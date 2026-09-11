const selector = ':is(button, [href], input, select, textarea, [tabindex]):not(:disabled)';

/** A fallback dialog and its portalled, stable content form one keyboard scope. */
export function bindDrawerFocus(panel: HTMLElement, content: HTMLElement, close: () => void): () => void {
  const document = panel.ownerDocument;
  const keydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || !panel.hasAttribute("data-open") || content.inert) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const entries = [panel, content].flatMap(root => [...root.querySelectorAll<HTMLElement>(selector)])
      .filter(element => element.tabIndex >= 0 &&
        element.closest('[hidden], [aria-hidden="true"], [inert]') === null &&
        element.checkVisibility?.({ checkVisibilityCSS: true }) !== false &&
        document.defaultView!.getComputedStyle(element).visibility !== "hidden");
    event.preventDefault();
    const index = entries.findIndex(element => element === document.activeElement);
    const next = event.shiftKey
      ? index <= 0 ? entries.length - 1 : index - 1
      : index < 0 || index === entries.length - 1 ? 0 : index + 1;
    entries[next]?.focus();
  };
  document.addEventListener("keydown", keydown);
  return () => { document.removeEventListener("keydown", keydown); };
}
