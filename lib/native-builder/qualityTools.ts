/**
 * build.run / test.run / lint.run / typecheck.run — typed, structured wrappers over the
 * existing hardened validationRunner engine (resolveOperationArgv already enforces fixed argv
 * arrays, repo-containment, timeouts, and secret redaction). Nothing here spawns a raw shell
 * string; every path resolves to a pre-defined argv the same way validation.run already does.
 *
 * These are DISTINCT tools from generic validation.run so the Foundry coding agent can reason
 * about SOURCE vs TEST vs BUILD as separate mission stages (PASS 002 requirement), rather than
 * having to remember an internal operation id. Each result also reports whether it succeeded
 * against the pre-existing 122-error TypeScript baseline (see CLAUDE.md) so the agent can tell a
 * genuine regression from known baseline debt without silently treating either as "clean."
 */
import { access, readFile } from 'node:fs/promises'
import { constants as FsConstants } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { runValidationOperationStreaming } from './validationRunner'
import { withBuildLock, type BuildLockPayload } from './buildLock'
import type { NativeValidationResult } from './types'

export type QualityToolResult = {
  ok: boolean
  exitCode: number | null
  durationMs: number
  ranAt: string
  timedOut: boolean
  stdout: string
  stderr: string
}

function toQualityResult(r: NativeValidationResult): QualityToolResult {
  return { ok: r.ok, exitCode: r.exitCode, durationMs: r.durationMs, ranAt: r.ranAt, timedOut: r.timedOut === true, stdout: r.stdout, stderr: r.stderr }
}

// ---------------------------------------------------------------------------
// typecheck.run
// ---------------------------------------------------------------------------

export type TypecheckRunInput = { repairId: string; scopeGlob?: string }

export type TypecheckRunResult = QualityToolResult & {
  totalErrorCount: number
  scopedErrorCount: number | null
  scopedErrors: string[]
  baselineNote: string
}

const TS_ERROR_LINE = /^(\S+\.tsx?)\(\d+,\d+\): error TS\d+:/

/** Whole-repo `tsc --noEmit` (TypeScript has no cheap single-file mode that respects project
 * config). When scopeGlob is given, partitions the raw error lines so a caller can tell "my
 * change introduced N new errors under lib/native-builder/" from "there are M pre-existing
 * baseline errors elsewhere" — see CLAUDE.md: 122 known baseline errors outside Foundry scope. */
export async function typecheckRun(input: TypecheckRunInput): Promise<TypecheckRunResult> {
  const result = await runValidationOperationStreaming({ id: 'typecheck' }, { repairId: input.repairId })
  const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter(l => TS_ERROR_LINE.test(l))
  const scopedErrors = input.scopeGlob ? lines.filter(l => l.replace(/\\/g, '/').startsWith(input.scopeGlob!.replace(/\\/g, '/'))) : []
  await logWarRoomRepoAudit('engineer: typecheck.run', { ok: result.ok, exitCode: result.exitCode, totalErrorCount: lines.length, scopeGlob: input.scopeGlob ?? null, scopedErrorCount: input.scopeGlob ? scopedErrors.length : null })
  return {
    ...toQualityResult(result),
    totalErrorCount: lines.length,
    scopedErrorCount: input.scopeGlob ? scopedErrors.length : null,
    scopedErrors,
    baselineNote: lines.length > 0
      ? `${lines.length} TypeScript error(s) repo-wide. See CLAUDE.md / Foundry PASS 001 report for the known baseline before treating any of these as a new regression.`
      : 'Repo-wide tsc --noEmit is clean.',
  }
}

// ---------------------------------------------------------------------------
// lint.run
// ---------------------------------------------------------------------------

export type LintRunInput = { repairId: string; targets?: string[] }

/** Defaults to whole-project ('.') when no targets are given; pass targets for a file / package /
 * subsystem scope (e.g. ['lib/native-builder']). eslint's own ignore rules still apply. A target
 * that escapes the repo root is reported as an ordinary failure, not thrown — this function is a
 * direct callable, not only reachable through executeEngineerTool's boundary-violation catch. */
export async function lintRun(input: LintRunInput): Promise<QualityToolResult> {
  const targets = input.targets?.length ? input.targets : ['.']
  try {
    const result = await runValidationOperationStreaming({ id: 'eslint_targeted', targets }, { repairId: input.repairId })
    await logWarRoomRepoAudit('engineer: lint.run', { ok: result.ok, exitCode: result.exitCode, targets })
    return toQualityResult(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logWarRoomRepoAudit('engineer: lint.run', { ok: false, exitCode: null, targets, error: message })
    return { ok: false, exitCode: null, durationMs: 0, ranAt: new Date().toISOString(), timedOut: false, stdout: '', stderr: message }
  }
}

// ---------------------------------------------------------------------------
// build.run
// ---------------------------------------------------------------------------

export type BuildRunResult = QualityToolResult & {
  artifacts: { buildId: string | null; standaloneReady: boolean; staticReady: boolean; buildMetaPath: string | null }
  lockState: 'ACQUIRED' | 'STALE_RECOVERED' | 'BUSY' | 'TIMEOUT'
}

function busyBuildResult(lockState: 'BUSY' | 'TIMEOUT', holder: BuildLockPayload | null): BuildRunResult {
  return {
    ok: false,
    exitCode: null,
    durationMs: 0,
    ranAt: new Date().toISOString(),
    timedOut: false,
    stdout: '',
    stderr: `Build/package lock is ${lockState}: another operation (${holder?.operation ?? 'unknown'}, mission ${holder?.missionId ?? 'unknown'}, pid ${holder?.pid ?? 'unknown'}) is already mutating the shared build output.`,
    artifacts: { buildId: null, standaloneReady: false, staticReady: false, buildMetaPath: null },
    lockState,
  }
}

/** `pnpm run build` (next build, output: standalone) + its postbuild write-build-meta.mjs hook.
 * Reports whether the expected build artifacts actually landed on disk — a zero exit code alone
 * is not proof of a usable build (mission requirement: "reject incomplete artifacts"). Guarded by
 * the repo-scoped build/package lock (buildLock.ts) — two concurrent build.run calls against the
 * same checkout can no longer corrupt each other's .next/ output. */
export async function buildRun(input: { repairId: string; lockWaitMs?: number }): Promise<BuildRunResult> {
  const locked = await withBuildLock({ missionId: input.repairId, operation: 'build.run', waitMs: input.lockWaitMs ?? 0 }, async () => {
    const result = await runValidationOperationStreaming({ id: 'build' }, { repairId: input.repairId })
    const repoRoot = resolveRepoRoot()
    const buildIdPath = path.join(repoRoot, '.next', 'BUILD_ID')
    const standalonePath = path.join(repoRoot, '.next', 'standalone')
    const staticPath = path.join(repoRoot, '.next', 'static')
    const buildMetaPath = path.join(repoRoot, '.next', 'build-meta.json')
    let buildId: string | null = null
    try {
      buildId = (await readFile(buildIdPath, 'utf8')).trim()
    } catch {
      buildId = null
    }
    const artifacts = {
      buildId,
      standaloneReady: existsSync(standalonePath),
      staticReady: existsSync(staticPath),
      buildMetaPath: existsSync(buildMetaPath) ? buildMetaPath : null,
    }
    const artifactsComplete = artifacts.standaloneReady && artifacts.staticReady && buildId !== null
    return { result, artifacts, ok: result.ok && artifactsComplete }
  })
  if (!locked.ok) {
    await logWarRoomRepoAudit('engineer: build.run', { ok: false, lockState: locked.lockState, holder: locked.holder })
    return busyBuildResult(locked.lockState, locked.holder)
  }
  const { result, artifacts, ok } = locked.value
  await logWarRoomRepoAudit('engineer: build.run', { ok, exitCode: result.exitCode, artifacts, lockState: locked.lockState })
  return { ...toQualityResult(result), ok, artifacts, lockState: locked.lockState }
}

// ---------------------------------------------------------------------------
// test.run
// ---------------------------------------------------------------------------

export type TestRunInput = { repairId: string; suite: string }

/** This repo has no Jest/Vitest (CLAUDE.md) — the project's real "test" convention is one of its
 * many package.json "validate:<subsystem>" scripts. test.run only accepts that prefix, and never
 * a ":live" suite (those call real external services), so it can never be pointed at an arbitrary
 * or costly script. Callers must name a specific suite; there is no whole-repo "run everything." */
export async function testRun(input: TestRunInput): Promise<QualityToolResult & { suite: string }> {
  const result = await runValidationOperationStreaming({ id: 'validate_suite', targets: [input.suite] }, { repairId: input.repairId })
  await logWarRoomRepoAudit('engineer: test.run', { ok: result.ok, exitCode: result.exitCode, suite: input.suite })
  return { ...toQualityResult(result), suite: input.suite }
}

/** Read-only: list every "validate:*" suite test.run is allowed to run, so the agent can pick a
 * real, existing scope instead of guessing a name. */
export async function listTestSuites(): Promise<string[]> {
  try {
    await access(path.join(resolveRepoRoot(), 'package.json'), FsConstants.F_OK)
    const pkg = JSON.parse(await readFile(path.join(resolveRepoRoot(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    return Object.keys(pkg.scripts ?? {}).filter(name => name.startsWith('validate:') && !name.endsWith(':live')).sort()
  } catch {
    return []
  }
}
