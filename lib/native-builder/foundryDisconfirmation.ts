/**
 * Disconfirmation pass (pure: no filesystem, network or clock).
 *
 * After a mission looks resolved, Foundry deliberately looks for the strongest plausible way it could be wrong, rather than
 * stopping at "tests pass". This is bounded: it does not invent endless hypotheticals, it picks from a fixed, small catalog
 * using the acceptance criteria, the touched code, and known project architecture, and it never selects more than
 * MAX_PROBES at a time. Some hypotheses can be answered directly from source text (an import silently dropped); the rest
 * become a probe descriptor the (impure) runtime executes, whose result comes back here to be turned into a finding.
 */
import { nextFindingId, type Phase6Finding } from './foundryPhase6Types'

export const MAX_PROBES = 2

export type DisconfirmationHypothesisId =
  | 'RESTART_PERSISTENCE'
  | 'SESSION_REOPEN_STATE'
  | 'MALFORMED_INPUT_CRASH'
  | 'INSTALLED_RUNTIME_MISMATCH'

export type DisconfirmationProbe = {
  hypothesisId: DisconfirmationHypothesisId
  question: string
  targetFiles: string[]
}

export type DisconfirmationInput = {
  criteria: readonly string[]
  touchedFiles: readonly string[]
  primaryFiles: readonly string[]
  /** True only when the runtime actually has an installed copy to compare against (e.g. an active desktop install). */
  installedRuntimeAvailable: boolean
  /** True when a primary file looks like a request handler (heuristic left to the caller, who knows the project layout). */
  handlesUntrustedInput: boolean
}

const RESTART_WORDS = /restart|reopen|resume|survive|persist/i
const REOPEN_WORDS = /reopen|resume|restore/i

/** At most MAX_PROBES, ranked: persistence/reopen only when the criteria actually ask for it, runtime mismatch whenever
 *  it is cheap to check, malformed input only for a handler that takes untrusted input. Never all four at once. */
export function selectDisconfirmationProbes(input: DisconfirmationInput): DisconfirmationProbe[] {
  const candidates: DisconfirmationProbe[] = []
  const criteriaText = input.criteria.join(' ')
  if (RESTART_WORDS.test(criteriaText)) {
    candidates.push({
      hypothesisId: 'RESTART_PERSISTENCE',
      question: 'Tests pass now, but does the result survive a restart?',
      targetFiles: [...input.primaryFiles],
    })
  }
  if (REOPEN_WORDS.test(criteriaText)) {
    candidates.push({
      hypothesisId: 'SESSION_REOPEN_STATE',
      question: 'Does reopening the project restore the same state?',
      targetFiles: [...input.primaryFiles],
    })
  }
  if (input.installedRuntimeAvailable) {
    candidates.push({
      hypothesisId: 'INSTALLED_RUNTIME_MISMATCH',
      question: 'The source and its tests pass, but does the actual installed runtime match the source?',
      targetFiles: [...input.primaryFiles],
    })
  }
  if (input.handlesUntrustedInput) {
    candidates.push({
      hypothesisId: 'MALFORMED_INPUT_CRASH',
      question: 'The happy path returns success, but does malformed input still crash instead of being handled?',
      targetFiles: [...input.primaryFiles],
    })
  }
  return candidates.slice(0, MAX_PROBES)
}

export type ProbeOutcome =
  | { ran: true; passed: boolean; detail: string }
  | { ran: false; reason: string }

/** Turns one executed probe's result into a finding. A probe that could not run is UNSUPPORTED (it proves nothing either way), never treated as a pass. */
export function interpretProbeResult(probe: DisconfirmationProbe, outcome: ProbeOutcome): Phase6Finding | null {
  if (!outcome.ran) {
    return {
      findingId: nextFindingId('disconfirmation-unrun'),
      severity: 'ADVISORY',
      claim: `${probe.question} — the probe could not run: ${outcome.reason}`,
      evidenceRefs: [],
      affectedFiles: [...probe.targetFiles],
      confidenceClass: 'UNSUPPORTED',
      actionability: 'NONE',
    }
  }
  if (outcome.passed) return null
  return {
    findingId: nextFindingId('disconfirmation'),
    severity: 'BLOCKING',
    claim: `${probe.question} — no: ${outcome.detail}`,
    evidenceRefs: [outcome.detail],
    reproduction: outcome.detail,
    affectedFiles: [...probe.targetFiles],
    confidenceClass: 'DIRECTLY_PROVEN',
    actionability: 'REPAIR',
  }
}

/** The individual names one Python `from X import a, b as c` line binds into the module (not the module stem — the symbols themselves). */
function importedSymbolNames(text: string): Set<string> {
  const names = new Set<string>()
  for (const hit of text.matchAll(/^[ \t]*from[ \t]+[\w.]*[ \t]+import[ \t]+([^\n]+)/gm)) {
    for (const part of hit[1].replace(/[()]/g, '').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return names
}

/** Answered directly from source, no probe needed: an edited file's import list shrank a symbol out from under it that the code still uses. */
export function droppedImportFinding(file: string, beforeText: string, afterText: string): Phase6Finding | null {
  const before = importedSymbolNames(beforeText)
  const after = importedSymbolNames(afterText)
  const codeAfterImports = afterText.replace(/^[ \t]*(?:from|import)[ \t].*$/gm, '')
  const dropped = [...before].filter(name => !after.has(name) && new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(codeAfterImports))
  if (!dropped.length) return null
  return {
    findingId: nextFindingId('disconfirmation-import'),
    severity: 'BLOCKING',
    claim: `${file} still uses ${dropped.join(', ')} but the edit dropped ${dropped.length === 1 ? 'its' : 'their'} import.`,
    evidenceRefs: [file],
    affectedFiles: [file],
    confidenceClass: 'DIRECTLY_PROVEN',
    actionability: 'REPAIR',
  }
}
