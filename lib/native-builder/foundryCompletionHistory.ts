/**
 * Completed-mission history truth.
 *
 * A completed engineering mission's completion card must describe what the mission did, using the
 * evidence the mission persisted (completion record, command output, FILE_EDITED diffs, review and
 * verifier events). It must never re-derive completion from the project's *current* workspace, git
 * state, or legacy validation operations: a later rollback is subsequent history and must not
 * rewrite a completed mission into "0 files changed / no tests / NOT COMPLETE".
 *
 * Pure: no filesystem, git, or network access. Numbers come only from recorded evidence; when the
 * evidence does not carry a number (e.g. no parseable test output survived) it is reported as
 * unknown, never guessed.
 */
import { countDiffPlusMinus, isFoundryMetadataPath, type FoundryCompletionTruth } from './foundryCompletionTruth'

type EvidenceEvent = {
  type?: string
  status?: string
  exitCode?: number
  outputTail?: string
  diff?: string
}

/** Structural subset of FoundryEngineeringRuntimeState that this module reads. */
export type EngineeringRuntimeEvidence = {
  completion?: {
    canComplete?: boolean
    changedFiles?: string[]
    tests?: { command: string; ok: boolean; summary?: string }[]
  } | null
  events?: EvidenceEvent[] | null
  scope?: { created?: string[] } | null
  blockedDetail?: unknown
  campaign?: { verification?: string | null } | null
}

export type UnittestCounts = { total: number; passed: number; failed: number }

/** Parses `python -m unittest` output: "Ran N tests" plus "OK" or "FAILED (failures=a, errors=b)". */
export function parseUnittestCounts(text: string | undefined): UnittestCounts | null {
  const output = text ?? ''
  const ran = /Ran (\d+) tests?\b/.exec(output)
  if (!ran) return null
  const total = Number(ran[1])
  const failedLine = /FAILED \(([^)]*)\)/.exec(output)
  if (failedLine) {
    let failed = 0
    for (const part of failedLine[1].matchAll(/(?:failures|errors)=(\d+)/g)) failed += Number(part[1])
    return { total, passed: Math.max(0, total - failed), failed }
  }
  if (/^OK\b/m.test(output)) return { total, passed: total, failed: 0 }
  return null
}

function lastPassingTestCounts(events: EvidenceEvent[]): UnittestCounts | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'COMMAND_COMPLETED' || event.exitCode !== 0) continue
    const counts = parseUnittestCounts(event.outputTail)
    if (counts) return counts
  }
  return null
}

/**
 * Returns the historical completion truth for a mission that has an engineering-runtime completion
 * record, or null when the mission has none (callers then keep their existing behavior).
 * `missionStatus` is only used to mark a later rollback as separate, subsequent history.
 */
export function buildEngineeringCompletionTruth(input: {
  missionStatus?: string | null
  runtime?: EngineeringRuntimeEvidence | null
}): FoundryCompletionTruth | null {
  const runtime = input.runtime
  const completion = runtime?.completion
  if (!runtime || !completion) return null

  const events = runtime.events ?? []
  const projectReady = events.some(event => event.type === 'PROJECT_READY' && event.status === 'pass')
    || runtime.campaign?.verification === 'PROJECT_READY'
  const missionComplete = events.some(event => event.type === 'MISSION_COMPLETE' && event.status === 'pass')
  const completed = completion.canComplete === true && (projectReady || missionComplete) && !runtime.blockedDetail

  const changed = (completion.changedFiles ?? []).map(file => file.replace(/\\/g, '/'))
  const product = changed.filter(file => !isFoundryMetadataPath(file))
  const metadataFiles = changed.filter(file => isFoundryMetadataPath(file))
  const createdSet = new Set(runtime.scope?.created ?? [])
  const created = product.filter(file => createdSet.has(file))
  const modified = product.filter(file => !createdSet.has(file))

  const testRuns = completion.tests ?? []
  const ran = testRuns.length > 0
  const testsOk = ran && testRuns.every(run => run.ok)
  const counts = testsOk ? lastPassingTestCounts(events) : null
  const command = testRuns[0]?.command ?? ''

  let plus = 0
  let minus = 0
  let editsWithDiff = 0
  for (const event of events) {
    if (event.type !== 'FILE_EDITED' || !event.diff) continue
    const delta = countDiffPlusMinus(event.diff)
    plus += delta.plus
    minus += delta.minus
    editsWithDiff += 1
  }

  const reviews = events.filter(event => event.type === 'REVIEWING')
  const lastReview = reviews[reviews.length - 1]
  const review = !lastReview ? 'none' : lastReview.status === 'pass' ? 'accepted' : 'findings'
  const verifier = projectReady ? 'accepted' : 'none'

  return {
    surface: 'generated_project',
    created,
    modified,
    metadataFiles,
    plus,
    minus,
    tests: {
      ran,
      command,
      pass: counts?.passed ?? 0,
      fail: counts?.failed ?? 0,
      total: counts?.total ?? 0,
      operationsOk: testRuns.filter(run => run.ok).length,
      operationsTotal: testRuns.length,
      ok: testsOk,
      reason: !ran
        ? 'No test command was recorded for this mission.'
        : !testsOk
          ? `${command} did not pass.`
          : counts
            ? `${counts.passed}/${counts.total} tests passed (${command})`
            : `${command} passed (test count not recorded)`,
    },
    runtimeProbes: [],
    canComplete: completed,
    installedRuntimeUpdated: false,
    headline: completed ? 'GENERATED PROJECT COMPLETE' : 'NOT COMPLETE',
    detail: completed
      ? 'Changes are in this Foundry project workspace. They are not the installed War Room UI.'
      : 'Mission evidence does not show a verified completion.',
    history: {
      source: 'engineering_runtime',
      validation: completed ? 'COMPLETE / VERIFIED' : 'NOT COMPLETE',
      review,
      verifier,
      testsCounted: Boolean(counts),
      diffKnown: editsWithDiff > 0,
      rolledBack: input.missionStatus === 'rolled_back',
    },
  }
}
