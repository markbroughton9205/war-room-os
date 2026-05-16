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
  telemetry: EconomicExtractionTelemetry
}

export type EconomicExtractionTelemetry = {
  attempted: number
  successfulCandidates: number
  fallbackStatus: 'not_needed' | 'created' | 'skipped_low_quality' | 'no_provider_content'
  fallbackReason: string | null
}

type Candidate = {
  title: string
  estimated_value: number | null
  confidence: number
  risk_level: EconomicRiskLevel
  required_actions: string[]
  notes: string
  extraction_method: 'json' | 'line' | 'prose' | 'fallback'
}

const OPPORTUNITY_KEYWORDS = [
  /income idea/i,
  /business model/i,
  /market gap/i,
  /logistics?|freight|dispatch|carrier|route/i,
  /automation|workflow|ai automation/i,
  /acquisition target|buy(?:ing)? (?:a )?business/i,
  /recurring revenue|subscription|retainer/i,
  /licen[cs](?:e|ing)/i,
  /service offer|offer (?:a|an|the)/i,
  /local business|small business|home service/i,
  /digital product|template|course|toolkit/i,
  /lead generation|generate leads|appointment setting/i,
  /underserved industr(?:y|ies)|niche/i,
] as const

const ACTION_PHRASES = [
  /build\b/i,
  /sell\b/i,
  /offer\b/i,
  /research\b/i,
  /contact\b/i,
  /licen[cs]e\b/i,
  /automate\b/i,
  /generate leads\b/i,
  /create (?:an? )?proposal\b/i,
  /target businesses\b/i,
  /investigate (?:the )?market\b/i,
] as const

const URGENCY_PHRASES = /\b(?:urgent|now|immediately|this week|next 30 days|near-term|short-term|time-sensitive|limited window)\b/i
const HIGH_CONFIDENCE = /\b(?:high confidence|strong signal|clear demand|validated|proven|likely|strong opportunity)\b/i
const LOW_CONFIDENCE = /\b(?:low confidence|uncertain|speculative|unvalidated|weak signal)\b/i
const HEADING_ONLY = /^(?:summary|recommendations?|opportunities?|analysis|next steps?|risks?|notes?)[:\s-]*$/i

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const raw = String(value).toLowerCase().replace(/[$,]/g, '').trim()
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(k|m|million|thousand)?/)
  if (!match) return null
  const base = Number(match[1])
  if (!Number.isFinite(base)) return null
  const suffix = match[2]
  if (suffix === 'm' || suffix === 'million') return Math.round(base * 1_000_000)
  if (suffix === 'k' || suffix === 'thousand') return Math.round(base * 1_000)
  return base
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

function clampConfidence(confidence: number): number {
  return Math.min(0.92, Math.max(0.25, Number(confidence.toFixed(2))))
}

function textMatchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
}

function estimateValueFromText(text: string): number | null {
  const money = text.match(/\$\s*\d[\d,.]*(?:\s*(?:k|m|million|thousand))?/i)?.[0]
  if (money) return numberOrNull(money)
  const revenue = text.match(/\b\d+(?:\.\d+)?\s*(?:k|m|million|thousand)\s*(?:\/\s*)?(?:mo|month|monthly|yr|year|annual|annually|revenue|arr|mrr)?\b/i)?.[0]
  return revenue ? numberOrNull(revenue) : null
}

function riskFromText(text: string): EconomicRiskLevel {
  if (/critical risk|severe risk/i.test(text)) return 'critical'
  if (/high risk|regulated|compliance|capital intensive|fraud/i.test(text)) return 'high'
  if (/low risk|simple|low overhead|low capital/i.test(text)) return 'low'
  return 'medium'
}

function requiredActionsFromText(text: string): string[] {
  const actions: string[] = []
  if (/research|investigate|validate|market/i.test(text)) actions.push('investigate_market')
  if (/build|create|develop|launch/i.test(text)) actions.push('build_offer')
  if (/sell|offer|proposal|outreach/i.test(text)) actions.push('draft_approval_gated_offer')
  if (/contact|target businesses|lead/i.test(text)) actions.push('identify_leads')
  if (/licen[cs]/i.test(text)) actions.push('review_licensing_path')
  if (/automate|workflow/i.test(text)) actions.push('map_automation_workflow')
  actions.push('human_review')
  return [...new Set(actions)].slice(0, 8)
}

function scoreCandidateConfidence(text: string, estimatedValue: number | null, riskLevel: EconomicRiskLevel): number {
  let score = 0.42
  const words = text.split(/\s+/).filter(Boolean).length
  if (words >= 8) score += 0.08
  if (words >= 18) score += 0.07
  if (estimatedValue !== null) score += 0.12
  if (textMatchesAny(text, ACTION_PHRASES)) score += 0.12
  if (textMatchesAny(text, OPPORTUNITY_KEYWORDS)) score += 0.1
  if (URGENCY_PHRASES.test(text)) score += 0.05
  if (riskLevel === 'low') score += 0.04
  if (riskLevel === 'high') score -= 0.03
  if (riskLevel === 'critical') score -= 0.08
  if (HIGH_CONFIDENCE.test(text)) score += 0.1
  if (LOW_CONFIDENCE.test(text)) score -= 0.12
  return clampConfidence(score)
}

function cleanTitleFromText(text: string): string {
  return text
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')
    .replace(/^(?:opportunity|idea|recommendation|target|model|offer)\s*[:\-]\s*/i, '')
    .split(/\s+-\s+|\s+—\s+|:\s+/)[0]
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function candidateFromText(text: string, extractionMethod: Candidate['extraction_method']): Candidate | null {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length < 18 || HEADING_ONLY.test(cleaned)) return null
  if (!textMatchesAny(cleaned, OPPORTUNITY_KEYWORDS) && !textMatchesAny(cleaned, ACTION_PHRASES)) return null
  const title = cleanTitleFromText(cleaned)
  if (title.length < 5 || title.length > 180) return null
  const estimatedValue = estimateValueFromText(cleaned)
  const riskLevel = riskFromText(cleaned)
  return {
    title,
    estimated_value: estimatedValue,
    confidence: scoreCandidateConfidence(cleaned, estimatedValue, riskLevel),
    risk_level: riskLevel,
    required_actions: requiredActionsFromText(cleaned),
    notes: cleaned,
    extraction_method: extractionMethod,
  }
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
            extraction_method: 'json',
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
    const candidate = candidateFromText(cleaned, 'line')
    if (!candidate) continue
    candidates.push(candidate)
    if (candidates.length >= 8) break
  }
  return candidates
}

function extractProseCandidates(content: string): Candidate[] {
  const chunks = content
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
  const candidates: Candidate[] = []
  for (const chunk of chunks) {
    const candidate = candidateFromText(chunk, 'prose')
    if (!candidate) continue
    candidates.push(candidate)
    if (candidates.length >= 8) break
  }
  return candidates
}

function candidatesFrom(content: string): Candidate[] {
  return extractJsonCandidates(content)
    .concat(extractLineCandidates(content), extractProseCandidates(content))
    .slice(0, 12)
}

function fallbackQuality(content: string): { ok: boolean; reason: string } {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length < 80) return { ok: false, reason: 'provider_content_too_short' }
  const words = normalized.split(/\s+/).filter(Boolean).length
  const keywordMatches = countMatches(normalized, OPPORTUNITY_KEYWORDS)
  const actionMatches = countMatches(normalized, ACTION_PHRASES)
  const hasSignal = words >= 120 || keywordMatches > 0 || actionMatches > 0
  if (!hasSignal) return { ok: false, reason: 'no_actionable_signal' }
  if (words < 20 && actionMatches === 0) return { ok: false, reason: 'vague_keyword_only' }
  return { ok: true, reason: words >= 120 ? 'long_provider_analysis' : actionMatches > 0 ? 'action_phrase_match' : 'opportunity_keyword_match' }
}

function fallbackCandidate(content: string, command: string): Candidate | null {
  const quality = fallbackQuality(content)
  if (!quality.ok) return null
  const title = `Investigate ${command} opportunity`
  const riskLevel = riskFromText(content)
  const estimatedValue = estimateValueFromText(content)
  return {
    title,
    estimated_value: estimatedValue,
    confidence: clampConfidence(scoreCandidateConfidence(content, estimatedValue, riskLevel) - 0.1),
    risk_level: riskLevel,
    required_actions: requiredActionsFromText(content),
    notes: content.replace(/\s+/g, ' ').trim().slice(0, 4000),
    extraction_method: 'fallback',
  }
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
      telemetry: {
        attempted: 0,
        successfulCandidates: 0,
        fallbackStatus: 'not_needed',
        fallbackReason: null,
      },
    }
  }

  const opportunities: EconomicOpportunity[] = []
  const seen = new Set<string>()
  let fallbackStatus: EconomicExtractionTelemetry['fallbackStatus'] = 'not_needed'
  let fallbackReason: string | null = null
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
          extraction_method: candidate.extraction_method,
        },
        dedupe_key: dedupeKey,
        metadata: {
          session_id: input.sessionId ?? null,
          compression: 'provider_analysis_stored_in_source_details',
          extraction_method: candidate.extraction_method,
        },
      }))
    }
  }

  if (opportunities.length === 0) {
    const combinedContent = input.providerAnalyses
      .map(analysis => analysis.content.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!combinedContent) {
      fallbackStatus = 'no_provider_content'
      fallbackReason = 'no_successful_provider_content'
    } else {
      const quality = fallbackQuality(combinedContent)
      fallbackReason = quality.reason
      if (quality.ok) {
        const firstProvider = input.providerAnalyses.find(analysis => analysis.content.trim())?.provider_family ?? 'unknown'
        const candidate = fallbackCandidate(combinedContent, parsed.command)
        if (candidate) {
          const dedupeKey = buildOpportunityDedupeKey({
            provider: firstProvider,
            sessionId: input.sessionId,
            decree: input.decree,
            title: candidate.title,
          })
          opportunities.push(createOpportunityDraft({
            title: candidate.title,
            category: parsed.domain.id,
            source: input.decree,
            source_provider: firstProvider,
            confidence: candidate.confidence,
            estimated_value: candidate.estimated_value,
            assigned_family: parsed.domain.providerPriority[0],
            required_actions: candidate.required_actions,
            risk_level: candidate.risk_level,
            notes: candidate.notes,
            source_details: {
              provider_family: firstProvider,
              command: parsed.command,
              workflow_id: parsed.workflow.id,
              full_provider_analysis: combinedContent,
              extraction_method: 'fallback',
              fallback_reason: fallbackReason,
            },
            dedupe_key: dedupeKey,
            metadata: {
              session_id: input.sessionId ?? null,
              compression: 'provider_analysis_stored_in_source_details',
              extraction_method: 'fallback',
              fallback_reason: fallbackReason,
            },
          }))
          fallbackStatus = 'created'
        }
      } else {
        fallbackStatus = 'skipped_low_quality'
      }
    }
  }

  return {
    commandMatched: true,
    summary: `${opportunities.length} opportunities discovered and added to Opportunity Scout.`,
    opportunities,
    assignedFamily: parsed.domain.providerPriority[0],
    domainId: parsed.domain.id,
    telemetry: {
      attempted: input.providerAnalyses.length,
      successfulCandidates: opportunities.length,
      fallbackStatus,
      fallbackReason,
    },
  }
}
