import { execFileSync } from 'node:child_process'
import { rename } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { collectDeployStatus } from '@/lib/deploy/status'
import { buildDeploymentIntegrityRollup } from './runtimeIntegrityMapper'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const repoRoot = path.resolve(process.cwd())
const buildMetaPath = path.join(repoRoot, '.next', 'build-meta.json')

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

const CI_ENV_KEYS = ['VERCEL_GIT_COMMIT_SHA', 'GITHUB_SHA', 'CF_PAGES_COMMIT_SHA'] as const

function snapshotCiEnv(): Record<string, string | undefined> {
  return Object.fromEntries(CI_ENV_KEYS.map(key => [key, process.env[key]]))
}

function restoreCiEnv(snapshot: Record<string, string | undefined>) {
  for (const key of CI_ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key]
    else process.env[key] = snapshot[key]
  }
}

function clearCiEnv() {
  for (const key of CI_ENV_KEYS) delete process.env[key]
}

/**
 * Covers the Phase 8C fix: `deployment.commitShort` (fed by
 * buildDeploymentIntegrityRollup) must come from the same collectDeployStatus()
 * result the canonical /api/deploy/status route returns, not a disconnected
 * self-fetch that loses its auth context. No git-resolution logic lives
 * here — these cases only check that the existing rollup mapper agrees with
 * the existing deploy-status collector.
 */
export async function runDeploymentIntegrityReconciliationValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const ciSnapshot = snapshotCiEnv()

  try {
    clearCiEnv()
    const expectedShort = git(['rev-parse', '--short', 'HEAD'])

    // Case 1: on a local NSSM-style build (no CI env), the rollup's
    // commitShort resolves to the local build's short SHA.
    const localStatus = await collectDeployStatus()
    const localRollup = buildDeploymentIntegrityRollup(localStatus)
    results.push(check(
      'runtime_integrity_01_local_build_commit_short_resolves',
      localRollup.commitShort === expectedShort,
      `commitShort=${localRollup.commitShort} expected=${expectedShort}`,
    ))

    // Case 2: CI/platform env still takes precedence over local build meta.
    process.env.VERCEL_GIT_COMMIT_SHA = 'deadbeef1234567890'
    const ciStatus = await collectDeployStatus()
    const ciRollup = buildDeploymentIntegrityRollup(ciStatus)
    results.push(check(
      'runtime_integrity_02_ci_env_precedence_still_wins',
      ciRollup.commitShort === 'deadbee',
      `commitShort=${ciRollup.commitShort} (expected CI-derived "deadbee")`,
    ))
    clearCiEnv()

    // Case 3: missing build metadata fails gracefully -- commitShort is
    // null, buildDeploymentIntegrityRollup does not throw.
    const tmpAsidePath = `${buildMetaPath}.validation-tmp`
    let missingCaseError: string | null = null
    let rollupWhenMissing: { commitShort: string | null } = { commitShort: 'not_run' }
    await rename(buildMetaPath, tmpAsidePath)
    try {
      const statusWhenMissing = await collectDeployStatus()
      rollupWhenMissing = buildDeploymentIntegrityRollup(statusWhenMissing)
    } catch (error) {
      missingCaseError = error instanceof Error ? error.message : String(error)
    } finally {
      await rename(tmpAsidePath, buildMetaPath)
    }
    results.push(check(
      'runtime_integrity_03_missing_metadata_graceful',
      rollupWhenMissing.commitShort === null && missingCaseError === null,
      `commitShort=${JSON.stringify(rollupWhenMissing.commitShort)} error=${missingCaseError}`,
    ))

    // Case 4: no secret/path fields introduced -- rollup keys unchanged
    // from its pre-existing 4-field shape, and no value looks like a
    // filesystem path or env-style secret.
    const rollupKeys = Object.keys(localRollup).sort()
    const expectedKeys = ['checkedAt', 'commitShort', 'lastDeployment', 'provider']
    const values = Object.values(localRollup).filter((v): v is string => typeof v === 'string')
    const leaksPath = values.some(v => /[\\/]Users[\\/]|[A-Za-z]:\\/.test(v))
    results.push(check(
      'runtime_integrity_04_no_secret_or_path_fields',
      JSON.stringify(rollupKeys) === JSON.stringify(expectedKeys) && !leaksPath,
      `keys=${JSON.stringify(rollupKeys)} leaksPath=${leaksPath}`,
    ))

    // Case 5: runtime-integrity's deployment rollup and collectDeployStatus()
    // agree on every field they share -- same source, not a competing one.
    const status = await collectDeployStatus()
    const rollup = buildDeploymentIntegrityRollup(status)
    const agrees =
      rollup.commitShort === status.gitCommitShort
      && rollup.lastDeployment === status.lastDeployment
      && rollup.provider === status.provider
      && rollup.checkedAt === status.checkedAt
    results.push(check(
      'runtime_integrity_05_agrees_with_deploy_status',
      agrees,
      `rollup=${JSON.stringify(rollup)} status.gitCommitShort=${status.gitCommitShort} status.lastDeployment=${status.lastDeployment} status.provider=${status.provider} status.checkedAt=${status.checkedAt}`,
    ))
  } finally {
    restoreCiEnv(ciSnapshot)
  }

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runDeploymentIntegrityReconciliationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Runtime-integrity deployment reconciliation validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
