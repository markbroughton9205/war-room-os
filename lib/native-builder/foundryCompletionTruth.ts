/**
 * Foundry completion metrics must come from workspace/execution evidence.
 * Validation operation "ok" is not a test count. Empty git diff is not +0/-0 when
 * untracked product files exist.
 */
import { parseNodeTestCounts } from './foundryCommanderState'
import type { NativeValidationResult } from './types'

export const NODE_TEST_COMMAND = 'node --test'

export type FoundryWorkspaceSurface = 'war_room_source' | 'generated_project'

export type FoundryTestTruth = {
  ran: boolean
  command: string
  pass: number
  fail: number
  total: number
  operationsOk: number
  operationsTotal: number
  ok: boolean
  reason: string
}

export type FoundryCompletionTruth = {
  surface: FoundryWorkspaceSurface
  created: string[]
  modified: string[]
  metadataFiles: string[]
  plus: number
  minus: number
  tests: FoundryTestTruth
  runtimeProbes: { id: string; ok: boolean; detail: string }[]
  canComplete: boolean
  installedRuntimeUpdated: false
  headline: string
  detail: string
  installedSha?: string | null
  sourceHead?: string | null
  sourceDirty?: boolean
}

const METADATA_RE = /(^|\/)\.war-room(\/|$)/i

export function isFoundryMetadataPath(rel: string): boolean {
  return METADATA_RE.test(rel.replace(/\\/g, '/'))
}

export function productFilesFromChanged(files: string[] | undefined): { createdOrTouched: string[]; metadata: string[] } {
  const createdOrTouched: string[] = []
  const metadata: string[] = []
  for (const file of files ?? []) {
    const rel = file.replace(/\\/g, '/')
    if (isFoundryMetadataPath(rel)) metadata.push(rel)
    else createdOrTouched.push(rel)
  }
  return { createdOrTouched, metadata }
}

export function countDiffPlusMinus(diff: string | undefined): { plus: number; minus: number } {
  const text = diff ?? ''
  const plus = (text.match(/^\+[^+]/gm) ?? []).length
  const minus = (text.match(/^-[^-]/gm) ?? []).length
  return { plus, minus }
}

export function evaluateFoundryTests(results: NativeValidationResult[] | undefined): FoundryTestTruth {
  const all = results ?? []
  const testOps = all.filter(r =>
    r.operation.id === 'node_test'
    || (r.operation.id === 'package_script' && r.operation.targets?.[0] === 'test'),
  )
  let pass = 0
  let fail = 0
  let total = 0
  let parsedAny = false
  for (const op of testOps) {
    const counts = parseNodeTestCounts(`${op.stdout ?? ''}\n${op.stderr ?? ''}`)
    if (!counts) continue
    parsedAny = true
    pass += counts.pass
    fail += counts.fail
    total += counts.tests
  }
  const operationsOk = testOps.filter(r => r.ok).length
  if (!testOps.length) {
    return {
      ran: false,
      command: NODE_TEST_COMMAND,
      pass: 0,
      fail: 0,
      total: 0,
      operationsOk,
      operationsTotal: all.length,
      ok: false,
      reason: 'No test command executed.',
    }
  }
  if (!parsedAny || total === 0) {
    return {
      ran: true,
      command: NODE_TEST_COMMAND,
      pass: 0,
      fail: 0,
      total: 0,
      operationsOk,
      operationsTotal: all.length,
      ok: false,
      reason: `${NODE_TEST_COMMAND} ran 0 tests. Exit 0 is not evidence of passing tests.`,
    }
  }
  const ok = fail === 0 && pass > 0 && pass === total && testOps.every(r => r.ok)
  return {
    ran: true,
    command: NODE_TEST_COMMAND,
    pass,
    fail,
    total,
    operationsOk,
    operationsTotal: all.length,
    ok,
    reason: ok ? `${pass}/${total} tests passed (${NODE_TEST_COMMAND})` : `${fail} failed of ${total} (${NODE_TEST_COMMAND})`,
  }
}

export function runtimeProbesFromResults(results: NativeValidationResult[] | undefined): { id: string; ok: boolean; detail: string }[] {
  return (results ?? [])
    .filter(r => r.operation.id === 'http_probe')
    .map(r => ({
      id: r.operation.id,
      ok: r.ok,
      detail: (r.stdout || r.stderr || '').slice(0, 160),
    }))
}

export function buildFoundryCompletionTruth(input: {
  surface: FoundryWorkspaceSurface
  filesChanged?: string[]
  created?: string[]
  modified?: string[]
  diff?: string
  validationResults?: NativeValidationResult[]
  installedSha?: string | null
  sourceHead?: string | null
  sourceDirty?: boolean
}): FoundryCompletionTruth {
  const split = productFilesFromChanged(input.filesChanged)
  const created = input.created ?? split.createdOrTouched
  const modified = input.modified ?? []
  const { plus, minus } = countDiffPlusMinus(input.diff)
  const tests = evaluateFoundryTests(input.validationResults)
  const runtimeProbes = runtimeProbesFromResults(input.validationResults)
  const runtimeFailed = runtimeProbes.some(p => !p.ok)
  const canComplete = tests.ok && !runtimeFailed && (created.length + modified.length > 0 || plus + minus > 0)
  const installedRuntimeUpdated = false as const
  const installedSha = input.installedSha ?? null
  const sourceHead = input.sourceHead ?? null
  const sourceDirty = input.sourceDirty === true
  const headline = input.surface === 'war_room_source'
    ? 'SOURCE CHANGES COMPLETE'
    : 'GENERATED PROJECT COMPLETE'
  const sourceVsInstalled = input.surface === 'war_room_source'
    ? `Installed application still running previous packaged build. Installed War Room is still running packaged build: ${installedSha ?? 'unknown'}. Source workspace now contains: ${sourceHead ?? 'unknown'}${sourceDirty ? ' (dirty)' : ''}.`
    : (canComplete
      ? 'Changes are in this Foundry project workspace. They are not the installed War Room UI.'
      : tests.reason)
  return {
    surface: input.surface,
    created,
    modified,
    metadataFiles: split.metadata,
    plus,
    minus,
    tests,
    runtimeProbes,
    canComplete,
    installedRuntimeUpdated,
    headline: canComplete ? headline : 'NOT COMPLETE',
    detail: sourceVsInstalled,
    installedSha,
    sourceHead,
    sourceDirty,
  }
}
