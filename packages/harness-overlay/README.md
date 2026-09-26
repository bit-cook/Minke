# Minke Harness overlay

This package is Minke's product-owned extension layer for DeepSeek Harness. It is installed into the generated desktop runtime and composed through the public `--patch` bundle seam. Nothing in this package is copied into or applied over `vendor/deepseek-harness`.

Harness development dependencies resolve through workspace overrides to the pinned source checkout. `pnpm harness:stage` installs and builds that checkout before typechecking or runtime tests, so source upgrades do not depend on matching npm packages being published first.

The host composition mounts the separate `@lencx/minke-model-runtime/dsh` adapter:

- `model-runtime` is a DSH plugin that owns local model discovery and optional service lifecycle for exactly two product runtimes: LM Studio and Ollama. LM Studio uses `lms server status --json` / `lms server start` and enriches its OpenAI-compatible catalog with LM Studio's v1 loaded-instance metadata. Before dispatch, it verifies that the selected instance has the configured context window. Selecting an unloaded model explicitly authorizes Minke to load that model with the configured context, even when LM Studio was started externally; Minke still never unloads or reconfigures an existing external instance. If Minke started the service itself, it may also reload an undersized default model instance while preserving its supported load parameters. Ollama uses its OpenAI-compatible `/v1/models` endpoint and starts through `ollama serve`. A generic `openAICompatible` adapter remains available for manually configured loopback servers; it does not gain command discovery or process management.

Product subagents follow the Profile Bundle contract in the pinned `dsh-v0.1.7-rc.2` runtime and are not embedded in Minke's base runtime. Install one into the `web` Profile:

- Codex: `dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex`
- Claude Code: `dsh plugin --profile web add @deepseek-ai/dsh-subagent-claude-code`

Then restart Minke and enable the matching disabled tool row in a copied Agent Preset. The Bundle owns its pinned platform CLI, provider configuration, and private runtime closure.

The model runtime executes CLIs through `ctx.subprocess`, resolves credential references through `ctx.credentials`, and mounts the upstream `@deepseek-ai/dsh-llm-pi-ai` plugin before discovering local services in parallel. Cloud routes remain available during local startup and auto-start updates. Discovered provider metadata is only the composition base layer; it is never serialized to `settings.yaml`, and user model settings continue to override it. Secrets are resolved for discovery but never copied into provider profiles.

The independent `@lencx/minke-harness-overlay/web-search` Host entry registers
the credential-free `minke_web_search` model tool. It does not register a
`ctx.web` provider or replace DSH's native `web_search` and `web_fetch`; upstream
provider selection, credentials, retries, and error reporting remain intact.
The persisted `webSearch.fallbackEnabled` compatibility setting defaults to
`true`; Harness startup maps it to the product-owned
`MINKE_WEB_SEARCH_FALLBACK_ENABLED` launch flag and uses it only to enable or
disable this additional tool. Agents call it explicitly; Minke does not intercept
`tools/execute`, retry native failures, or replace their results. Search snippets
are never presented as fetched page content. The built-in Bing RSS endpoint is a bounded
best-effort search route with no stability guarantee.
`MINKE_WEB_SEARCH_BASE_URL` may select a compatible RSS endpoint. The provider
sends no cookies or credentials, follows only same-origin or controlled Bing
country redirects, rejects HTML/challenge responses, and caps response,
title, snippet, URL, result-count, query-count, and time budgets. The tool is
available to full Agent Presets and withheld from `minimal`.

Service policy is explicit:

- `external` only discovers an already-running service;
- `ensure-running` starts a missing service. LM Studio's one-shot CLI leaves the shared service running; an `ollama serve` process started by Minke is owned by the Harness process and stopped with it;
- `managed` stops the service on plugin disposal only when this plugin proved it started that service.

Both auto-start preferences default to `false` under `modelRuntime.{lmStudio,ollama}.enabled` in `~/.minke/desktop/minke.config.json`. Electron checks known installation paths and `PATH` without executing either CLI. The DSH Models page shows both LM Studio and Ollama auto-start switches in one labeled Local services section through its public `settings.models.footer` slot. Both controls remain available independently of provider discovery; native provider cards keep their standard configuration layout. Service availability describes the local command, not the number of models in its catalog. No translated-heading lookup, private form mutation, or document-wide observer is involved. An unavailable local command leaves its switch visible but disabled. Auto-start changes reconcile against the running Harness immediately and persist only after its provider registry acknowledges the update. Turning off auto-start does not kill an Ollama server Minke already started for the current Harness; it remains usable until Harness exits, while every later Harness launch honors the disabled preference. `LM_STUDIO_BASE_URL` and `OLLAMA_BASE_URL` can select explicit loopback endpoints and are also applied to services Minke starts. Without an override, Minke follows the runtimes' official defaults: LM Studio uses `http://127.0.0.1:1234/v1` and Ollama uses `http://127.0.0.1:11434/v1`. Port `0` is rejected because a client Base URL must contain the service's resolved, connectable port. `LM_API_TOKEN` is used for LM Studio when configured.

The browser half owns Minke's product policy, configurable keyboard shortcuts, and post-boot desktop surface adaptation. It uses:

- `settings.onboarding` slot shadowing to bypass Harness's developer-only internal-testing notice without changing the upstream plugin;
- the native opt-in Schedule host and Client plugins, so active schedules appear in the conversation header without a Minke-owned UI fork;
- Harness's native whole-session turn outline and deep-history jump loader, so unloaded turns remain previewable and navigable without a Minke-owned conversation directory;
- one `settings.section` entry with compact labeled secondary tabs for durable Minke preferences;
- `ctx.uiWorkspace.startSession()` for the New Session action;
- the Settings trigger's accessible DOM contract for the Settings action;
- Harness's `ctx.locale` registry and revision source for synchronized zh/en copy;
- Harness's locale snapshot and `locale/change` event for native desktop copy;
- Harness's `ctx.theme` snapshot and `theme/change` event for native window synchronization;
- a lifecycle-managed DOM adapter for the macOS sidebar, titlebar, and translucent surfaces; the adapter is capability-gated by the isolated preload and removes its observer, markers, and stylesheet on disposal;
- the isolated Minke preload bridge for durable desktop-owned preferences.

Third-party Profile plugins cross the trusted extension boundary. Their package manager hooks may execute during installation, and their Host and Client code is composed into the `web` Profile on every later launch. Such code can reach DSH data, workspaces, credentials through DSH services, and any service the user authorizes. Minke therefore treats the plugin source—not only its install command—as a persistent trust decision.

DSH's native Plugins page owns installation, configuration, installed bundles,
and live activation through `pluginManager`. Minke contributes GitHub discovery
and desktop safe-mode recovery through public slots. The former disabled-package
list is migrated once into the `web` Profile's selected bundles before startup;
installed dependencies remain intact. The legacy list is cleared only after the
Profile update succeeds. Ordinary plugin changes no longer use desktop IPC,
CLI subprocesses, or a separate Minke activation state.
Discovery uses the shared Web Tab guest, navigation and error recovery with a
GitHub search preset. Existing discovery tabs keep their identity and restore
their last URL; discovery guests continue to disallow popups.
Desktop recovery exposes only settings and safe-mode changes; legacy Profile
migrations remain separate from that interface.

DSH's native workspace directory flow uses the window-owned desktop picker
bridge when available. Requests from guest windows or subframes are rejected;
remote browsers retain DSH's Host chooser or directory-browser flow.

The unified Minke section contains labeled tabs for Preferences, Browser, Shortcuts, and Storage. Model-related configuration remains under the existing DSH Models entry, so users do not need to switch between two settings directories for one task. Remote access configuration lives only in Connections under Device access, alongside its live status and recovery actions. It is backed by the separate `@lencx/minke-remote-access` package, persists a default-off Tailscale opt-in, shows the active private HTTPS URL, and keeps command execution, retries, trusted-host updates, and process lifecycle in the desktop host rather than the browser bundle. Changing the enable switch applies to the running Harness without restarting Minke.

The separate document-start extension remains CSS-only. It exists solely because first-paint transparency and Electron drag regions must be present before Harness initializes; it does not traverse or modify the Harness DOM.

## Right Sidebar tabs

DSH owns the right tab strip, selection,
splits, floats, fullscreen, and native document previews. Minke registers its
Files editor, Web, AgentBrowser, plugin discovery, and Browser History through
`sidebarRightTabs` and the body/title slots. The native Start page offers
Minke's creation cards and shortcut hints through `sidebar.right.tab.guide.entry`,
below the native Workspace files and Terminal cards. DSH owns the Terminal shell
picker and its multiple-instance, cleanup and refresh-recovery lifecycle.
The right-side Terminal shortcut delegates to DSH; there is no duplicate Minke
Terminal card. The bottom panel uses the same DSH terminal view and service.
Both placements share Minke's font, line spacing and code palette preferences;
DSH owns PTYs, input/output, reconnects and explicit close. Minke retains only
the bottom layout and its Session-bound tab identities, with independent window
holds so one placement cannot release the other's shells.
Creating a Minke tab replaces Start in the same pane and strip slot; keyboard
creation shortcuts continue to use the same controllers. The earlier
`minke.launcher` address redirects to the native Start page.
The native add-tab button opens a grouped DSH / Minke picker through the pinned
`sidebar.right.pane.add-menu` slot. Choosing an entry creates it in the clicked
pane; dismissing the menu leaves existing tabs intact. Start remains available
for provider-owned cards, including Terminal's shell picker.
The Start page follows `dsh-v0.1.7-rc.2`'s compass and descriptive native cards,
with the Minke card list below them. Native descriptions appear for up to four
entries and remain owned by the registering plugin's locale.
Start fills at least the pane's available height and uses the native pane's
scroller. Cards shrink within narrow panes so their text cannot widen the page.
The docked native Sidebar reserves the bottom panel's current height, including
while resizing it, so its content scrolls above that panel. Fullscreen retains
the entire window, and closing the bottom panel restores the docked Sidebar's height.

Custom content rehydrates from per-window session storage before attaching to
the native layout. Refresh restores Web URLs, Files locations and unsaved drafts,
plugin discovery, history, and active AgentBrowser projections. File drafts retain
their original disk version so a later save still detects external changes.
Terminal tabs reconnect to their original DSH shells after a renderer refresh;
webpage form state is not preserved.

The Files editor offers Preview, Source and Diff for Markdown and HTML files.
Preview renders the current draft through DSH's document bodies; changing modes
does not save or discard edits. In preview headers narrower than 280px, one More
menu contains the view modes and the action to open the file's containing folder
in the system file manager. Wider headers retain those direct buttons; Close
remains outside the menu at every width and still guards unsaved drafts.
DSH's native document tabs keep their own viewer menu.
Native code previews use DSH's source scrollport below the Copy banner; the
earlier Minke scrollbar-gutter background compensation is no longer needed.

Blank-session global controls follow DSH's conversation grid column. While the
native Sidebar is open, DSH owns its split, fullscreen, and collapse buttons;
Minke retains Remote and bottom-panel actions in the conversation area and supplies
the opener when a blank session has no native conversation header.

Session export uses DSH's native header menu (More actions → Download session log).
Electron handles the ZIP download through its existing save dialog. The staged
`session-export-feedback.patch` keeps the shared Header and `/export` modal
closed during preparation and successful handoff, while preserving failure
details and dismissal. Minke's Remote
and panel controls follow DSH's 28px circular buttons and 15px icons. Their icons
share DSH's unrotated outer contour and border weight; Remote status colors its
wireless symbol inside the frame. On macOS,
the native Sidebar's empty tab-strip area also supports window dragging while
tabs, buttons, and open menus remain interactive.

`tabs/native` is the only adapter to the pinned `sidebar-tab-lifecycle.patch`.
It projects DSH layout state into `TabsRuntime`, which retains content payloads
and the existing controller interface. Global Minke instances have stable content
identities and appear in each visited session's layout; native documents remain
session-owned. Closing a Minke instance in any session closes its other seats.
Native close, replacement, and undo check the renderer's close guard before
committing. Undo cannot recreate a disposed PTY or browser instance.

Each custom view has one stable DOM owner outside the transient native seats.
Seats provide viewport geometry; only visible hosts follow it, with clipping for
overlapping native floats. A shared observer coalesces layout, resize and scroll
changes; static tabs do not poll geometry, and finite layout transitions retain
frame-by-frame tracking. Changing tabs, panes, presentation, or sessions does
not reparent the WebView. Native titles, tab context menus, and drag handling remain in DSH.
Opening right-side content from a global panel such as Plugins returns to the current
conversation and waits for DSH's Sidebar to mount; if no conversation exists,
DSH starts one. Existing tabs and editor drafts are retained. The fallback strip
is used only without a connected DSH Sidebar service. The bottom panel retains
its independent Minke implementation.
There is no DOM observer switching between competing right sidebars.

The applied-artifact tests in `tests/native-sidebar-tabs.test.mjs` exercise the
actual DSH store and controller, including a negative control for close guards.
The Electron conversation regression verifies native placement and WebContents
identity with a local model fixture and temporary user data.
`pnpm test:desktop:sidebar` exercises blank-session controls at different widths,
direct tab creation, Web navigation and retained input, live Terminal commands
after returning from Plugins (including after closing Settings), and the file editor's unsaved-close
guard in the production renderer.

Client Sessions can coexist in the main view and sidebar. Minke locates the main
conversation through the catalog's `retainedBy.mainView` count and navigates with
`uiWorkspace.openSession()`. Browser comment drafts borrow only a live retained
Session scope; opening a sidebar Subagent does not redirect the handoff target.
