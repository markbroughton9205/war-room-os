import { parseEconomicOperationalCommand } from '@/lib/economic/commands'
import { createOpportunityDraft, buildOpportunityDedupeKey } from '@/lib/economic/opportunities'
import type {
  EconomicFamily,
  EconomicOperationalDomainId,
  EconomicOpportunity,
  EconomicRiskLevel,
} from '@/lib/economic/types'

export type EconomicProviderAnalysis = {
  provider_family: EconomicFamily
  content: string
  latency_ms?: number
  success?: boolean
}

export type ExtractEconomicOpportunitiesInput = {
  decree: string
  sessionId?: string | null
  providerAnalyses: readonly EconomicProviderAnalysis[]
}

export type ExtractEconomicOpportunitiesResult = {
  commandMatched: boolean
  summary: string
  opportunities: EconomicOpportunity[]
  assignedFamily: EconomicFamily | null
  domainId: EconomicOperationalDomainId | null
}

type Candidate = {
  title: string
  estimated_value: number | null
  confidence: number
  risk_level: EconomicRiskLevel
  required_actions: string[]
  notes: string
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

function confidenceOrDefault(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.58
  return Math.min(1, Math.max(0, n > 1 ? n / 100 : n))
}

function riskOrDefault(value: unknown): EconomicRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical' ? value : 'medium'
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean).slice(0, 8)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return ['human_review']
}

function extractJsonCandidates(content: string): Candidate[] {
  const blocks = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/g) ?? []
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block) as unknown
      const rows = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { opportunities?: unknown }).opportunities)
          ? (parsed as { opportunities: unknown[] }).opportunities
          : []
      const candidates = rows
        .filter(row => row && typeof row === 'object')
        .map(row => {
          const r = row as Record<string, unknown>
          const title = String(r.title ?? r.name ?? '').trim()
          if (!title) return null
          return {
            title,
            estimated_value: numberOrNull(r.estimated_value ?? r.value),
            confidence: confidenceOrDefault(r.confidence),
            risk_level: riskOrDefault(r.risk_level ?? r.risk),
            required_actions: stringList(r.required_actions ?? r.actions),
            notes: String(r.notes ?? r.reasoning ?? r.description ?? '').trim(),
          }
        })
        .filter((candidate): candidate is Candidate => Boolean(candidate))
      if (candidates.length) return candidates.slice(0, 12)
    } catch {
      /* Try the next JSON-looking block, then fall back to lines. */
    }
  }
  return []
}

function extractLineCandidates(content: string): Candidate[] {
  const lines = content.split(/\r?\n/)
  const candidates: Candidate[] = []
  for (const line of lines) {
    const cleaned = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim()
    if (!cleaned || cleaned.length < 8) continue
    if (!/[a-z]/i.test(cleaned)) continue
    const title = cleaned.split(/[:—-]\s+/)[0]?.trim() || cleaned
    if (title.length < 5 || title.length > 180) continue
    candidates.push({
      title,
      estimated_value: numberOrNull(cleaned.match(/\$[\d,]+(?:\.\d+)?/)?.[0]),
      confidence: /high confidence/i.test(cleaned) ? 0.78 : /low confidence/i.test(cleaned) ? 0.38 : 0.55,
      risk_level: /critical risk/i.test(cleaned) ? 'critical' : /high risk/i.test(cleaned) ? 'high' : /low risk/i.test(cleaned) ? 'low' : 'medium',
      required_actions: ['investigate', 'human_review'],
      notes: cleaned,
    })
    if (candidates.length >= 8) break
  }
  return candidates
}

function candidatesFrom(content: string): Candidate[] {
  return extractJsonCandidates(content).concat(extractLineCandidates(content)).slice(0, 12)
}

export function extractEconomicOpportunities(input: ExtractEconomicOpportunitiesInput): ExtractEconomicOpportunitiesResult {
  const parsed = parseEconomicOperationalCommand(input.decree)
  if (!parsed.matched) {
    return {
      commandMatched: false,
      summary: 'No Economic Ops command detected.',
      opportunities: [],
      assignedFamily: null,
      domainId: null,
    }
  }

  const opportunities: EconomicOpportunity[] = []
  const seen = new Set<string>()
  for (const analysis of input.providerAnalyses) {
    for (const candidate of candidatesFrom(analysis.content)) {
      const dedupeKey = buildOpportunityDedupeKey({
        provider: analysis.provider_family,
        sessionId: input.sessionId,
        decree: input.decree,
        title: candidate.title,
      })
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      opportunities.push(createOpportunityDraft({
        title: candidate.title,
        category: parsed.domain.id,
        source: input.decree,
        source_provider: analysis.provider_family,
        confidence: candidate.confidence,
        estimated_value: candidate.estimated_value,
        assigned_family: parsed.domain.providerPriority[0],
        required_actions: candidate.required_actions,
        risk_level: candidate.risk_level,
        notes: candidate.notes || analysis.content.slice(0, 2000),
        source_details: {
          provider_family: analysis.provider_family,
          command: parsed.command,
          workflow_id: parsed.workflow.id,
          full_provider_analysis: analysis.content,
        },
        dedupe_key: dedupeKey,
        metadata: {
          session_id: input.sessionId ?? null,
          compression: 'provider_analysis_stored_in_source_details',
        },
      }))
    }
  }

  return {
    commandMatched: true,
    summary: `${opportunities.length} opportunities discovered and added to Opportunity Scout.`,
    opportunities,
    assignedFamily: parsed.domain.providerPriority[0],
    domainId: parsed.domain.id,
  }
}
