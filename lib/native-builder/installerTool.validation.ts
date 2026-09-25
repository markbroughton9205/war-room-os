/**
 * installer.install validation. Everything here runs against a throwaway tmp/ override — never
 * the real ~/.local/opt install root — except the one test that confirms the real root is denied.
 */
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { classifyProductionInstallTarget } from './commandPolicy'
import {
  installerActivate,
  installerActiveStatus,
  installerInstall,
  installerInstallProduction,
  installerRollbackActivation,
  installerRollbackTarget,
  installerStatus,
  realInstallOptRoot,
} from './installerTool'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function withFixtureArtifact<T>(fn: (artifactPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'foundry-installer-src-'))
  const artifactPath = path.join(dir, 'War Room OS-0.0.0-test.AppImage')
  await writeFile(artifactPath, 'fixture-not-a-real-binary')
  try {
    return await fn(artifactPath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function realRootDeniedTests(): Promise<CaseResult[]> {
  return withFixtureArtifact(async artifactPath => {
    const deniedEvenConfirmed = await installerInstall({
      sourceArtifactPath: artifactPath,
      installRootOverride: realInstallOptRoot(),
      feature: 'should-never-install',
      commanderConfirmed: true,
    })
    return [check('real_root_01_denied_even_with_confirmation', !deniedEvenConfirmed.ok, JSON.stringify(deniedEvenConfirmed))]
  })
}

async function tmpOverrideTests(): Promise<CaseResult[]> {
  return withFixtureArtifact(async artifactPath => {
    const installRoot = path.join(resolveRepoRoot(), 'tmp', `foundry-installer-test-${randomUUID()}`)
    await mkdir(installRoot, { recursive: true })
    try {
      const unconfirmed = await installerInstall({ sourceArtifactPath: artifactPath, installRootOverride: installRoot, feature: 'proof-run' })
      const confirmed = await installerInstall({ sourceArtifactPath: artifactPath, installRootOverride: installRoot, feature: 'proof-run', commanderConfirmed: true })
      if (!confirmed.ok) return [check('tmp_02_confirmed_install_succeeds', false, confirmed.error)]
      const stampShapeOk =
        typeof confirmed.stamp.install_id === 'string' &&
        Array.isArray(confirmed.stamp.rollback_installs) &&
        typeof confirmed.stamp.system_opt_untouched === 'string' &&
        typeof confirmed.stamp.user_config_preserved === 'string'
      const insideOverride = confirmed.installDir.startsWith(installRoot)

      const second = await installerInstall({ sourceArtifactPath: artifactPath, installRootOverride: installRoot, feature: 'second-run', commanderConfirmed: true })
      const rollbackPreserved = second.ok && second.stamp.rollback_installs.includes(confirmed.installDir)

      return [
        check('tmp_01_unconfirmed_install_rejected', !unconfirmed.ok, JSON.stringify(unconfirmed)),
        check('tmp_02_confirmed_install_succeeds', confirmed.ok, JSON.stringify(confirmed.ok ? confirmed.installDir : confirmed)),
        check('tmp_03_install_stamp_shape', stampShapeOk, JSON.stringify(confirmed.stamp)),
        check('tmp_04_install_stays_inside_override', insideOverride, confirmed.installDir),
        check('tmp_05_rollback_preserves_prior_install', rollbackPreserved, JSON.stringify(second.ok ? second.stamp.rollback_installs : second)),
      ]
    } finally {
      await rm(installRoot, { recursive: true, force: true })
    }
  })
}

async function missingArtifactTests(): Promise<CaseResult[]> {
  const installRoot = path.join(resolveRepoRoot(), 'tmp', `foundry-installer-missing-${randomUUID()}`)
  const result = await installerInstall({
    sourceArtifactPath: path.join(tmpdir(), `does-not-exist-${randomUUID()}.AppImage`),
    installRootOverride: installRoot,
    feature: 'missing-artifact',
    commanderConfirmed: true,
  })
  return [check('missing_01_nonexistent_artifact_rejected', !result.ok, JSON.stringify(result))]
}

async function sha256File(p: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(p))
  return hash.digest('hex')
}

function productionPolicyTests(): CaseResult[] {
  const realRoot = '/home/fixture-user/.local/opt'
  const bareRoot = classifyProductionInstallTarget(realRoot, realRoot)
  const outsideRoot = classifyProductionInstallTarget('/home/fixture-user/somewhere-else', realRoot)
  const validSubdir = classifyProductionInstallTarget(path.join(realRoot, 'war-room-os-1.0.0-abc123-feature'), realRoot)
  return [
    check('prod_policy_01_bare_root_denied', bareRoot.policyClass === 'DENIED', JSON.stringify(bareRoot)),
    check('prod_policy_02_outside_root_denied', outsideRoot.policyClass === 'DENIED', JSON.stringify(outsideRoot)),
    check('prod_policy_03_named_subdir_requires_approval_never_safe_local', validSubdir.policyClass === 'REQUIRES_APPROVAL', JSON.stringify(validSubdir)),
  ]
}

/** Full DISCOVER -> PREPARE -> INSTALL -> VERIFY round trip against an isolated fake "real root"
 * (realOptRootOverride, test-only) — never the actual shared ~/.local/opt. Uses the REAL, current
 * desktop/dist-release artifacts (read-only hash) rather than writing fixture files into that
 * directory, so this never risks interfering with a concurrent packaging run. */
async function productionInstallRoundTripTests(): Promise<CaseResult[]> {
  const distRelease = path.join(resolveRepoRoot(), 'desktop', 'dist-release')
  const appimagePath = path.join(distRelease, 'War Room OS-0.2.0-x86_64.AppImage')
  const debPath = path.join(distRelease, 'War Room OS-0.2.0-amd64.deb')
  const linuxUnpackedDir = path.join(distRelease, 'linux-unpacked')
  if (!existsSync(appimagePath) || !existsSync(debPath) || !existsSync(path.join(linuxUnpackedDir, 'war-room-os'))) {
    return [check('prod_roundtrip_00_skipped_no_prior_artifacts', true, 'No existing desktop/dist-release artifacts on this machine — covered instead by the PASS 002/003 real package.run proof.')]
  }
  const fakeRoot = path.join(resolveRepoRoot(), 'tmp', `foundry-production-install-test-${randomUUID()}`)
  await mkdir(fakeRoot, { recursive: true })
  try {
    const [appimageSha, debSha] = await Promise.all([sha256File(appimagePath), sha256File(debPath)])

    const pathInjection = await installerInstallProduction({
      appimage: { path: path.join(tmpdir(), 'not-really-dist-release.AppImage'), sha256: appimageSha },
      deb: { path: debPath, sha256: debSha },
      linuxUnpackedDir,
      feature: 'path-injection-attempt',
      commanderConfirmed: true,
      realOptRootOverride: fakeRoot,
    })

    const hashMismatch = await installerInstallProduction({
      appimage: { path: appimagePath, sha256: '0'.repeat(64) },
      deb: { path: debPath, sha256: debSha },
      linuxUnpackedDir,
      feature: 'hash-mismatch-attempt',
      commanderConfirmed: true,
      realOptRootOverride: fakeRoot,
    })

    const unpackedInjection = await installerInstallProduction({
      appimage: { path: appimagePath, sha256: appimageSha },
      deb: { path: debPath, sha256: debSha },
      linuxUnpackedDir: tmpdir(),
      feature: 'unpacked-injection-attempt',
      commanderConfirmed: true,
      realOptRootOverride: fakeRoot,
    })

    const unconfirmed = await installerInstallProduction({
      appimage: { path: appimagePath, sha256: appimageSha },
      deb: { path: debPath, sha256: debSha },
      linuxUnpackedDir,
      feature: 'unconfirmed-attempt',
      realOptRootOverride: fakeRoot,
    })

    const confirmed = await installerInstallProduction({
      appimage: { path: appimagePath, sha256: appimageSha },
      deb: { path: debPath, sha256: debSha },
      linuxUnpackedDir,
      feature: 'production-proof',
      commanderConfirmed: true,
      realOptRootOverride: fakeRoot,
    })
    if (!confirmed.ok) return [check('prod_roundtrip_04_confirmed_install_succeeds', false, confirmed.error)]

    const verifiedFiles =
      existsSync(path.join(confirmed.installDir, path.basename(appimagePath))) &&
      existsSync(path.join(confirmed.installDir, path.basename(debPath))) &&
      existsSync(path.join(confirmed.installDir, 'INSTALL_STAMP.json')) &&
      existsSync(confirmed.stamp.executable ?? '')
    const neverTouchedRealRoot = !confirmed.installDir.startsWith(realInstallOptRoot())

    const duplicate = await installerInstallProduction({
      appimage: { path: appimagePath, sha256: appimageSha },
      deb: { path: debPath, sha256: debSha },
      linuxUnpackedDir,
      feature: 'production-proof',
      commanderConfirmed: true,
      realOptRootOverride: fakeRoot,
    })

    return [
      check('prod_roundtrip_01_path_injection_rejected', !pathInjection.ok && pathInjection.stage === 'prepare', JSON.stringify(pathInjection)),
      check('prod_roundtrip_02_hash_mismatch_rejected', !hashMismatch.ok && hashMismatch.stage === 'prepare', JSON.stringify(hashMismatch)),
      check('prod_roundtrip_02b_unpacked_dir_injection_rejected', !unpackedInjection.ok && unpackedInjection.stage === 'prepare', JSON.stringify(unpackedInjection)),
      check('prod_roundtrip_03_unconfirmed_rejected', !unconfirmed.ok && unconfirmed.stage === 'policy', JSON.stringify(unconfirmed)),
      check('prod_roundtrip_04_confirmed_install_succeeds', confirmed.ok, JSON.stringify({ installDir: confirmed.installDir })),
      check('prod_roundtrip_05_both_artifacts_and_stamp_and_executable_verified_on_disk', verifiedFiles, confirmed.installDir),
      check('prod_roundtrip_06_never_touches_actual_shared_opt_root', neverTouchedRealRoot, `${confirmed.installDir} vs real root ${realInstallOptRoot()}`),
      check('prod_roundtrip_07_never_overwrites_same_install_id', !duplicate.ok && /already exists/i.test(duplicate.error ?? ''), JSON.stringify(duplicate)),
    ]
  } finally {
    await rm(fakeRoot, { recursive: true, force: true })
  }
}

async function rollbackTargetTests(): Promise<CaseResult[]> {
  const status = await installerStatus()
  const notFound = await installerRollbackTarget(`does-not-exist-${randomUUID()}`)
  if (!status.installs.length) {
    return [check('rollback_01_unknown_install_rejected', !notFound.ok, JSON.stringify(notFound))]
  }
  const existing = status.installs.find(i => i.stamp)
  if (!existing?.stamp) return [check('rollback_01_unknown_install_rejected', !notFound.ok, JSON.stringify(notFound))]
  const found = await installerRollbackTarget(existing.stamp.install_id)
  return [
    check('rollback_01_unknown_install_rejected', !notFound.ok, JSON.stringify(notFound)),
    check('rollback_02_known_install_read_only_lookup_succeeds', found.ok && found.target.installId === existing.stamp.install_id, JSON.stringify(found)),
  ]
}

/** PASS 003 Step 11 — activation logic proven entirely against an isolated fake install root and
 * a fake shim path (never the real ~/.local/bin/war-room-os-user) before it is ever exercised for
 * real. */
async function activationSafetyTests(): Promise<CaseResult[]> {
  const fakeRoot = path.join(resolveRepoRoot(), 'tmp', `foundry-activation-test-${randomUUID()}`)
  const fakeShimDir = path.join(resolveRepoRoot(), 'tmp', `foundry-activation-shim-${randomUUID()}`)
  const shimPath = path.join(fakeShimDir, 'war-room-os-user')
  await mkdir(fakeRoot, { recursive: true })
  await mkdir(fakeShimDir, { recursive: true })

  async function makeFakeInstall(installId: string, opts: { withStamp?: boolean; withExecutable?: boolean; stampInstallId?: string } = {}): Promise<void> {
    const { withStamp = true, withExecutable = true, stampInstallId = installId } = opts
    const dir = path.join(fakeRoot, installId)
    const appDir = path.join(dir, 'opt', 'War Room OS')
    await mkdir(appDir, { recursive: true })
    if (withExecutable) await writeFile(path.join(appDir, 'war-room-os'), '#!/bin/sh\necho fake\n', { mode: 0o755 })
    if (withStamp) {
      await writeFile(
        path.join(dir, 'INSTALL_STAMP.json'),
        JSON.stringify({ install_id: stampInstallId, feature: 'test', gitSha: 'x', gitShort: 'x', gitDirty: false, gitRef: 'x', builtAt: 'x', preparedAt: 'x', appimage: null, deb: null, executable: path.join(appDir, 'war-room-os'), rollback_installs: [], system_opt_untouched: '/opt/War Room OS', user_config_preserved: '/x' }, null, 2),
        'utf8',
      )
    }
  }

  try {
    await makeFakeInstall('war-room-os-1.0.0-aaa-install-one')
    await makeFakeInstall('war-room-os-1.0.0-aaa-install-two')
    await makeFakeInstall('war-room-os-1.0.0-aaa-no-stamp', { withStamp: false })
    await makeFakeInstall('war-room-os-1.0.0-aaa-no-exe', { withExecutable: false })
    await makeFakeInstall('war-room-os-1.0.0-aaa-mismatched-identity', { stampInstallId: 'some-other-id' })

    const statusBefore = await installerActiveStatus({ realOptRootOverride: fakeRoot, shimPathOverride: shimPath })

    const nonexistent = await installerActivate({ installId: `does-not-exist-${randomUUID()}`, commanderConfirmed: true, realOptRootOverride: fakeRoot, shimPathOverride: shimPath })
    const pathEscape = await installerActivate({ installId: '../../../etc', commanderConfirmed: true, realOptRootOverride: fakeRoot, shimPathOverride: shimPath })
    const noStamp = await installerActivate({ installId: 'war-room-os-1.0.0-aaa-no-stamp', commanderConfirmed: true, realOptRootOverride: fakeRoot, shimPathOverride: shimPath })
    const noExe = await installerActivate({ installId: 'war-room-os-1.0.0-aaa-no-exe', commanderConfirmed: true, realOptRootOverride: fakeRoot, shimPathOverride: shimPath })
    const mismatched = await installerActivate({ installId: 'war-room-os-1.0.0-aaa-mismatched-identity', commanderConfirmed: true, realOptRootOverride: fakeRoot, shimPathOverride: shimPath })
    const unconfirmed = await installerActivate({ installId: 'war-room-os-1.0.0-aaa-install-one', realOptRootOverride: fakeRoot, shimPathOverride: shimPath })

    const first = await installerActivate({ installId: 'war-room-os-1.0.0-aaa-install-one', commanderConfirmed: true, realOptRootOverride: fakeRoot, shimPathOverride: shimPath })
    if (!first.ok) return [check('activate_04_valid_activation_succeeds', false, first.error)]
    const statusAfterFirst = await installerActiveStatus({ realOptRootOverride: fakeRoot, shimPathOverride: shimPath })

    const second = await installerActivate({ installId: 'war-room-os-1.0.0-aaa-install-two', commanderConfirmed: true, realOptRootOverride: fakeRoot, shimPathOverride: shimPath })
    if (!second.ok) return [check('activate_06_switch_to_second_install_succeeds', false, second.error)]
    const statusAfterSecond = await installerActiveStatus({ realOptRootOverride: fakeRoot, shimPathOverride: shimPath })

    const noTmpFileLeftBehind = !(await readdirSafe(fakeShimDir)).some(name => name.includes('.tmp-'))

    const rolledBack = await installerRollbackActivation({ previousInstallId: second.previousActiveInstallId, commanderConfirmed: true, realOptRootOverride: fakeRoot, shimPathOverride: shimPath })
    const statusAfterRollback = await installerActiveStatus({ realOptRootOverride: fakeRoot, shimPathOverride: shimPath })

    return [
      check('activate_01_nonexistent_install_rejected', !nonexistent.ok && nonexistent.stage === 'validate', JSON.stringify(nonexistent)),
      check('activate_02_path_escape_rejected', !pathEscape.ok, JSON.stringify(pathEscape)),
      check('activate_02b_missing_stamp_rejected', !noStamp.ok && noStamp.stage === 'validate', JSON.stringify(noStamp)),
      check('activate_02c_missing_executable_rejected', !noExe.ok && noExe.stage === 'validate', JSON.stringify(noExe)),
      check('activate_02d_mismatched_stamp_identity_rejected', !mismatched.ok && mismatched.stage === 'validate', JSON.stringify(mismatched)),
      check('activate_03_unconfirmed_rejected', !unconfirmed.ok && unconfirmed.stage === 'policy', JSON.stringify(unconfirmed)),
      check('activate_04_valid_activation_succeeds', first.ok, JSON.stringify(first)),
      check('activate_04b_no_prior_active_before_first_activation', statusBefore.activeInstallId === null, JSON.stringify(statusBefore)),
      check('activate_05_active_status_identifies_exact_target', statusAfterFirst.valid && statusAfterFirst.activeInstallId === 'war-room-os-1.0.0-aaa-install-one', JSON.stringify(statusAfterFirst)),
      check('activate_06_switch_to_second_install_succeeds', second.ok && second.previousActiveInstallId === 'war-room-os-1.0.0-aaa-install-one', JSON.stringify(second)),
      check('activate_07_active_status_reflects_switch', statusAfterSecond.activeInstallId === 'war-room-os-1.0.0-aaa-install-two', JSON.stringify(statusAfterSecond)),
      check('activate_08_atomic_write_leaves_no_tmp_file', noTmpFileLeftBehind, JSON.stringify(await readdirSafe(fakeShimDir))),
      check('activate_09_rollback_restores_previous_target', rolledBack.ok && statusAfterRollback.activeInstallId === 'war-room-os-1.0.0-aaa-install-one', JSON.stringify({ rolledBack, activeNow: statusAfterRollback.activeInstallId })),
    ]
  } finally {
    await rm(fakeRoot, { recursive: true, force: true })
    await rm(fakeShimDir, { recursive: true, force: true })
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await realRootDeniedTests())
  add(await tmpOverrideTests())
  add(await missingArtifactTests())
  add(productionPolicyTests())
  add(await productionInstallRoundTripTests())
  add(await rollbackTargetTests())
  add(await activationSafetyTests())
  const failed = results.filter(r => !r.pass)
  console.log(`installerTool validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runInstallerToolValidation }
