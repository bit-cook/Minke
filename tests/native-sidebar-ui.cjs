'use strict';

const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { nativeTheme, webContents } = require('electron');
const { fillsFullscreenViewport } = require('./support/sidebar-geometry.cjs');
const { verifyWindowDrag, observeWindowDragRecall, verifyWindowDragRecall } = require('./window-drag-ui.cjs');

/** Exercises the production renderer in a blank Session, before its header exists. */
async function verifyNativeSidebarUI({ window, harnessUrl, fixtureUrl, rendererValue, waitFor, workspace, openedFilePaths }) {
  await writeFile(join(workspace, 'sidebar-code.ts'), Array.from({ length: 180 }, (_, index) =>
    `export const value${index} = ${JSON.stringify('Native code preview '.repeat(16))};`).join('\n'));
  const pressEnter = () => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  };
  const pressKey = keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const typeKeys = text => {
    for (const keyCode of text) {
      // xterm handles keyDown before char; uppercase letters need real Shift.
      const modifiers = /^[A-Z]$/.test(keyCode) ? ['shift'] : [];
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      window.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    }
  };
  const click = async (selector, index = 0) => {
    const point = await waitFor(async () => {
      const candidate = await rendererValue(window, `() => {
      const button = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!button || !button.checkVisibility({ checkVisibilityCSS: true })) return false;
      button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === button || button.contains(hit))) return false;
      return { x: Math.round(x), y: Math.round(y) };
      }`);
      if (!candidate) return false;
      window.webContents.sendInputEvent({ type: 'mouseMove', ...candidate });
      // Native plugins and fonts can finish mounting between measurement and
      // input delivery. Verify the actual hovered target before pressing.
      return await rendererValue(window, `() => new Promise(resolve => requestAnimationFrame(() => {
        const button = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        const hit = document.elementFromPoint(${candidate.x}, ${candidate.y});
        resolve(button?.matches(':hover') && button.contains(hit));
      }))`) ? candidate : false;
    }, `clickable ${selector}`, 8_000);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const assertHeaderAlignment = async state => {
    await verifyWindowDrag({ window, rendererValue }, state);
    await waitFor(async () => {
      const remote = await rendererValue(window, `() => {
      const button = document.querySelector('[data-minke-new-session-remote-hub-action] button');
      if (!button?.checkVisibility({ checkVisibilityCSS: true })) return false;
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      }`);
      if (!remote) return false;
      window.webContents.sendInputEvent({ type: 'mouseMove', ...remote });
      return rendererValue(window, `() => new Promise(resolve => requestAnimationFrame(() =>
        resolve(document.querySelector('[data-minke-new-session-remote-hub-action] button')?.matches(':hover'))))`);
    }, 'Remote hover');
    const centers = await rendererValue(window, `() => {
      return [...document.querySelectorAll('[data-minke-remote-hub-action], [data-minke-tabs-header-action], [data-sidebar-right-mode], [data-sidebar-right-toggle], [data-sidebar-right-expand]')]
        .filter(button => button.checkVisibility({ checkVisibilityCSS: true }))
        .map(button => {
          const rect = button.getBoundingClientRect();
          const icon = button.querySelector('svg').getBoundingClientRect();
          return { label: button.getAttribute('aria-label'), group: button.closest('[data-sidebar-right-panel]') ? 'sidebar' : 'conversation', left: rect.left, right: rect.right, button: rect.top + rect.height / 2, icon: icon.top + icon.height / 2 };
        });
    }`);
    assert.ok(centers.length >= 3, JSON.stringify(centers));
    for (const dimension of ['button', 'icon']) {
      const values = centers.map(center => center[dimension]);
      assert.ok(Math.max(...values) - Math.min(...values) < 0.1,
        `${state}: ${dimension} centers must align, including hovered Remote: ${JSON.stringify(centers)}`);
    }
    for (const group of ['conversation', 'sidebar']) {
      const row = centers.filter(center => center.group === group).sort((left, right) => left.left - right.left);
      for (let index = 1; index < row.length; index++) {
        assert.ok(Math.abs(row[index].left - row[index - 1].right - 8) < 0.1,
          `${state}: ${group} controls must share DSH's 8px gap: ${JSON.stringify(row)}`);
      }
    }
    if (process.env.MINKE_SIDEBAR_SCREENSHOT && state === 'collapsed Sidebar') {
      const clip = await rendererValue(window, `() => {
        const remote = document.querySelector('[data-minke-new-session-remote-hub-action] button').getBoundingClientRect();
        const x = Math.max(0, Math.floor(remote.left - 12));
        return { x, y: 0, width: innerWidth - x, height: 54 };
      }`);
      await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.header-hover.png`, (await window.webContents.capturePage(clip)).toPNG());
    }
    process.stdout.write('[sidebar-ui] ' + state + ' header alignment passed\n');
  };
  await window.loadURL(harnessUrl);
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel]') !== null`), 'selected blank Session');
  await verifyWindowDrag({ window, rendererValue }, 'blank Session');
  await observeWindowDragRecall({ window, rendererValue });
  if (process.platform === 'darwin') {
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-dsh-desktop-sidebar-toggle]') !== null`), 'native left Sidebar toggle');
    const initiallyCollapsed = await rendererValue(window, `() => document.querySelector('[data-sidebar-collapsed]') !== null`);
    if (!initiallyCollapsed) await click('[data-dsh-desktop-sidebar-toggle]');
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-collapsed]') !== null`), 'collapsed left Sidebar');
    // DSH swaps the wide content for the rail after its fade. A check made
    // immediately after the state change would still inspect the wide glyph.
    await waitFor(() => rendererValue(window, `() => {
      const frame = document.querySelector('[data-sidebar-collapsed]');
      const sidebar = frame?.firstElementChild;
      return frame && sidebar && !frame.hasAttribute('data-animating') &&
        ![...frame.getAnimations(), ...sidebar.getAnimations({ subtree: true })]
          .some(animation => animation.playState === 'running');
    }`), 'settled collapsed left Sidebar');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 600, y: 600 });
    await waitFor(() => rendererValue(window, `() => !document.querySelector('[data-dsh-desktop-sidebar-toggle]').matches(':hover')`), 'pointer outside left Sidebar toggle');
    const collapsedToggle = await rendererValue(window, `() => {
      const button = document.querySelector('[data-dsh-desktop-sidebar-toggle]');
      const icon = button.querySelector(':scope > svg');
      return {
        visible: icon?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
        draggable: getComputedStyle(button).getPropertyValue('-webkit-app-region').trim(),
      };
    }`);
    assert.deepEqual(collapsedToggle, { visible: true, draggable: 'no-drag' }, 'collapsed native Sidebar toggle stays visible and interactive without hover');
    if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.left-toggle.png`, (await window.webContents.capturePage({ x: 0, y: 0, width: 90, height: 340 })).toPNG());
    await click('[data-dsh-desktop-sidebar-toggle]');
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-collapsed]') === null`), 'native left Sidebar expands on click');
    if (initiallyCollapsed) {
      await click('[data-dsh-desktop-sidebar-toggle]');
      await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-collapsed]') !== null`), 'restored left Sidebar state');
    }
    process.stdout.write('[sidebar-ui] native left Sidebar toggle remains visible without hover and expands on click\n');
  }
  // The preceding start-page check now survives navigation. Close its browser
  // through the real tab action before checking the empty Start layout.
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-tab-title]') !== null`), 'retained start-page browser');
  await click('[data-dockkit-tab]:has([data-minke-tab-title]) [data-dockkit-tab-close]');
  await waitFor(() => rendererValue(window, `() =>
    document.querySelector('[data-sidebar-right-expand]') !== null
  `), 'blank Session Sidebar opener');
  assert.equal(await rendererValue(window, `() => document.querySelectorAll('[data-minke-tabs-placement="right"]').length`), 0, 'a blank Session uses only the native Sidebar opener');
  await assertHeaderAlignment('collapsed Sidebar');
  await click('[data-sidebar-right-expand]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null`), 'blank Session native Sidebar');
  await waitFor(() => rendererValue(window, `() => {
    const frame = document.querySelector('[data-shell-overlay]').parentElement;
    const sidebar = document.querySelector('[data-sidebar-right-panel]');
    return !frame.hasAttribute('data-animating') && ![...frame.getAnimations(), ...sidebar.getAnimations()]
      .some(animation => animation.playState === 'running');
  }`), 'Sidebar and conversation column transition');
  await assertHeaderAlignment('open Sidebar');
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) {
    await writeFile(process.env.MINKE_SIDEBAR_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    const headerClip = await rendererValue(window, `() => {
      const button = document.querySelector('[data-minke-new-session-remote-hub-action] button').getBoundingClientRect();
      const x = Math.max(0, Math.floor(button.left - 12));
      return { x, y: 0, width: innerWidth - x, height: 54 };
    }`);
    await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.header-open.png`, (await window.webContents.capturePage(headerClip)).toPNG());
  }
  const layout = () => rendererValue(window, `() => {
    const buttons = [...document.querySelectorAll('[data-minke-tabs-header-action], [data-minke-remote-hub-action], [data-sidebar-right-mode], [data-sidebar-right-toggle], [data-sidebar-right-expand], [data-dockkit-split-button]')]
      .filter(button => button.checkVisibility({ checkVisibilityCSS: true }))
      .map(button => ({ label: button.getAttribute('aria-label') ?? button.title, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0);
    return buttons.flatMap((left, index) => buttons.slice(index + 1).flatMap(right => {
      const width = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
      const height = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
      return width > 1 && height > 1 ? [{ left: left.label, right: right.label, width, height }] : [];
    }));
  }`);
  const overlaps = await layout();
  const creators = await rendererValue(window, `() => [...document.querySelectorAll('[data-sidebar-right-panel] [data-option]')].map(button => button.dataset.option)`);
  assert.deepEqual({ overlaps, creators }, {
    overlaps: [], creators: ['files', 'browser', 'browser-history', 'plugins'],
  }, 'blank Session controls must be separate and the native Start tab must directly offer Minke creation actions');
  const guide = await rendererValue(window, `() => {
    const entry = document.querySelector('[data-sidebar-right-guide-entry="files"]');
    const section = document.querySelector('.minke-tabs-native-guide__section');
    return {
      description: entry.textContent,
      heading: section.querySelector('h2').textContent,
      nativeBottom: entry.getBoundingClientRect().bottom,
      minkeTop: section.getBoundingClientRect().top,
    };
  }`);
  assert.ok(guide.description.includes("Browse files in this session's workspace"));
  assert.equal(guide.heading, 'Minke');
  assert.equal(await rendererValue(window, `() => document.querySelector('[data-sidebar-right-guide-entry="terminal"] button[aria-label="Choose shell"]') !== null`), true, 'the native terminal guide retains its shell picker above Minke cards');
  assert.ok(guide.nativeBottom < guide.minkeTop, 'Minke cards follow the native guide entries');
  const assertGuideLayout = async state => {
    const bounds = await rendererValue(window, `() => {
      const guide = document.querySelector('[data-sidebar-right-guide]');
      let viewport = guide.parentElement;
      while (getComputedStyle(viewport).display === 'contents') viewport = viewport.parentElement;
      const pane = guide.closest('[data-dockkit-pane]');
      return {
        guideHeight: guide.getBoundingClientRect().height,
        viewportHeight: viewport.clientHeight,
        guideBottom: guide.getBoundingClientRect().bottom,
        paneBottom: pane.getBoundingClientRect().bottom,
        guideWidth: guide.clientWidth,
        guideScrollWidth: guide.scrollWidth,
        viewportWidth: viewport.clientWidth,
        viewportScrollWidth: viewport.scrollWidth,
      };
    }`);
    assert.ok(bounds.guideBottom >= bounds.paneBottom - 1,
      `${state}: Start must fill the pane so scrolling is not stranded above its bottom: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.guideScrollWidth <= bounds.guideWidth + 1 && bounds.viewportScrollWidth <= bounds.viewportWidth + 1,
      `${state}: Start cards must fit the pane without horizontal scrolling: ${JSON.stringify(bounds)}`);
  };
  await assertGuideLayout('initial Sidebar');
  await click('[data-minke-new-session-tabs-action] [data-minke-tabs-placement="bottom"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-panel[data-placement="bottom"][data-open]') !== null`), 'bottom panel beside Start');
  const assertBottomLayout = async state => {
    await rendererValue(window, '() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    await rendererValue(window, `() => {
      let viewport = document.querySelector('[data-sidebar-right-guide]').parentElement;
      while (getComputedStyle(viewport).display === 'contents') viewport = viewport.parentElement;
      viewport.scrollTop = viewport.scrollHeight;
      return true;
    }`);
    await rendererValue(window, '() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    const bounds = await rendererValue(window, `() => {
      const guide = document.querySelector('[data-sidebar-right-guide]');
      let viewport = guide.parentElement;
      while (getComputedStyle(viewport).display === 'contents') viewport = viewport.parentElement;
      const panel = guide.closest('[data-sidebar-right-panel]');
      const bottom = document.querySelector('.minke-tabs-panel[data-placement="bottom"][data-open]');
      const last = [...guide.querySelectorAll('[data-option]')].at(-1);
      return {
        rightBottom: panel.getBoundingClientRect().bottom,
        bottomTop: bottom.getBoundingClientRect().top,
        scrollTop: viewport.scrollTop,
        lastBottom: last.getBoundingClientRect().bottom,
      };
    }`);
    assert.ok(bounds.rightBottom <= bounds.bottomTop + 1,
      state + ': the native Sidebar must end above the bottom panel: ' + JSON.stringify(bounds));
    // scrollHeight is integer CSS pixels; rect edges can retain fractions.
    assert.ok(bounds.scrollTop > 0 && bounds.lastBottom <= bounds.bottomTop + 1,
      state + ': Start must scroll its final card above the bottom panel: ' + JSON.stringify(bounds));
  };
  await assertBottomLayout('bottom open');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-panel[data-placement="bottom"] [data-terminal-renderer="dsh"] .xterm-helper-textarea') !== null && document.querySelector('.minke-tabs-panel[data-placement="bottom"] [role="status"]') === null`), 'bottom terminal ready before resizing');
  const bottomResize = '.minke-tabs-panel[data-placement="bottom"][data-open] [data-minke-tabs-resize-handle]';
  const bottomHeight = await rendererValue(window, `() => {
    const handle = document.querySelector('${bottomResize}');
    handle.focus();
    return Number(handle.getAttribute('aria-valuenow'));
  }`);
  pressKey('Up');
  await waitFor(() => rendererValue(window, `() => Number(document.querySelector('${bottomResize}').getAttribute('aria-valuenow')) > ${bottomHeight}`), 'bottom panel expanded');
  await assertBottomLayout('bottom resized');
  pressKey('Down');
  await waitFor(() => rendererValue(window, `() => Number(document.querySelector('${bottomResize}').getAttribute('aria-valuenow')) === ${bottomHeight}`), 'bottom height restored');
  await click('[data-sidebar-right-mode="fullscreen"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="fullscreen"]')?.getBoundingClientRect().bottom === innerHeight`), 'fullscreen retains the entire viewport with bottom open');
  await click('[data-sidebar-right-mode="push"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="push"]') !== null`), 'docked beside bottom again');
  await assertBottomLayout('after fullscreen');
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.start-with-bottom.png`, (await window.webContents.capturePage()).toPNG());
  await click('[data-minke-new-session-tabs-action] [data-minke-tabs-placement="bottom"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-panel[data-placement="bottom"][data-open]') === null`), 'bottom panel closed after Start scroll');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="push"]').getBoundingClientRect().bottom === innerHeight`), 'Sidebar regains its full height');
  await rendererValue(window, `() => {
    let viewport = document.querySelector('[data-sidebar-right-guide]').parentElement;
    while (getComputedStyle(viewport).display === 'contents') viewport = viewport.parentElement;
    viewport.scrollTop = 0;
    return true;
  }`);
  const panelWidth = await rendererValue(window, `() => {
    const panel = document.querySelector('[data-sidebar-right-panel]');
    const width = panel.style.width;
    panel.style.width = '300px';
    return width;
  }`);
  try {
    await assertGuideLayout('300px Sidebar');
    if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.start-narrow.png`, (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1280, 420);
    await waitFor(() => rendererValue(window, '() => innerHeight === 420'), 'short Start viewport');
    await assertGuideLayout('short Sidebar');
    const scroll = await rendererValue(window, `() => {
      const guide = document.querySelector('[data-sidebar-right-guide]');
      let viewport = guide.parentElement;
      while (getComputedStyle(viewport).display === 'contents') viewport = viewport.parentElement;
      viewport.scrollTop = viewport.scrollHeight;
      const last = [...guide.querySelectorAll('[data-option]')].at(-1);
      const result = { top: viewport.scrollTop, lastBottom: last.getBoundingClientRect().bottom, viewportBottom: viewport.getBoundingClientRect().bottom };
      viewport.scrollTop = 0;
      return result;
    }`);
    assert.ok(scroll.top > 0 && scroll.lastBottom <= scroll.viewportBottom + 1, 'short Start pages scroll to the final card within CSS scroll rounding: ' + JSON.stringify(scroll));
  } finally {
    window.setContentSize(1280, 800);
    await waitFor(() => rendererValue(window, '() => innerHeight === 800'), 'restored Start viewport');
    await rendererValue(window, `() => { document.querySelector('[data-sidebar-right-panel]').style.width = ${JSON.stringify(panelWidth)}; return true; }`);
  }

  // Source input at the failing seam is now green; also exercise the same
  // global actions at compact widths and while DSH owns fullscreen.
  for (const width of [980, 1600, 1280]) {
    window.setContentSize(width, 800);
    await waitFor(() => rendererValue(window, `() => innerWidth === ${width}`), 'window resize');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(await layout(), [], `layout controls at width ${width}`);
    await assertGuideLayout(`Sidebar at width ${width}`);
    await click('[data-sidebar-right-mode="fullscreen"]');
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="fullscreen"]') !== null`), 'fullscreen mode');
    await assertGuideLayout(`fullscreen at width ${width}`);
    await verifyWindowDrag({ window, rendererValue }, `fullscreen at width ${width}`);
    await verifyWindowDragRecall({ window, rendererValue });
    if (process.platform === 'darwin') {
      const chrome = await rendererValue(window, `() => {
        const panel = document.querySelector('[data-sidebar-right-panel="fullscreen"]');
        const strip = panel.querySelector('[data-dockkit-strip]');
        const firstTab = panel.querySelector('[data-dockkit-tab]');
        // rc.2 paints each docked pane; the common panel stays transparent so
        // floating panes can escape it. Check the surfaces that actually cover
        // the conversation rather than the former wrapper background.
        const backgroundAlpha = [...panel.querySelectorAll('[data-dockkit-host="dock"] > [data-dockkit-pane]')].map(pane => {
          const context = document.createElement('canvas').getContext('2d');
          context.fillStyle = getComputedStyle(pane).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3];
        });
        return {
          firstTabLeft: firstTab.getBoundingClientRect().left,
          backgroundAlpha: backgroundAlpha.length ? Math.min(...backgroundAlpha) : 0,
          stripAppRegion: getComputedStyle(strip).getPropertyValue('-webkit-app-region').trim(),
          interactiveRegions: [...strip.querySelectorAll('[data-dockkit-tab], button')].map(element =>
            getComputedStyle(element).getPropertyValue('-webkit-app-region').trim()),
        };
      }`);
      if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.fullscreen.png`, (await window.webContents.capturePage()).toPNG());
      assert.ok(chrome.firstTabLeft >= 64 && chrome.backgroundAlpha === 255,
        'fullscreen tabs must clear the native window controls and cover underlying Sidebar chrome: ' + JSON.stringify(chrome));
      assert.equal(chrome.stripAppRegion, 'drag', 'macOS native Sidebar header must expose its blank area as a window drag region');
      assert.ok(chrome.interactiveRegions.every(region => region === 'no-drag'), 'tabs and header controls must retain their pointer interaction');
    }
    assert.deepEqual(await layout(), [], 'fullscreen controls');
    await click('[data-sidebar-right-mode="push"]');
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="push"]') !== null`), 'docked mode');
  }
  nativeTheme.themeSource = 'dark';
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 750 });
  await new Promise(resolve => setTimeout(resolve, 200));
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(process.env.MINKE_SIDEBAR_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  nativeTheme.themeSource = 'light';
  await click('[data-sidebar-right-toggle]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') === null`), 'collapsed Sidebar');
  await click('[data-sidebar-right-expand]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null`), 'reopened Sidebar');

  const create = async (option, kind, count, keyboard = false) => {
    const selector = `[data-sidebar-right-guide] [data-option="${option}"]`;
    if (keyboard) {
      await rendererValue(window, `() => { document.querySelector(${JSON.stringify(selector)}).focus(); return true; }`);
      pressEnter();
    } else await click(selector);
    await waitFor(() => rendererValue(window, `() => {
      const host = [...document.querySelectorAll('.minke-tabs-native-host[data-kind="${kind}"]')].find(host => !host.inert);
      return host?.checkVisibility({ checkVisibilityCSS: true }) === true;
    }`), `visible ${kind} content`);
    assert.equal(await rendererValue(window, `() => document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-tab]').length`), count, 'creation replaces Start with the requested tab');
  };
  const openAddMenu = async (selector = '[data-dockkit-add-tab]', keyboard = false) => {
    const before = await rendererValue(window, `() => [...document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-tab]')].map(tab => tab.dataset.dockkitTab)`);
    if (keyboard) {
      await rendererValue(window, `() => { document.querySelector(${JSON.stringify(selector)}).focus(); return true; }`);
      pressEnter();
    } else await click(selector);
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-tabs-create-menu]') !== null`), 'grouped add-tab menu');
    await verifyWindowDrag({ window, rendererValue }, 'add menu open');
    const menu = await rendererValue(window, `() => ({
      tabs: [...document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-tab]')].map(tab => tab.dataset.dockkitTab),
      groups: [...document.querySelectorAll('[data-minke-tabs-create-menu] [role="group"]')].map(group => group.getAttribute('aria-label')),
      options: [...document.querySelectorAll('[data-minke-tabs-create-menu] [data-option]')].map(item => item.dataset.option),
      expanded: document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded'),
    })`);
    assert.deepEqual(menu.tabs, before, 'opening the menu must not create or replace tabs');
    assert.deepEqual(menu.groups, ['DSH', 'Minke']);
    assert.ok(menu.options.some(id => id.startsWith('dsh:files:')), 'native file manager stays available');
    assert.equal(menu.options.filter(id => id.startsWith('dsh:terminal:') || id === 'terminal').length, 1, 'one provider-owned Terminal entry');
    assert.ok(menu.options.includes('browser') && menu.options.includes('dsh:guide'));
    assert.equal(menu.expanded, 'true');
    return before;
  };
  const add = async () => {
    const before = await openAddMenu();
    await click('[data-minke-tabs-create-menu] [data-option="dsh:guide"]');
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-guide] [data-option="files"]') !== null`), 'native Start page', 5_000);
    const after = await rendererValue(window, `() => [...document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-tab]')].map(tab => tab.dataset.dockkitTab)`);
    assert.equal(after.length, before.length + 1, 'choosing Start opens one tab');
    assert.ok(before.every(id => after.includes(id)), 'opening Start preserves existing tabs');
    assert.equal(await rendererValue(window, `() => document.querySelector('[data-minke-tabs-create-menu]') === null`), true, 'selection dismisses the menu');
  };

  const beforeCancel = await openAddMenu();
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) {
    await rendererValue(window, '() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.add-menu.png`, (await window.webContents.capturePage()).toPNG());
  }
  pressKey('Escape');
  await waitFor(() => rendererValue(window, `() => !document.querySelector('[data-minke-tabs-create-menu]') && document.activeElement?.matches('[data-dockkit-add-tab]')`), 'Escape returns focus to add button');
  assert.deepEqual(await rendererValue(window, `() => [...document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-tab]')].map(tab => tab.dataset.dockkitTab)`), beforeCancel);
  await openAddMenu('[data-dockkit-add-tab]', true);
  await waitFor(() => rendererValue(window, `() => document.activeElement?.matches('[data-minke-tabs-create-menu] [role="menuitem"]')`), 'keyboard menu focus');
  pressKey('End');
  await waitFor(() => rendererValue(window, `() => document.activeElement === [...document.querySelectorAll('[data-minke-tabs-create-menu] [role="menuitem"]')].at(-1)`), 'keyboard navigation to last menu item');
  await click('[data-sidebar-right-guide-entry="terminal"] button[aria-label="Choose shell"]');
  await waitFor(() => rendererValue(window, `() => !document.querySelector('[data-minke-tabs-create-menu]')`), 'outside click dismisses add menu');
  pressKey('Escape');
  process.stdout.write('[sidebar-ui] grouped add menu, cancellation, and keyboard navigation passed\n');

  // Exercise the provider-owned guide, two independent native shells, and cleanup
  // before creating Minke content. This catches accidental replacement of the guide.
  const shellPattern = process.platform === 'win32' ? '^cmd(?:\\.exe)?$' : '^(ba|z|k)?sh$';
  await click('[data-sidebar-right-guide-entry="terminal"] button[aria-label="Choose shell"]');
  await waitFor(() => rendererValue(window, `() => [...document.querySelectorAll('[role="menuitem"]:not([disabled])')].some(item => new RegExp(${JSON.stringify(shellPattern)}, 'i').test(item.textContent.trim()))`), 'native shell choices');
  const shellIndex = await rendererValue(window, `() => [...document.querySelectorAll('[role="menuitem"]')].findIndex(item => new RegExp(${JSON.stringify(shellPattern)}, 'i').test(item.textContent.trim()))`);
  await click('[role="menuitem"]', shellIndex);
  const nativeTerminalIds = [];
  const runNativeShell = async (file, value) => {
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal] .xterm-helper-textarea') !== null && document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal] [role="status"]') === null`), 'connected native terminal');
    await click('[data-sidebar-right-panel] [data-sidebar-terminal] .xterm-screen');
    await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal] .xterm-helper-textarea')`), 'native terminal keyboard focus');
    typeKeys(process.platform === 'win32'
      ? `<nul set /p "=${value}" > "${file}"`
      : `printf '%s' '${value}' > '${file}'`);
    pressEnter();
    try {
      await waitFor(async () => {
        try { return await readFile(join(workspace, file), 'utf8') === value; }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      }, 'native shell writes its workspace file');
    } catch (error) {
      const actual = await readFile(join(workspace, file), 'utf8').catch(() => null);
      const terminals = await rendererValue(window, `() => [...document.querySelectorAll('[data-sidebar-right-panel] [data-sidebar-terminal]')].map(terminal => ({
        visible: terminal.checkVisibility({ checkVisibilityCSS: true }),
        focused: terminal.contains(document.activeElement),
        text: terminal.querySelector('.xterm-rows')?.textContent.slice(-1200),
      }))`);
      throw new Error(JSON.stringify({ file, expected: value, actual, terminals }), { cause: error });
    }
    return rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal]').closest('[data-dockkit-pane]').querySelector('[data-dockkit-tab][aria-selected="true"]').dataset.dockkitTab`);
  };
  nativeTerminalIds.push(await runNativeShell('dsh-terminal-one.txt', 'first'));
  // Keep the upstream dock usable: its split must host native Terminal and
  // Workspace files together, including after the renderer restores its layout.
  await click('[data-sidebar-right-mode="fullscreen"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-dockkit-split-button]:not([disabled])') !== null`), 'native split control in the expanded Sidebar');
  await click('[data-dockkit-split-button]:not([disabled])');
  await waitFor(() => rendererValue(window, `() => document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-pane]').length === 2`), 'two native panes');
  await click('button[data-sidebar-right-guide-entry="files"]');
  const splitFilesTabId = await waitFor(() => rendererValue(window, `() => {
    const tree = document.querySelector('[data-files-state="tree"]');
    return tree?.closest('[data-dockkit-pane]').querySelector('[data-dockkit-tab][aria-selected="true"]')?.dataset.dockkitTab;
  }`), 'native Workspace files in the second pane');
  const assertNativeSplit = async state => {
    const content = await rendererValue(window, `() => {
      const terminal = document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal] .xterm-screen');
      const files = document.querySelector('[data-files-state="tree"]');
      const terminalPane = terminal?.closest('[data-dockkit-pane]');
      const filesPane = files?.closest('[data-dockkit-pane]');
      const left = terminalPane?.getBoundingClientRect();
      const right = filesPane?.getBoundingClientRect();
      return {
        panes: document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-pane]').length,
        terminalVisible: terminal?.checkVisibility({ checkVisibilityCSS: true }),
        filesVisible: files?.checkVisibility({ checkVisibilityCSS: true }),
        separatePanes: !!terminalPane && !!filesPane && terminalPane !== filesPane,
        sideBySide: !!left && !!right && left.right <= right.left + 1 && Math.abs(left.top - right.top) < 1,
      };
    }`);
    assert.deepEqual(content, { panes: 2, terminalVisible: true, filesVisible: true, separatePanes: true, sideBySide: true },
      state + ': native split must keep Terminal and Workspace files visible in separate columns');
    await verifyWindowDrag({ window, rendererValue }, state);
  };
  await assertNativeSplit('after splitting');
  const filesPaneId = await rendererValue(window, `() => document.querySelector('[data-files-state="tree"]').closest('[data-dockkit-pane]').dataset.dockkitPane`);
  await openAddMenu(`[data-dockkit-add-tab="${filesPaneId}"]`);
  await click('[data-minke-tabs-create-menu] [data-option="browser"]');
  const splitBrowserTabId = await waitFor(() => rendererValue(window, `() => {
    const pane = document.querySelector('[data-dockkit-pane="${filesPaneId}"]');
    const tab = pane.querySelector('[data-dockkit-tab][aria-selected="true"]:has([data-minke-tab-title])');
    return tab?.dataset.dockkitTab;
  }`), 'menu creates browser in the clicked split pane');
  await click(`[data-dockkit-tab="${splitBrowserTabId}"] [data-dockkit-tab-close]`);
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-files-state="tree"]')?.checkVisibility({ checkVisibilityCSS: true })`), 'split files restored after closing browser');
  await assertNativeSplit('after creating from the split menu');
  await runNativeShell('dsh-terminal-one.txt', 'split');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-files-path$="/dsh-terminal-one.txt"]') !== null`), 'native file browser sees the terminal output');
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.native-split.png`, (await window.webContents.capturePage()).toPNG());
  await window.loadURL(harnessUrl);
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-files-state="tree"]') !== null && document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal] .xterm-screen') !== null`), 'restored native split content');
  await assertNativeSplit('after refresh');
  await runNativeShell('dsh-terminal-one.txt', 'restored');
  await click(`[data-dockkit-tab="${splitFilesTabId}"] [data-dockkit-tab-close]`);
  await waitFor(() => rendererValue(window, `() => document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-pane]').length === 1`), 'closing the second pane keeps the native terminal');
  await click('[data-sidebar-right-mode="push"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="push"]') !== null`), 'native split returns to docked mode');
  process.stdout.write('[sidebar-ui] native split, simultaneous Terminal and Workspace files, and layout restoration passed\n');
  await openAddMenu('[data-dockkit-add-tab]', true);
  await rendererValue(window, `() => { document.querySelector('[data-minke-tabs-create-menu] [data-option^="dsh:terminal:"]').focus(); return true; }`);
  pressEnter();
  nativeTerminalIds.push(await runNativeShell('dsh-terminal-two.txt', 'second'));
  assert.notEqual(nativeTerminalIds[0], nativeTerminalIds[1], 'native terminal instances have separate tabs');
  await click(`[data-dockkit-tab="${nativeTerminalIds[0]}"]`);
  await runNativeShell('dsh-terminal-one.txt', 'retained');
  for (const id of nativeTerminalIds) {
    await click(`[data-dockkit-tab="${id}"]`);
    await click(`[data-dockkit-tab="${id}"] [data-dockkit-tab-close]`);
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-dockkit-tab="${id}"]') === null`), 'closed native terminal');
  }
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') === null`), 'Sidebar closes with its last native terminal');
  await click('[data-sidebar-right-expand]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-guide] [data-option="browser"]') !== null`), 'Start after closing native terminals');
  process.stdout.write('[sidebar-ui] native shell picker, independent terminals and close passed\n');

  await create('browser', 'web', 1);
  await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('.minke-tabs-native-host[data-kind="web"] input[role="combobox"]')`), 'new Web tab address focus', 5_000);
  await window.webContents.insertText(fixtureUrl);
  pressEnter();
  const guestId = await waitFor(() => rendererValue(window, `() => {
    const guest = document.querySelector('.minke-tabs-native-host[data-kind="web"] webview');
    if (!guest?.getWebContentsId) return false;
    try { return guest.getURL() === ${JSON.stringify(fixtureUrl)} && guest.getWebContentsId(); }
    catch (error) {
      if (String(error).includes('dom-ready')) return false;
      throw error;
    }
  }`), 'Web fixture navigation');
  const guest = webContents.fromId(guestId);
  await waitFor(() => guest.executeJavaScript('document.querySelector("#human-note") !== null'), 'Web fixture input');
  await guest.executeJavaScript('document.querySelector("#human-note").focus()');
  await guest.insertText('Preserved Web state');
  process.stdout.write('[sidebar-ui] Web creation, focus and navigation passed\n');
  await add();
  await click('[data-sidebar-right-panel] [data-dockkit-tab][aria-selected="true"] [data-dockkit-tab-close]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-guide]') === null`), 'closing Start returns to the browser');
  assert.equal(await guest.executeJavaScript('document.querySelector("#human-note").value'), 'Preserved Web state', 'closing Start retains page input');
  await add();
  await click('[data-sidebar-right-guide-entry="terminal"] button');
  const terminalId = await runNativeShell('dsh-terminal-retention.txt', 'ready');
  typeKeys(process.platform === 'win32'
    ? 'set "minke_sidebar_state=retained"&echo assigned > dsh-terminal-retention.txt'
    : 'minke_sidebar_state=retained; printf assigned > dsh-terminal-retention.txt');
  pressEnter();
  await waitFor(async () => (await readFile(join(workspace, 'dsh-terminal-retention.txt'), 'utf8')).trim() === 'assigned', 'native shell variable assignment');
  const checkShellState = async () => {
    await click(`[data-dockkit-tab="${terminalId}"]`);
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal] .xterm-helper-textarea') !== null && document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal] [role="status"]') === null`), 'reconnected native terminal');
    await click('[data-sidebar-right-panel] [data-sidebar-terminal] .xterm-screen');
    await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('[data-sidebar-right-panel] [data-sidebar-terminal] .xterm-helper-textarea')`), 'restored native terminal keyboard focus');
    typeKeys(process.platform === 'win32'
      ? 'echo %minke_sidebar_state% > dsh-terminal-retention.txt'
      : 'printf "%s" "$minke_sidebar_state" > dsh-terminal-retention.txt');
    pressEnter();
    await waitFor(async () => (await readFile(join(workspace, 'dsh-terminal-retention.txt'), 'utf8')).trim() === 'retained', 'same native shell state');
  };
  process.stdout.write('[sidebar-ui] live native Terminal command passed\n');

  await writeFile(join(workspace, 'sidebar-draft.txt'), 'Original draft\n');
  await add();
  await create('files', 'files', 3);
  const file = await waitFor(() => rendererValue(window, `() => {
    const row = [...document.querySelectorAll('.minke-tabs-native-host[data-kind="files"] [data-kind="file"]')].find(row => row.textContent.includes('sidebar-draft.txt'));
    if (!row) return false;
    row.dataset.sidebarTestFile = '';
    return true;
  }`), 'workspace file in the Minke editor');
  assert.equal(file, true);
  await click('[data-sidebar-test-file]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="files"] .cm-content') !== null`), 'file editor');
  await click('.minke-tabs-native-host[data-kind="files"] .cm-content');
  await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('.minke-tabs-native-host[data-kind="files"] .cm-content')`), 'file editor keyboard focus');
  await window.webContents.insertText('Unsaved change ');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="files"] .cm-content')?.textContent.includes('Unsaved change') && document.querySelector('.minke-tabs-native-host[data-kind="files"] .minke-files-preview__dirty') !== null`), 'unsaved editor input');
  // Rejecting the actual close guard must retain the live editor and draft.
  await rendererValue(window, `() => {
    window.__minkeSidebarConfirmCalls = 0;
    window.confirm = () => { window.__minkeSidebarConfirmCalls += 1; return false; };
    return true;
  }`);
  const fileId = await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="files"]').dataset.minkeTabInstance`);
  await click(`[data-dockkit-tab]:has([data-minke-tab-title="${fileId}"]) [data-dockkit-tab-close]`);
  await waitFor(() => rendererValue(window, `() => window.__minkeSidebarConfirmCalls === 1`), 'native close to consult the unsaved file guard');
  assert.equal(await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="files"] .cm-content')?.textContent.includes('Unsaved change')`), true);

  const webId = await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="web"]').dataset.minkeTabInstance`);
  await click('[data-sidebar-right-mode="fullscreen"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="fullscreen"]') !== null`), 'populated Sidebar fullscreen');
  await waitFor(() => rendererValue(window, `() => (${fillsFullscreenViewport})('.minke-tabs-native-host[data-kind="files"]')`), 'file editor fills the fullscreen viewport');
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.files-fullscreen.png`, (await window.webContents.capturePage()).toPNG());
  await click(`[data-minke-tab-title="${webId}"]`);
  await waitFor(() => rendererValue(window, `() => !document.querySelector('.minke-tabs-native-host[data-kind="web"]').inert`), 'first fullscreen tab receives a real mouse click');
  assert.equal(await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="web"] webview').getWebContentsId()`), guestId, 'switching tabs retains the browser instance');
  assert.equal(await guest.executeJavaScript('document.querySelector("#human-note").value'), 'Preserved Web state', 'switching tabs retains page input');
  await click('[data-sidebar-right-mode="push"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="push"]') !== null`), 'populated Sidebar restores docked mode');
  await checkShellState();
  await add();
  await create('browser', 'web', 4);
  assert.equal(await rendererValue(window, `() => document.querySelectorAll('.minke-tabs-native-host[data-kind="web"]').length`), 2, 'same-kind tabs remain separate instances');

  await add();
  await create('browser-history', 'browser-history', 5);
  await add();
  await create('browser-history', 'browser-history', 5);
  assert.equal(await rendererValue(window, `() => document.querySelectorAll('.minke-tabs-native-host[data-kind="browser-history"]').length`), 1, 'a singleton creator reuses its content and still removes Start');

  // Other plugins still use their native guide entries and document viewers.
  await add();
  await click('button[data-sidebar-right-guide-entry="files"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-files-state="tree"] [data-files-path$="/sidebar-draft.txt"]') !== null`), 'native Workspace files tree');
  const nativeFilesTabId = await rendererValue(window, `() => document.querySelector('[data-files-state="tree"]').closest('[data-dockkit-pane]').querySelector('[data-dockkit-tab][aria-selected="true"]').dataset.dockkitTab`);
  await click('[data-files-entry="file"][data-files-path$="/sidebar-draft.txt"] button');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-textpreview-body]')?.textContent.includes('Original draft')`), 'native document preview beside Minke editor');
  assert.equal(await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="files"] .cm-content')?.textContent.includes('Unsaved change')`), true, 'native preview leaves the custom editor draft intact');

  await click(`[data-dockkit-tab="${nativeFilesTabId}"]`);
  await click('[data-files-entry="file"][data-files-path$="/sidebar-code.ts"] button');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-code-block-content]')?.textContent.includes('value179')`), 'native code preview');
  const codeLayout = await rendererValue(window, `() => {
    const body = document.querySelector('[data-textpreview-body]');
    const banner = body.querySelector('[data-code-block-banner]');
    const port = body.querySelector('[data-code-block-content]');
    const bannerRect = banner.getBoundingClientRect(), portRect = port.getBoundingClientRect();
    window.__minkeCodeScrollObserved = false;
    port.addEventListener('scroll', () => { window.__minkeCodeScrollObserved = true; }, { once: true });
    port.scrollTo({ top: 120, left: 50 });
    return {
      edgeGap: Math.abs(bannerRect.right - body.getBoundingClientRect().right),
      overlap: bannerRect.bottom - portRect.top,
      overflow: getComputedStyle(port).overflow,
      legacyBackground: getComputedStyle(body).backgroundImage,
    };
  }`);
  assert.ok(codeLayout.edgeGap < 1 && codeLayout.overlap <= 1, JSON.stringify(codeLayout));
  assert.equal(codeLayout.overflow, 'auto');
  assert.equal(codeLayout.legacyBackground, 'none', 'DSH owns the banner and source scrollport without a Minke fill');
  await waitFor(() => rendererValue(window, '() => window.__minkeCodeScrollObserved === true'), 'native code scroll state');
  const codeTabId = await rendererValue(window, `() => document.querySelector('[data-textpreview-body]').closest('[data-dockkit-pane]').querySelector('[data-dockkit-tab][aria-selected="true"]').dataset.dockkitTab`);
  await click(`[data-dockkit-tab="${nativeFilesTabId}"]`);
  await click(`[data-dockkit-tab="${codeTabId}"]`);
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-code-block-content]')?.scrollTop === 120`), 'restored native code scroll position');
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.code-preview.png`, (await window.webContents.capturePage()).toPNG());
  process.stdout.write('[sidebar-ui] native code banner, scrollport and saved position passed\n');

  await checkShellState();
  const checkBottomAfterReload = await require('./shared-terminal-ui.cjs').verifySharedTerminalUI({ window, rendererValue, waitFor, workspace, click, pressKey, pressEnter, typeKeys });
  assert.deepEqual(await layout(), [], 'global actions remain separate with both panels open');
  await click('[data-minke-new-session-tabs-action] [data-minke-tabs-placement="bottom"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-panel[data-placement="bottom"][data-open]') === null`), 'bottom panel collapse');
  assert.equal(await rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null`), true, 'bottom toggle leaves the native Sidebar open');
  process.stdout.write('[sidebar-ui] retained state, close guard, native previews and bottom controls passed\n');
  // A real renderer refresh must rehydrate content before DSH reconciles its
  // persisted layout. File drafts keep their baseline; native shells reconnect.
  await click(`[data-minke-tab-title="${fileId}"]`);
  const draft = await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="files"] .cm-content').textContent`);
  await writeFile(join(workspace, 'dsh-terminal-retention.txt'), 'before refresh');
  window.webContents.reload();
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-tab-title="${fileId}"]') !== null`), 'restored Files tab identity', 30_000);
  await click(`[data-minke-tab-title="${fileId}"]`);
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="files"] .cm-content')?.textContent === ${JSON.stringify(draft)} && document.querySelector('.minke-tabs-native-host[data-kind="files"] .minke-files-preview__dirty') !== null`), 'restored unsaved file draft');
  await click(`[data-minke-tab-title="${webId}"]`);
  await waitFor(() => rendererValue(window, `() => {
    const guest = document.querySelector('[data-minke-tab-instance="${webId}"] webview');
    try { return guest?.getURL() === ${JSON.stringify(fixtureUrl)}; } catch { return false; }
  }`), 'restored Web URL');
  await checkShellState();
  await checkBottomAfterReload();
  assert.equal(await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="terminal"]') === null`), true, 'sidebar contains only native terminals');
  process.stdout.write('[sidebar-ui] refresh restores custom content and the original native shell\n');
  await require('./files-preview-ui.cjs').verifyFilesPreviewUI({ window, rendererValue, waitFor, workspace, click, pressKey, openedFilePaths });
  await add();
  await click('[data-sidebar-right-guide] [data-option="plugins"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-plugins-page [role="search"]') !== null`), 'plugin discovery search');
  assert.deepEqual(await rendererValue(window, `() => [...document.querySelectorAll('.minke-plugins-page button')]
    .filter(button => /Manage plugins|safe mode/.test(button.textContent))
    .map(button => button.textContent)`), [], 'discovery must not duplicate management or recovery controls');
  const discoveryId = await waitFor(() => rendererValue(window, `() => {
    const host = document.querySelector('.minke-tabs-native-host[data-kind="plugin-catalog"]');
    try { return host?.querySelector('webview')?.getWebContentsId() ? host.dataset.minkeTabInstance : false; }
    catch { return false; }
  }`), 'discovery shared browser guest');
  await rendererValue(window, `() => document.querySelector('.minke-plugins-page webview').loadURL(${JSON.stringify(fixtureUrl)})`);
  const checkDiscoveryGuest = async () => {
    const id = await waitFor(() => rendererValue(window, `() => {
      const view = document.querySelector('.minke-plugins-page webview');
      if (!view?.checkVisibility({ checkVisibilityCSS: true })) return false;
      const rect = view.getBoundingClientRect();
      try { return rect.width > 100 && rect.height > 100 && view.getURL() === ${JSON.stringify(fixtureUrl)} && view.getWebContentsId(); }
      catch { return false; }
    }`), 'visible discovery fixture');
    await waitFor(() => webContents.fromId(id)?.executeJavaScript(`document.querySelector('#state')?.textContent === 'Ready'`), 'discovery fixture content');
    assert.equal(await rendererValue(window, `() => document.querySelectorAll('.minke-plugins-page webview').length`), 1, 'discovery owns one shared guest');
    return id;
  };
  const discoveryGuestId = await checkDiscoveryGuest();
  await webContents.fromId(discoveryGuestId).executeJavaScript(`document.querySelector('#human-note').value = 'Retained across Plugins and Settings'`);
  await click('button[aria-label="Plugins"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-plugin-panel][aria-busy="false"] [data-plugin-package]') !== null`), 'native DSH Plugins page');
  await click('[data-plugin-panel] header button:last-child');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[role="dialog"] input[aria-label="Package name or address"]') !== null`), 'DSH Add plugin dialog');
  await click('[role="dialog"] button[aria-label="Close"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[role="dialog"]') === null`), 'native plugin dialog dismissed');
  await verifyWindowDrag({ window, rendererValue }, 'Plugins page');
  await rendererValue(window, `() => {
    document.querySelector('[data-plugin-item="minke-plugin-recovery"]').scrollIntoView({ block: 'center' });
    return true;
  }`);
  await click('[data-plugin-item="minke-plugin-recovery"] button');
  await waitFor(() => rendererValue(window, `() => {
    const page = document.querySelector('[data-plugin-item-detail="minke-plugin-recovery"]');
    return page && [...page.querySelectorAll('button')].some(button => button.textContent.includes('Restart in safe mode') && !button.disabled)
      && page.querySelector('[role="alert"]') === null;
  }`), 'desktop recovery through the native Plugins slot');
  assert.deepEqual(await rendererValue(window, `() => [...document.querySelectorAll('.minke-plugin-recovery button')].map(button => button.textContent.trim())`), ['Restart in safe mode'], 'recovery has one canonical entry in the native Plugins page');
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.plugins.png`, (await window.webContents.capturePage()).toPNG());
  process.stdout.write('[sidebar-ui] native plugin installation entry and single desktop recovery entry passed\n');
  for (const entry of ['header', 'shortcut']) {
    if (entry === 'shortcut') {
      await click('button[aria-label="Plugins"]');
      await click('button[aria-label="Settings"]');
      await waitFor(() => rendererValue(window, `() => document.querySelector('[data-shortcut-modal="settings"]') !== null`), 'native Settings dialog');
      pressKey('Escape');
      await waitFor(() => rendererValue(window, `() => document.querySelector('[data-shortcut-modal="settings"]') === null`), 'Settings returns to Plugins');
      await verifyWindowDrag({ window, rendererValue }, 'after Settings dismissal');
    }
    const opener = '[data-minke-new-session-tabs-action] [data-minke-tabs-placement="right"]';
    await waitFor(() => rendererValue(window, `() => document.querySelector('${opener}')?.checkVisibility({ checkVisibilityCSS: true })`), entry + ' Sidebar opener');
    assert.equal(await rendererValue(window, `() => document.querySelector('.minke-tabs-panel[data-placement="right"][data-open]') !== null`), false,
      entry + ' must not replace the connected DSH Sidebar with the legacy Minke menu');
    if (entry === 'header') await click(opener);
    else {
      const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'p', modifiers });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'p', modifiers });
      assert.equal(await checkDiscoveryGuest(), discoveryGuestId, 'Sidebar shortcut restores the selected native tab');
      await add();
    }
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-guide-entry="terminal"]')?.checkVisibility({ checkVisibilityCSS: true }) && document.querySelector('[data-sidebar-right-guide-entry="files"]')?.checkVisibility({ checkVisibilityCSS: true })`), entry + ' opens the native Start entries');
    await click('[data-sidebar-right-guide-entry="terminal"] button');
    const openedTerminal = await runNativeShell('dsh-terminal-from-panel.txt', entry === 'header' ? 'Plugins' : 'Shortcut');
    await click(`[data-dockkit-tab="${openedTerminal}"] [data-dockkit-tab-close]`);
    await click(`[data-minke-tab-title="${discoveryId}"]`);
    assert.equal(await checkDiscoveryGuest(), discoveryGuestId, entry + ' retains the same browser instance');
    assert.equal(await webContents.fromId(discoveryGuestId).executeJavaScript(`document.querySelector('#human-note').value`), 'Retained across Plugins and Settings');
    assert.equal(await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="files"] .cm-content')?.textContent`), draft,
      entry + ' navigation preserves the unsaved editor draft');
  }
  process.stdout.write('[sidebar-ui] Plugins, Settings dismissal and Sidebar shortcut retain content and open working DSH terminals\n');
  window.webContents.reload();
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-tab-title="${discoveryId}"]') !== null`), 'restored discovery tab identity');
  await click(`[data-minke-tab-title="${discoveryId}"]`);
  await checkDiscoveryGuest();
  process.stdout.write('[sidebar-ui] shared discovery browser content and URL restoration passed\n');
}

module.exports = { verifyNativeSidebarUI };
