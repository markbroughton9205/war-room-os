# Ascension Phase 11D — Installable Windows War Room Application

Roadmap #22, Sovereign Application Runtime. Packages the Phase 11A–11C sovereign local runtime
(local Core + full local War Room Next UI + local Commander identity + local model path) as a real
installable Windows application, so the Commander opens War Room OS from a desktop or Start Menu
icon instead of a terminal.

## What was built

| Layer | Implementation |
| --- | --- |
| Packaging | `electron-builder` (already present), NSIS x64 target, per-user assisted installer |
| Identity | Product `War Room OS`, executable `War Room OS.exe`, description `Sovereign AI Operations Headquarters`, appId `com.warroomos.desktop` |
| Runtime bundle | `scripts/prepare-desktop-runtime.mjs` → `desktop/runtime/{ui,core,boot-ui.cjs,start-ui.cjs,start-core.cjs}` shipped via `extraResources` |
| Supervisor | `desktop/src/main.cjs` starts owned Core (in-process) + owned Next UI child, loopback only |
| Ports | Core `127.0.0.1:3847`, UI `127.0.0.1:3848`. Occupied ports produce `PORT_CONFLICT`; occupants are never killed |
| Mutable data | `%LOCALAPPDATA%\War Room OS\{data,logs,cache,exports,runtime}` |
| Node runtime | The packaged Electron binary hosts Node via `ELECTRON_RUN_AS_NODE=1`. No Node, pnpm or npm install is required to launch |

## Non-obvious constraints discovered

These are load-bearing; changing them silently breaks the installed application.

1. **Relative argv only for `ELECTRON_RUN_AS_NODE`.** Electron in Node mode splits absolute Windows
   paths on spaces, and the install path contains spaces (`War Room OS`). The Next server is
   therefore launched as `spawn(electronExec, ['boot-ui.cjs'], { cwd: runtimeRoot })`.
2. **`boot-ui.cjs` is generated at build time**, not at launch. An installed application directory
   may be read-only, so nothing may be written into `resources/runtime` at runtime.
3. **The Next standalone tree must be copied with `dereference: true`.** pnpm's
   `.next/standalone/node_modules` is a symlink farm into `node_modules/.pnpm`; preserving those
   links would make the installed app depend on the developer checkout.
4. **After dereferencing, `.pnpm` packages must be hoisted flat.** Otherwise Node resolution fails
   with `Cannot find module '@next/env'` (and `@swc/helpers/...`), because pnpm resolved transitive
   dependencies through the symlinked parent directory.
5. **Middleware must stay Edge-safe.** `middleware.ts` may not reach Node built-ins, so the local
   Commander middleware gate lives in `lib/sovereign-runtime/local-ownership/edgeSession.ts` and
   performs a loopback + token-presentation check only. SQLite session verification stays in the
   Node API routes.
6. **`signAndEditExecutable: true` with `signExecutable: false`** is what applies the icon and
   version metadata to the EXE while performing no code signing.

## Security posture (unchanged from Phase 11A–11C)

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; loopback-only Core and UI;
no shell bridge, no PowerShell surface, no arbitrary filesystem bridge; `shell.exec`,
`powershell.run`, `fs.write` and `child_process` IPC channels are explicit DENIED stubs. Remote
pages never inherit the privileged preload, and there is no website fallback. Logs under
`%LOCALAPPDATA%\War Room OS\logs` are redacted for passwords, bearer tokens, `sk-*` keys and
service-role strings.

No automatic Windows startup is configured. No updater, no remote activation, no license server.

## Proof status

Live-proven on the installed executable (not dev Electron, not `npm start`): silent install →
`War Room OS.exe` launched → Core `:3847` ready → UI `:3848` ready → first-run local Commander
bootstrap → conversation created → harmless prompt answered by `huihui_ai/qwen3-abliterated:14b`
via `OLLAMA`, `local_or_remote: LOCAL` → shutdown with both ports closed → relaunch with identity,
conversation and messages intact → second launch focuses the existing instance without duplicate
listeners → launch from the Start Menu shortcut and from the desktop shortcut both reach a ready
UI → `%LOCALAPPDATA%\War Room OS` Commander profile byte-identical throughout → prod `:3000`
unaffected.

Run `npm --prefix desktop run dist`, then:

- `node scripts/phase11d-install-smoke.mjs` — silent install into an isolated directory, then
  Core + UI readiness, first-run Commander bootstrap, conversation create, message send,
  shutdown, restart, persistence, and an integrity check that the real
  `%LOCALAPPDATA%\War Room OS` profile was not overwritten.
- `node scripts/phase11d-local-model-proof.mjs` — live local model reply through the Phase 11B
  canonical router against the installed payload.
- `npm run validate:ascension-phase11d` — deterministic packaging/security/truth checks.

### Icon

The approved artwork is Commander-supplied only: a dark cinematic rounded square with an Earth
background, a metallic W emblem, blue luminous accents, "WAR ROOM OS" and "SEE · ANALYZE · PLAN ·
BUILD". It lives at `desktop/assets/war-room-os-icon.png` (1254×1254, 1,668,743 bytes, sha256
`843af444…6f0b`) copied byte-for-byte from the Commander's clean, arrow-free export, with
provenance in `desktop/assets/ICON_APPROVAL.txt`. `desktop/scripts/generate-icon-ico.cjs` derives
the ICO at 16/24/32/48/64/128/256 from that exact PNG. The artwork is never redesigned.

Substituting another mark from this repository is explicitly **not** approval. The generator detects
the `app/favicon.ico` triangle-in-disc mark by hash and reports
`NOT_APPROVED_PLACEHOLDER_APP_FAVICON_MARK`, which fails the gate.

`scripts/phase11d-icon-surface-proof.mjs` verifies each Windows surface **independently** — failures
are never aggregated into an overall PASS:

| Surface | Method |
| --- | --- |
| `APPROVED_SOURCE_PNG` | provenance status, approval file, hash of the PNG on disk |
| `WINDOWS_ICO` | all seven frames present, derived from the approved PNG |
| `INSTALLED_EXE_ICON` | approved 256×256 frame bytes located inside the installed `War Room OS.exe` |
| `DESKTOP_SHORTCUT_ICON` | shell-resolved `.lnk` target and icon location point at that executable |
| `START_MENU_ICON` | same, for the Start Menu entry |
| `WINDOW_ICON` | `BrowserWindow` receives the packaged icon via `resolveIconPath()` |
| `TASKBAR_ICON` | inherited from the window/executable icon, with `setAppUserModelId` establishing identity |

An earlier supplied PNG (sha256 `63d2a9d3…0447`, 2,140,555 bytes) carried a Windows shortcut-arrow
overlay baked into its lower-left corner and was shipped unedited. The Commander then replaced it
with a clean re-export. That clean file is the only approved artwork: `CLEAN ARROW-FREE ICON = LIVE`
on the installed EXE, desktop shortcut, Start Menu, window, and taskbar (commit `701f60a`). The
triangle-in-disc mark and the arrow-badged PNG are both not approved.

### Code signing — optional, not a functional blocker

`CODE_SIGNING: NOT_CONFIGURED`. No Windows signing certificate exists in this environment, and
**Smart App Control is enabled** on the Commander machine
(`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState = 1`). It blocked
an earlier unsigned build of this application outright — CodeIntegrity events 3033/3077,
`spawn UNKNOWN`, "did not meet the Enterprise signing level requirements". The current build
launches normally, but that is a reputation decision, not a guarantee: while the binary is unsigned,
any rebuild may be blocked again, and SmartScreen will warn on the installer. Recorded as
`SMART_APP_CONTROL: ENABLED_INTERMITTENTLY_BLOCKING_UNSIGNED`. Smart App Control must not be
disabled — on Windows 11 it cannot be re-enabled without resetting Windows.

Signing is **optional** and does not gate the phase. `PHASE_11D: COMPLETE` rests on the installed
application: normal per-user install, both shortcuts, the local Core/UI runtime, local Commander
auth, and the approved icon on every surface. Configuring Azure Trusted Signing (below) removes the
SmartScreen warning and the risk that a future rebuild is blocked, but adds no capability.

One practical consequence observed after this rebuild: the **first** launch of a freshly built
unsigned executable can be silently stalled by Smart App Control while it evaluates reputation. The
first shortcut launch produced no process; a direct launch of the same executable succeeded, and
every launch afterwards — desktop shortcut and Start Menu — started normally.

### Enabling Azure Trusted Signing

Signing is wired but opt-in, so unsigned local builds keep working. Set these in the build
environment — **names only, never values in the repository**:

| Variable | Meaning |
| --- | --- |
| `WAR_ROOM_AZURE_SIGNING=1` | Turns signing on |
| `WAR_ROOM_SIGN_PUBLISHER_NAME` | Must match the certificate subject exactly; becomes the installer publisher |
| `WAR_ROOM_SIGN_ENDPOINT` | Trusted Signing account endpoint for your region |
| `WAR_ROOM_SIGN_ACCOUNT_NAME` | Code Signing Account name |
| `WAR_ROOM_SIGN_CERT_PROFILE` | Certificate Profile name |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Read by Azure Identity directly |

`npm --prefix desktop run dist` then reports `code_signing: AZURE_TRUSTED_SIGNING` and flips
`signExecutable` back on. With any variable missing the build stops rather than producing a
silently unsigned artifact. A self-signed certificate is not an alternative: Smart App Control
requires a Microsoft-trusted signing level.

## Uninstall

The uninstaller removes program files and deliberately preserves `%LOCALAPPDATA%\War Room OS`
(`deleteAppDataOnUninstall: false`, plus an explicit `customUnInstall` no-op in
`desktop/build/installer.nsh`). Commander identity, conversations, messages and exports survive
uninstall and reinstall.
