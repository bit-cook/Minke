# DeepSeek Harness runtime patches

Minke keeps `vendor/deepseek-harness` pinned and pristine. Local fixes that cannot be accepted upstream are declared in `config/harness-runtime.json` and applied only to the disposable staged runtime after workspace deployment.

The applicator accepts git unified diffs that modify existing text files below `node_modules/@deepseek-ai/`. It rejects path escapes, file creation/deletion, renames, binary patches, stale hunks, and skipped patches. Patch contents are part of the runtime fingerprint and metadata; validation also reverse-checks that every declared patch is present before publishing or fast refresh.

`window-drag-capability.patch` lets Minke opt into the existing macOS drag
geometry watcher with `data-window-drag-platform="darwin"`. The full
`data-platform` marker also requires DSH Desktop's native keyboard bridge, so
Minke keeps its current shortcuts and layout. The preload supplies matching
drag/control CSS; DSH retains ownership of geometry recollection. The frontend
entry URL changes to invalidate previously cached code. Remove this patch when
upstream exposes an independent window-drag capability.

`win32-directory-picker.patch` is pinned to Harness `dsh-v0.1.7-rc.2` (`477b4f420553e8a52c2fbccc464d7561b239c443`). It:

- routes the directory dialog worker and Windows ACL sandbox runner through `MINKE_NODE_EXECUTABLE`, with Electron Node mode explicitly restored for the dialog worker;
- keeps the dialog worker's IPC channel open through non-terminal `showing` progress and disconnects only after a terminal result.

Local desktop windows now supply DSH's `__DSH_DIRECTORY_PICKER__` bridge, so
the native workspace flow opens Electron's window-owned dialog directly.
The worker hunks remain for Host/CLI fallback callers without that bridge;
the separate Windows ACL runner hunks are still required.

Harness now decodes selected UTF-16 paths through a pointer-sized buffer without creating an external `ArrayBuffer`. The former local decoding hunk is removed; the worker regression still checks the selected Unicode path and terminal IPC result.

`windows-background-processes.patch` is pinned to the same Harness commit. It:

- fills the remaining console-window suppression gaps in Windows process inspection, sandbox probes, browser handoff, the SDK child runtime, and the experimental Python PTC runtime (`dsh-experimental-ptc-runtime-python`);
- retains upstream's hidden `taskkill` helpers, hides the Windows Job runner, and makes the fallback subprocess spawner's `windowsHide` value explicitly `true` for the staged-artifact audit;
- leaves PTY/ConPTY terminal sessions on their dedicated `spawnTerminal` lifecycle path.

After applying that static source patch, staging enumerates every JavaScript
artifact actually deployed by `dsh-sandbox-windows-acl` and `dsh-win32-process`
and hides restricted-token and current-token Job children with
`STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES` and `SW_HIDE`. This transform is
deliberately independent of generated `types-<hash>.js` names, which differ
between platform-specific dependency closures. The staged-artifact AST audit
then rejects any direct or native Windows launch site that remains visible,
including injectable spawners whose fallback is `node:child_process`.
The native `Open In` application launcher retains each adapter's explicit
visibility choice so requested GUI windows can appear. The audit recognizes
only its detached, credential-scrubbed launch in the pinned resolver artifacts;
other launch sites in that package remain subject to the background policy.

LibreOffice engine `0.1.1` packages redistribute their build sources with the
native binaries. The audit excludes only `.mjs` rebuild inputs declared by
`prebuilds.json` below `sources/engine` and `sources/scripts` in those pinned
engine packages. It retains the sources and licenses in the shipped runtime.
Actual converter workers, undeclared scripts, and future engine versions remain
audited; re-evaluate this boundary on the next engine upgrade.

`optional-plugin-isolation.patch` is pinned to the same Harness commit. It:

- uses upstream startup auditing for optional-plugin failures and adds `minke-overlay` and `llm-pi-ai` to its required-entry list;
- temporarily skips external profile bundles in desktop safe mode without changing the profile manifest; ordinary enablement uses DSH PluginManager;
- retains import errors on Loader entries and projects them as `failed` in plugin inventory, alongside upstream activation failures.

The CLI now delegates package operations to Plugin Manager, which uses execa
and the bundled pnpm adapter; the old CLI spawn patches are removed.

`embedded-profile-resolution.patch` makes the main and Worker profile resolvers
use Node's exposed internal modules when Minke launches with
`--expose-internals`, as Cordis's own loader already does. The new upstream
resolver otherwise unconditionally uses `node-addon-require-builtin` 0.1.6,
whose runtime fingerprint list rejects Minke's Electron 43.4.0. The resolver's
loader-shape checks remain intact, and launches without the flag retain the
upstream addon path. Remove this patch when upstream supports exposed internals
in both profile resolvers or the bundled addon supports Minke's Electron.

`model-runtime-composition.patch` selects Minke's local-model wrapper at the
existing `llm-pi-ai` entry in the staged base bundle. Cordis treats a patch's
`name` as an identity check, so the product overlay cannot replace that module.
The wrapper mounts the unchanged upstream pi-ai plugin, preserves the native
settings namespace, and adds transient local discovery. Remove this packaging
patch when upstream exposes a provider-contribution or module-replacement seam.

The former local isolation/rollback implementation is removed. Upstream now owns
startup recovery: optional failures do not stop unrelated plugins, required
failures remain fatal, and activation errors during hot reload can leave partial
changes that must be corrected.

`dynamic-trusted-hosts.patch` is pinned to the same Harness commit. It:

- keeps one mutable trusted-host policy behind the existing Connection service so registered HTTP, WebSocket, and RPC routes observe an atomic replacement;
- validates every replacement before changing the live policy and retains the loopback-only fence for privileged methods;
- lets Minke apply an exact authority through its private parent-child process channel without restarting Harness.

`process-environment-boundaries.patch` is pinned to the same Harness commit. It:

- strips Electron/Node bootstrap controls from ordinary subprocesses, native integrations, and browser handoff children so ambient desktop runtime state cannot leak across execution boundaries;
- restores Minke's managed Node executable and bootstrap for private subprocess runners and explicitly recognized embedded-Node targets, including native Windows Job, Linux systemd, terminal, and Windows ACL paths;
- restores embedded Node arguments before PTC confinement. On POSIX, the confined argv explicitly restores Node mode after the native sandbox launcher; model code still sees an empty environment, and the separate control pipe remains intact;
- preserves upstream's `proxyEnvironmentForChild()` overlay after scrubbing, so children retain the configured proxy routing.

The former `document-preview-browser-crypto.patch` is removed. The alpha.2
preview bundle loads PDF.js through the upstream runtime loader and no longer
inlines the secure-context-only UUID call. The browser-artifact audit remains
active for the staged client bundles.

`connection-rpc-webserver-scope.patch` is pinned to the same Harness commit.
Connection no longer requires a Web server at its root. Dedicated RPC channels
therefore inject `webServer` in a child scope, as the upstream shared `/api`
route already does. Cordis's exported `getTraceable` helper removes the service's
dependency shadow before that injection, retaining caller isolation and lifetime.
The route still uses Connection's authentication and trust
checks, and its lifetime remains bound to the calling plugin. Remove this patch
when upstream dedicated-channel registration owns that dependency itself.

`embedded-document-preview.patch` is pinned to the same Harness commit. It
provides the private `minkeDocumentPreview` component face for Minke's Files
preview mode. Markdown and HTML reuse DSH's existing bodies, styles, localization,
relative-asset reader and sandbox. Minke supplies its current draft and file
address; the embedded body owns cancellation. DSH's document slot keeps its
original owner and registrations. Remove this patch when upstream exposes an
embeddable document-body API.

`sidebar-tab-lifecycle.patch` is pinned to the same Harness commit. It adds one
private `connectMinkeTabs` seam for observing the native layouts, opening custom
instances with distinct content identities, and removing their seats across
sessions. Native store mutations ask the content owner before removing records,
including replacement and undo; a rejected mutation does not publish navigation
or layout changes. Minke registers a `minke-tab` resource provider and follows standard DSH pins.
Releasing a session pin ends its resource stream; an explicit close disposes the
global content instance. Native file resources keep their existing ownership. Session
mount changes now use DSH's public `sidebarRight.mounted` observable; the private
binding-notification hunk has been retired. The store retains native layout
persistence and new-pane placement. The patch is
confined to the staged Sidebar client bundle and can be retired when upstream
provides equivalent instance, observation, and close-admission contracts.

`session-export-feedback.patch` limits the shared Session-export modal to
errors. Header-menu downloads and `/export` proceed to the browser or native
save flow without a preparing or download-started dialog. Download deduplication,
the menu's busy state, and dismissible failure details remain owned by Harness.
Remove this patch when upstream offers equivalent quiet download feedback.

`sidebar-add-menu.patch` exposes the add-tab intent through a session-scoped
`sidebar.right.pane.add-menu` slot. It supplies the clicked pane and button anchor;
without a picker registration it opens the native Start page. DSH continues to
own the button, split controls, tab placement, and provider guide cards. Menus
close when their pane or session is hidden or removed. Remove this patch when
upstream offers an equivalent add-tab picker slot.

`shared-terminal-view.patch` exposes the native Terminal screen as `terminalUI`
and gives `webTerminals.retainTabs` an optional owner key (default: Sidebar).
The bottom panel can then reuse DSH's model, screen and process lifecycle without
overwriting Sidebar window holds. One appearance store updates both placements'
fonts and ANSI palettes; the native OSC override/reset behavior remains intact.
The old Minke desktop PTY, terminal IPC and Host long-poll transport are retired.
Remove the patch when DSH exposes an equivalent reusable view, appearance input
and independent retention owners. `shared-terminal.test.mjs` exercises the
patched providers; the Electron Sidebar regression checks commands, live settings
and restoration of the same shell after refresh.

Harness owns the native right Sidebar, document previews, produced-file actions,
and the whole-session turn rail with deep-history load-and-jump. Minke custom
tabs now join that Sidebar through its public registration and render slots,
with the private adapter confined to `tabs/native`. The native Start page owns
its guide and terminal shell picker; Minke contributes its cards through
`sidebar.right.tab.guide.entry` rather than replacing the guide. Stable Minke content hosts
preserve WebViews and editors across native pane changes. The start page/global
panel fallback and the bottom panel retain their Minke shells. Native
conversation file links retain their Sidebar routing. Global panels use
`sidebar.panellist` and `main`; the removed
Details and conversation slots are no longer Minke integration points.
The former subagent route patch stays removed because Harness natively resolves
the effective parent provider, model, and reasoning effort.

The earlier 0.1.2-alpha.3 release removes only Harness's optional SQLite Session persistence backend.
Minke's IM Gateway SQLite mailbox is a separate desktop transport store and is
not part of that Session persistence contract.

The 0.1.7-rc.2 runtime uses Session v4 and lifecycle-scoped SessionHandles.
Minke's staged entry invokes the exported `runCli()` after loading its Node
bootstrap; importing the upstream CLI no longer dispatches a command.
Minke delegates Session creation, inspection, follow streams, and export to
SessionController; Harness owns locking and adjacent format migrations, including
v3 to v4, which write new logs and retain committed predecessors. Downgrade reads are not
supported. Historical PTC/preset events and system prompts are migrated by the
upstream format catalog rather than rewritten by Minke.

Session leases use `@deepseek-ai/node-addon-system/flock` on macOS and Linux,
with stable Node-API binaries instead of `fs-ext` rebuilds for Electron. Before
publication and reuse, staging exercises acquisition, contention, and release
under Electron; Windows checks its Koffi native binding. The source build owns
the platform binary, and the runtime dependency closure includes it.

The production deploy allows unused workspace patches because the upstream
`@electron/osx-sign` patch belongs to its separate desktop build, outside Minke's
production dependency closure. The complete frozen workspace install still
validates all declared patches.

Alpha.2 adds LibreOffice for Office previews. Its platform packages add about
255–264 MiB on macOS, 185 MiB on Linux (WASM), and 325–328 MiB on Windows before
pruning. All platforms share a 1 GiB runtime budget to leave room for Office
engines and platform-specific native dependencies; the 15,000-file limit
remains active. The staged rc.2 macOS ARM64 runtime measures about 342 MiB.
Every platform must still pass the size gate when staged.

The rc.2 source cleaner omits `lib/desktop-keyboard-test-types` from its allowed
outputs despite referencing that project. `scripts/harness/clean-source.mjs`
executes the upstream cleaner with only that exact output admitted. Source and
orphan-path checks remain intact; remove the adapter when upstream fixes its
allowlist. This build-time adaptation does not modify the vendored checkout or
ship in the runtime.

After changing the upstream pin or a patch, run:

```sh
pnpm harness:verify
pnpm harness:stage
pnpm test:desktop
pnpm harness:smoke
pnpm test:desktop:sidebar
```
