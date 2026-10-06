/**
 * Adaptive evidence acquisition for an existing research mission.
 * Process state only. EBC remains the factual store. LUMEN rules are unchanged.
 */
import type { ToolCallRecord } from './types'
import type { ToolRunner } from './tools'

export const EVIDENCE_RECOVERY_SCHEMA = 'council.evidence-recovery.v1' as const

export const GAP_REASONS = [
  'NO_RESULTS',
  'IRRELEVANT_RESULTS',
  'NO_PRIMARY_SOURCE',
  'PRIMARY_SOURCE_INACCESSIBLE',
  'STALE_ONLY',
  'INSUFFICIENT_CORROBORATION',
  'SOURCE_DISAGREEMENT',
  'ENTITY_AMBIGUITY',
  'WRONG_TERMINOLOGY',
  'TOO_BROAD',
  'TOO_NARROW',
  'TEMPORAL_GAP',
  'GEOGRAPHIC_GAP',
  'JURISDICTION_GAP',
  'MISSING_DATASET',
  'TOOL_FAILURE',
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'PAYWALL',
  'COVERAGE_GAP',
  'UNSUPPORTED_FORMAT',
  'UNKNOWN',
] as const
export type GapReason = (typeof GAP_REASONS)[number]

export const RESEARCH_TERMINALS = [
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'CONTRADICTED',
  'STALE',
  'TOOL_BLOCKED',
  'SOURCE_ACCESS_BLOCKED',
  'NO_PRIMARY_SOURCE_FOUND',
  'NO_USABLE_EVIDENCE',
  'INSUFFICIENT_CORROBORATION',
  'CONFLICT_UNRESOLVED',
  'BUDGET_EXHAUSTED',
  'OBJECTIVE_PARTIALLY_ANSWERED',
  'GENUINELY_UNRESOLVED',
] as const
export type ResearchTerminal = (typeof RESEARCH_TERMINALS)[number]

export type EvidenceRequirementKind =
  | 'PRIMARY_SOURCE'
  | 'OFFICIAL_RECORD'
  | 'LIVE_TELEMETRY'
  | 'TOOL_RESULT'
  | 'DATASET'
  | 'REPOSITORY'
  | 'TECHNICAL_DOCUMENTATION'
  | 'ACADEMIC_SOURCE'
  | 'LEGAL_RECORD'
  | 'REGULATORY_RECORD'
  | 'PUBLIC_STATEMENT'
  | 'CURRENT_NEWS'
  | 'HISTORICAL_ARCHIVE'
  | 'SECONDARY_ANALYSIS'
  | 'INDEPENDENT_CORROBORATION'

export type AtomicQuestion = {
  id: string
  text: string
  blocking: boolean
}

export type EvidenceRequirement = {
  question_id: string
  kind: EvidenceRequirementKind
  freshness_required: boolean
  minimum_independent_sources: number
  source_class_preferences: string[]
}

export type SourceTriage =
  | 'USABLE'
  | 'IRRELEVANT'
  | 'DUPLICATE'
  | 'STALE'
  | 'LOW_AUTHORITY'
  | 'SECONDARY_ONLY'
  | 'PRIMARY'
  | 'ACCESS_BLOCKED'
  | 'PAYWALLED'
  | 'AUTH_BLOCKED'
  | 'MALFORMED'
  | 'TOOL_ERROR'
  | 'UNRELATED_ENTITY'
  | 'WRONG_TIME_WINDOW'
  | 'WRONG_JURISDICTION'

export type ResearchLedger = {
  schema: typeof EVIDENCE_RECOVERY_SCHEMA
  mission_id: string
  wave_number: number
  max_waves: number
  objective: string
  blocking_questions: AtomicQuestion[]
  evidence_requirements: EvidenceRequirement[]
  query_history: string[]
  source_class_history: string[]
  rejection_history: Array<{ ref: string; reason: SourceTriage | GapReason }>
  strategy_history: string[]
  gap: GapReason | null
  termination_reason: ResearchTerminal | null
  continue_research: boolean
  discovered_source_count: number
  opened_source_count: number
  usable_source_count: number
  primary_source_count: number
  duplicate_source_count: number
  claims_supported: number
  claims_open: number
  budget_used: number
  budget_remaining: number
  is_ebc: false
  grants_authority: false
}

const RESEARCH_ASK = /\b(research|primary sources?|according to|what is the current|compare sources|find the (?:law|ruling|docs|documentation))\b/i

export function isResearchObjective(text: string): boolean {
  return RESEARCH_ASK.test(text)
}

export function decomposeResearchQuestion(text: string): AtomicQuestion[] {
  if (!isResearchObjective(text)) return []
  const parts = text.split(/[?;]/).map(part => part.trim()).filter(part => part.length > 12)
  const questions = (parts.length ? parts : [text.trim()]).slice(0, 4)
  return questions.map((part, index) => ({
    id: `q${index + 1}`,
    text: part,
    blocking: index === 0 || /\bmust|required|primary|current\b/i.test(part),
  }))
}

export function evidenceRequirementFor(question: AtomicQuestion): EvidenceRequirement {
  const text = question.text
  let kind: EvidenceRequirementKind = 'PRIMARY_SOURCE'
  let minimum = 1
  let preferences = ['official', 'primary']
  if (/\bapi|docs|documentation|repository|github\b/i.test(text)) {
    kind = 'TECHNICAL_DOCUMENTATION'
    preferences = ['technical docs', 'repository', 'official']
  } else if (/\bcourt|ruling|docket|statute\b/i.test(text)) {
    kind = 'LEGAL_RECORD'
    preferences = ['legal/regulatory', 'official']
  } else if (/\bdataset|statistics|census\b/i.test(text)) {
    kind = 'DATASET'
    preferences = ['dataset', 'official']
  } else if (/\bnews|today|announcement\b/i.test(text)) {
    kind = 'CURRENT_NEWS'
    preferences = ['primary', 'news']
    minimum = 2
  } else if (/\bcorroborat|independent\b/i.test(text)) {
    kind = 'INDEPENDENT_CORROBORATION'
    minimum = 2
    preferences = ['primary', 'independent']
  }
  return {
    question_id: question.id,
    kind,
    freshness_required: /\bcurrent|today|latest|now\b/i.test(text),
    minimum_independent_sources: minimum,
    source_class_preferences: preferences,
  }
}

export function diagnoseGap(input: { summary: string; usable: number; primary: number; stale: boolean; disagreement: boolean }): GapReason {
  const text = input.summary.toLowerCase()
  if (/auth|permission|profile_access/.test(text)) return 'AUTH_REQUIRED'
  if (/rate.?limit|429/.test(text)) return 'RATE_LIMITED'
  if (/paywall/.test(text)) return 'PAYWALL'
  if (/timeout|fetch failed|tool/.test(text) && input.usable === 0) return 'TOOL_FAILURE'
  if (input.disagreement) return 'SOURCE_DISAGREEMENT'
  if (input.stale) return 'STALE_ONLY'
  if (/jurisdiction|statute of/.test(text)) return 'JURISDICTION_GAP'
  if (/acronym|also known|wrong name/.test(text)) return 'WRONG_TERMINOLOGY'
  if (input.usable === 0 && /no usable|no results|opened no usable/.test(text)) return 'NO_RESULTS'
  if (input.usable > 0 && input.primary === 0) return 'NO_PRIMARY_SOURCE'
  if (input.usable === 0) return 'NO_RESULTS'
  return 'UNKNOWN'
}

export function adaptStrategy(gap: GapReason): { source_class: string; instruction: string } {
  switch (gap) {
    case 'NO_PRIMARY_SOURCE':
    case 'PRIMARY_SOURCE_INACCESSIBLE':
      return { source_class: 'official', instruction: 'official primary record' }
    case 'STALE_ONLY':
      return { source_class: 'current', instruction: 'current dated source' }
    case 'INSUFFICIENT_CORROBORATION':
      return { source_class: 'independent', instruction: 'independent corroboration' }
    case 'SOURCE_DISAGREEMENT':
      return { source_class: 'disconfirming', instruction: 'original record and disconfirming evidence' }
    case 'WRONG_TERMINOLOGY':
      return { source_class: 'alias', instruction: 'alternate official name' }
    case 'TOO_BROAD':
      return { source_class: 'narrow', instruction: 'narrower claim' }
    case 'TOO_NARROW':
      return { source_class: 'broader', instruction: 'broader upstream concept' }
    case 'JURISDICTION_GAP':
      return { source_class: 'jurisdiction', instruction: 'correct jurisdiction' }
    case 'TOOL_FAILURE':
      return { source_class: 'alternate-tool', instruction: 'alternate registered source' }
    case 'PAYWALL':
      return { source_class: 'public-equivalent', instruction: 'lawful public equivalent' }
    case 'MISSING_DATASET':
      return { source_class: 'dataset', instruction: 'official public dataset' }
    case 'NO_RESULTS':
      return { source_class: 'reformulation', instruction: 'reformulated query' }
    default:
      return { source_class: 'reformulation', instruction: 'different source class' }
  }
}

export function reformulateQuery(query: string, gap: GapReason, history: readonly string[]): string {
  const strategy = adaptStrategy(gap)
  const base = query.replace(/\s+/g, ' ').trim()
  let next = `${base} ${strategy.instruction}`.trim()
  if (gap === 'WRONG_TERMINOLOGY') next = base.replace(/\b(ai|ml)\b/ig, 'machine learning').concat(' official documentation')
  if (gap === 'TOO_BROAD') next = `${base.split(' ').slice(0, 6).join(' ')} specific official record`
  if (gap === 'TOO_NARROW') next = `${base} overview official source`
  if (gap === 'JURISDICTION_GAP') next = `${base} United States official record`
  if (history.includes(next)) next = `${next} wave-${history.length + 1}`
  return next
}

export function triageSource(input: { url: string; snippet: string; seen: ReadonlySet<string>; stale?: boolean; ok?: boolean }): SourceTriage {
  if (!input.url || !/^https?:\/\//i.test(input.url)) return 'MALFORMED'
  if (input.ok === false) return 'TOOL_ERROR'
  if (input.seen.has(input.url)) return 'DUPLICATE'
  if (input.stale) return 'STALE'
  if ((input.snippet || '').trim().length < 24) return 'IRRELEVANT'
  return 'USABLE'
}

export function independentCount(urls: readonly string[]): number {
  const origins = new Set<string>()
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '')
      origins.add(host.replace(/^(m|amp)\./, ''))
    } catch {
      origins.add(url)
    }
  }
  return origins.size
}

export function snippetIsEvidence(snippet: string, opened: boolean): boolean {
  return opened && snippet.trim().length >= 24
}

export type ExtractedClaim = {
  claim_candidate: string
  source_ref: string
  source_class: string
  source_authority: string
  observed_text_location: string
  publication_time: string | null
  observed_at: string
  freshness: 'CURRENT' | 'STALE' | 'UNKNOWN'
  entity: string
  jurisdiction: string | null
  support_type: 'SUPPORTS' | 'CONTRADICTS' | 'CONTEXT_ONLY' | 'INSUFFICIENT'
}

export function extractClaimFromInspection(input: {
  opened: boolean
  text: string
  source_ref: string
  source_class: string
  source_authority: string
  location: string
  observed_at: string
  publication_time?: string | null
  entity?: string
  jurisdiction?: string | null
  support_type?: ExtractedClaim['support_type']
}): ExtractedClaim | null {
  const text = input.text.trim()
  if (!input.opened || text.length < 24 || !input.source_ref) return null
  return {
    claim_candidate: text.slice(0, 500),
    source_ref: input.source_ref,
    source_class: input.source_class,
    source_authority: input.source_authority,
    observed_text_location: input.location,
    publication_time: input.publication_time ?? null,
    observed_at: input.observed_at,
    freshness: 'UNKNOWN',
    entity: input.entity ?? '',
    jurisdiction: input.jurisdiction ?? null,
    support_type: input.support_type ?? 'SUPPORTS',
  }
}

export function corroborationKeys(rows: readonly { url: string; content_hash?: string }[]): number {
  const keys = new Set<string>()
  for (const row of rows) {
    if (row.content_hash) {
      keys.add(`hash:${row.content_hash}`)
      continue
    }
    try {
      const parsed = new URL(row.url)
      const host = parsed.hostname.replace(/^www\./, '').replace(/^(m|amp)\./, '')
      keys.add(`${host}${parsed.pathname}`)
    } catch {
      keys.add(row.url)
    }
  }
  return keys.size
}

export const RESEARCH_ACCESS_IS_NOT_ACTION_AUTHORITY = true as const

export function zeroEvidenceContinues(input: {
  wave_number: number
  max_waves: number
  tools_available: boolean
  blocking_open: boolean
  strategy_changed: boolean
  auth_blocked: boolean
}): boolean {
  if (input.auth_blocked) return false
  if (!input.tools_available || !input.blocking_open || !input.strategy_changed) return false
  return input.wave_number < input.max_waves
}

export function terminalFor(input: {
  continue_research: boolean
  usable: number
  primary: number
  open: number
  verified: number
  conflict: boolean
  stale: boolean
  auth: boolean
  budget_left: number
  gap: GapReason | null
}): ResearchTerminal {
  if (input.conflict) return 'CONFLICT_UNRESOLVED'
  if (input.auth) return 'SOURCE_ACCESS_BLOCKED'
  if (input.budget_left <= 0 && input.open > 0) return 'BUDGET_EXHAUSTED'
  if (input.stale && input.usable === 0) return 'STALE'
  if (input.verified > 0 && input.open > 0) return 'OBJECTIVE_PARTIALLY_ANSWERED'
  if (input.verified > 0 && input.open === 0) return 'VERIFIED'
  if (!input.continue_research && input.gap === 'NO_PRIMARY_SOURCE') return 'NO_PRIMARY_SOURCE_FOUND'
  if (!input.continue_research && input.usable === 0) return 'NO_USABLE_EVIDENCE'
  if (input.open > 0) return 'GENUINELY_UNRESOLVED'
  return 'PARTIALLY_VERIFIED'
}

export function objectiveSatisfied(input: { blocking: number; open: number; verified: number }): boolean {
  return input.blocking > 0 && input.open === 0 && input.verified > 0
}

function questionsForObjective(text: string): AtomicQuestion[] {
  const decomposed = decomposeResearchQuestion(text)
  if (decomposed.length) return decomposed
  const trimmed = text.trim()
  if (!trimmed) return []
  return [{ id: 'q1', text: trimmed, blocking: true }]
}

export function createLedger(input: {
  mission_id: string
  objective: string
  max_waves?: number
}): ResearchLedger {
  const questions = questionsForObjective(input.objective)
  return {
    schema: EVIDENCE_RECOVERY_SCHEMA,
    mission_id: input.mission_id,
    wave_number: 1,
    max_waves: input.max_waves ?? 3,
    objective: input.objective,
    blocking_questions: questions.filter(q => q.blocking),
    evidence_requirements: questions.filter(q => q.blocking).map(evidenceRequirementFor),
    query_history: [],
    source_class_history: [],
    rejection_history: [],
    strategy_history: [],
    gap: null,
    termination_reason: null,
    continue_research: false,
    discovered_source_count: 0,
    opened_source_count: 0,
    usable_source_count: 0,
    primary_source_count: 0,
    duplicate_source_count: 0,
    claims_supported: 0,
    claims_open: questions.filter(q => q.blocking).length,
    budget_used: 0,
    budget_remaining: input.max_waves ?? 3,
    is_ebc: false,
    grants_authority: false,
  }
}

export function publicTerminalLabel(reason: ResearchTerminal): string {
  return reason.toLowerCase().replaceAll('_', ' ')
}

export function transparencyBrief(ledger: ResearchLedger): string {
  const reason = publicTerminalLabel(ledger.termination_reason ?? 'GENUINELY_UNRESOLVED')
  return [
    `I could not fully verify the request.`,
    `What I verified: ${ledger.claims_supported}.`,
    `What remains unresolved: ${ledger.claims_open} blocking question(s).`,
    `Why: ${reason}.`,
    `Research performed:`,
    `- ${ledger.strategy_history.length} query strategies`,
    `- ${ledger.discovered_source_count} candidate sources`,
    `- ${ledger.opened_source_count} sources inspected`,
    `- ${ledger.primary_source_count} primary sources`,
    `- ${ledger.usable_source_count} usable sources`,
    ledger.rejection_history.length ? `- rejection reasons: ${ledger.rejection_history.map(row => row.reason).join(', ')}` : '- rejection reasons: none recorded',
    `Waves: ${ledger.wave_number}.`,
    `Terminal: ${reason}.`,
  ].join('\n')
}

export async function runRecoveryFetches(input: {
  missionId: string
  objective: string
  tools: ToolRunner
  priorQueries: string[]
  usableCount: number
  authBlocked: boolean
  maxWaves?: number
  now?: string
}): Promise<{ ledger: ResearchLedger; records: ToolCallRecord[] }> {
  const ledger = createLedger({ mission_id: input.missionId, objective: input.objective, max_waves: input.maxWaves })
  ledger.query_history.push(...input.priorQueries)
  ledger.usable_source_count = input.usableCount
  ledger.budget_used = 1
  ledger.budget_remaining = Math.max(0, ledger.max_waves - 1)
  if (input.usableCount > 0 && ledger.claims_open > 0) {
    const covered = Math.min(ledger.claims_open, input.usableCount)
    ledger.claims_supported += covered
    ledger.claims_open -= covered
  }
  const records: ToolCallRecord[] = []
  const corroborationNeeded = Math.max(1, ...ledger.evidence_requirements.map(row => row.minimum_independent_sources))
  const requirementsOpen = ledger.claims_open > 0 || input.usableCount < corroborationNeeded
  if (input.authBlocked || !requirementsOpen || (!isResearchObjective(input.objective) && input.priorQueries.length === 0)) {
    ledger.continue_research = false
    ledger.usable_source_count = input.usableCount
    ledger.termination_reason = input.authBlocked
      ? 'SOURCE_ACCESS_BLOCKED'
      : !requirementsOpen && input.usableCount > 0 && ledger.claims_open === 0
        ? 'VERIFIED'
        : !requirementsOpen
          ? null
          : null
    return { ledger, records }
  }
  const gap = input.usableCount > 0 && input.usableCount < corroborationNeeded
    ? 'INSUFFICIENT_CORROBORATION'
    : diagnoseGap({ summary: 'opened no usable sources', usable: 0, primary: 0, stale: false, disagreement: false })
  ledger.gap = gap
  let wave = 1
  while (wave < ledger.max_waves) {
    const strategy = adaptStrategy(ledger.gap ?? 'NO_RESULTS')
    const query = reformulateQuery(input.objective, ledger.gap ?? 'NO_RESULTS', ledger.query_history)
    const changed = !ledger.query_history.includes(query)
    ledger.continue_research = zeroEvidenceContinues({
      wave_number: wave,
      max_waves: ledger.max_waves,
      tools_available: true,
      blocking_open: ledger.claims_open > 0 || ledger.usable_source_count < corroborationNeeded,
      strategy_changed: changed,
      auth_blocked: false,
    })
    if (!ledger.continue_research) break
    ledger.strategy_history.push(strategy.instruction)
    ledger.source_class_history.push(strategy.source_class)
    ledger.query_history.push(query)
    wave += 1
    ledger.wave_number = wave
    ledger.budget_used += 1
    ledger.budget_remaining = Math.max(0, ledger.max_waves - ledger.budget_used)
    const record = await input.tools('broker.fetch', {
      query,
      mission_id: input.missionId,
      recovery_wave: wave,
      gap: ledger.gap,
    })
    records.push(record)
    const payload = record.payload as { discovered_source_count?: number; opened_source_count?: number; usable_source_count?: number; primary_source_count?: number } | undefined
    ledger.discovered_source_count += payload?.discovered_source_count ?? (record.ok ? 1 : 0)
    ledger.opened_source_count += payload?.opened_source_count ?? (record.url ? 1 : 0)
    ledger.usable_source_count += payload?.usable_source_count ?? (record.ok ? 1 : 0)
    ledger.primary_source_count += payload?.primary_source_count ?? (record.ok ? 1 : 0)
    if (!record.ok) ledger.rejection_history.push({ ref: query, reason: record.denied ? 'AUTH_BLOCKED' : 'TOOL_ERROR' })
    if (record.ok) {
      ledger.claims_supported += 1
      ledger.claims_open = Math.max(0, ledger.claims_open - 1)
    }
    const stillOpen = ledger.claims_open > 0 || ledger.usable_source_count < corroborationNeeded
    if (!stillOpen) {
      ledger.continue_research = false
      break
    }
    ledger.gap = diagnoseGap({ summary: record.summary, usable: ledger.usable_source_count, primary: ledger.primary_source_count, stale: /stale/i.test(record.summary), disagreement: /contradict/i.test(record.summary) })
  }
  ledger.continue_research = false
  ledger.termination_reason = terminalFor({
    continue_research: false,
    usable: ledger.usable_source_count,
    primary: ledger.primary_source_count,
    open: ledger.claims_open,
    verified: ledger.claims_supported,
    conflict: ledger.gap === 'SOURCE_DISAGREEMENT',
    stale: ledger.gap === 'STALE_ONLY',
    auth: input.authBlocked || ledger.rejection_history.some(row => row.reason === 'AUTH_BLOCKED'),
    budget_left: ledger.budget_remaining,
    gap: ledger.gap,
  })
  void input.now
  return { ledger, records }
}

export function resumeSkipsCompleted(ledger: ResearchLedger, query: string): boolean {
  return ledger.query_history.includes(query)
}
