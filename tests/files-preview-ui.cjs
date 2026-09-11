'use strict';

const assert = require('node:assert/strict');
const { realpath, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { nativeTheme } = require('electron');

/** Runs against the production renderer and DSH document slots, with real local files. */
async function verifyFilesPreviewUI({ window, rendererValue, waitFor, workspace, click, pressKey }) {
  workspace = await realpath(workspace);
  await Promise.all([
    writeFile(join(workspace, 'preview-notes.md'), '# Rendered notes\n\n**Bold text**\n\n| Name | Value |\n| --- | --- |\n| Preview | Ready |\n'),
    writeFile(join(workspace, 'preview-page.html'), '<!doctype html><html><head><link rel="stylesheet" href="preview-style.css"></head><body><h1>HTML preview</h1><button id="counter">0</button><script src="preview-script.js"></script></body></html>'),
    writeFile(join(workspace, 'preview-style.css'), 'body{padding:20px;font:16px system-ui;background:#fff;color:#123456}'),
    writeFile(join(workspace, 'preview-script.js'), 'document.body.dataset.ready="yes";document.querySelector("#counter").onclick=event=>event.target.textContent=Number(event.target.textContent)+1;'),
    writeFile(join(workspace, 'preview-source.ts'), 'export const source = true;\n'),
  ]);
  if (await rendererValue(window, '() => document.querySelector("[data-dockkit-add-tab]") !== null')) {
    await click('[data-dockkit-add-tab]');
    await click('[data-minke-tabs-create-menu] [data-option="files"]');
  } else await click('[data-sidebar-right-panel] [data-option="files"]');
  const host = '.minke-tabs-native-host[data-kind="files"]:not([inert])';
  await waitFor(() => rendererValue(window, `() => document.querySelector('${host} .minke-files-explorer') !== null`), 'new Files instance');
  const openFile = async name => {
    const path = join(workspace, name);
    await click(`${host} [data-kind="file"][title=${JSON.stringify(path)}]`);
    await waitFor(() => rendererValue(window, `() => document.querySelector('${host} .minke-files-preview__header strong')?.title === ${JSON.stringify(path)} && document.querySelector('${host} .cm-content') !== null`), `${name} source`);
  };
  const choose = async mode => {
    const more = `${host} button[aria-label="More file actions"]`;
    const compact = await rendererValue(window, `() => document.querySelector('${more}') !== null`);
    if (compact) {
      await click(more);
      await click(`[role="menu"][aria-label="More file actions"] [data-option="${mode}"]`);
    } else await click(`${host} button[aria-label="${{ preview: 'Preview', source: 'Source', diff: 'Diff' }[mode]}"]`);
    if (mode === 'source') await waitFor(() => rendererValue(window, `() => document.querySelector('${host} .cm-content[contenteditable="true"]') !== null`), 'source editor remount');
  };
  const resizePreview = async width => {
    const separator = `${host} [role="separator"]`;
    // Set up keyboard resizing without racing pane activation on pointerdown.
    await rendererValue(window, `() => { document.querySelector('${separator}').focus(); return true; }`);
    await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('${separator}')`), 'focused preview divider');
    const readWidth = () => rendererValue(window, `() => document.querySelector('${host} .minke-files-preview').getBoundingClientRect().width`);
    const right = await rendererValue(window, `() => document.querySelector('${host} .minke-files-browser').dataset.explorerPosition === 'right'`);
    for (let step = 0; step < 64; step++) {
      const previous = await readWidth();
      // The accessible divider moves in 16px steps. Wait for each React commit
      // before sending the next key, just as a user holds or repeats an arrow.
      if (Math.abs(previous - width) < 16) return;
      pressKey((width > previous) === right ? 'Right' : 'Left');
      await waitFor(async () => Math.abs(await readWidth() - previous) > 1, 'preview divider keyboard resize', 8_000);
    }
    assert.fail(`Preview divider did not reach ${width}px`);
  };
  const capture = async label => {
    if (!process.env.MINKE_FILES_PREVIEW_SCREENSHOT) return;
    const clip = label.startsWith('compact-menu') ? await rendererValue(window, `() => {
      const menu = document.querySelector('[role="menu"][aria-label="More file actions"]').getBoundingClientRect();
      const header = document.querySelector('${host} .minke-files-preview__header').getBoundingClientRect();
      const x = Math.max(0, Math.floor(Math.min(menu.left, header.left) - 8));
      const y = Math.max(0, Math.floor(header.top - 8));
      return { x, y, width: Math.min(innerWidth - x, Math.ceil(Math.max(menu.right, header.right) - x + 8)), height: Math.min(innerHeight - y, Math.ceil(menu.bottom - y + 8)) };
    }`) : undefined;
    await writeFile(`${process.env.MINKE_FILES_PREVIEW_SCREENSHOT}.${label}.png`, (await window.webContents.capturePage(clip)).toPNG());
  };
  await openFile('preview-notes.md');
  await choose('preview');
  await waitFor(() => rendererValue(window, `() => document.querySelector('${host} [data-document-markdown] h1')?.textContent === 'Rendered notes'`), 'DSH Markdown heading');
  assert.equal(await rendererValue(window, `() => document.querySelector('${host} [data-document-markdown] table')?.textContent.includes('Ready')`), true, 'Markdown tables are rendered');
  await choose('source');
  await click(`${host} .cm-content`);
  for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({ type, keyCode: 'A', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
  await window.webContents.insertText('# Unsaved preview\n\nUpdated **draft**.');
  await waitFor(() => rendererValue(window, `() => document.querySelector('${host} .minke-files-preview__dirty') !== null`), 'dirty draft');
  await choose('preview');
  await waitFor(() => rendererValue(window, `() => document.querySelector('${host} [data-document-markdown] h1')?.textContent === 'Unsaved preview'`), 'preview renders current unsaved draft');
  process.stdout.write('[files-preview-ui] rendered Markdown and unsaved draft passed\n');
  await click('[data-sidebar-right-mode="fullscreen"]');
  await waitFor(() => rendererValue(window, `() => Math.abs(document.querySelector('${host}').getBoundingClientRect().width - innerWidth) < 1`), 'fullscreen host geometry');
  await resizePreview(520);
  await waitFor(() => rendererValue(window, `() => document.querySelector('${host} button[aria-label="Preview"]') !== null`), 'wide preview controls');
  await capture('wide-markdown');
  await click('[data-sidebar-right-mode="push"]');
  window.setContentSize(980, 800);
  await waitFor(() => rendererValue(window, `() => innerWidth === 980 && document.querySelector('${host}').getBoundingClientRect().width < 980`), 'docked host geometry');
  await resizePreview(240);
  const more = `${host} button[aria-label="More file actions"]`;
  await waitFor(() => rendererValue(window, `() => document.querySelector('${more}') !== null`), 'narrow preview overflow menu', 8_000);
  await new Promise(resolve => setTimeout(resolve, 150));
  const geometry = await rendererValue(window, `() => {
    const header = document.querySelector('${host} .minke-files-preview__header');
    const title = header.querySelector('strong').getBoundingClientRect();
    const buttons = [...header.querySelectorAll('button')];
    return { buttons: buttons.length, titleWidth: title.width, overlap: title.right > buttons[0].getBoundingClientRect().left };
  }`);
  assert.ok(geometry.buttons === 1 && geometry.titleWidth > 60 && !geometry.overlap, JSON.stringify(geometry));
  await click(more);
  const menu = '[role="menu"][aria-label="More file actions"]';
  await waitFor(() => rendererValue(window, `() => document.querySelector('${menu} [data-option="preview"]') !== null`), 'mounted file actions menu', 8_000);
  const labels = await rendererValue(window, `() => [...document.querySelectorAll('${menu} button')].map(button => button.textContent.trim())`);
  assert.deepEqual(labels, ['Preview', 'Source', 'Diff', 'Open in default app', 'Close preview']);
  assert.equal(await rendererValue(window, `() => document.querySelector('${menu} [data-option="preview"]').getAttribute('aria-checked')`), 'true');
  await capture('compact-menu');
  nativeTheme.themeSource = 'dark';
  await new Promise(resolve => setTimeout(resolve, 100));
  await capture('compact-menu-dark');
  nativeTheme.themeSource = 'light';
  pressKey('Escape');
  await waitFor(() => rendererValue(window, `() => document.querySelector('${menu}') === null && document.activeElement === document.querySelector('${more}')`), 'Escape returns focus to More');
  await choose('diff');
  await waitFor(() => rendererValue(window, `() => document.querySelector('${host} .minke-files-preview__state')?.textContent.includes('not in a Git repository')`), 'diff remains accessible');
  await choose('source');
  assert.equal(await rendererValue(window, `() => document.querySelector('${host} .cm-content')?.textContent.includes('Unsaved preview')`), true, 'all three modes retain the draft');
  // The fixture owns its draft; permit switching files without saving to disk.
  await rendererValue(window, '() => { window.confirm = () => true; return true; }');
  await openFile('preview-page.html');
  await choose('preview');
  const frame = await waitFor(async () => {
    const url = await rendererValue(window, `() => document.querySelector('${host} iframe[data-html-preview]')?.src`);
    const candidate = window.webContents.mainFrame.framesInSubtree.find(value => value.url === url);
    if (!candidate) return false;
    return await candidate.executeJavaScript('document.body?.dataset.ready === "yes"') ? candidate : false;
  }, 'DSH HTML preview and relative script');
  assert.deepEqual(await frame.executeJavaScript(`({ heading: document.querySelector('h1').textContent, color: getComputedStyle(document.body).color, bridge: typeof window.minke })`), {
    heading: 'HTML preview', color: 'rgb(18, 52, 86)', bridge: 'undefined',
  }, 'HTML loads its relative stylesheet without exposing the application bridge');
  assert.equal(await rendererValue(window, `() => document.querySelector('${host} iframe[data-html-preview]').getAttribute('sandbox')`), 'allow-scripts');
  await frame.executeJavaScript('document.querySelector("#counter").click()');
  assert.equal(await frame.executeJavaScript('document.querySelector("#counter").textContent'), '1', 'HTML remains interactive');
  const bounds = await rendererValue(window, `() => {
    const frame = document.querySelector('${host} iframe[data-html-preview]');
    const rect = frame.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top, visible: frame.checkVisibility({ checkVisibilityCSS: true }) };
  }`);
  assert.ok(bounds.visible && bounds.width >= 140 && bounds.height >= 240 && bounds.top < 300, JSON.stringify(bounds));
  const wasVisible = window.isVisible();
  if (!wasVisible) window.showInactive();
  try {
    await frame.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await capture('html');
  } finally { if (!wasVisible) window.hide(); }
  await choose('source');
  assert.equal(await rendererValue(window, `() => document.querySelector('${host} .cm-content')?.textContent.includes('<!doctype html>')`), true);
  await openFile('preview-source.ts');
  await click(more);
  assert.equal(await rendererValue(window, `() => document.querySelector('${menu} [data-option="preview"]') === null`), true, 'source-only files do not offer a rendered view');
  pressKey('Escape');
  process.stdout.write('[files-preview-ui] Markdown, HTML assets, draft switching and responsive menu passed\n');
}

module.exports = { verifyFilesPreviewUI };
