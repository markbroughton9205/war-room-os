/**
 * War Room's own reasoning engine. Local-first per Phase 13:
 *   1. deterministic War Room heuristics (no AI, no network — real pattern matching)
 *   2. local Ollama model, if reachable
 *   3. multi-family Council review as ADVISORY evidence only (never the executing path)
 *
 * Council opinions reuse lib/council/providerDirectCall.ts's real, key-gated adapters — but via
 * dependency injection (an `invoke` callback), not a static import: providerDirectCall.ts pulls
 * in lib/providers/kimi.ts, which imports the `server-only` sentinel package. That package is
 * resolved by Next's bundler, not a real npm dependency, so a static import breaks any plain-node
 * validation script that transitively touches it (the same reason lib/providers/retryOrchestration.ts
 * takes its `invoke` as a parameter instead of importing a provider-call module directly — this
 * follows that existing, proven pattern rather than inventing a new one).
 * invokeDirectCouncilProvider's shared system prompt and 120-token cap make it unsuitable for a
 * full structured patch response, so council families return a short diagnosis + risk opinion
 * (plannedChanges: []) and never execute; only a deterministic or local-model proposal (the ones
 * that actually produced a structured patch) can be selected for application.
 */
import { createHash } from 'node:crypto'
import { probeOllama, requestOllamaCompletion } from './ollamaClient'
import type {
  LocalReasoningLabel,
  NativeIssueRecord,
  NativePlannedChange,
  NativeRepairProposal,
} from './types'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export type InspectionExcerpt = { relPath: string; content: string }

// ---------------------------------------------------------------------------
// 1. Deterministic War Room analysis — real pattern matching, no AI involved.
// ---------------------------------------------------------------------------

type DeterministicMatch = {
  change: NativePlannedChange
  /** Extra validations beyond the default [typecheck, eslint_targeted] — used when a template's
   * bug class needs its own proof (e.g. a logic bug that only a dedicated validation script, not
   * typecheck/eslint, can actually confirm is fixed). */
  extraValidations?: { id: 'validation_script'; targets: string[] }[]
}

type DeterministicTemplate = {
  id: string
  /** Returns a match when this template's pattern matches the given file content, else null. */
  match: (relPath: string, content: string) => DeterministicMatch | null
}

/** Template 1 — the Phase 14 fixture's seeded bug: an off-by-one loop bound that drops the last
 * array element. Scoped deliberately narrow (this exact source line shape) rather than a general
 * "fix any loop" heuristic — a real template for a known, previously-seen pattern, matching the
 * Phase 12 auto-repair category "known repeat issues with previously approved repair templates".
 * Its proof of fix is the fixture's own validation script, not typecheck/eslint (which can't see
 * a runtime logic error) — this is the direct recheck repairVerifier needs to reach 'resolved'. */
const offByOneLoopBoundTemplate: DeterministicTemplate = {
  id: 'off_by_one_loop_bound_length_minus_one',
  match: (relPath, content) => {
    const anchor = 'for (let i = 0; i < values.length - 1; i += 1) {'
    if (!content.includes(anchor)) return null
    return {
      change: {
        file: relPath,
        reason: 'Loop bound `values.length - 1` excludes the final array element; should be `values.length`.',
        operation: 'replace_range',
        patch: {
          operation: 'replace_range',
          file: relPath,
          expectedOriginalHash: sha256(content),
          matchText: anchor,
          replacementText: 'for (let i = 0; i < values.length; i += 1) {',
        },
      },
      extraValidations: [{ id: 'validation_script', targets: ['scripts/run-native-builder-fixture-validation.mjs'] }],
    }
  },
}

/** Template 2 — duplicate import of the same named binding from the same module (a class of bug
 * explicitly named in Phase 12 as auto-repair eligible). Detects the first duplicate line and
 * proposes deleting it. */
const duplicateImportTemplate: DeterministicTemplate = {
  id: 'duplicate_import_line',
  match: (relPath, content) => {
    const importLineRe = /^import\s+.+\s+from\s+['"][^'"]+['"];?\s*$/gm
    const lines = content.match(importLineRe) ?? []
    const seen = new Map<string, number>()
    for (const line of lines) {
      const count = (seen.get(line) ?? 0) + 1
      seen.set(line, count)
      if (count === 2) {
        // Delete this exact duplicate occurrence (matchText requires exactly one occurrence in the
        // whole file, so we match the duplicate together with its trailing newline as a unique unit
        // only when it appears back-to-back; otherwise this template declines rather than guess).
        const doubled = `${line}\n${line}\n`
        if (content.includes(doubled)) {
          return {
            change: {
              file: relPath,
              reason: `Duplicate import line removed: ${line.trim()}`,
              operation: 'replace_range',
              patch: {
                operation: 'replace_range',
                file: relPath,
                expectedOriginalHash: sha256(content),
                matchText: doubled,
                replacementText: `${line}\n`,
              },
            },
          }
        }
        return null
      }
    }
    return null
  },
}

const DETERMINISTIC_TEMPLATES: DeterministicTemplate[] = [offByOneLoopBoundTemplate, duplicateImportTemplate]

export function buildDeterministicProposal(
  issue: NativeIssueRecord,
  excerpts: InspectionExcerpt[],
): NativeRepairProposal | null {
  for (const excerpt of excerpts) {
    for (const template of DETERMINISTIC_TEMPLATES) {
      const match = template.match(excerpt.relPath, excerpt.content)
      if (match) {
        return {
          issueId: issue.id,
          sourceKind: 'deterministic',
          proposerId: `deterministic:${template.id}`,
          diagnosis: match.change.reason,
          confidence: 'high',
          relevantFiles: [excerpt.relPath],
          plannedChanges: [match.change],
          validations: [
            { id: 'typecheck' },
            { id: 'eslint_targeted', targets: [excerpt.relPath] },
            ...(match.extraValidations ?? []),
          ],
          risks: ['Pattern-matched fix — confirm the anchor text was truly the only cause before relying on auto-repair for novel files.'],
          rollbackPlan: 'Restore the pre-patch file content from the native-builder snapshot for this repair.',
          generatedAt: new Date().toISOString(),
        }
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 2. Local model (Ollama) — real HTTP call, honest failure on any problem.
// ---------------------------------------------------------------------------

const STRUCTURED_PROPOSAL_INSTRUCTIONS = `You are War Room's local repair reasoning step. Given an issue and source excerpts, return ONLY a single JSON object (no prose, no markdown fences) matching exactly this shape:
{"diagnosis":"...","confidence":"low"|"medium"|"high","relevantFiles":["..."],"plannedChanges":[{"file":"...","reason":"...","operation":"replace_range","matchText":"...","replacementText":"..."}],"risks":["..."],"rollbackPlan":"..."}
Rules: matchText must be an exact substring of the given file content that appears exactly once. Only propose changes to files you were shown. Keep the patch minimal.`

function tryParseModelProposal(raw: string, issue: NativeIssueRecord, excerpts: InspectionExcerpt[], proposerId: string): NativeRepairProposal | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  let parsed: {
    diagnosis?: string
    confidence?: string
    relevantFiles?: string[]
    plannedChanges?: { file?: string; reason?: string; matchText?: string; replacementText?: string }[]
    risks?: string[]
    rollbackPlan?: string
  }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return null
  }
  if (!parsed.plannedChanges?.length) return null

  const byPath = new Map(excerpts.map(e => [e.relPath, e.content]))
  const plannedChanges: NativePlannedChange[] = []
  for (const change of parsed.plannedChanges) {
    if (!change.file || !change.matchText || change.replacementText === undefined) continue
    const content = byPath.get(change.file)
    if (!content) continue
    if (content.split(change.matchText).length - 1 !== 1) continue // only exactly-once matches are usable
    plannedChanges.push({
      file: change.file,
      reason: change.reason ?? 'Local model proposed change.',
      operation: 'replace_range',
      patch: {
        operation: 'replace_range',
        file: change.file,
        expectedOriginalHash: sha256(content),
        matchText: change.matchText,
        replacementText: change.replacementText,
      },
    })
  }
  if (!plannedChanges.length) return null

  const confidence = parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low' ? parsed.confidence : 'low'

  return {
    issueId: issue.id,
    sourceKind: 'local_model',
    proposerId,
    diagnosis: parsed.diagnosis ?? 'Local model diagnosis (unlabeled).',
    confidence,
    relevantFiles: parsed.relevantFiles?.length ? parsed.relevantFiles : plannedChanges.map(c => c.file),
    plannedChanges,
    validations: [{ id: 'typecheck' }],
    risks: parsed.risks?.length ? parsed.risks : ['Unreviewed local-model output — verify diagnosis before broad reuse.'],
    rollbackPlan: parsed.rollbackPlan ?? 'Restore the pre-patch file content from the native-builder snapshot for this repair.',
    generatedAt: new Date().toISOString(),
  }
}

export type LocalModelOutcome =
  | { status: 'proposal'; proposal: NativeRepairProposal }
  | { status: 'unavailable'; detail: string }
  | { status: 'insufficient'; detail: string }

export async function requestLocalModelProposal(
  issue: NativeIssueRecord,
  excerpts: InspectionExcerpt[],
): Promise<LocalModelOutcome> {
  const probe = await probeOllama()
  if (!probe.available) {
    return { status: 'unavailable', detail: probe.detail }
  }
  const model = probe.models[0]
  if (!model) {
    return { status: 'unavailable', detail: 'Ollama is reachable but has no models pulled.' }
  }

  const excerptBlock = excerpts.map(e => `--- ${e.relPath} ---\n${e.content.slice(0, 4000)}`).join('\n\n')
  const prompt = `${STRUCTURED_PROPOSAL_INSTRUCTIONS}\n\nIssue: ${issue.title}\nSeverity: ${issue.severity}\nSubsystem: ${issue.affectedSubsystem}\nEvidence:\n${issue.evidence.join('\n')}\n\nSource excerpts:\n${excerptBlock}`

  const result = await requestOllamaCompletion({ model, prompt })
  if (!result.ok) return { status: 'unavailable', detail: result.detail }

  const proposal = tryParseModelProposal(result.text, issue, excerpts, `ollama:${model}`)
  if (!proposal) return { status: 'insufficient', detail: 'Local model responded but did not produce a usable structured proposal.' }
  return { status: 'proposal', proposal }
}

// ---------------------------------------------------------------------------
// 3. Multi-family Council review — advisory only, independent, parallel dispatch.
// ---------------------------------------------------------------------------

/** Structurally identical to lib/council/providerDirectCall.ts's DirectProviderFamily/
 * invokeDirectCouncilProvider — kept as a local type-only mirror so this file never statically
 * imports that module (see the file-header note on the server-only resolution issue). Callers
 * (runtime.ts, API routes) pass the real invokeDirectCouncilProvider in at the call site. */
export type NativeCouncilFamily = 'chatgpt' | 'claude' | 'grok' | 'gemini' | 'kimi' | 'red_team' | 'baby'
export type NativeCouncilInvokeFn = (
  family: NativeCouncilFamily,
  prompt: string,
  opts?: { timeoutMs?: number },
) => Promise<{ ok: boolean; text: string; error?: string }>

export type CouncilOpinion = {
  family: NativeCouncilFamily
  ok: boolean
  diagnosisText: string
  error?: string
}

const COUNCIL_ROLE_FRAMING: Partial<Record<NativeCouncilFamily, string>> = {
  chatgpt: 'Focus on repair strategy and implementation path.',
  claude: 'Focus on architecture and dependency impact.',
  gemini: 'Give a broad code/context review.',
  grok: 'Look for contradictions or an alternate root cause the others might miss.',
  kimi: 'Decompose this into the smallest ordered task list.',
  red_team: 'Assess patch risk and regression exposure only — do not propose the fix.',
}

/** Each family inspects the same evidence independently and in parallel — none sees another
 * family's output before forming its own diagnosis, satisfying "do not wait for another family". */
export async function requestCouncilOpinions(
  issue: NativeIssueRecord,
  excerpts: InspectionExcerpt[],
  families: NativeCouncilFamily[],
  invoke: NativeCouncilInvokeFn,
): Promise<CouncilOpinion[]> {
  const excerptBlock = excerpts.map(e => `--- ${e.relPath} ---\n${e.content.slice(0, 1500)}`).join('\n\n')
  const basePrompt = `War Room issue needs diagnosis. Reply in 2-3 sentences only, plain text, no lists.\nIssue: ${issue.title}\nSubsystem: ${issue.affectedSubsystem}\nEvidence: ${issue.evidence.join(' | ')}\nExcerpts:\n${excerptBlock}`

  const calls = families.map(async family => {
    const framing = COUNCIL_ROLE_FRAMING[family] ?? ''
    const result = await invoke(family, `${basePrompt}\n\n${framing}`, { timeoutMs: 15_000 })
    return {
      family,
      ok: result.ok,
      diagnosisText: result.ok ? result.text : '',
      error: result.ok ? undefined : result.error,
    } satisfies CouncilOpinion
  })

  return Promise.all(calls)
}

export function councilOpinionsAsAdvisoryProposals(issue: NativeIssueRecord, opinions: CouncilOpinion[]): NativeRepairProposal[] {
  return opinions
    .filter(o => o.ok)
    .map(o => ({
      issueId: issue.id,
      sourceKind: 'council_family' as const,
      proposerId: o.family,
      diagnosis: o.diagnosisText,
      confidence: 'medium' as const,
      relevantFiles: [],
      plannedChanges: [], // advisory only — never selected for application, see selectPreferredProposal
      validations: [],
      risks: [],
      rollbackPlan: 'n/a (advisory diagnosis only, no patch produced)',
      generatedAt: new Date().toISOString(),
    }))
}

// ---------------------------------------------------------------------------
// 4. Selection + honest routing labels
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<NativeRepairProposal['confidence'], number> = { high: 0, medium: 1, low: 2 }

/** Only proposals with at least one planned change are eligible — council diagnoses are advisory
 * evidence, never directly executable. Ties broken by smallest patch (fewest planned changes). */
export function selectPreferredProposal(proposals: NativeRepairProposal[]): NativeRepairProposal | null {
  const executable = proposals.filter(p => p.plannedChanges.length > 0)
  if (!executable.length) return null
  return [...executable].sort((a, b) => {
    const confidenceDelta = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
    if (confidenceDelta !== 0) return confidenceDelta
    return a.plannedChanges.length - b.plannedChanges.length
  })[0]
}

export function determineLocalReasoningLabel(args: {
  deterministicFound: boolean
  localModelOutcome: LocalModelOutcome | null
  externalEscalationApproved: boolean
}): LocalReasoningLabel {
  if (args.deterministicFound) return 'LOCAL_REPAIR_READY'
  if (args.externalEscalationApproved) return 'EXTERNAL_ESCALATION_APPROVED'
  if (!args.localModelOutcome || args.localModelOutcome.status === 'unavailable') return 'LOCAL_MODEL_UNAVAILABLE'
  if (args.localModelOutcome.status === 'insufficient') return 'LOCAL_ANALYSIS_INSUFFICIENT'
  return 'LOCAL_REPAIR_READY'
}
