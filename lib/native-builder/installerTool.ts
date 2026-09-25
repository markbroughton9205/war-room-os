/**
 * installer.install / installer.status.
 *
 * There is no install script anywhere in this repo or the user's home directory today — every
 * versioned directory under the real `~/.local/opt` was produced by hand in a prior session. This
 * module is a real, working implementation of that missing piece, but it is deliberately gated:
 * classifyInstallTarget (commandPolicy.ts) DENIES a target inside the real install root outright
 * for an autonomous mission, and REQUIRES_APPROVAL (commanderConfirmed:true) for anywhere else.
 * This pass never supplies that confirmation for a real path — only tmp/ overrides are exercised
 * by tests and the acceptance proof. Prior installs are always preserved into rollback_installs,
 * never deleted, matching the schema already observed in existing INSTALL_STAMP.json files.
 */
import { chmod, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { APP_TREE_DIRNAME, installedAppTreeDir } from './installLayout'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { classifyInstallTarget, classifyProductionInstallTarget } from './commandPolicy'
import { terminalRepoStatus } from './terminalExecutor'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { electronShimExecLine, helperBesideExecutable, inspectLinuxElectronSandboxCapability } from './linuxElectronSandboxCapability'

const nodeRequire = createRequire(import.meta.url)

export function realInstallOptRoot(): string {
  if (process.platform === 'darwin') return '/Applications'
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Local', 'Programs')
  return path.join(os.homedir(), '.local', 'opt')
}

function userConfigDir(): string {
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming', 'War Room OS')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'War Room OS')
  return path.join(os.homedir(), '.config', 'War Room OS')
}

export type InstallStamp = {
  install_id: string
  feature: string
  gitSha: string
  gitShort: string
  gitDirty: boolean
  gitRef: string
  builtAt: string
  preparedAt: string
  appimage: string | null
  deb: string | null
  /** Runnable executable inside the unpacked app tree this install copied in (PASS 003) — null
   * for older/tmp-override installs (installerInstall) that never copy a runnable tree. */
  executable: string | null
  rollback_installs: string[]
  system_opt_untouched: string
  user_config_preserved: string
}

export type InstallerInstallInput = {
  sourceArtifactPath: string
  installRootOverride: string
  feature: string
  commanderConfirmed?: boolean
}

export type InstallerInstallResult =
  | { ok: true; installDir: string; stamp: InstallStamp }
  | { ok: false; error: string }

async function readPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(path.join(resolveRepoRoot(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export async function installerInstall(input: InstallerInstallInput): Promise<InstallerInstallResult> {
  const installRoot = path.resolve(input.installRootOverride)
  const policy = classifyInstallTarget(installRoot, realInstallOptRoot())
  if (policy.policyClass === 'DENIED') return { ok: false, error: policy.reason }
  if (policy.policyClass === 'REQUIRES_APPROVAL' && input.commanderConfirmed !== true) {
    return { ok: false, error: `${policy.reason} (pass commanderConfirmed: true once approved).` }
  }
  if (!existsSync(input.sourceArtifactPath)) {
    return { ok: false, error: `Source artifact not found: ${input.sourceArtifactPath}` }
  }

  const status = await terminalRepoStatus()
  const version = await readPackageVersion()
  const gitShort = status.lastCommitHash?.short ?? 'unknown'
  const gitSha = status.lastCommitHash?.full ?? 'unknown'
  const gitDirty = status.workingTreeStatus !== 'clean'
  const gitRef = status.currentBranch
  const feature = input.feature.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'foundry-install'
  const installId = `war-room-os-${version}-${gitShort}-${feature}`
  const installDir = path.join(installRoot, installId)

  await mkdir(installRoot, { recursive: true })
  const priorEntries = existsSync(installRoot) ? await readdir(installRoot) : []
  const rollbackInstalls: string[] = []
  for (const entry of priorEntries) {
    const abs = path.join(installRoot, entry)
    if (abs === installDir) continue
    const info = await stat(abs).catch(() => null)
    if (info?.isDirectory()) rollbackInstalls.push(abs)
  }

  await mkdir(installDir, { recursive: true })
  const artifactBasename = path.basename(input.sourceArtifactPath)
  const destArtifact = path.join(installDir, artifactBasename)
  await cp(input.sourceArtifactPath, destArtifact)

  const isAppImage = /\.appimage$/i.test(artifactBasename)
  const isDeb = /\.deb$/i.test(artifactBasename)
  const now = new Date().toISOString()
  const stamp: InstallStamp = {
    install_id: installId,
    feature: input.feature,
    gitSha,
    gitShort,
    gitDirty,
    gitRef,
    builtAt: now,
    preparedAt: now,
    appimage: isAppImage ? destArtifact : null,
    deb: isDeb ? destArtifact : null,
    executable: null,
    rollback_installs: rollbackInstalls,
    system_opt_untouched: '/opt/War Room OS',
    user_config_preserved: userConfigDir(),
  }
  await writeInstallStamp(installDir, stamp)

  await logWarRoomRepoAudit('engineer: installer.install', { installDir, installId, approvalKind: policy.approvalKind ?? null, commanderConfirmed: input.commanderConfirmed === true })
  return { ok: true, installDir, stamp }
}

async function writeInstallStamp(installDir: string, stamp: InstallStamp): Promise<void> {
  await writeFile(path.join(installDir, 'INSTALL_STAMP.json'), JSON.stringify(stamp, null, 2), 'utf8')
}

/** Accept Foundry stamps and the older hand-made/Terra stamps already on this machine
 * (`binary` instead of `executable`, `source_commit` instead of `gitSha`, no `install_id`).
 * Identity still has to resolve to the install directory name — we never invent a different id. */
export function normalizeInstallStamp(raw: unknown, installId: string, installDir: string): InstallStamp | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const executable =
    (typeof s.executable === 'string' && s.executable) ||
    (typeof s.binary === 'string' && s.binary) ||
    path.join(installedAppTreeDir(installDir), 'war-room-os')
  const gitSha = String(s.gitSha ?? s.source_commit ?? '')
  const gitShort = String(s.gitShort ?? s.git_short ?? gitSha.slice(0, 7))
  return {
    install_id: typeof s.install_id === 'string' && s.install_id ? s.install_id : installId,
    feature: String(s.feature ?? ''),
    gitSha,
    gitShort,
    gitDirty: s.gitDirty === true || s.git_dirty === true,
    gitRef: String(s.gitRef ?? s.git_ref ?? ''),
    builtAt: String(s.builtAt ?? s.built_at ?? ''),
    preparedAt: String(s.preparedAt ?? s.prepared_at ?? s.installed_at ?? ''),
    appimage: typeof s.appimage === 'string' ? s.appimage : null,
    deb: typeof s.deb === 'string' ? s.deb : null,
    executable,
    rollback_installs: Array.isArray(s.rollback_installs) ? s.rollback_installs.map(String) : [],
    system_opt_untouched: String(s.system_opt_untouched ?? '/opt/War Room OS'),
    user_config_preserved: String(s.user_config_preserved ?? userConfigDir()),
  }
}

export type InstallerStatusResult = {
  realInstallRoot: string
  installs: { dir: string; stamp: InstallStamp | null }[]
  activeLauncherTarget: string | null
}

/** Read-only survey of the REAL install root — never mutates anything. Lets Foundry answer
 * "what's currently installed" without installing anything. */
export async function installerStatus(): Promise<InstallerStatusResult> {
  const root = realInstallOptRoot()
  const installs: InstallerStatusResult['installs'] = []
  if (existsSync(root)) {
    for (const entry of await readdir(root)) {
      const dir = path.join(root, entry)
      const info = await stat(dir).catch(() => null)
      if (!info?.isDirectory()) continue
      let stamp: InstallStamp | null = null
      try {
        const raw = JSON.parse(await readFile(path.join(dir, 'INSTALL_STAMP.json'), 'utf8'))
        stamp = normalizeInstallStamp(raw, path.basename(dir), dir)
      } catch {
        stamp = null
      }
      installs.push({ dir, stamp })
    }
  }
  let activeLauncherTarget: string | null = null
  const launcherPath = process.platform === 'linux' ? path.join(os.homedir(), '.local', 'bin', 'war-room-os-user') : null
  if (launcherPath && existsSync(launcherPath)) {
    try {
      activeLauncherTarget = (await readFile(launcherPath, 'utf8')).trim()
    } catch {
      activeLauncherTarget = null
    }
  }
  return { realInstallRoot: root, installs, activeLauncherTarget }
}

// ---------------------------------------------------------------------------
// PASS 002 — production installation protocol.
//
// This is a SEPARATE, additive pathway from installerInstall() above: that function's
// classifyInstallTarget continues to hard-DENY the real ~/.local/opt root unconditionally, for
// every existing caller and every existing test. installerInstallProduction() is the only
// function in this file that can write into the real root, gated by
// classifyProductionInstallTarget (always REQUIRES_APPROVAL, never SAFE_LOCAL), and it follows
// the DISCOVER -> PREPARE -> INSTALL -> VERIFY -> (rollback-on-failure) sequence PASS 002 asks
// for:
//   DISCOVER — installerStatus() surveys what's already installed before anything is written.
//   PREPARE  — both artifacts must already exist under desktop/dist-release (never an arbitrary
//              caller-supplied path — this refuses path injection by construction) and must
//              re-hash to the sha256 the caller (package.run) reported producing.
//   INSTALL  — a brand-new, uniquely-named versioned directory, matching the exact convention
//              every prior hand-made install under ~/.local/opt already uses. Nothing is ever
//              deleted or overwritten: every existing install directory is left completely alone
//              and returned as rollback_installs, exactly like installerInstall().
//   VERIFY   — both copied files are re-hashed and compared byte-for-byte against the source.
//   ROLLBACK — on any verify failure, only the directory THIS call just created is removed (it
//              cannot yet be referenced by anything); every prior install is untouched, so "the
//              previous known-good version" was never at risk in the first place.
//
// What this deliberately does NOT do: touch ~/.local/bin/war-room-os-user, any .desktop entry, or
// kill/replace a currently-running installed instance. "Activation" (pointing the user's actual
// launcher at a new version) is a distinct, more sensitive action than installing a new versioned
// copy side-by-side, and is out of scope for this pass — see the PASS 002 report.
// ---------------------------------------------------------------------------

export type ProductionInstallArtifact = { path: string; sha256: string }

export type InstallerInstallProductionInput = {
  appimage: ProductionInstallArtifact
  deb: ProductionInstallArtifact
  /** electron-builder's unpacked app tree (package.run's linuxUnpackedDir) — copied into
   * `<installDir>/opt/War-Room-OS/` (space-free: Chromium cannot exec a SUID sandbox helper
   * whose path contains spaces; older installs keep `opt/War Room OS/`). Without this, an install is a package-file archive only, not something a launcher can
   * actually run. */
  linuxUnpackedDir: string
  feature: string
  commanderConfirmed?: boolean
  /** Test-only. Never set by any real Engineer tool call path (engineerTools.ts never accepts or
   * forwards this field) — exists purely so the validation suite can exercise the full
   * DISCOVER/PREPARE/INSTALL/VERIFY/rollback sequence against an isolated tmp/ directory instead
   * of the actual shared ~/.local/opt. Deliberately separate from realInstallOptRoot() itself
   * (used unconditionally by installerInstall's real-root DENY check), so nothing here can weaken
   * that unrelated guarantee. */
  realOptRootOverride?: string
}

export type InstallerInstallProductionResult =
  | { ok: true; installDir: string; stamp: InstallStamp; discovered: InstallerStatusResult }
  | { ok: false; error: string; stage: 'discover' | 'policy' | 'prepare' | 'install' | 'verify' }

const DESKTOP_DIST_RELEASE_DIR = path.join(resolveRepoRoot(), 'desktop', 'dist-release')

async function sha256File(p: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(p))
  return hash.digest('hex')
}

export async function installerInstallProduction(input: InstallerInstallProductionInput): Promise<InstallerInstallProductionResult> {
  // DISCOVER — always, even if PREPARE/policy later refuses, so a caller can see current state.
  const discovered = await installerStatus()

  for (const [label, artifact] of [['appimage', input.appimage], ['deb', input.deb]] as const) {
    const resolved = path.resolve(artifact.path)
    if (path.relative(DESKTOP_DIST_RELEASE_DIR, resolved).startsWith('..')) {
      return { ok: false, error: `${label} artifact must be a real package.run output under desktop/dist-release, got: ${artifact.path}`, stage: 'prepare' }
    }
  }
  const unpackedResolved = path.resolve(input.linuxUnpackedDir)
  if (path.relative(DESKTOP_DIST_RELEASE_DIR, unpackedResolved).startsWith('..')) {
    return { ok: false, error: `linuxUnpackedDir must be a real package.run output under desktop/dist-release, got: ${input.linuxUnpackedDir}`, stage: 'prepare' }
  }
  const unpackedExecutableSrc = path.join(input.linuxUnpackedDir, 'war-room-os')
  if (!existsSync(unpackedExecutableSrc)) {
    return { ok: false, error: `linuxUnpackedDir has no war-room-os executable: ${unpackedExecutableSrc}`, stage: 'prepare' }
  }

  const realRoot = input.realOptRootOverride ?? realInstallOptRoot()
  const version = await readPackageVersion()
  const status = await terminalRepoStatus()
  const gitShort = status.lastCommitHash?.short ?? 'unknown'
  const gitSha = status.lastCommitHash?.full ?? 'unknown'
  const gitDirty = status.workingTreeStatus !== 'clean'
  const gitRef = status.currentBranch
  const feature = input.feature.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'foundry-production-install'
  const installId = `war-room-os-${version}-${gitShort}-${feature}`
  const installDir = path.join(realRoot, installId)

  const policy = classifyProductionInstallTarget(installDir, realRoot)
  if (policy.policyClass === 'DENIED') return { ok: false, error: policy.reason, stage: 'policy' }
  if (policy.policyClass === 'REQUIRES_APPROVAL' && input.commanderConfirmed !== true) {
    return { ok: false, error: `${policy.reason} (pass commanderConfirmed: true once approved).`, stage: 'policy' }
  }

  // PREPARE — both artifacts must exist and re-hash to what the caller (package.run) reported.
  for (const [label, artifact] of [['appimage', input.appimage], ['deb', input.deb]] as const) {
    if (!existsSync(artifact.path)) return { ok: false, error: `${label} artifact not found: ${artifact.path}`, stage: 'prepare' }
    const actual = await sha256File(artifact.path)
    if (actual !== artifact.sha256) {
      return { ok: false, error: `${label} artifact hash mismatch — expected ${artifact.sha256}, found ${actual}. Refusing to install a changed artifact.`, stage: 'prepare' }
    }
  }
  if (existsSync(installDir)) {
    return { ok: false, error: `Install target already exists: ${installDir}. Never overwriting an existing directory.`, stage: 'prepare' }
  }

  // INSTALL — never touches any existing sibling directory, the launcher, or any .desktop entry.
  await mkdir(realRoot, { recursive: true })
  const priorEntries = await readdir(realRoot)
  const rollbackInstalls = priorEntries
    .map(entry => path.join(realRoot, entry))
    .filter(abs => abs !== installDir)
  await mkdir(installDir, { recursive: true })
  const appimageDest = path.join(installDir, path.basename(input.appimage.path))
  const debDest = path.join(installDir, path.basename(input.deb.path))
  await cp(input.appimage.path, appimageDest)
  await cp(input.deb.path, debDest)
  // The runnable tree — `opt/War-Room-OS/...` (space-free so the adjacent SUID chrome-sandbox helper
  // is executable by Chromium), which is what installer.activate's launcher shim points at.
  const appTreeDest = path.join(installDir, 'opt', APP_TREE_DIRNAME)
  await mkdir(path.dirname(appTreeDest), { recursive: true })
  // electron-builder/Next standalone output legitimately contains relative package symlinks.
  // Preserve that packaged topology; dereferencing makes a dangling optional dependency abort
  // installation even though the produced application tree itself is valid and executable.
  await cp(input.linuxUnpackedDir, appTreeDest, { recursive: true, dereference: false })
  const executableDest = path.join(appTreeDest, 'war-room-os')
  await chmod(executableDest, 0o755).catch(() => { /* best-effort — verified below by presence+size instead */ })
  if (process.platform === 'linux') {
    try {
      const prepare = nodeRequire(path.join(resolveRepoRoot(), 'desktop/workbench-host/prepare-linux-chrome-sandbox.cjs')) as {
        applyHelper: (helper: string) => Record<string, unknown>
      }
      const sandbox = prepare.applyHelper(path.join(appTreeDest, 'chrome-sandbox'))
      await writeFile(path.join(installDir, 'LINUX_CHROME_SANDBOX.json'), `${JSON.stringify(sandbox, null, 2)}\n`)
    } catch (error) {
      await writeFile(path.join(installDir, 'LINUX_CHROME_SANDBOX.json'), `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`)
    }
  }

  const now = new Date().toISOString()
  const stamp: InstallStamp = {
    install_id: installId,
    feature: input.feature,
    gitSha,
    gitShort,
    gitDirty,
    gitRef,
    builtAt: now,
    preparedAt: now,
    appimage: appimageDest,
    deb: debDest,
    executable: executableDest,
    rollback_installs: rollbackInstalls,
    system_opt_untouched: '/opt/War Room OS',
    user_config_preserved: userConfigDir(),
  }

  // VERIFY — re-hash the packages; the runnable tree is verified by executable presence + exact
  // size match (hashing an 800MB+ tree file-by-file on every install would make this minutes
  // slower for no real additional safety over a size check backed by the OS-level `cp` result).
  const [appimageOk, debOk, executableSrcStat, executableDestStat] = await Promise.all([
    sha256File(appimageDest),
    sha256File(debDest),
    stat(unpackedExecutableSrc),
    existsSync(executableDest) ? stat(executableDest) : Promise.resolve(null),
  ])
  const executableOk = executableDestStat !== null && executableDestStat.size === executableSrcStat.size
  if (appimageOk !== input.appimage.sha256 || debOk !== input.deb.sha256 || !executableOk) {
    await rm(installDir, { recursive: true, force: true })
    await logWarRoomRepoAudit('engineer: installer.install_production (verify failed, rolled back own partial install)', { installDir, installId })
    return { ok: false, error: 'Post-copy verification failed (hash mismatch) — removed the partial install directory this call created. Every prior install is untouched.', stage: 'verify' }
  }
  await writeInstallStamp(installDir, stamp)

  await logWarRoomRepoAudit('engineer: installer.install_production', {
    installDir,
    installId,
    rollbackInstalls,
    approvalKind: policy.approvalKind ?? null,
    commanderConfirmed: input.commanderConfirmed === true,
  })
  return { ok: true, installDir, stamp, discovered }
}

export type RollbackTarget = { installId: string; installDir: string; appimage: string | null; deb: string | null; executable: string | null; feature: string }

/** Read-only: describes how to relaunch a specific prior install directly, WITHOUT touching the
 * shared active launcher/.desktop entry — this Foundry pass never flips which version the user's
 * existing desktop shortcut points at. */
export async function installerRollbackTarget(installId: string): Promise<{ ok: true; target: RollbackTarget } | { ok: false; error: string }> {
  const root = realInstallOptRoot()
  const installDir = path.join(root, installId)
  if (path.relative(root, installDir).startsWith('..') || !existsSync(installDir)) {
    return { ok: false, error: `No such install under ${root}: ${installId}` }
  }
  try {
    const stamp = normalizeInstallStamp(JSON.parse(await readFile(path.join(installDir, 'INSTALL_STAMP.json'), 'utf8')), installId, installDir)
    if (!stamp) return { ok: false, error: `Install exists but INSTALL_STAMP.json is unreadable.` }
    return { ok: true, target: { installId, installDir, appimage: stamp.appimage, deb: stamp.deb, executable: stamp.executable ?? null, feature: stamp.feature } }
  } catch (error) {
    return { ok: false, error: `Install exists but INSTALL_STAMP.json is unreadable: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// ---------------------------------------------------------------------------
// PASS 003 — canonical active-install pointer + gated activation.
//
// The existing convention, already relied on by runtimeControl.ts's resolveInstalledExecutable
// (PASS 002) and confirmed by inspection to be what actually drives the currently-live process on
// this machine, is ~/.local/bin/war-room-os-user: a small shell shim. W7 source writes that shim
// without Chromium sandbox bypass flags. This pass formalizes the shim as the ONE authoritative
// active-install pointer, rather than inventing a parallel system.
//
// A second, independent ~/.local/share/applications/war-room-os.desktop entry was found to exist
// on this machine with a DIFFERENT hardcoded Exec= target than the shim — a real, pre-existing
// inconsistency from unrelated prior activity, not something this pass introduces. Foundry's
// activation authority is scoped to the shim only (the mechanism PASS 001/002 code already
// trusted, and the one actually driving the live process); the raw .desktop Exec= line is left
// untouched, and installerActiveStatus reports it purely as read-only diagnostic information.
// ---------------------------------------------------------------------------

function defaultShimPath(): string {
  return path.join(os.homedir(), '.local', 'bin', 'war-room-os-user')
}

function defaultDesktopEntryPath(): string | null {
  return process.platform === 'linux' ? path.join(os.homedir(), '.local', 'share', 'applications', 'war-room-os-user.desktop') : null
}

function parseShimExecPath(raw: string): string | null {
  return raw.match(/exec\s+"([^"]+)"/)?.[1] ?? null
}

export type ActiveInstallStatus = {
  activeInstallId: string | null
  activeInstallDir: string | null
  activeExecutable: string | null
  launcherPath: string
  desktopEntryPath: string | null
  desktopEntryExecTarget: string | null
  desktopEntryAgreesWithLauncher: boolean | null
  installStamp: InstallStamp | null
  exists: boolean
  valid: boolean
  reason: string | null
}

/** Read-only. Resolves the canonical active install strictly from the launcher shim — never from
 * install mtimes (mission requirement: "do not use 'most recent install' as production truth"). */
export async function installerActiveStatus(input: { realOptRootOverride?: string; shimPathOverride?: string } = {}): Promise<ActiveInstallStatus> {
  const realRoot = input.realOptRootOverride ?? realInstallOptRoot()
  const launcherPath = input.shimPathOverride ?? defaultShimPath()
  const desktopEntryPath = defaultDesktopEntryPath()

  let desktopEntryExecTarget: string | null = null
  if (desktopEntryPath && existsSync(desktopEntryPath)) {
    try {
      const raw = await readFile(desktopEntryPath, 'utf8')
      desktopEntryExecTarget = raw.match(/^Exec=(.*)$/m)?.[1]?.trim() ?? null
    } catch {
      desktopEntryExecTarget = null
    }
  }

  const base = { launcherPath, desktopEntryPath, desktopEntryExecTarget, desktopEntryAgreesWithLauncher: null as boolean | null }

  if (!existsSync(launcherPath)) {
    return { activeInstallId: null, activeInstallDir: null, activeExecutable: null, ...base, installStamp: null, exists: false, valid: false, reason: 'Launcher shim does not exist — no install has ever been activated on this machine.' }
  }
  let raw: string
  try {
    raw = await readFile(launcherPath, 'utf8')
  } catch (error) {
    return { activeInstallId: null, activeInstallDir: null, activeExecutable: null, ...base, installStamp: null, exists: true, valid: false, reason: `Launcher shim unreadable: ${error instanceof Error ? error.message : String(error)}` }
  }
  const execPath = parseShimExecPath(raw)
  if (!execPath) {
    return { activeInstallId: null, activeInstallDir: null, activeExecutable: null, ...base, installStamp: null, exists: true, valid: false, reason: 'Launcher shim has no recognizable exec "<path>" line.' }
  }
  const resolvedExec = path.resolve(execPath)
  const desktopEntryAgreesWithLauncher = desktopEntryExecTarget === null ? null : desktopEntryExecTarget.startsWith(resolvedExec)
  const rel = path.relative(realRoot, resolvedExec)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { activeInstallId: null, activeInstallDir: null, activeExecutable: resolvedExec, launcherPath, desktopEntryPath, desktopEntryExecTarget, desktopEntryAgreesWithLauncher, installStamp: null, exists: true, valid: false, reason: `Launcher target is outside the canonical install root ${realRoot}: ${resolvedExec}` }
  }
  const installId = rel.split(path.sep)[0]
  const installDir = path.join(realRoot, installId)
  if (!existsSync(installDir)) {
    return { activeInstallId: installId, activeInstallDir: installDir, activeExecutable: resolvedExec, launcherPath, desktopEntryPath, desktopEntryExecTarget, desktopEntryAgreesWithLauncher, installStamp: null, exists: true, valid: false, reason: `Install directory referenced by launcher does not exist: ${installDir}` }
  }
  let stamp: InstallStamp | null = null
  try {
    stamp = normalizeInstallStamp(JSON.parse(await readFile(path.join(installDir, 'INSTALL_STAMP.json'), 'utf8')), installId, installDir)
  } catch {
    stamp = null
  }
  const executableExists = existsSync(resolvedExec)
  const identityMatches = stamp?.install_id === installId
  const valid = stamp !== null && executableExists && identityMatches
  const reason = valid
    ? null
    : !stamp
      ? `INSTALL_STAMP.json missing or unreadable in ${installDir}`
      : !executableExists
        ? `Executable referenced by launcher does not exist: ${resolvedExec}`
        : `INSTALL_STAMP.json install_id "${stamp.install_id}" does not match install directory "${installId}"`
  return { activeInstallId: installId, activeInstallDir: installDir, activeExecutable: resolvedExec, launcherPath, desktopEntryPath, desktopEntryExecTarget, desktopEntryAgreesWithLauncher, installStamp: stamp, exists: true, valid, reason }
}

export type InstallerActivateInput = {
  installId: string
  commanderConfirmed?: boolean
  missionId?: string | null
  commanderExplicitRollback?: boolean
  activationMode?: 'MISSION' | 'MAINTENANCE_ROLLBACK' | 'RELAUNCH_CURRENT'
  allowHistoricalRollback?: boolean
  realOptRootOverride?: string
  shimPathOverride?: string
}

export type InstallerActivateResult =
  | { ok: true; previousActiveInstallId: string | null; previousActiveExecutable: string | null; newActiveInstallId: string; installDir: string; executablePath: string }
  | { ok: false; error: string; stage: 'policy' | 'validate' | 'write' }

/** The consequential sibling of installer.install_production: flips the canonical launcher shim
 * to point at an already-installed, already-validated version. Always requires explicit
 * confirmation. Never installs, builds, or packages anything itself — the target must already
 * exist and be a complete, stamped, runnable install. Atomic: writes a temp file beside the shim
 * and renames it into place, so the shim is never observably half-written. */
export async function installerActivate(input: InstallerActivateInput): Promise<InstallerActivateResult> {
  if (input.commanderConfirmed !== true) {
    return { ok: false, error: "installer.activate requires explicit Commander confirmation (commanderConfirmed: true) — this changes what the user's existing launcher runs.", stage: 'policy' }
  }
  const { authorizeProductionActivation } = await import('./foundryProductionOwnership')
  const allowed = await authorizeProductionActivation({
    missionId: input.missionId,
    installId: input.installId,
    commanderConfirmed: input.commanderConfirmed,
    commanderExplicitRollback: input.commanderExplicitRollback === true,
    activationMode: input.activationMode,
    allowHistoricalRollback: input.allowHistoricalRollback === true,
    realOptRootOverride: input.realOptRootOverride,
  })
  if (!allowed.ok) return { ok: false, error: allowed.error, stage: 'policy' }
  // installId must be a bare directory name — never a path (path escape / injection guard).
  if (!input.installId || input.installId !== path.basename(input.installId) || input.installId.includes('..')) {
    return { ok: false, error: `installId must be a bare install directory name, got: ${input.installId}`, stage: 'validate' }
  }
  const realRoot = input.realOptRootOverride ?? realInstallOptRoot()
  const shimPath = input.shimPathOverride ?? defaultShimPath()
  const installDir = path.join(realRoot, input.installId)
  const rel = path.relative(realRoot, installDir)
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    return { ok: false, error: 'Target install must reside beneath the canonical install root.', stage: 'validate' }
  }
  if (!existsSync(installDir)) return { ok: false, error: `No such install: ${installDir}`, stage: 'validate' }

  let stamp: InstallStamp
  try {
    const normalized = normalizeInstallStamp(JSON.parse(await readFile(path.join(installDir, 'INSTALL_STAMP.json'), 'utf8')), input.installId, installDir)
    if (!normalized) return { ok: false, error: 'Install has no valid INSTALL_STAMP.json.', stage: 'validate' }
    stamp = normalized
  } catch (error) {
    return { ok: false, error: `Install has no valid INSTALL_STAMP.json: ${error instanceof Error ? error.message : String(error)}`, stage: 'validate' }
  }
  if (stamp.install_id !== input.installId) {
    return { ok: false, error: `INSTALL_STAMP.json install_id "${stamp.install_id}" does not match requested "${input.installId}" — refusing a mismatched identity.`, stage: 'validate' }
  }
  const executablePath = stamp.executable ?? path.join(installedAppTreeDir(installDir), 'war-room-os')
  if (!existsSync(executablePath)) {
    return { ok: false, error: `Expected executable does not exist: ${executablePath} — this install looks partial, refusing to activate it.`, stage: 'validate' }
  }

  // Capture the current active target BEFORE writing anything — this is the rollback target.
  const before = await installerActiveStatus({ realOptRootOverride: realRoot, shimPathOverride: shimPath })

  const sandboxCapability = inspectLinuxElectronSandboxCapability(helperBesideExecutable(executablePath))
  const shimContents = [
    '#!/bin/bash',
    '# Per-user War Room OS launcher (does not touch /opt). Written by Foundry installer.activate.',
    `# sandbox_supported=${sandboxCapability.sandbox_supported} sandbox_mode=${sandboxCapability.sandbox_mode}`,
    `export GDK_BACKEND=x11`,
    `export ELECTRON_OZONE_PLATFORM_HINT=x11`,
    electronShimExecLine(executablePath, sandboxCapability),
    '',
  ].join('\n')
  const tmpPath = `${shimPath}.tmp-${process.pid}-${Date.now()}`
  try {
    await mkdir(path.dirname(shimPath), { recursive: true })
    await writeFile(tmpPath, shimContents, { mode: 0o755 })
    await rename(tmpPath, shimPath) // atomic on the same filesystem
  } catch (error) {
    await rm(tmpPath, { force: true })
    return { ok: false, error: `Failed to write launcher shim: ${error instanceof Error ? error.message : String(error)}`, stage: 'write' }
  }

  await logWarRoomRepoAudit('engineer: installer.activate', {
    previousActiveInstallId: before.activeInstallId,
    newActiveInstallId: input.installId,
    installDir,
    executablePath,
    shimPath,
  })
  if (!input.realOptRootOverride || input.realOptRootOverride === realInstallOptRoot()) {
    const { recordProductionOwner } = await import('./foundryProductionOwnership')
    if (allowed.mode !== 'RELAUNCH_CURRENT') {
      await recordProductionOwner({
        installId: input.installId,
        missionId: input.missionId,
        mode: allowed.mode,
        authorized: true,
      })
    }
  }
  return { ok: true, previousActiveInstallId: before.activeInstallId, previousActiveExecutable: before.activeExecutable, newActiveInstallId: input.installId, installDir, executablePath }
}

export type InstallerRollbackActivationInput = {
  previousInstallId: string | null
  commanderConfirmed?: boolean
  commanderExplicitRollback?: boolean
  realOptRootOverride?: string
  shimPathOverride?: string
}

export type InstallerRollbackActivationResult =
  | { ok: true; restoredInstallId: string | null; note: string }
  | { ok: false; error: string }

/** Restores the exact prior active install captured by a previous installer.activate call's
 * `previousActiveInstallId`. Reuses installerActivate itself (same validation, same atomic
 * write) rather than a parallel code path. Never deletes any install. */
export async function installerRollbackActivation(input: InstallerRollbackActivationInput): Promise<InstallerRollbackActivationResult> {
  if (!input.previousInstallId) {
    return { ok: true, restoredInstallId: null, note: 'No prior active install was captured (this was the machine\'s first-ever activation) — nothing to roll back to; the launcher was left as-is.' }
  }
  if (input.commanderExplicitRollback !== true && !input.realOptRootOverride) {
    return { ok: false, error: 'installer.rollback_activation requires COMMANDER_EXPLICIT_ROLLBACK=true and the exact prior install id.' }
  }
  const activated = await installerActivate({
    installId: input.previousInstallId,
    commanderConfirmed: input.commanderConfirmed,
    commanderExplicitRollback: true,
    activationMode: 'MAINTENANCE_ROLLBACK',
    realOptRootOverride: input.realOptRootOverride,
    shimPathOverride: input.shimPathOverride,
  })
  if (!activated.ok) return { ok: false, error: `Rollback failed: ${activated.error}` }
  await logWarRoomRepoAudit('engineer: installer.rollback_activation', { restoredInstallId: input.previousInstallId })
  return { ok: true, restoredInstallId: input.previousInstallId, note: `Launcher restored to ${input.previousInstallId}.` }
}
