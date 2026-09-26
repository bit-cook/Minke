const CONTENT_SELECTOR = [
  "[data-conversation-scroll]",
  "[data-input-scroll]",
  ".cm-content",
  ".xterm-rows",
  ".xterm-accessibility-tree",
].join(",");
const INTERACTIVE_SURFACE_SELECTOR = [
  "dialog",
  "[popover]",
  '[aria-modal="true"]',
  '[role="alertdialog"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  "[data-window-drag]",
].join(",");

/** Text replacement in scrolling content cannot introduce new surface markers.
 * DSH independently owns drag geometry observation.
 */
export function isContentTextMutation(record: MutationRecord): boolean {
  if (record.type !== "childList" || record.target.nodeType !== 1) return false;
  const target = record.target as Element;
  if (
    target.closest(CONTENT_SELECTOR) === null ||
    target.closest(INTERACTIVE_SURFACE_SELECTOR) !== null
  ) return false;
  return [...record.addedNodes, ...record.removedNodes].every(
    node => node.nodeType === 3 || node.nodeType === 8,
  );
}
