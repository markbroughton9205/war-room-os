/**
 * Local 14B Foundry brain: compact context, constrained JSON, bounded schema repair.
 * Does not change Ollama service health. Does not grant filesystem access.
 */
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryModelContext, FoundryModelRequest, FoundryModelToolDescription } from './foundryModelTypes'
import { FOUNDRY_MODEL_TOOL_CATALOG, toolAllowedByPermissions } from './foundryToolCatalog'
import { buildFoundryModelContext } from './foundryModelContext'
import { compactEngineeringDecisionContext } from './foundryEngineeringContract'
import { compactWriteScopePrompt } from './foundryMissionWriteSet'
import { buildEngineeringGateTable, genericExampleForTool } from './foundryEngineeringGateTable'
import { ensureEngineeringState } from './foundryEngineeringDepth'
import { boundedRetryLockFromMission } from './foundryBoundedRetry'

export const LOCAL_MODEL_CONTEXT_BUDGET_TOKENS = 1_500
export const LOCAL_MODEL_MAX_REPAIRS = 2
export const LOCAL_MODEL_DEFAULT_REASONING = 'Local model selected validated action.'

export const FOUNDRY_LOCAL_GENERATE_OPTIONS = {
  temperature: 0,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.1,
  num_predict: 640,
  num_ctx: 8_192,
  seed: 7,
} as const

export const FOUNDRY_LOCAL_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['TOOL', 'REPLAN', 'COMPLETE', 'BLOCKED'] },
    reasoningSummary: { type: 'string' },
    tool: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['name'],
    },
    result: { type: 'string' },
    blocker: { type: 'string' },
  },
  required: ['decision'],
} as const

export const FOUNDRY_LOCAL_MODEL_SYSTEM_PROMPT = `You are Foundry's local reasoning engine.
You do not edit files. Foundry executes tools.
Return exactly one JSON object. No prose. No markdown.
Shape:
{"decision":"TOOL|REPLAN|COMPLETE|BLOCKED","reasoningSummary":"short","tool":{"name":"...","args":{}},"result":"optional","blocker":"optional string"}
Rules:
- One tool per TOOL turn. Use only the listed tools and argument names.
- Infer the owner from PRIMARY_OWNER, dependents, tests, and runtime surfaces. Do not guess decoys.
- GATE MISSING is normal until work is done. If NEXT_REQUIRED_ACTION is TOOL or FOCUSED_READ, return TOOL with RECOMMENDED_TOOL_CLASS. Do not REPLAN or BLOCKED only because a gate is incomplete.
- EVIDENCE_REQUIRED means follow RECOMMENDED_TOOL_CLASS. A missing SOURCE_DONE gate is remaining work, not a blocker.
- Acquire missing engineering evidence with a TOOL before using REPLAN.
- REPLAN only when evidence invalidated the hypothesis, the selected owner/target was rejected, the same action produced no new evidence, SOURCE_READ_LOOP fired, or a mutation/test disproved the plan.
- If observations include NOT_OWNER, NOT_RUNTIME_REFERENCED, NO_DEPENDENTS, or NO_TEST_ASSOCIATION after a read/write, REPLAN to a different evidenced owner. Do not write that file.
- You may only edit through broker tools. When file.read returns anchorId, use that anchorId with file.replace_unique. Do not invent source text. Do not reconstruct matchText. Do not include placeholders. If an anchor is stale, reread and use the new anchor.
- Mutate only after MAP + IMPACT + BASELINE, unless file.read already returned a unique EDIT_ANCHOR / anchorId for the requested path. In that case the next TOOL must be file.replace_unique with that anchorId. Do not file.read the same region again.
- If file.read lists several EDITABLE_REGIONS, pick one anchorId. Do not guess.
- replacementText must keep surrounding source/JSX valid. Keep existing data-testid attributes. Preserve all PROTECTED_BINDINGS listed by file.read unless the requested change explicitly requires modifying one.
- When file.read returns EDIT_CONTRACT, obey REQUIRED_BINDINGS, MUST_PRESERVE, and MUST_NOT. Reuse the supplied ANCHOR_TEXT structure. Do not hardcode status copy when a detail binding already exists. Do not emit the contract as source.
- Prefer a MINIMAL PRESERVING EDIT: reuse the existing anchor structure, preserve existing expressions, append neighboring detail. Do not reconstruct entire JSX wrappers.
- If file.replace_unique returns INVALID_REPLACEMENT: keep the SAME anchorId. Correct replacementText only. Do not reread unless CURRENT_STATE requires FOCUSED_READ. After 3 invalid replacements, BLOCKED. Do not empty REPLAN.
- When CURRENT_STATE=BOUNDED_RETRY, the only legal tool is file.replace_unique with the current ANCHOR_ID. Do not file.read. Do not workspace.search.
- If file.replace_unique returns MATCH_NOT_FOUND, MATCH_NOT_UNIQUE, STALE_FILE_HASH, or STALE_EDIT_ANCHOR: one focused file.read, then one retry with the fresh anchorId. Do not reconstruct source from memory. After 3 failed mutation replans, BLOCKED. Do not loop file.read.
- If lint.run fails after a mutation: one focused file.read of the reported line WINDOW, then one file.replace_unique using that window's anchorId. Keep surrounding source/JSX valid. Do not insert a raw // comment as JSX children. Do not loop file.read.
- For large files, file.read with aroundMatch, symbol, or query. Do not dump the whole file. Identical rereads of the same region force REPLAN.
- COMPLETE only when the listed gate items are already proven.
- BLOCKED only with a short blocker string after real failed attempts.
- For read-only ownership questions: search, read, then code.owners. COMPLETE after the map. No mutation.
- terminal.execute args.operation MUST be an object, never a string: {"id":"node_test","targets":["<ranked-test>"]}`

export type LocalModelCallMetrics = {
  promptChars: number
  promptTokensEst: number
  repairs: number
  schemaOk: boolean
  latencyMs: number
}

export let lastLocalModelCallMetrics: LocalModelCallMetrics | null = null
export const localDecisionContextSamples: number[] = []

export function recordLocalModelCallMetrics(metrics: LocalModelCallMetrics): void {
  lastLocalModelCallMetrics = metrics
  localDecisionContextSamples.push(metrics.promptTokensEst)
}

export function resetLocalDecisionContextSamples(): void {
  localDecisionContextSamples.length = 0
}

export function summarizeLocalDecisionContext(): { min: number; max: number; median: number; samples: number } {
  if (!localDecisionContextSamples.length) return { min: 0, max: 0, median: 0, samples: 0 }
  const sorted = [...localDecisionContextSamples].sort((a, b) => a - b)
  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    samples: sorted.length,
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function isReadOnlyLocateRequest(text: string): boolean {
  const locate = /\b(find where|where is|locate where|explain the (component|health|path)|health path|ownership path|full ownership|complete ownership|map the complete ownership)\b/i.test(text)
  const negated = /\b(do not change|don't change|without changing|no source mutation|read-only|do not modify|no mutation)\b/i.test(text)
  const mutate = /\b(change|fix|patch|replace|add|install|activate)\b/i.test(text) && !negated
  return locate && !mutate
}

export function orderedInspectTargets(text: string): string[] {
  if (!/inspect these files in order/i.test(text)) return []
  return [...new Set([...text.matchAll(/((?:lib|components|app|scripts)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g)].map(match => match[1]))]
}

function compactTool(entry: FoundryModelToolDescription): FoundryModelToolDescription {
  if (entry.name === 'terminal.execute') {
    return {
      ...entry,
      purpose: 'Run one typed validation. Never a shell string.',
      args: { operation: '{"id":"node_test","targets":["<ranked-test>"]}' },
    }
  }
  if (entry.name === 'file.replace_unique') {
    return {
      ...entry,
      purpose: 'Replace one unique region via a broker-issued anchorId. Do not reconstruct matchText.',
      args: {
        path: 'repo-relative string',
        anchorId: 'id from the latest relevant file.read',
        replacementText: 'bounded replacement',
        reason: 'string',
      },
    }
  }
  if (entry.name !== 'file.patch') return entry
  return {
    ...entry,
    purpose: 'Hash-bound patch. Prefer file.write for tiny files.',
    args: { proposal: 'StructuredPatch object' },
  }
}

function readPaths(mission: FoundryMissionRecord): string[] {
  return mission.toolCalls
    .filter(call => call.ok && call.tool === 'file.read')
    .map(call => {
      const excerpt = call.excerpt ?? ''
      return /"relPath":"([^"]+)"/.exec(excerpt)?.[1]
        ?? /^PATH:\n(\S+)/.exec(excerpt)?.[1]
        ?? /^(\S+) sha=/.exec(excerpt)?.[1]
        ?? ''
    })
    .filter(Boolean)
}

export function orderedInspectProgress(mission: FoundryMissionRecord): {
  ordered: string[]
  read: string[]
  remaining: string[]
} {
  const ordered = orderedInspectTargets(mission.userRequest)
  const read = [...new Set(readPaths(mission).filter(file => ordered.includes(file)))]
  return { ordered, read, remaining: ordered.filter(file => !read.includes(file)) }
}

export function nextOrderedInspectPath(mission: FoundryMissionRecord, requestedPath?: string): string | null {
  const { remaining } = orderedInspectProgress(mission)
  if (!remaining.length) return null
  const requested = requestedPath?.replace(/^\.\//, '').trim() ?? ''
  if (requested && remaining.includes(requested)) return requested
  return remaining[0] ?? null
}

export function localToolsForMission(mission: FoundryMissionRecord): FoundryModelToolDescription[] {
  const allowed = FOUNDRY_MODEL_TOOL_CATALOG.filter(entry => toolAllowedByPermissions(entry, mission.permissions))
  const byName = new Map(allowed.map(entry => [entry.name, compactTool(entry)]))
  const pick = (...names: string[]) => names.flatMap(name => byName.get(name as never) ? [byName.get(name as never)!] : [])
  const ordered = orderedInspectTargets(mission.userRequest)
  const reads = readPaths(mission)
  if (ordered.length) {
    const hit = ordered.filter(file => reads.includes(file)).length
    if (hit >= ordered.length) return []
    return pick('file.read', ...(reads.length ? [] : ['workspace.search']))
  }
  if (isReadOnlyLocateRequest(mission.userRequest)) {
    const searched = mission.toolCalls.some(call => call.ok && call.tool === 'workspace.search')
    const reads = readPaths(mission)
    if (searched && reads.length) return []
    if (searched) return pick('file.read')
    return pick('workspace.search', 'file.read')
  }
  const table = buildEngineeringGateTable(mission)
  const recovery = ensureEngineeringState(mission).editMatchRecovery
  if (recovery?.nextRequiredAction === 'BOUNDED_RETRY') {
    return pick('file.replace_unique')
  }
  if (recovery?.nextRequiredAction === 'FOCUSED_READ') {
    return pick('file.read', 'file.replace_unique')
  }
  const mutated = mission.toolCalls.some(call => call.ok && call.tool === 'file.replace_unique')
  if (mutated && (/test application fixture/i.test(mission.userRequest) || table.nextRequiredAction === 'COMPLETE')) {
    return []
  }
  const uniqueRead = [...mission.toolCalls].reverse().find(call => call.ok && call.tool === 'file.read'
    && /ANCHOR_UNIQUE=true/.test(call.excerpt ?? ''))
  const loopedReads = (ensureEngineeringState(mission).sourceReadCursor?.consecutiveSourceReads ?? 0) >= 2
    || (mission.architectureFindings ?? []).some(item => /SOURCE_READ_LOOP|READ_ALREADY_DONE|nudged-replace/i.test(item))
  if (uniqueRead && !mutated && loopedReads) {
    return pick('file.replace_unique')
  }
  if (table.nextRequiredAction === 'COMPLETE' || table.nextRequiredAction === 'REPLAN') return []
  const picked = pick(...table.availableTools)
  if (picked.length) return picked
  return pick('workspace.search', 'file.read', 'code.owners', 'engineering.baseline')
}

function summarizeSearch(excerpt: string): string {
  try {
    const parsed = JSON.parse(excerpt) as Array<{ relPath?: string; lineNumber?: number; line?: string }>
    if (!Array.isArray(parsed)) return excerpt.slice(0, 500)
    const ranked = [...parsed].sort((a, b) => {
      const score = (rel: string) => {
        if (/^components\//.test(rel)) return 0
        if (/\.(proof|validation)\.ts$/.test(rel) || /(?:^|\/)scripts\//.test(rel) || /^lib\/council\//.test(rel)) return 2
        return 1
      }
      return score(a.relPath ?? '') - score(b.relPath ?? '')
    })
    return ranked.slice(0, 8).map(hit => `${hit.relPath}:${hit.lineNumber}:${String(hit.line ?? '').slice(0, 80)}`).join('\n')
  } catch {
    return excerpt.slice(0, 500)
  }
}

function summarizeRead(excerpt: string): string {
  if (/^PATH:/.test(excerpt) || excerpt.includes('EDITABLE_REGION:') || excerpt.includes('WINDOW:')) {
    return excerpt.slice(0, 2_200)
  }
  try {
    const parsed = JSON.parse(excerpt) as {
      relPath?: string
      sha256?: string
      FILE_SHA256?: string
      sizeBytes?: number
      range?: { startLine?: number; endLine?: number; totalLines?: number }
      matchCount?: number
      matchLines?: number[]
      uniqueCopyLines?: string[]
      compact?: string
      anchorId?: string
      ANCHOR_TEXT_PREVIEW?: string
      ANCHOR_START_LINE?: number
      ANCHOR_END_LINE?: number
      ANCHOR_UNIQUE?: boolean
      PROTECTED_BINDINGS?: string[]
      EDIT_ANCHOR?: { anchorId?: string; ANCHOR_TEXT_PREVIEW?: string; ANCHOR_UNIQUE?: boolean; PROTECTED_BINDINGS?: string[] }
      error?: string
    }
    if (parsed.compact) return parsed.compact.slice(0, 2_400)
    const view = parsed.EDIT_ANCHOR ?? parsed
    return [
      `PATH:\n${parsed.relPath ?? 'file'}`,
      `SHA256:\n${parsed.FILE_SHA256 ?? parsed.sha256 ?? '?'}`,
      view.anchorId ? `EDITABLE_REGION:\nanchorId=${view.anchorId}` : '',
      parsed.ANCHOR_START_LINE != null ? `LINES:\n${parsed.ANCHOR_START_LINE}-${parsed.ANCHOR_END_LINE}` : '',
      view.ANCHOR_TEXT_PREVIEW ? `SOURCE:\n${view.ANCHOR_TEXT_PREVIEW}` : '',
      (parsed.PROTECTED_BINDINGS ?? view.PROTECTED_BINDINGS)?.length
        ? `PROTECTED_BINDINGS:\n${JSON.stringify(parsed.PROTECTED_BINDINGS ?? view.PROTECTED_BINDINGS)}`
        : '',
      parsed.error ? `READ_ERROR=${parsed.error}` : '',
    ].filter(Boolean).join('\n')
  } catch {
    return excerpt.slice(0, 800)
  }
}

function summarizeRuntimeVerify(excerpt: string): string {
  try {
    const parsed = JSON.parse(excerpt) as {
      identityMatch?: boolean
      activeInstallId?: string
      runningInstallId?: string
      health?: { running?: boolean; httpStatus?: number }
      corePort?: { httpStatus?: number }
    }
    return [
      `runtime.verify running=${parsed.health?.running === true}`,
      `ui=${parsed.health?.httpStatus ?? '?'}`,
      `core=${parsed.corePort?.httpStatus ?? '?'}`,
      `activeInstallId=${parsed.activeInstallId ?? '?'}`,
      `runningInstallId=${parsed.runningInstallId ?? '?'}`,
      `identityMatch=${parsed.identityMatch === true}`,
    ].join(' ')
  } catch {
    return 'runtime.verify: result present'
  }
}

export function summarizeObservation(tool: string, ok: boolean, excerpt?: string, error?: string): string {
  const body = error || excerpt || ''
  if (!ok) return `${tool} FAIL: ${body.slice(0, 280)}`
  if (tool === 'workspace.search') return `${tool} ok:\n${summarizeSearch(body)}`
  if (tool === 'file.read') return `${tool} ok:\n${summarizeRead(body)}`
  if (tool === 'file.replace_unique') {
    try {
      const parsed = JSON.parse(body) as { STATUS?: string; FILE?: string; OLD_SHA256?: string; NEW_SHA256?: string; MATCH_COUNT?: number; CHANGED_LINE_RANGE?: { start?: number; end?: number } }
      return `${tool} ok: ${parsed.STATUS ?? 'APPLIED'} file=${parsed.FILE ?? '?'} old=${(parsed.OLD_SHA256 ?? '').slice(0, 12)} new=${(parsed.NEW_SHA256 ?? '').slice(0, 12)} match=${parsed.MATCH_COUNT ?? 1} lines=${parsed.CHANGED_LINE_RANGE?.start ?? '?'}-${parsed.CHANGED_LINE_RANGE?.end ?? '?'}`
    } catch {
      return `${tool} ok: ${body.slice(0, 240)}`
    }
  }
  if (tool.startsWith('code.') || tool.startsWith('engineering.')) {
    try {
      const parsed = JSON.parse(body) as { compact?: string; owners?: string[]; status?: string; classification?: string }
      if (parsed.compact) return `${tool} ok:\n${parsed.compact}`
      if (parsed.classification) return `${tool} ok: ${parsed.classification} next=${(parsed as { next?: string }).next ?? ''}`
      if (parsed.status) return `${tool} ok: ${parsed.status}`
      return `${tool} ok: ${(parsed.owners ?? []).slice(0, 6).join(', ') || body.slice(0, 240)}`
    } catch {
      return `${tool} ok: ${body.slice(0, 360)}`
    }
  }
  if (tool === 'runtime.verify') return summarizeRuntimeVerify(body)
  if (tool === 'terminal.execute' || tool === 'test.run' || tool === 'validation.run') {
    try {
      const parsed = JSON.parse(body) as { ok?: boolean; exitCode?: number; stdout?: string }
      return `${tool} ok exit=${parsed.exitCode ?? '?'} ${String(parsed.stdout ?? '').slice(0, 160)}`
    } catch {
      return `${tool} ok: ${body.slice(0, 240)}`
    }
  }
  if (tool === 'workspace.inspect') {
    try {
      const parsed = JSON.parse(body) as { root?: string; importantDirectories?: string[]; framework?: string }
      return `${tool} ok: root=${parsed.root} dirs=${(parsed.importantDirectories ?? []).join(',')} framework=${parsed.framework}`
    } catch {
      return `${tool} ok: ${body.slice(0, 240)}`
    }
  }
  return `${tool} ok: ${body.slice(0, 360)}`
}

export function buildLocalFoundryModelContext(
  mission: FoundryMissionRecord,
  loopWarning?: string,
): FoundryModelContext {
  const base = buildFoundryModelContext(mission, loopWarning)
  const tools = localToolsForMission(mission)
  const lock = boundedRetryLockFromMission(mission)
  if (lock) {
    const lastFail = [...mission.toolCalls].reverse().find(call => call.tool === 'file.replace_unique' && !call.ok)
    return {
      ...base,
      plan: [],
      hypotheses: [],
      importantFindings: [compactEngineeringDecisionContext(mission)].filter(Boolean).slice(0, 2),
      relevantExcerpts: [],
      visualEvidence: [],
      recentToolResults: lastFail
        ? [{
          tool: lastFail.tool,
          ok: false,
          reason: lastFail.reason,
          excerpt: (lastFail.error ?? lastFail.excerpt ?? '').slice(0, 700),
          error: lastFail.error?.slice(0, 280),
        }]
        : [],
      recentErrors: [],
      unresolvedQuestions: [],
      loopWarning: undefined,
      tools,
      boundedRetryLock: lock,
    }
  }
  const findings = [
    ...(mission.kind === 'fixture' && (mission.completionGate?.missing ?? []).includes('SOURCE_DONE')
      ? ['FIXTURE: map owners from code.owners, read the evidenced owner, then file.write that file. Do not call runtime.verify, build, package, or installer.']
      : []),
    ...(mission.kind === 'fixture' && mission.testState.ok === false
      ? [
          mission.engineering?.diagnosis
            ? `VALIDATION FAILED. CLASSIFICATION=${mission.engineering.diagnosis.classification}. ${mission.engineering.diagnosis.next}`
            : 'VALIDATION FAILED. Diagnose IMPLEMENTATION_BUG vs TEST_EXPECTATION_OUTDATED, then patch only the justified owner.',
        ]
      : []),
    ...(mission.kind === 'fixture' && mission.sourceState.changedFiles.length > 0 && mission.testState.ok == null
      ? ['SELF_REVIEW is recorded. Run terminal.execute node_test against a ranked associated test. Do not file.write again until a test fails.']
      : []),
    compactWriteScopePrompt(mission),
    compactEngineeringDecisionContext(mission),
    ...base.importantFindings.filter(item => !/GATE STALL|runtime.verify|BUILD_DONE|PEER production/i.test(item)).slice(-4),
  ]
  const progress = orderedInspectProgress(mission)
  if (progress.ordered.length) {
    if (progress.remaining.length) {
      findings.unshift(
        `ORDERED INSPECT remaining=${progress.remaining.length}: next file.read path=${progress.remaining[0]}. Already read: ${progress.read.join(', ') || 'none'}. Do not re-read.`,
      )
    } else {
      findings.unshift('ORDERED INSPECT complete. Return COMPLETE now.')
    }
  }
  const recentCalls = mission.toolCalls.slice(-6)
  const lastRead = [...recentCalls].reverse().find(call => call.tool === 'file.read')
  const lastOther = [...recentCalls].reverse().find(call => call.tool !== 'file.read' && (call.tool === 'file.replace_unique' || call.tool === 'lint.run' || call.tool.startsWith('code.') || call.tool.startsWith('engineering.')))
  const pickedCalls = [lastRead, lastOther].filter((item, index, all): item is NonNullable<typeof item> => Boolean(item) && all.findIndex(other => other === item) === index)
  const recentToolResults = (pickedCalls.length ? pickedCalls : mission.toolCalls.slice(-2)).map(call => ({
    tool: call.tool,
    ok: call.ok,
    reason: call.reason,
    excerpt: summarizeObservation(call.tool, call.ok, call.excerpt, call.error).slice(0, call.tool === 'file.read' ? 1_500 : 700),
    error: call.ok ? undefined : call.error?.slice(0, 240),
  }))
  const recentErrors = mission.errors
    .filter(error => /MALFORMED|reasoningSummary|decision must|requires tool|JSON/i.test(error.message))
    .slice(-1)
    .map(error => ({ klass: 'MODEL_SCHEMA_FAILURE', message: error.message.slice(0, 240) }))
  return {
    ...base,
    plan: base.plan.filter(step => step.status === 'active' || step.status === 'pending').slice(0, 6),
    hypotheses: base.hypotheses.slice(-3),
    importantFindings: findings.slice(0, 8),
    relevantExcerpts: [],
    visualEvidence: [],
    recentToolResults,
    recentErrors,
    unresolvedQuestions: progress.remaining,
    loopWarning: loopWarning && !/BUILD_DONE|installer\.activate|ops-write-conflict/i.test(loopWarning) ? loopWarning.slice(0, 280) : undefined,
    tools,
    boundedRetryLock: lock,
  }
}

export function buildLocalFoundryModelPrompt(request: FoundryModelRequest): string {
  const context = request.context
  const tools = context.tools.map(tool => {
    const args = Object.entries(tool.args).map(([name, spec]) => `${name}:${spec}`).join(', ')
    return `- ${tool.name} (${tool.required.join(',') || 'no required'})${args ? ` args={${args}}` : ''}`
  }).join('\n')
  const latest = context.recentToolResults.map(item => item.excerpt || `${item.tool} ${item.ok ? 'ok' : 'FAIL'}`).join('\n---\n')
  const schemaFail = context.recentErrors[0]?.message
  const gateFinding = context.importantFindings.find(item => item.includes('CURRENT_INTENT=')) ?? ''
  let prompt = [
    `KIND: ${request.kind}`,
    `MISSION: ${context.missionKind}`,
    `GOAL: ${context.goal}`,
    `REQUEST: ${context.userRequest}`,
    `PHASE: ${context.phase}`,
    gateFinding || `GATE MISSING: ${context.completionGate.missing.join(', ') || 'none'}`,
    context.completionGate.missing.length === 0
      ? 'GATE IS SATISFIED. Return COMPLETE now. Do not call more tools.'
      : 'Acquire missing engineering evidence with a TOOL before using REPLAN.',
    `CHANGED: ${context.changedFiles.join(', ') || 'none'}`,
    `PLAN: ${context.plan.map(step => `${step.status}:${step.title}`).join(' | ') || 'none'}`,
    context.importantFindings.filter(item => !item.includes('CURRENT_INTENT=')).length
      ? `FINDINGS: ${context.importantFindings.filter(item => !item.includes('CURRENT_INTENT=')).join(' | ')}`
      : '',
    context.loopWarning ? `WARNING: ${context.loopWarning}` : '',
    schemaFail ? `LAST_SCHEMA_FAILURE: ${schemaFail}` : '',
    'TOOLS:',
    tools,
    /Do not use src\/example\.ts/.test(context.goal)
      ? 'SYNTAX: one JSON TOOL file.replace_unique. path is the working-set file. matchText is copied once from SOURCE. replacementText is the replacement. Do not use anchorId.'
      : (genericExampleForTool(context.tools[0]?.name) ? `SYNTAX EXAMPLE (fake names only):\n${genericExampleForTool(context.tools[0]?.name)}` : ''),
    'LATEST OBSERVATIONS:',
    latest || '(none)',
    'Return one JSON decision now.',
  ].filter(Boolean).join('\n')
  const budgetChars = LOCAL_MODEL_CONTEXT_BUDGET_TOKENS * 4
  if (prompt.length > budgetChars) prompt = `${prompt.slice(0, budgetChars)}\n[truncated to local context budget]`
  return prompt
}

export function buildLocalRepairPrompt(error: string, invalidText: string): string {
  return [
    'VALIDATION FAILURE:',
    error,
    'Invalid response:',
    invalidText.slice(0, 600),
    'Return ONLY one corrected JSON object. No prose. No markdown.',
    'terminal.execute args.operation must be an object, never a string:',
    '{"decision":"TOOL","reasoningSummary":"run ranked test","tool":{"name":"terminal.execute","args":{"operation":{"id":"node_test","targets":["<ranked-test>"]}}}}',
    'If the gate is already satisfied or no tools are listed, return COMPLETE.',
  ].join('\n')
}
