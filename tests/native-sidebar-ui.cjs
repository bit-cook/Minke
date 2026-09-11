'use strict';

const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { nativeTheme, webContents } = require('electron');

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
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      window.webContents.sendInputEvent({ type: 'char', keyCode });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    }
  };
  const click = async selector => {
    const point = await waitFor(() => rendererValue(window, `() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      if (!button || !button.checkVisibility({ checkVisibilityCSS: true })) return false;
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === button || button.contains(hit))) return false;
      return { x: Math.round(x), y: Math.round(y) };
    }`), `clickable ${selector}`, 8_000);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const assertHeaderAlignment = async state => {
    const remote = await waitFor(() => rendererValue(window, `() => {
      const button = document.querySelector('[data-minke-new-session-remote-hub-action] button');
      if (!button?.checkVisibility({ checkVisibilityCSS: true })) return false;
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }`), 'blank Session Remote action');
    window.webContents.sendInputEvent({ type: 'mouseMove', ...remote });
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-new-session-remote-hub-action] button')?.matches(':hover')`), 'Remote hover');
    const centers = await rendererValue(window, `() => {
      return [...document.querySelectorAll('[data-minke-remote-hub-action], [data-minke-tabs-header-action], [data-sidebar-right-mode], [data-sidebar-right-toggle]')]
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
  await waitFor(() => rendererValue(window, `() =>
    document.querySelector('[data-minke-new-session-tabs-action] button[data-minke-tabs-placement="right"]') !== null
  `), 'blank Session Sidebar opener');
  await assertHeaderAlignment('collapsed Sidebar');
  await click('[data-minke-new-session-tabs-action] button[data-minke-tabs-placement="right"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null`), 'blank Session native Sidebar');
  await waitFor(() => rendererValue(window, `() => !document.querySelector('[data-sidebar-right-panel]').getAnimations().some(animation => animation.playState === 'running')`), 'Sidebar transition');
  await assertHeaderAlignment('open Sidebar');
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) {
    await writeFile(process.env.MINKE_SIDEBAR_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  const layout = () => rendererValue(window, `() => {
    const buttons = [...document.querySelectorAll('[data-minke-tabs-header-action], [data-minke-remote-hub-action], [data-sidebar-right-mode], [data-sidebar-right-toggle], [data-dockkit-split-button]')]
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
    overlaps: [], creators: ['files', 'terminal', 'browser', 'browser-history', 'plugins'],
  }, 'blank Session controls must be separate and the native Start tab must directly offer Minke creation actions');
  const guide = await rendererValue(window, `() => {
    const entry = document.querySelector('[data-sidebar-right-guide-entry="files"]');
    const section = document.querySelector('.minke-tabs-native-guide__section');
    return {
      description: entry.querySelector('.minke-tabs-native-guide__description')?.textContent,
      heading: section.querySelector('h2').textContent,
      nativeBottom: entry.getBoundingClientRect().bottom,
      minkeTop: section.getBoundingClientRect().top,
    };
  }`);
  assert.equal(guide.description, "Browse files in this session's workspace");
  assert.equal(guide.heading, 'Minke');
  assert.ok(guide.nativeBottom < guide.minkeTop, 'Minke cards follow the native guide entries');
  const assertGuideLayout = async state => {
    const bounds = await rendererValue(window, `() => {
      const guide = document.querySelector('.minke-tabs-native-guide');
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
      const guide = document.querySelector('.minke-tabs-native-guide');
      let viewport = guide.parentElement;
      while (getComputedStyle(viewport).display === 'contents') viewport = viewport.parentElement;
      viewport.scrollTop = viewport.scrollHeight;
      const last = [...guide.querySelectorAll('[data-option]')].at(-1);
      const result = { top: viewport.scrollTop, lastBottom: last.getBoundingClientRect().bottom, viewportBottom: viewport.getBoundingClientRect().bottom };
      viewport.scrollTop = 0;
      return result;
    }`);
    assert.ok(scroll.top > 0 && scroll.lastBottom <= scroll.viewportBottom, 'short Start pages scroll to the final card: ' + JSON.stringify(scroll));
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
    if (process.platform === 'darwin') {
      const chrome = await rendererValue(window, `() => {
        const panel = document.querySelector('[data-sidebar-right-panel="fullscreen"]');
        const strip = panel.querySelector('[data-dockkit-strip]');
        const firstTab = panel.querySelector('[data-dockkit-tab]');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.fillStyle = getComputedStyle(panel).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return {
          firstTabLeft: firstTab.getBoundingClientRect().left,
          backgroundAlpha: context.getImageData(0, 0, 1, 1).data[3],
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
  await click('[data-minke-new-session-tabs-action] button[data-minke-tabs-placement="right"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null`), 'reopened Sidebar');

  const create = async (option, kind, count, keyboard = false) => {
    if (keyboard) {
      await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('[data-minke-tabs-create-menu] [role="menuitem"]')`), 'first menu item focus');
      const index = await rendererValue(window, `() => [...document.querySelectorAll('[data-minke-tabs-create-menu] [role="menuitem"]')].findIndex(item => item.dataset.option === ${JSON.stringify(option)})`);
      assert.ok(index >= 0);
      for (let step = 0; step < index; step++) pressKey('Down');
      await waitFor(() => rendererValue(window, `() => document.activeElement?.dataset.option === ${JSON.stringify(option)}`), 'keyboard selection across menu groups');
      pressEnter();
    } else await click(`:is([data-sidebar-right-panel], [data-minke-tabs-create-menu]) [data-option="${option}"]`);
    await waitFor(() => rendererValue(window, `() => {
      const host = [...document.querySelectorAll('.minke-tabs-native-host[data-kind="${kind}"]')].find(host => !host.inert);
      return host?.checkVisibility({ checkVisibilityCSS: true }) === true;
    }`), `visible ${kind} content`);
    assert.equal(await rendererValue(window, `() => document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-tab]').length`), count, 'creation leaves only the requested tabs');
  };
  let capturedMenu = false;
  const add = async () => {
    const before = await rendererValue(window, `() => [...document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-tab]')].map(tab => ({ id: tab.dataset.dockkitTab, selected: tab.getAttribute('aria-selected') }))`);
    await click('[data-dockkit-add-tab]');
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-tabs-create-menu] [data-option="files"]') !== null`), 'grouped native add-tab menu', 5_000);
    if (process.platform === 'darwin') {
      assert.equal(await rendererValue(window, `() => getComputedStyle(document.querySelector('[data-sidebar-right-panel] [data-dockkit-strip]')).getPropertyValue('-webkit-app-region').trim()`), 'no-drag', 'an open menu must suspend native header window dragging');
    }
    assert.deepEqual(await rendererValue(window, `() => [...document.querySelectorAll('[data-minke-tabs-create-menu] [role="group"]')].map(group => group.getAttribute('aria-label'))`), ['DSH', 'Minke']);
    assert.deepEqual(await rendererValue(window, `() => [...document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-tab]')].map(tab => ({ id: tab.dataset.dockkitTab, selected: tab.getAttribute('aria-selected') }))`), before, 'opening the menu preserves the selected tab and creates no Start tab');
    if (!capturedMenu && process.env.MINKE_SIDEBAR_SCREENSHOT) {
      const clip = await rendererValue(window, `() => {
        const rect = document.querySelector('[data-minke-tabs-create-menu]').getBoundingClientRect();
        return { x: Math.max(0, Math.floor(rect.left - 8)), y: Math.max(0, Math.floor(rect.top - 8)), width: Math.ceil(rect.width + 16), height: Math.ceil(rect.height + 16) };
      }`);
      await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.menu.png`, (await window.webContents.capturePage(clip)).toPNG());
      capturedMenu = true;
    }
  };
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
  pressKey('Escape');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-tabs-create-menu]') === null && document.activeElement?.matches('[data-dockkit-add-tab][aria-expanded="false"]')`), 'Escape restores focus to the add button');
  if (process.platform === 'darwin') {
    await waitFor(() => rendererValue(window, `() => getComputedStyle(document.querySelector('[data-sidebar-right-panel] [data-dockkit-strip]')).getPropertyValue('-webkit-app-region').trim() === 'drag'`), 'docked native header resumes window dragging after menu dismissal');
  }
  await add();
  await click('[data-sidebar-right-panel] [data-minke-tab-title]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-tabs-create-menu]') === null`), 'outside click dismisses the menu');
  assert.equal(await guest.executeJavaScript('document.querySelector("#human-note").value'), 'Preserved Web state', 'cancelling creation retains page input');
  await add();
  await create('terminal', 'terminal', 2, true);
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="terminal"] .xterm-helper-textarea') !== null`), 'Terminal input');
  await click('.minke-tabs-native-host[data-kind="terminal"] .xterm-screen');
  await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('.minke-tabs-native-host[data-kind="terminal"] .xterm-helper-textarea') && document.querySelector('.minke-tabs-native-host[data-kind="terminal"] .minke-terminal-state') === null`), 'running Terminal with keyboard focus');
  // Xterm's screen-reader mode consumes keypresses rather than insertText events.
  typeKeys("minke_sidebar_state=retained; printf 'minke_sidebar_terminal_ok\\n'");
  pressEnter();
  await waitFor(() => rendererValue(window, `() => [...document.querySelectorAll('.minke-tabs-native-host[data-kind="terminal"] .xterm-accessibility-tree [role="listitem"]')].some(row => row.textContent.trim() === 'minke_sidebar_terminal_ok')`), 'Terminal command output');
  process.stdout.write('[sidebar-ui] live Terminal command passed\n');

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
  await waitFor(() => rendererValue(window, `() => {
    const host = document.querySelector('.minke-tabs-native-host[data-kind="files"]');
    const rect = host.getBoundingClientRect();
    return !host.inert && rect.left === 0 && Math.abs(rect.width - innerWidth) < 1;
  }`), 'file editor fills the fullscreen viewport');
  if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.files-fullscreen.png`, (await window.webContents.capturePage()).toPNG());
  await click(`[data-minke-tab-title="${webId}"]`);
  await waitFor(() => rendererValue(window, `() => !document.querySelector('.minke-tabs-native-host[data-kind="web"]').inert`), 'first fullscreen tab receives a real mouse click');
  assert.equal(await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="web"] webview').getWebContentsId()`), guestId, 'switching tabs retains the browser instance');
  assert.equal(await guest.executeJavaScript('document.querySelector("#human-note").value'), 'Preserved Web state', 'switching tabs retains page input');
  await click('[data-sidebar-right-mode="push"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="push"]') !== null`), 'populated Sidebar restores docked mode');
  const terminalId = await rendererValue(window, `() => document.querySelector('.minke-tabs-native-host[data-kind="terminal"]').dataset.minkeTabInstance`);
  await click(`[data-minke-tab-title="${terminalId}"]`);
  await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('.minke-tabs-native-host[data-kind="terminal"] .xterm-helper-textarea')`), 'restored Terminal focus');
  typeKeys("printf '%s\\n' \"$minke_sidebar_state\"");
  pressEnter();
  await waitFor(() => rendererValue(window, `() => [...document.querySelectorAll('.minke-tabs-native-host[data-kind="terminal"] .xterm-accessibility-tree [role="listitem"]')].some(row => row.textContent.trim() === 'retained')`), 'same shell state after switching tabs');
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
  await click('[data-minke-tabs-create-menu] [role="group"][aria-label="DSH"] [role="menuitem"]');
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

  await click('[data-minke-new-session-tabs-action] [data-minke-tabs-placement="bottom"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-panel[data-placement="bottom"][data-open] .xterm-helper-textarea') !== null`), 'independent bottom Terminal');
  assert.deepEqual(await layout(), [], 'global actions remain separate with both panels open');
  await click('[data-minke-new-session-tabs-action] [data-minke-tabs-placement="bottom"]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('.minke-tabs-panel[data-placement="bottom"][data-open]') === null`), 'bottom panel collapse');
  assert.equal(await rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null`), true, 'bottom toggle leaves the native Sidebar open');
  process.stdout.write('[sidebar-ui] retained state, close guard, native previews and bottom controls passed\n');
  await require('./files-preview-ui.cjs').verifyFilesPreviewUI({ window, rendererValue, waitFor, workspace, click, pressKey, openedFilePaths });
}

module.exports = { verifyNativeSidebarUI };
