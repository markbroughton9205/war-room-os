#!/usr/bin/env node
/**
 * Read-only War Room desktop cross-platform validator.
 *
 * Detects the current host, inspects expected local paths and desktop package
 * metadata, and reports PASS / WARN / FAIL. Does not install packages, launch
 * Electron, write config, alter env, kill processes, modify repo files, or
 * print secret values.
 *
 * Usage: node scripts/validate-desktop-platform.mjs
 */
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const DESKTOP_ROOT = path.join(REPO_ROOT, 'desktop')
const PRODUCT = 'War Room OS'
const LINUX_PRODUCT_DIR = 'war-room-os'
const APP_ID = 'com.warroomos.desktop'
const DESKTOP_CORE_PORT = 3847
const DESKTOP_UI_PORT = 3848
const PROD_PORT = 3000
const DEV_PORT = 3001

const findings = []

function add(status, id, detail, extra) {
  const row = { status, id, detail }
  if (extra && Object.keys(extra).length) row.extra = extra
  findings.push(row)
}

function pass(id, detail, extra) {
  add('PASS', id, detail, extra)
}
function warn(id, detail, extra) {
  add('WARN', id, detail, extra)
}
function fail(id, detail, extra) {
  add('FAIL', id, detail, extra)
}

function exists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

function readJson(p) {
  const raw = readText(p)
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function looksLikeWindowsPath(p) {
  const s = String(p || '')
  return (
    /^[A-Za-z]:[\\/]/.test(s) ||
    s.includes('\\AppData\\') ||
    s.includes('/AppData/') ||
    /(?:^|[\\/])AppData[\\/]Local(?:[\\/]|$)/.test(s) ||
    /LOCALAPPDATA/i.test(s)
  )
}

function looksLikeLinuxHomePath(p) {
  const s = String(p || '')
  return (
    s.includes('/.local/share/') ||
    s.includes('/.config/') ||
    s.includes('/.cache/') ||
    s.includes('/.local/state/') ||
    /XDG_(DATA|CONFIG|CACHE|STATE)_HOME/.test(s)
  )
}

/**
 * Future desktop platform contract — expected paths only.
 * Not wired into Electron runtime. Aligns Windows with existing
 * %LOCALAPPDATA%\War Room OS layout and Linux with XDG / paths.ts.
 */
function contractRoots(platform, env, homedir) {
  const override = String(env.WAR_ROOM_LOCAL_DATA_DIR || '').trim()
  if (override) {
    const root = path.resolve(override)
    return {
      source: 'WAR_ROOM_LOCAL_DATA_DIR',
      dataRoot: root,
      configRoot: root,
      cacheRoot: path.join(root, 'cache'),
      logRoot: path.join(root, 'logs'),
    }
  }

  if (platform === 'win32') {
    const base = String(env.LOCALAPPDATA || '').trim() || path.join(homedir, 'AppData', 'Local')
    const root = path.join(base, PRODUCT)
    return {
      source: 'windows-localappdata',
      dataRoot: root,
      configRoot: root,
      cacheRoot: path.join(root, 'cache'),
      logRoot: path.join(root, 'logs'),
    }
  }

  if (platform === 'darwin') {
    const root = path.join(homedir, 'Library', 'Application Support', PRODUCT)
    return {
      source: 'darwin-application-support',
      dataRoot: root,
      configRoot: root,
      cacheRoot: path.join(root, 'cache'),
      logRoot: path.join(root, 'logs'),
    }
  }

  const dataBase = String(env.XDG_DATA_HOME || '').trim() || path.join(homedir, '.local', 'share')
  const configBase = String(env.XDG_CONFIG_HOME || '').trim() || path.join(homedir, '.config')
  const cacheBase = String(env.XDG_CACHE_HOME || '').trim() || path.join(homedir, '.cache')
  const stateBase = String(env.XDG_STATE_HOME || '').trim() || path.join(homedir, '.local', 'state')
  return {
    source: 'linux-xdg',
    dataRoot: path.join(dataBase, LINUX_PRODUCT_DIR),
    configRoot: path.join(configBase, LINUX_PRODUCT_DIR),
    cacheRoot: path.join(cacheBase, LINUX_PRODUCT_DIR),
    logRoot: path.join(stateBase, LINUX_PRODUCT_DIR),
  }
}

function inferDesktopShellRoot(mainSrc, platform, env, homedir) {
  if (!mainSrc) return { root: null, kind: 'missing-main' }
  const usesOverride = /WAR_ROOM_LOCAL_DATA_DIR/.test(mainSrc)
  const usesLocalAppData = /process\.env\.LOCALAPPDATA/.test(mainSrc)
  const usesAppDataLocal = /AppData['"` ,\\/]+Local|AppData\\\\Local/.test(mainSrc)
  const usesXdg = /XDG_DATA_HOME|XDG_CONFIG_HOME|XDG_CACHE_HOME/.test(mainSrc)
  const usesLinuxShare = /\.local['"` ,\\/]+share|war-room-os/.test(mainSrc)
  const usesDarwin = /Application Support/.test(mainSrc)

  const override = String(env.WAR_ROOM_LOCAL_DATA_DIR || '').trim()
  if (override && usesOverride) {
    return { root: path.resolve(override), kind: 'env-override' }
  }

  if (usesLocalAppData || usesAppDataLocal) {
    const base = String(env.LOCALAPPDATA || '').trim() || path.join(homedir, 'AppData', 'Local')
    return {
      root: path.join(base, PRODUCT),
      kind: 'localappdata-or-appdata-local',
      usesLocalAppData,
      usesAppDataLocal,
      usesXdg,
      usesLinuxShare,
    }
  }

  if (platform === 'linux' && (usesXdg || usesLinuxShare)) {
    const dataBase = String(env.XDG_DATA_HOME || '').trim() || path.join(homedir, '.local', 'share')
    return { root: path.join(dataBase, LINUX_PRODUCT_DIR), kind: 'linux-share-or-xdg', usesXdg, usesLinuxShare }
  }

  if (platform === 'darwin' && usesDarwin) {
    return {
      root: path.join(homedir, 'Library', 'Application Support', PRODUCT),
      kind: 'darwin-application-support',
    }
  }

  return { root: null, kind: 'unrecognized', usesLocalAppData, usesAppDataLocal, usesXdg, usesLinuxShare }
}

function inferLibOwnershipRoot(pathsSrc, platform, env, homedir) {
  if (!pathsSrc) return { root: null, kind: 'missing-paths-ts' }
  const honorsXdg = /XDG_DATA_HOME/.test(pathsSrc)
  const hasLinuxShare = /\.local['"` ,\\/]+share/.test(pathsSrc)
  const hasWin = /LOCALAPPDATA/.test(pathsSrc)
  const hasDarwin = /Application Support/.test(pathsSrc)

  const override = String(env.WAR_ROOM_LOCAL_DATA_DIR || '').trim()
  if (override) return { root: path.resolve(override), kind: 'env-override', honorsXdg }

  if (platform === 'win32') {
    const base = String(env.LOCALAPPDATA || '').trim() || path.join(homedir, 'AppData', 'Local')
    return { root: path.join(base, PRODUCT), kind: 'windows', honorsXdg, hasWin }
  }
  if (platform === 'darwin') {
    return {
      root: path.join(homedir, 'Library', 'Application Support', PRODUCT),
      kind: 'darwin',
      honorsXdg,
      hasDarwin,
    }
  }
  if (honorsXdg && String(env.XDG_DATA_HOME || '').trim()) {
    return { root: path.join(String(env.XDG_DATA_HOME).trim(), LINUX_PRODUCT_DIR), kind: 'xdg-data-home', honorsXdg }
  }
  if (hasLinuxShare) {
    return { root: path.join(homedir, '.local', 'share', LINUX_PRODUCT_DIR), kind: 'homedir-local-share', honorsXdg, hasLinuxShare }
  }
  return { root: null, kind: 'unrecognized', honorsXdg, hasWin, hasDarwin, hasLinuxShare }
}

function probePort(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = open => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(250)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

function linuxTargetsFromBuild(build) {
  const linux = build?.linux
  if (!linux) return []
  const raw = linux.target
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map(item => (typeof item === 'string' ? item : item?.target)).filter(Boolean)
}

function winTargetsFromBuild(build) {
  const win = build?.win
  if (!win) return []
  const raw = win.target
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map(item => (typeof item === 'string' ? item : item?.target)).filter(Boolean)
}

async function main() {
  const platform = process.platform
  const arch = process.arch
  const node = process.version
  const homedir = os.homedir()
  const env = process.env

  const desktopPkgPath = path.join(DESKTOP_ROOT, 'package.json')
  const mainPath = path.join(DESKTOP_ROOT, 'src', 'main.cjs')
  const preloadPath = path.join(DESKTOP_ROOT, 'src', 'preload.cjs')
  const bootstrapPath = path.join(DESKTOP_ROOT, 'src', 'councilRoutingBootstrap.cjs')
  const winEnvPath = path.join(DESKTOP_ROOT, 'src', 'windowsUserEnv.cjs')
  const desktopHelperPath = path.join(DESKTOP_ROOT, 'src', 'appDataRoot.cjs')
  const libHelperPath = path.join(REPO_ROOT, 'lib', 'sovereign-runtime', 'local-ownership', 'appDataRoot.cjs')
  const pathsTsPath = path.join(REPO_ROOT, 'lib', 'sovereign-runtime', 'local-ownership', 'paths.ts')
  const constantsPath = path.join(REPO_ROOT, 'lib', 'sovereign-runtime', 'constants.ts')
  const nshPath = path.join(DESKTOP_ROOT, 'build', 'installer.nsh')
  const pngPath = path.join(DESKTOP_ROOT, 'assets', 'war-room-os-icon.png')
  const icoPath = path.join(DESKTOP_ROOT, 'assets', 'war-room-os.ico')
  const provenancePath = path.join(DESKTOP_ROOT, 'assets', 'ICON_PROVENANCE.json')

  const pkg = readJson(desktopPkgPath)
  const mainSrc = readText(mainPath)
  const preloadSrc = readText(preloadPath)
  const bootstrapSrc = readText(bootstrapPath)
  const winEnvSrc = readText(winEnvPath)
  const desktopHelperSrc = readText(desktopHelperPath)
  const libHelperSrc = readText(libHelperPath)
  const pathsSrc = readText(pathsTsPath)
  const constantsSrc = readText(constantsPath)
  const nshSrc = readText(nshPath)

  const contract = contractRoots(platform, env, homedir)

  function liveRoot(file) {
    try {
      return require(file).resolveAppDataRoot({ env, platform, homedir })
    } catch {
      return null
    }
  }

  const desktopLive = liveRoot(desktopHelperPath)
  const libLive = liveRoot(libHelperPath)
  const desktopInferred = desktopLive
    ? { root: desktopLive, kind: 'live-appDataRoot-cjs' }
    : inferDesktopShellRoot(`${mainSrc || ''}\n${desktopHelperSrc || ''}`, platform, env, homedir)
  const libInferred = libLive
    ? {
        root: libLive,
        kind: 'live-lib-appDataRoot-cjs',
        honorsXdg: /XDG_DATA_HOME/.test(`${libHelperSrc || ''}\n${pathsSrc || ''}`),
      }
    : inferLibOwnershipRoot(`${pathsSrc || ''}\n${libHelperSrc || ''}`, platform, env, homedir)

  if (platform === 'win32' || platform === 'linux' || platform === 'darwin') {
    pass('host.platform_supported', `platform=${platform} arch=${arch} node=${node}`)
  } else {
    fail('host.platform_supported', `unsupported platform=${platform}`)
  }

  if (platform === 'linux' && arch !== 'x64') {
    warn('host.arch', `Linux release matrix currently specifies x64; this host is ${arch}`)
  } else if (platform === 'win32' && arch !== 'x64') {
    warn('host.arch', `Windows release matrix currently specifies x64; this host is ${arch}`)
  } else {
    pass('host.arch', arch)
  }

  if (!pkg) {
    fail('desktop.package_json', `unreadable ${desktopPkgPath}`)
  } else {
    const build = pkg.build || {}
    if (pkg.productName === PRODUCT && build.productName === PRODUCT) {
      pass('desktop.product_name', PRODUCT)
    } else {
      fail('desktop.product_name', `expected "${PRODUCT}"`, {
        productName: pkg.productName ?? null,
        buildProductName: build.productName ?? null,
      })
    }
    if (build.appId === APP_ID) pass('desktop.app_id', APP_ID)
    else fail('desktop.app_id', `expected ${APP_ID}`, { appId: build.appId ?? null })

    if (pkg.version) pass('desktop.version', String(pkg.version))
    else fail('desktop.version', 'desktop/package.json has no version')

    const winTargets = winTargetsFromBuild(build)
    if (winTargets.includes('nsis')) pass('desktop.windows_nsis_target', 'win.target includes nsis')
    else fail('desktop.windows_nsis_target', 'NSIS target missing from desktop/package.json build.win', { winTargets })

    if (build.win?.artifactName === 'War Room OS Setup.${ext}') {
      pass('desktop.windows_artifact_name', build.win.artifactName)
    } else {
      fail('desktop.windows_artifact_name', 'expected "War Room OS Setup.${ext}"', {
        artifactName: build.win?.artifactName ?? null,
      })
    }

    if (build.nsis?.shortcutName === PRODUCT && build.nsis?.createStartMenuShortcut === true) {
      pass('desktop.windows_shortcut_identity', 'Start Menu shortcutName is War Room OS')
    } else {
      fail('desktop.windows_shortcut_identity', 'NSIS shortcut identity changed', {
        shortcutName: build.nsis?.shortcutName ?? null,
        createStartMenuShortcut: build.nsis?.createStartMenuShortcut ?? null,
      })
    }

    if (build.nsis?.deleteAppDataOnUninstall === false) {
      pass('desktop.uninstall_preserves_appdata', 'deleteAppDataOnUninstall=false')
    } else {
      fail('desktop.uninstall_preserves_appdata', 'uninstall must preserve AppData', {
        deleteAppDataOnUninstall: build.nsis?.deleteAppDataOnUninstall ?? null,
      })
    }

    const linuxTargets = linuxTargetsFromBuild(build)
    const hasAppImage = linuxTargets.includes('AppImage')
    const hasDeb = linuxTargets.includes('deb')
    const hasSnap = linuxTargets.includes('snap')
    const hasFlatpak = linuxTargets.includes('flatpak')
    if (hasAppImage) pass('desktop.linux_appimage_target', 'linux.target includes AppImage')
    else warn('desktop.linux_appimage_target', 'Linux AppImage target not present yet (Claude Linux packaging in progress)', { linuxTargets })
    if (hasDeb) pass('desktop.linux_deb_target', 'linux.target includes deb')
    else warn('desktop.linux_deb_target', 'Linux deb target not present yet (Claude Linux packaging in progress)', { linuxTargets })
    if (!hasSnap && !hasFlatpak) pass('desktop.no_snap_flatpak', 'Snap/Flatpak not added')
    else warn('desktop.no_snap_flatpak', 'Snap/Flatpak present; current matrix excludes those formats', { linuxTargets })

    const distScript = pkg.scripts?.dist || ''
    if (/--win|nsis|build-installer/.test(distScript)) {
      pass('desktop.dist_still_windows_capable', distScript)
    } else {
      warn('desktop.dist_still_windows_capable', 'desktop dist script no longer obviously Windows/NSIS capable', {
        dist: distScript || null,
      })
    }
  }

  if (!mainSrc) fail('desktop.main_present', `missing ${mainPath}`)
  else pass('desktop.main_present', 'desktop/src/main.cjs readable')

  if (!preloadSrc) fail('desktop.preload_present', `missing ${preloadPath}`)
  else {
    pass('desktop.preload_present', 'desktop/src/preload.cjs readable')
    if (/contextBridge/.test(preloadSrc) && /sovereign\.openExternalSafe/.test(preloadSrc)) {
      pass('desktop.preload_allowlist', 'hardened preload allowlist includes openExternalSafe')
    } else {
      warn('desktop.preload_allowlist', 'preload allowlist does not mention openExternalSafe')
    }
  }

  if (exists(pngPath)) pass('desktop.icon_png', pngPath)
  else fail('desktop.icon_png', `missing ${pngPath}`)
  if (exists(icoPath)) pass('desktop.icon_ico', icoPath)
  else fail('desktop.icon_ico', `missing ${icoPath}`)
  const provenance = readJson(provenancePath)
  if (provenance?.status === 'COMMANDER_APPROVED_SUPPLIED_PNG' && provenance?.redesigned === false) {
    pass('desktop.icon_provenance', provenance.status)
  } else {
    warn('desktop.icon_provenance', 'ICON_PROVENANCE.json missing or not Commander-approved PNG', {
      status: provenance?.status ?? null,
    })
  }

  const extraResources = JSON.stringify(pkg?.build?.extraResources || [])
  if (platform === 'linux' && extraResources.includes('war-room-os.ico') && !extraResources.includes('war-room-os-icon.png')) {
    warn(
      'desktop.linux_icon_resource',
      'extraResources currently copies the Windows .ico; Linux packages typically need the PNG (or an icon dir)',
    )
  } else if (platform !== 'linux') {
    pass('desktop.linux_icon_resource', 'Linux icon extraResources check skipped on this host')
  } else {
    pass('desktop.linux_icon_resource', 'Linux icon resource appears present in extraResources')
  }

  if (constantsSrc && /LOCAL_CORE_PORT = 3847/.test(constantsSrc) && /LOCAL_UI_PORT = 3848/.test(constantsSrc)) {
    pass('ports.desktop_constants', 'lib/sovereign-runtime/constants.ts keeps Core 3847 / UI 3848')
  } else {
    fail('ports.desktop_constants', 'desktop Core/UI port constants missing or changed')
  }

  if (mainSrc && /127\.0\.0\.1:3847/.test(mainSrc) && /127\.0\.0\.1:3848/.test(mainSrc)) {
    pass('ports.desktop_main', 'Electron main still binds expected loopback Core/UI origins')
  } else {
    fail('ports.desktop_main', 'desktop/src/main.cjs does not mention 127.0.0.1:3847 and :3848')
  }

  if (mainSrc && /warroomos\.com/.test(mainSrc) && /DENIED/.test(mainSrc)) {
    pass('desktop.no_website_fallback', 'public website fallback remains denied')
  } else {
    warn('desktop.no_website_fallback', 'could not confirm website fallback DENIED in main.cjs')
  }

  if (mainSrc && /shell\.openExternal/.test(mainSrc)) {
    pass('desktop.open_external', 'shell.openExternal present (Electron maps this per OS)')
  } else {
    fail('desktop.open_external', 'shell.openExternal not found in desktop/src/main.cjs')
  }

  if (mainSrc && /\bTray\b/.test(mainSrc)) warn('desktop.tray', 'Tray referenced in main — must be tested on Linux if implemented')
  else pass('desktop.tray', 'Tray not implemented; Linux tray test is N/A until added')

  if (mainSrc && /Notification/.test(mainSrc)) {
    warn('desktop.notifications', 'Notification referenced in main — must be tested on Linux if implemented')
  } else {
    pass('desktop.notifications', 'Notifications not implemented; Linux notification test is N/A until added')
  }

  if (mainSrc && /clipboard/i.test(mainSrc)) {
    warn('desktop.clipboard', 'clipboard referenced in main — must be tested on Linux if implemented')
  } else {
    pass('desktop.clipboard', 'Clipboard API not implemented in Electron main')
  }

  if (winEnvSrc) {
    if (/process\.platform !== 'win32'/.test(winEnvSrc) && /reg\.exe/.test(winEnvSrc)) {
      pass('desktop.windows_user_env_gated', 'windowsUserEnv.cjs is win32-gated and uses reg.exe only on Windows')
    } else {
      warn('desktop.windows_user_env_gated', 'windowsUserEnv.cjs gate/reg.exe pattern not recognized')
    }
  } else {
    warn('desktop.windows_user_env_gated', 'desktop/src/windowsUserEnv.cjs missing')
  }

  if (nshSrc && /LOCALAPPDATA\\Programs\\War Room OS/.test(nshSrc) && /do NOT remove %LOCALAPPDATA%\\War Room OS/i.test(nshSrc)) {
    pass('windows.installer_nsh', 'NSIS script still installs under LocalAppData Programs and preserves AppData')
  } else if (!nshSrc) {
    fail('windows.installer_nsh', 'desktop/build/installer.nsh missing')
  } else {
    warn('windows.installer_nsh', 'installer.nsh present but canonical install/AppData comments/paths not recognized')
  }

  const listening = {}
  for (const port of [DESKTOP_CORE_PORT, DESKTOP_UI_PORT, PROD_PORT, DEV_PORT]) {
    listening[port] = await probePort(port)
  }
  pass('ports.probe_readonly', 'TCP probe only; no processes started or killed', listening)

  if (desktopInferred.root) {
    const opposite =
      (platform === 'linux' && looksLikeWindowsPath(desktopInferred.root)) ||
      (platform === 'win32' && looksLikeLinuxHomePath(desktopInferred.root))
    if (opposite) {
      fail(
        'paths.desktop_shell_opposite_platform',
        'Electron main would select an opposite-platform app-data path on this host',
        { inferred: desktopInferred.root, kind: desktopInferred.kind, contract: contract.dataRoot },
      )
    } else {
      pass('paths.desktop_shell_opposite_platform', 'desktop shell inferred path is not an opposite-platform location', {
        inferred: desktopInferred.root,
        kind: desktopInferred.kind,
      })
    }
  } else {
    warn('paths.desktop_shell_opposite_platform', 'could not infer desktop shell app-data root from main.cjs', desktopInferred)
  }

  if (libInferred.root) {
    const opposite =
      (platform === 'linux' && looksLikeWindowsPath(libInferred.root)) ||
      (platform === 'win32' && looksLikeLinuxHomePath(libInferred.root))
    if (opposite) {
      fail('paths.lib_ownership_opposite_platform', 'lib ownership paths would select an opposite-platform root', {
        inferred: libInferred.root,
        kind: libInferred.kind,
      })
    } else {
      pass('paths.lib_ownership_opposite_platform', 'lib/sovereign-runtime/local-ownership/paths.ts is platform-appropriate', {
        inferred: libInferred.root,
        kind: libInferred.kind,
      })
    }
  } else {
    warn('paths.lib_ownership_opposite_platform', 'could not infer lib ownership root', libInferred)
  }

  if (desktopInferred.root && libInferred.root) {
    const same = path.resolve(desktopInferred.root) === path.resolve(libInferred.root)
    if (same) pass('paths.shell_matches_lib', 'desktop shell and lib ownership roots agree')
    else {
      fail('paths.shell_matches_lib', 'desktop shell and Core/UI ownership would use different data roots', {
        desktop: desktopInferred.root,
        lib: libInferred.root,
        contract: contract.dataRoot,
      })
    }
  }

  if (platform === 'linux') {
    if (libInferred.honorsXdg) pass('paths.linux_honors_xdg_data_home', 'paths.ts honors XDG_DATA_HOME')
    else warn('paths.linux_honors_xdg_data_home', 'paths.ts Linux root is ~/.local/share/war-room-os and does not read XDG_DATA_HOME')

    if (/appDataRoot\.cjs/.test(mainSrc || '')) {
      pass('paths.main_uses_shared_helper', 'desktop/src/main.cjs requires appDataRoot.cjs')
    } else {
      fail('paths.main_uses_shared_helper', 'desktop/src/main.cjs does not require the shared app-data helper')
    }

    if (/appDataRoot\.cjs/.test(bootstrapSrc || '')) {
      pass('paths.council_bootstrap_linux', 'council routing bootstrap uses shared appDataRoot.cjs')
    } else if (bootstrapSrc && /LOCALAPPDATA/.test(bootstrapSrc) && !/XDG_/.test(bootstrapSrc)) {
      fail(
        'paths.council_bootstrap_linux',
        'desktop/src/councilRoutingBootstrap.cjs still resolves data via LOCALAPPDATA / AppData\\Local',
      )
    } else if (bootstrapSrc) {
      pass('paths.council_bootstrap_linux', 'council routing bootstrap does not hard-require LOCALAPPDATA')
    }

    if (mainSrc && /cmd\.exe|powershell\.exe|taskkill|reg\.exe/.test(mainSrc) && !/win32/.test(mainSrc)) {
      fail('linux.no_windows_process_tools', 'main.cjs references Windows process tools without a platform gate')
    } else {
      pass('linux.no_windows_process_tools', 'Electron main does not require cmd.exe/PowerShell on Linux')
    }

    if (mainSrc && /process\.kill\(-/.test(mainSrc) && /detached:\s*true|detached:\s*posix|ownedSpawnExtras/.test(mainSrc)) {
      pass('linux.child_shutdown', 'POSIX owned children use process-group spawn/terminate')
    } else if (mainSrc && /process\.kill\(-/.test(mainSrc)) {
      pass('linux.child_shutdown', 'POSIX process-group terminate is present')
    } else if (mainSrc && /killOwned[\s\S]{0,200}SIGTERM/.test(mainSrc) && !/taskkill/.test(mainSrc)) {
      warn(
        'linux.child_shutdown',
        'Owned child shutdown is SIGTERM on the direct child only; Next/Core grandchildren may orphan on Linux until a process-group adapter exists',
      )
    }
  }

  if (platform === 'win32') {
    if (looksLikeLinuxHomePath(contract.dataRoot)) {
      fail('windows.no_linux_paths', 'Windows contract data root looks like a Linux XDG path', { root: contract.dataRoot })
    } else {
      pass('windows.no_linux_paths', 'Windows contract data root stays under LocalAppData / War Room OS')
    }
  } else {
    pass(
      'windows.expectation_recorded',
      'Windows regression expectation is documented; this host is not win32 so Windows launch is not claimed as PASS',
    )
  }

  const setupExe = path.join(DESKTOP_ROOT, 'dist-release', 'War Room OS Setup.exe')
  if (exists(setupExe)) {
    const st = fs.statSync(setupExe)
    pass('windows.preserved_nsis_artifact', 'desktop/dist-release/War Room OS Setup.exe is present on this checkout', {
      bytes: st.size,
    })
  } else {
    warn('windows.preserved_nsis_artifact', 'NSIS artifact not present at desktop/dist-release/War Room OS Setup.exe')
  }

  const rendererStillPresent =
    exists(path.join(DESKTOP_ROOT, 'renderer', 'index.html')) &&
    exists(path.join(DESKTOP_ROOT, 'renderer', 'app.js'))
  if (rendererStillPresent && mainSrc && /LOCAL_UI_ORIGIN/.test(mainSrc) && !/renderer\/index\.html/.test(mainSrc)) {
    warn(
      'legacy.foundation_renderer',
      'desktop/renderer foundation HTML still exists and build-check.cjs still requires it, but current main.cjs loads the local Next UI on :3848',
    )
  }

  const counts = { PASS: 0, WARN: 0, FAIL: 0 }
  for (const row of findings) counts[row.status] += 1
  const verdict = counts.FAIL > 0 ? 'FAIL' : counts.WARN > 0 ? 'WARN' : 'PASS'

  const report = {
    title: 'WAR_ROOM_DESKTOP_PLATFORM_VALIDATION',
    verdict,
    counts,
    host: {
      platform,
      arch,
      node,
      homedir_set: Boolean(homedir),
      env_names_consulted: [
        'WAR_ROOM_LOCAL_DATA_DIR',
        'LOCALAPPDATA',
        'XDG_DATA_HOME',
        'XDG_CONFIG_HOME',
        'XDG_CACHE_HOME',
        'XDG_STATE_HOME',
      ],
    },
    ports: {
      desktop_core: DESKTOP_CORE_PORT,
      desktop_ui: DESKTOP_UI_PORT,
      production_untouched: PROD_PORT,
      dev_untouched: DEV_PORT,
      listening,
      note: 'Desktop Core/UI are 3847/3848. :3000 production and :3001 DEV must remain untouched by the desktop shell.',
    },
    contract_paths: contract,
    inferred_paths: {
      desktop_shell: desktopInferred,
      lib_ownership: libInferred,
    },
    windows_regression_expectation: {
      scored_on_this_host: platform === 'win32',
      productName: PRODUCT,
      appId: APP_ID,
      installer_artifact: 'War Room OS Setup.exe',
      installer_format: 'NSIS',
      architecture: 'x64',
      install_dir: '%LOCALAPPDATA%\\Programs\\War Room OS',
      exe: '%LOCALAPPDATA%\\Programs\\War Room OS\\War Room OS.exe',
      app_data: '%LOCALAPPDATA%\\War Room OS',
      logs: '%LOCALAPPDATA%\\War Room OS\\logs\\desktop-main.log',
      ports: { core: DESKTOP_CORE_PORT, ui: DESKTOP_UI_PORT },
      forbidden_on_windows: ['XDG_* roots', 'bash/systemd required at runtime', 'AppImage/deb-only packaging'],
    },
    linux_acceptance_expectation: {
      scored_on_this_host: platform === 'linux',
      artifacts: ['AppImage', 'deb'],
      architecture: 'x64',
      data_root: contract.dataRoot,
      forbidden_on_linux: ['C:\\', 'LOCALAPPDATA as required root', 'cmd.exe', 'powershell.exe', 'NSIS-only packaging'],
    },
    claude_owned_files_not_modified: [
      'desktop/package.json',
      'desktop/src/main.cjs',
      'desktop/src/councilRoutingBootstrap.cjs',
      'desktop/src/windowsUserEnv.cjs',
      'desktop/scripts/build-installer.cjs',
      'desktop/scripts/build-check.cjs',
    ],
    findings,
  }

  console.log(JSON.stringify(report, null, 2))
  if (verdict === 'FAIL') process.exitCode = 1
}

main().catch(err => {
  console.error(JSON.stringify({ verdict: 'FAIL', error: String(err && err.message ? err.message : err) }, null, 2))
  process.exitCode = 1
})
