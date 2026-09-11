# DeepSeek Harness runtime patches

Minke keeps `vendor/deepseek-harness` pinned and pristine. Local fixes that cannot be accepted upstream are declared in `config/harness-runtime.json` and applied only to the disposable staged runtime after workspace deployment.

The applicator accepts git unified diffs that modify existing text files below `node_modules/@deepseek-ai/`. It rejects path escapes, file creation/deletion, renames, binary patches, stale hunks, and skipped patches. Patch contents are part of the runtime fingerprint and metadata; validation also reverse-checks that every declared patch is present before publishing or fast refresh.

`win32-directory-picker.patch` is pinned to Harness `dsh-v0.1.5-rc.2` (`fb2c4b9e698e30edb738bca4cf0618587db7d203`). It:

- routes the directory dialog worker and Windows ACL sandbox runner through `MINKE_NODE_EXECUTABLE`, with Electron Node mode explicitly restored for the dialog worker;
- keeps the dialog worker's IPC channel open through non-terminal `showing` progress and disconnects only after a terminal result.

Harness now decodes selected UTF-16 paths through a pointer-sized buffer without creating an external `ArrayBuffer`. The former local decoding hunk is removed; the worker regression still checks the selected Unicode path and terminal IPC result.

`windows-background-processes.patch` is pinned to the same Harness commit. It:

- fills the remaining console-window suppression gaps in Windows process inspection, sandbox probes, browser handoff, plugin management, and the experimental Python runtime;
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

`optional-plugin-isolation.patch` is pinned to the same Harness commit. It:

- marks entries inserted by profile bundles listed in the profile's `dependencies` as isolated, while installation-owned bundles and launcher overlays remain fail-fast;
- skips external profile bundles selected by Minke's disabled-plugin policy or safe mode without changing the profile manifest;
- retains a failed external entry as Loader health state, logs its original activation error, and lets unrelated entries finish booting;
- exposes isolated activation failures as `failed` through the existing plugin inventory so Settings can report the degraded plugin.

`dynamic-trusted-hosts.patch` is pinned to the same Harness commit. It:

- keeps one mutable trusted-host policy behind the existing Connection service so registered HTTP, WebSocket, and RPC routes observe an atomic replacement;
- validates every replacement before changing the live policy and retains the loopback-only fence for privileged methods;
- lets Minke apply an exact authority through its private parent-child process channel without restarting Harness.

`process-environment-boundaries.patch` is pinned to the same Harness commit. It:

- strips Electron/Node bootstrap controls from ordinary subprocesses, native integrations, and browser handoff children so ambient desktop runtime state cannot leak across execution boundaries;
- restores Minke's managed Node executable and bootstrap for private subprocess runners and explicitly recognized embedded-Node targets, including native Windows Job, Linux systemd, terminal, and Windows ACL paths;
- preserves upstream's `proxyEnvironmentForChild()` overlay after scrubbing, so children retain the configured proxy routing.

`document-preview-browser-crypto.patch` is pinned to the same Harness commit.
It removes PDF.js's optional `crypto.randomUUID` fast path from the document
preview bundle, retaining its existing 32-byte `getRandomValues` fallback for
internal annotation identifiers. This keeps the browser artifact within Minke's
crypto boundary on HTTP/LAN origins without changing the audit or vendor source.
The patch can be removed when the upstream bundle no longer references that
secure-context-only API.

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
or layout changes. Minke content lifetimes bypass DSH resource pins, while native
file resources retain their existing pin and Session ownership. The patch is
confined to the staged Sidebar client bundle and can be retired when upstream
provides equivalent instance, observation, and close-admission contracts.

Harness owns the native right Sidebar, document previews, produced-file actions,
and the whole-session turn rail with deep-history load-and-jump. Minke custom
tabs now join that Sidebar through its public registration and render slots,
with the private adapter confined to `tabs/native`. Stable Minke content hosts
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

The 0.1.5-rc.2 runtime uses Session v3 and lifecycle-scoped SessionHandles.
Minke's staged entry invokes the exported `runCli()` after loading its Node
bootstrap; importing the upstream CLI no longer dispatches a command.
Minke delegates Session creation, inspection, follow streams, and export to
SessionController; Harness owns locking and adjacent v0/v1/v2 migrations, which
write new v3 logs and retain committed predecessors. Downgrade reads are not
supported. Historical PTC/preset events and system prompts are migrated by the
upstream format catalog rather than rewritten by Minke.

Session leases use `@deepseek-ai/node-addon-system/flock` on macOS and Linux,
with stable Node-API binaries instead of `fs-ext` rebuilds for Electron. Before
publication and reuse, staging exercises acquisition, contention, and release
under Electron; Windows checks its Koffi native binding. The source build owns
the platform binary, and the runtime dependency closure includes it.

After changing the upstream pin or a patch, run:

```sh
pnpm harness:verify
pnpm harness:stage
pnpm test:desktop
```
