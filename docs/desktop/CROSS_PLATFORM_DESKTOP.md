# War Room OS — Cross-Platform Desktop Contract

One product. One source tree. One Electron shell. Platform adapters only where the OS actually differs.

```
Same War Room source
        ↓
Shared Electron desktop shell
        ↓
Shared app-data helper + platform process/installer adapters
       ↙                              ↘
 Windows x64 (NSIS)                 Linux x64 (AppImage + deb)
```

Do not create War Room Windows 2, War Room Linux 2, separate Council/Core forks, or a second UI.

macOS packaging is not in the matrix. The shared helper already has a darwin Application Support branch.

---

## Verification labels (do not mix)

| Label | Meaning |
| --- | --- |
| **VERIFIED_ON_LINUX** | Executed on this Linux host (`linux x64`, 2026-09-16). |
| **STRUCTURALLY_VALIDATED_FOR_WINDOWS** | Source/config/artifact identity checked; NSIS config and Windows path branch remain intact. |
| **NOT_RUNTIME_TESTED_ON_WINDOWS** | No Windows process launched, no NSIS rebuild, no installed-exe smoke on this pass. |

This reconciliation pass did **not** rebuild `War Room OS Setup.exe` on Linux.

---

## 1. Architecture (current)

### Shared stack

| Layer | Canonical location | Role |
| --- | --- | --- |
| War Room UI | `app/*` | Canonical Commander UI. Not forked for desktop. |
| Local Core | `lib/sovereign-runtime/*` | Loopback control plane. |
| Council / routing | `lib/council/*` | Shared. Packaged preference file is Commander-owned JSON. |
| App-data contract | `lib/sovereign-runtime/local-ownership/appDataRoot.cjs` | Canonical resolver. |
| Electron copy of helper | `desktop/src/appDataRoot.cjs` | Identical algorithm. Asar cannot `require()` repo `lib/`. |
| TypeScript wrapper | `lib/sovereign-runtime/local-ownership/paths.ts` | `createRequire('./appDataRoot.cjs')`. |
| Electron shell | `desktop/src/main.cjs`, `desktop/src/preload.cjs` | Window, lifecycle, spawn/attach Core+UI, deny public website fallback. |
| Packaged runtime | `desktop/runtime/` (`scripts/prepare-desktop-runtime.mjs`) | Repo-independent Core + Next standalone. |

`desktop/src/appDataRoot.cjs` and `lib/sovereign-runtime/local-ownership/appDataRoot.cjs` must stay algorithmically identical. `prepare-desktop-runtime.mjs` copies the desktop helper into `desktop/runtime/appDataRoot.cjs`.

### Ports (must stay true on every OS)

| Port | Role | Desktop may |
| --- | --- | --- |
| `127.0.0.1:3848` | Local full War Room Next UI | Discover, start if missing, load, stop **owned** child only |
| `127.0.0.1:3847` | Local Core | Discover, start if missing, stop **owned** child/handle only |
| `:3000` | Production web | **Untouched** |
| `:3001` | DEV web | **Untouched** |

Desktop never loads `https://warroomos.com`. `homepage` in `desktop/package.json` is **deb/AppImage metadata only**, not a runtime fallback.

### Security (shared)

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- IPC allowlist: `sovereign.getRuntimeTruth`, `sovereign.getHealth`, `sovereign.getBootState`, `sovereign.openExternalSafe`
- Privileged channels `shell.exec`, `powershell.run`, `fs.write`, `child_process` return `DENIED`
- `app.requestSingleInstanceLock()`
- Non-loopback http(s) → `shell.openExternal` (Electron maps this per OS)

---

## 2. Single data-root contract

`WAR_ROOM_LOCAL_DATA_DIR`, when set, is the **root** on every platform (not the `data/` subdirectory).

| Platform | Root |
| --- | --- |
| Windows | `%LOCALAPPDATA%\War Room OS` |
| macOS | `~/Library/Application Support/War Room OS` |
| Linux | `$XDG_DATA_HOME/war-room-os` when `XDG_DATA_HOME` is set; otherwise `~/.local/share/war-room-os` |

Mutable subdirs under that root: `data`, `logs`, `cache`, `exports`, `runtime`. Ownership SQLite is `<root>/data/local-ownership.sqlite`.

Agreement:

| Consumer | How it resolves |
| --- | --- |
| `lib/sovereign-runtime/local-ownership/paths.ts` | requires `appDataRoot.cjs` |
| `desktop/src/main.cjs` | `require('./appDataRoot.cjs')` |
| `desktop/src/councilRoutingBootstrap.cjs` | `resolveAppDataPaths().data` for `council-runtime.json` |

Electron `ensureRuntimes()` also sets `process.env.WAR_ROOM_LOCAL_DATA_DIR` to that root before spawning Core/UI so packaged Next chunks inherit the same root even if a previously compiled UI bundle still contains a Windows-only fallback.

Linux smoke on 2026-09-16 wrote Commander data to `~/.local/share/war-room-os/data` (**VERIFIED_ON_LINUX**). Electron Chromium profile still uses Electron’s default `userData` (`~/.config/War Room OS` on this host). That is session/cache for Chromium, not the Commander ownership root.

---

## 3. Process ownership

| OS | Spawn | Terminate owned children |
| --- | --- | --- |
| Windows | `windowsHide: true`, not detached | `child.kill('SIGTERM')` — **STRUCTURALLY_VALIDATED_FOR_WINDOWS**, **NOT_RUNTIME_TESTED_ON_WINDOWS** |
| Linux | `detached: true` so the child is in its own process group | `process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after 3s — same idea as `lib/native-builder/processRegistry.ts` |

Desktop does **not** kill by port or generic process name. Core in-process is closed via the returned handle. UI child is process-group terminated on Linux.

Linux smoke: SIGTERM to Electron closed `:3847` / `:3848`; no owned `boot-ui` / Next child remained (**VERIFIED_ON_LINUX**).

`desktop/src/windowsUserEnv.cjs` (`reg.exe`) and `app.setAppUserModelId('com.warroomos.desktop')` remain **win32-only**.

---

## 4. Release matrix

Do not add Snap or Flatpak. Do not remove NSIS.

```
War Room OS
├── Windows x64 → NSIS
├── Linux x64   → AppImage
└── Linux x64   → deb
```

| OS | Target | Artifact | Status |
| --- | --- | --- | --- |
| Windows | `electron-builder --win nsis --x64` | `War Room OS Setup.exe` | **STRUCTURALLY_VALIDATED_FOR_WINDOWS**. Existing file `desktop/dist-release/War Room OS Setup.exe` preserved. **NOT_RUNTIME_TESTED_ON_WINDOWS**. Not rebuilt on Linux. |
| Linux | `electron-builder --linux AppImage --x64` | `desktop/dist-release/War Room OS-0.2.0-x86_64.AppImage` | **VERIFIED_ON_LINUX** (build succeeded). AppImage runtime launch not part of the Electron *development* smoke. |
| Linux | `electron-builder --linux deb --x64` | `desktop/dist-release/War Room OS-0.2.0-amd64.deb` | **VERIFIED_ON_LINUX** (build succeeded). **Not installed.** |

Identity constants:

- `appId`: `com.warroomos.desktop`
- `productName`: `War Room OS`
- Linux `executableName`: `war-room-os`
- Linux desktop entry `Name`: `War Room OS`, `StartupWMClass`: `war-room-os`
- Desktop package version: `0.2.0`
- Debian package name currently follows npm `name`: `war-room-desktop`
- Windows icon: `desktop/assets/war-room-os.ico`
- Linux icon: `desktop/assets/war-room-os-icon.png`

Windows installer extras remain in `desktop/build/installer.nsh` (per-user `$LOCALAPPDATA\Programs\War Room OS`, AppData preserved, AUTO_START_WITH_WINDOWS = OFF).

---

## 5. What Claude already had vs what reconciliation added

Claude’s Linux Electron work (read on 2026-09-16 **before** further edits) already had:

- Shared security/preload allowlist
- Loopback `:3847` / `:3848` and no website fallback
- `windowsUserEnv.cjs` win32-gated
- Windows NSIS pipeline (`build.win`, `build.nsis`, `build-installer.cjs`, `installer.nsh`, `.ico`)
- Packaged `desktop/runtime` Core + Next launchers

Claude had **not** landed Linux electron-builder targets or a shared data-root helper. Electron main and Council bootstrap still used `%LOCALAPPDATA%` / `AppData\Local` on every platform.

Reconciliation added the shared helper, Linux AppImage+deb config, POSIX process-group shutdown, `WAR_ROOM_LOCAL_DATA_DIR` pinning, phase11d Linux/darwin helper checks, and this document’s verification labels.

---

## 6. Validation

```bash
node scripts/validate-desktop-platform.mjs
```

Linux host result 2026-09-16: **PASS 40 / WARN 1 / FAIL 0**.

Previous path failures are resolved:

- `paths.desktop_shell_opposite_platform` **PASS**
- `paths.shell_matches_lib` **PASS**
- `paths.council_bootstrap_linux` **PASS**

Remaining warning:

- `legacy.foundation_renderer` — `desktop/renderer/*` still required by `desktop/scripts/build-check.cjs`; current `main.cjs` loads Next `:3848`. Intentionally deferred.

Phase 11D packaging check `24_appdata` still requires `LOCALAPPDATA` + `War Room OS` in the shared helper. Added `24b` Linux XDG, `24c` darwin, `24d` shared helper. Windows packaging gate is not weakened.

Linux Electron development smoke (**VERIFIED_ON_LINUX**):

- Window opened; UI `http://127.0.0.1:3848/login` (title War Room — Higher Vision Inc)
- Core `CORE_READY` on `:3847`
- `:3000` / `:3001` closed
- Data dir `~/.local/share/war-room-os/data`
- No `LOCALAPPDATA` failure; no Windows command invocation in desktop log
- Clean SIGTERM shutdown; no owned orphans
- This host’s `chrome-sandbox` is mode `755` (not setuid `4755`); smoke used `--no-sandbox --disable-setuid-sandbox`. That is an environment constraint, not a product fork.

Packaged Next server chunks under `desktop/runtime/ui/.next` still contain a compiled Windows `AppData\Local` fallback. Electron pins `WAR_ROOM_LOCAL_DATA_DIR` to the platform root before spawn, which is why the Linux smoke did not rewrite `~/AppData/Local` after that pin. Re-running `prepare-desktop-runtime` after a Next rebuild will replace those chunks; it is not required for the current FAIL=0 gate.

---

## 7. Windows regression contract

**WINDOWS_DESKTOP_CONTRACT_PRESERVED = YES** — **STRUCTURALLY_VALIDATED_FOR_WINDOWS**, **NOT_RUNTIME_TESTED_ON_WINDOWS**.

Still true in source/config:

1. NSIS x64 target remains; `npm run dist` still runs `build-installer.cjs --win nsis --x64`
2. Artifact name `War Room OS Setup.${ext}`
3. `appId` / `productName` / shortcutName unchanged
4. App data branch is win32 `LOCALAPPDATA` + `War Room OS` (Linux XDG is not selected on `win32`)
5. `installer.nsh` still installs under `$LOCALAPPDATA\Programs\War Room OS` and does not delete AppData
6. `.ico` remains; Linux uses PNG without replacing the ICO
7. `AppUserModelId` still win32-only
8. No bash/systemd/XDG required on Windows
9. `windowsUserEnv.cjs` still no-op off Windows
10. Existing `desktop/dist-release/War Room OS Setup.exe` was not overwritten by the Linux build

---

## 8. Linux acceptance (this host)

| Criterion | Result |
| --- | --- |
| Electron opens in development | **VERIFIED_ON_LINUX** (`cd desktop && electron .`, with host sandbox flags) |
| UI `:3848` / Core `:3847` | **VERIFIED_ON_LINUX** |
| Does not steal `:3001` | **VERIFIED_ON_LINUX** |
| XDG / `~/.local/share/war-room-os` | **VERIFIED_ON_LINUX** |
| No required `LOCALAPPDATA` | **VERIFIED_ON_LINUX** |
| `shell.openExternal` in main | Code-verified; Electron maps to the OS opener. Live click of an external site was not separately instrumented. |
| AppImage builds | **VERIFIED_ON_LINUX** |
| deb builds | **VERIFIED_ON_LINUX** |
| deb installed / Applications menu live | **Not done** (Commander ordered STOP before install) |
| Tray / notifications / clipboard | Not implemented on any OS |

Linux desktop must not require NSIS, Azure Trusted Signing, `reg.exe`, or Windows Scheduled Tasks.

---

## 9. Commands

```bash
node scripts/validate-desktop-platform.mjs
cd desktop && npx electron . --no-sandbox --disable-setuid-sandbox   # only if chrome-sandbox is not setuid
cd desktop && npm run dist:linux                                    # AppImage + deb; does not build NSIS
cd desktop && npm run dist                                          # Windows NSIS (Windows host)
```

Manual deb install (not executed on this pass):

```bash
sudo dpkg -i "/home/chosenone/Codex/war-room-os/desktop/dist-release/War Room OS-0.2.0-amd64.deb"
```

Windows live installer proof remains Windows-host only:

```bash
node scripts/phase11d-install-smoke.mjs
```

---

## 10. Rules for future platform additions

1. One app id, one product name, one Council, one Core, one UI tree.
2. Add a platform adapter; do not fork `lib/council` or `app/`.
3. Keep NSIS when adding Linux targets. Adding `build.linux` must not delete `build.win` / `build.nsis`.
4. Do not add Snap or Flatpak unless Commander authorizes a new matrix row.
5. macOS, if added later, should implement the same data-root contract. No darwin installer is in the current matrix.
6. Do not abstract Electron/Node APIs that already work cross-platform (`path`, `spawn` argv, `openExternal`, `BrowserWindow`, sandbox prefs).
7. Windows USER registry overlay, AppUserModelId, NSIS, `.ico`, `taskkill`, `reg.exe` stay Windows-only.
8. Linux must not require PowerShell, `cmd.exe`, NSIS, or `%LOCALAPPDATA%`. Windows must not require bash, systemd, or XDG.
9. Honor `WAR_ROOM_LOCAL_DATA_DIR` as the **root** on every OS.
10. Keep Electron main, Council bootstrap, and `paths.ts` on the same helper — do not add a third independent resolver.
11. Tray/notifications/clipboard, if added, go through shared optional code — not a Linux-only shell.
12. Rebuild packaged Next (`prepare-desktop-runtime`) when ownership path source changes, so compiled UI chunks match the helper.

---

## Operator note

This document does not change production, secrets, WR-CORPUS, WR-TOKENIZER, or training. Linux `.deb` was built and **not** installed.
