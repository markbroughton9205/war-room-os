/**
 * package.run — turns a completed `pnpm run build` into real installable artifacts using the
 * repository's OWN existing packaging system (desktop/package.json's electron-builder config,
 * scripts/prepare-desktop-runtime.mjs). This never invents a second packaging mechanism.
 *
 * BUILD PASS and PACKAGE PASS are kept distinct: packageRun refuses to run against a stale or
 * missing build rather than silently rebuilding, so a caller can tell "the build never happened"
 * apart from "packaging itself failed".
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { runValidationOperationStreaming, terminalRepoStatus } from './validationRunner'
import { withBuildLock } from './buildLock'

export type PackageArtifact = { path: string; sizeBytes: number; sha256: string }

export type PackageRunResult =
  | {
    ok: true
    version: string
    gitSha: string
    gitShort: string
    gitDirty: boolean
    gitRef: string
    appimage: PackageArtifact
    deb: PackageArtifact
    /** electron-builder's unpacked, directly-runnable app tree (desktop/dist-release/linux-unpacked)
     * — this is what installer.install_production actually copies into `<installDir>/opt/War Room
     * OS/`; the AppImage/deb above are the distributable packages, kept for record, but are not
     * themselves what a launcher executes. */
    linuxUnpackedDir: string
    linuxUnpackedExecutable: string
    durationMs: number
    ranAt: string
  }
  | { ok: false; error: string; stage: 'build_precondition' | 'prepare_runtime' | 'package' | 'artifact_verification' | 'lock' }

async function sha256File(p: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(p))
  return hash.digest('hex')
}

async function readDesktopVersion(): Promise<string> {
  try {
    const raw = await readFile(path.join(resolveRepoRoot(), 'desktop', 'package.json'), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Find the most recently produced AppImage/deb under desktop/dist-release, regardless of the
 * exact version string embedded in the filename (electron-builder names them
 * `${productName}-${version}-${arch}.${ext}`). */
async function findArtifact(pattern: RegExp): Promise<{ path: string; mtimeMs: number } | null> {
  const dir = path.join(/* turbopackIgnore: true */ resolveRepoRoot(), 'desktop', 'dist-release')
  if (!existsSync(dir)) return null
  const entries = await readdir(dir)
  let best: { path: string; mtimeMs: number } | null = null
  for (const name of entries) {
    if (!pattern.test(name)) continue
    const full = path.join(dir, name)
    const info = await stat(full)
    if (!info.isFile()) continue
    if (!best || info.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: info.mtimeMs }
  }
  return best
}

export async function packageRun(input: { repairId: string }): Promise<PackageRunResult> {
  const startedAt = Date.now()
  const repoRoot = resolveRepoRoot()

  // BUILD precondition: package.run never triggers a build itself and never packages a build
  // whose source commit doesn't match the current checkout — that would silently ship stale UI.
  const buildIdPath = path.join(repoRoot, '.next', 'BUILD_ID')
  const buildMetaPath = path.join(repoRoot, '.next', 'build-meta.json')
  if (!existsSync(buildIdPath) || !existsSync(path.join(repoRoot, '.next', 'standalone'))) {
    return { ok: false, error: 'No completed build found (.next/BUILD_ID or .next/standalone missing). Run build.run first.', stage: 'build_precondition' }
  }
  const status = await terminalRepoStatus()
  const gitShort = status.lastCommitHash?.short ?? 'unknown'
  const gitSha = status.lastCommitHash?.full ?? 'unknown'
  const gitDirty = status.workingTreeStatus !== 'clean'
  const gitRef = status.currentBranch
  if (existsSync(buildMetaPath)) {
    try {
      const meta = JSON.parse(await readFile(buildMetaPath, 'utf8')) as { gitSha?: string }
      if (meta.gitSha && gitSha !== 'unknown' && meta.gitSha !== gitSha) {
        return { ok: false, error: `Build was produced from ${meta.gitSha}, but the working tree is now at ${gitSha}. Rerun build.run before packaging.`, stage: 'build_precondition' }
      }
    } catch {
      // build-meta.json is best-effort; absence/parse failure does not block packaging.
    }
  }

  // Same repo-scoped lock as build.run — prepare-desktop-runtime reads .next/ and rewrites
  // desktop/runtime/, and electron-builder writes desktop/dist-release/, both shared mutable
  // trees a concurrent build.run/package.run in another mission could otherwise race.
  const locked = await withBuildLock({ missionId: input.repairId, operation: 'package.run' }, async () => {
    const prepared = await runValidationOperationStreaming({ id: 'prepare_desktop_runtime' }, { repairId: input.repairId })
    if (!prepared.ok) {
      return { ok: false as const, error: `prepare-desktop-runtime failed (exit ${prepared.exitCode}): ${prepared.stderr.slice(0, 800) || prepared.stdout.slice(0, 800)}`, stage: 'prepare_runtime' as const }
    }
    const packaged = await runValidationOperationStreaming({ id: 'package_desktop_linux' }, { repairId: input.repairId })
    if (!packaged.ok) {
      return { ok: false as const, error: `electron-builder packaging failed (exit ${packaged.exitCode}): ${packaged.stderr.slice(0, 800) || packaged.stdout.slice(0, 800)}`, stage: 'package' as const }
    }
    return { ok: true as const }
  })
  if (!locked.ok) {
    return { ok: false, error: `Build/package lock is ${locked.lockState}: another operation (${locked.holder?.operation ?? 'unknown'}, mission ${locked.holder?.missionId ?? 'unknown'}) is already mutating shared build output.`, stage: 'lock' }
  }
  if (!locked.value.ok) {
    return { ok: false, error: locked.value.error, stage: locked.value.stage }
  }

  const appimageHit = await findArtifact(/\.AppImage$/i)
  const debHit = await findArtifact(/\.deb$/i)
  if (!appimageHit || !debHit) {
    return { ok: false, error: `Packaging reported success but expected artifacts are missing under desktop/dist-release (appimage=${Boolean(appimageHit)}, deb=${Boolean(debHit)}).`, stage: 'artifact_verification' }
  }
  const [appimageStat, debStat] = await Promise.all([stat(appimageHit.path), stat(debHit.path)])
  if (appimageStat.size < 1_000_000 || debStat.size < 1_000_000) {
    return { ok: false, error: `Produced artifact is implausibly small (appimage=${appimageStat.size}B, deb=${debStat.size}B) — treating as incomplete rather than trusting a bare exit code.`, stage: 'artifact_verification' }
  }

  const linuxUnpackedDir = path.join(resolveRepoRoot(), 'desktop', 'dist-release', 'linux-unpacked')
  const linuxUnpackedExecutable = path.join(linuxUnpackedDir, 'war-room-os')
  if (!existsSync(linuxUnpackedExecutable)) {
    return { ok: false, error: `electron-builder's unpacked app tree is missing its executable: ${linuxUnpackedExecutable}`, stage: 'artifact_verification' }
  }

  const [appimageSha, debSha] = await Promise.all([sha256File(appimageHit.path), sha256File(debHit.path)])
  const version = await readDesktopVersion()
  const result: PackageRunResult = {
    ok: true,
    version,
    gitSha,
    gitShort,
    gitDirty,
    gitRef,
    appimage: { path: appimageHit.path, sizeBytes: appimageStat.size, sha256: appimageSha },
    deb: { path: debHit.path, sizeBytes: debStat.size, sha256: debSha },
    linuxUnpackedDir,
    linuxUnpackedExecutable,
    durationMs: Date.now() - startedAt,
    ranAt: new Date().toISOString(),
  }
  await logWarRoomRepoAudit('engineer: package.run', { ok: true, version, gitShort, appimage: result.appimage, deb: result.deb, linuxUnpackedDir })
  return result
}
