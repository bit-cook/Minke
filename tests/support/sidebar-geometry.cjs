'use strict';

/** Evaluated in the renderer against the actual DockKit pane and its live content. */
function fillsFullscreenViewport(selector) {
  const host = document.querySelector(selector);
  if (!host || host.inert) return false;
  const viewport = document.querySelector('[data-minke-tab-viewport="' + host.dataset.minkeTabInstance + '"]');
  const pane = viewport?.closest('[data-sidebar-right-panel="fullscreen"] [data-dockkit-pane]');
  if (!pane) return false;
  const rect = host.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  // DockKit's 0.5px border rounds to 1px on a standard-density display.
  // Check the full-width pane and its actual content edges independently.
  const style = getComputedStyle(pane);
  return Math.abs(paneRect.left) < 0.1 && Math.abs(paneRect.right - innerWidth) < 0.1 &&
    Math.abs(rect.left - paneRect.left - parseFloat(style.borderLeftWidth)) < 0.1 &&
    Math.abs(rect.right - paneRect.right + parseFloat(style.borderRightWidth)) < 0.1 &&
    ['left', 'top', 'right', 'bottom'].every(edge => Math.abs(rect[edge] - viewportRect[edge]) < 0.1);
}

module.exports = { fillsFullscreenViewport };
