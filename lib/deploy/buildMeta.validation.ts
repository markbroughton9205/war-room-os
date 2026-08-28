import { execFileSync } from 'node:child_process'
import { rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { collectDeployStatus, readLocalBuildMeta, resolveGitCommitShortFromEnv } from './status'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const repoRoot = path.resolve(process.cwd())
const buildMetaPath = path.join(repoRoot, '.next', 'build-meta.json')

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function gitSymbolicRefOrNull(): string | null {
  try {
    return git(['symbolic-ref', '-q', '--short', 'HEAD']) || null
  } catch {
    return null
  }
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

export async function runBuildMetaValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const ciSnapshot = snapshotCiEnv()

  try {
    // Case 1: the writer script (already run by `postbuild`) produced valid,
    // well-shaped JSON at the expected, gitignored location.
    let fileExists = false
    try {
      fileExists = (await stat(buildMetaPath)).isFile()
    } catch {
      fileExists = false
    }
    results.push(check(
      'build_meta_01_file_exists_and_is_valid_json',
      fileExists,
      fileExists ? `found ${path.relative(repoRoot, buildMetaPath)}` : `missing — run "pnpm run build" (or "node scripts/write-build-meta.mjs" directly) first`,
    ))

    clearCiEnv()
    const meta = await readLocalBuildMeta()
    const expectedSha = git(['rev-parse', 'HEAD'])
    const expectedShort = git(['rev-parse', '--short', 'HEAD'])
    const expectedDirty = git(['status', '--porcelain']).length > 0
    const expectedRef = gitSymbolicRefOrNull()

    // Case 2: gitSha matches current HEAD.
    results.push(check(
      'build_meta_02_git_sha_matches_head',
      meta?.gitSha === expectedSha,
      `meta.gitSha=${meta?.gitSha} expected=${expectedSha}`,
    ))

    // Case 3: gitShort matches current short SHA.
    results.push(check(
      'build_meta_03_git_short_matches_head',
      meta?.gitShort === expectedShort,
      `meta.gitShort=${meta?.gitShort} expected=${expectedShort}`,
    ))

    // Case 4: gitDirty reflects the actual working tree state at build time.
    // Node02 carries intentional uncommitted changes, so this is expected
    // true — the point is that it tracks reality, not that it is always true.
    results.push(check(
      'build_meta_04_git_dirty_reflects_working_tree',
      meta?.gitDirty === expectedDirty,
      `meta.gitDirty=${meta?.gitDirty} expected=${expectedDirty}`,
    ))

    // Case 5: detached HEAD handled correctly. This repo is genuinely
    // detached right now (Node02's documented state), so `git symbolic-ref`
    // itself fails and the generated meta must carry gitRef=null, not throw
    // and not fabricate a branch name.
    results.push(check(
      'build_meta_05_detached_head_yields_null_ref',
      meta?.gitRef === expectedRef,
      `meta.gitRef=${JSON.stringify(meta?.gitRef)} expected=${JSON.stringify(expectedRef)} (repo is detached: ${expectedRef === null})`,
    ))

    // Case 6: the existing deploy-status plumbing reads the generated
    // metadata end-to-end (collectDeployStatus -> localBuild).
    const status = await collectDeployStatus()
    results.push(check(
      'build_meta_06_deploy_status_exposes_local_build',
      status.localBuild?.gitSha === expectedSha && status.localBuild?.gitShort === expectedShort,
      `status.localBuild=${JSON.stringify(status.localBuild)}`,
    ))

    // Case 7: CI env SHA still takes precedence over local build metadata
    // when present (existing behavior must not regress).
    process.env.VERCEL_GIT_COMMIT_SHA = 'deadbeef1234567890'
    const statusWithCi = await collectDeployStatus()
    results.push(check(
      'build_meta_07_ci_env_sha_takes_precedence',
      statusWithCi.gitCommitShort === 'deadbee' && resolveGitCommitShortFromEnv() === 'deadbee',
      `gitCommitShort=${statusWithCi.gitCommitShort} (expected CI-derived "deadbee", not local build meta)`,
    ))
    clearCiEnv()
    const statusWithoutCi = await collectDeployStatus()
    results.push(check(
      'build_meta_07b_falls_back_to_local_build_without_ci_env',
      statusWithoutCi.gitCommitShort === expectedShort,
      `gitCommitShort=${statusWithoutCi.gitCommitShort} expected=${expectedShort}`,
    ))

    // Case 8: missing metadata fails gracefully (null, not a throw), and the
    // real file is restored immediately after in a finally block.
    let missingCaseError: string | null = null
    let metaWhenMissing: unknown = 'not_run'
    const tmpAsidePath = `${buildMetaPath}.validation-tmp`
    await rename(buildMetaPath, tmpAsidePath)
    try {
      metaWhenMissing = await readLocalBuildMeta()
    } catch (error) {
      missingCaseError = error instanceof Error ? error.message : String(error)
    } finally {
      await rename(tmpAsidePath, buildMetaPath)
    }
    results.push(check(
      'build_meta_08_missing_file_returns_null_not_throw',
      metaWhenMissing === null && missingCaseError === null,
      `result=${JSON.stringify(metaWhenMissing)} error=${missingCaseError}`,
    ))

    // Case 9: no filesystem path, secret, username, or env value leaked into
    // the generated file's own content (structural — only the 5 documented
    // keys are present).
    const rawKeys = meta ? Object.keys(meta).sort() : []
    const expectedKeys = ['builtAt', 'gitDirty', 'gitRef', 'gitSha', 'gitShort']
    results.push(check(
      'build_meta_09_no_extra_fields_in_generated_file',
      JSON.stringify(rawKeys) === JSON.stringify(expectedKeys),
      `keys=${JSON.stringify(rawKeys)}`,
    ))
  } finally {
    restoreCiEnv(ciSnapshot)
  }

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runBuildMetaValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Build metadata validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
