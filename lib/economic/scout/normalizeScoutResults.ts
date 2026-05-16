import type { EconomicFamily, EconomicOperationalDomainId, EconomicRiskLevel } from '@/lib/economic/types'

export type ScoutProvider = 'tavily' | 'firecrawl' | 'decree_fallback'

export type RawScoutResult = {
  provider: ScoutProvider
  query: string
  title: string
  url: string
  snippet: string
  rawScore?: number | null
}

export type ScoutFamilyScores = {
  chatgpt: {
    revenue_potential: number
    speed_to_cash: number
    scalability: number
  }
  claude: {
    feasibility: number
    operational_complexity: number
    sustainability: number
  }
  grok: {
    market_demand: number
    trend_strength: number
    validation: number
  }
  gemini: {
    ecosystem_fit: number
    strategic_positioning: number
    future_relevance: number
  }
  red_team: {
    fraud_risk: number
    contradiction_risk: number
    scam_risk: number
  }
}

export type NormalizedScoutCandidate = {
  title: string
  summary: string
  url: string | null
  source: string
  source_provider: ScoutProvider
  category: EconomicOperationalDomainId
  estimated_value: number | null
  confidence: number
  risk_level: EconomicRiskLevel
  required_actions: string[]
  family_scores: ScoutFamilyScores
  rank_score: number
  assigned_family: EconomicFamily
  evidence: {
    query: string
    snippet: string
    sources: string[]
  }
}

const HIGH_RISK = /\b(?:scam|guaranteed|pay upfront|crypto|wire transfer|bank login|no experience required.*\$\d+|get rich quick)\b/i
const LOW_RISK = /\b(?:verified|report|survey|trend|case study|official|market size|demand|RFP|hiring|job posting)\b/i
const VALUE = /\$\s*\d[\d,.]*(?:\s*(?:k|m|million|thousand))?|\b\d+(?:\.\d+)?\s*(?:k|m|million|thousand)\s*(?:mrr|arr|revenue|monthly|annually)?\b/i
const DEMAND = /\b(?:demand|shortage|underserved|gap|growth|hiring|requests?|RFP|trend|needs?|pain point|backlog)\b/i
const ACTION = /\b(?:build|offer|sell|target|contact|validate|research|automate|license|generate leads|create proposal)\b/i
const RECURRING = /\b(?:recurring|subscription|retainer|monthly|SaaS|maintenance|managed service)\b/i
const AUTOMATION = /\b(?:automation|workflow|AI agent|AI service|zapier|manual process|back office)\b/i
const LOGISTICS = /\b(?:freight|logistics|dispatch|carrier|route|lane|warehouse|last mile)\b/i

function clamp(value: number): number {
  return Math.min(0.95, Math.max(0.05, Number(value.toFixed(2))))
}

function sourceFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'external_market_intelligence'
  }
}

function titleFrom(raw: RawScoutResult): string {
  return raw.title
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
    || 'Live market opportunity signal'
}

function estimateValue(text: string): number | null {
  const match = text.match(VALUE)?.[0]
  if (!match) return null
  const normalized = match.toLowerCase().replace(/[$,]/g, '').trim()
  const amount = normalized.match(/\d+(?:\.\d+)?/)?.[0]
  if (!amount) return null
  const base = Number(amount)
  if (!Number.isFinite(base)) return null
  if (/\bm|million\b/.test(normalized)) return Math.round(base * 1_000_000)
  if (/\bk|thousand\b/.test(normalized)) return Math.round(base * 1_000)
  return Math.round(base)
}

function riskLevel(text: string): EconomicRiskLevel {
  if (HIGH_RISK.test(text)) return 'high'
  if (LOW_RISK.test(text)) return 'low'
  return 'medium'
}

function actionsFor(text: string): string[] {
  const actions = ['human_review']
  if (DEMAND.test(text)) actions.unshift('validate_market_demand')
  if (ACTION.test(text)) actions.unshift('draft_approval_gated_offer')
  if (AUTOMATION.test(text)) actions.unshift('map_automation_workflow')
  if (LOGISTICS.test(text)) actions.unshift('research_freight_lane_or_logistics_need')
  if (RECURRING.test(text)) actions.unshift('model_recurring_revenue_offer')
  return [...new Set(actions)].slice(0, 8)
}

function scoreFamilySignals(text: string, hasValue: boolean, risk: EconomicRiskLevel): ScoutFamilyScores {
  const demand = DEMAND.test(text) ? 0.78 : 0.48
  const action = ACTION.test(text) ? 0.72 : 0.44
  const recurring = RECURRING.test(text) ? 0.78 : 0.45
  const automation = AUTOMATION.test(text) ? 0.8 : 0.46
  const logistics = LOGISTICS.test(text) ? 0.74 : 0.44
  const riskPenalty = risk === 'high' ? -0.18 : risk === 'low' ? 0.08 : 0

  return {
    chatgpt: {
      revenue_potential: clamp((hasValue ? 0.78 : 0.52) + (recurring > 0.7 ? 0.08 : 0) + riskPenalty),
      speed_to_cash: clamp(action + (hasValue ? 0.08 : 0) + riskPenalty),
      scalability: clamp(Math.max(recurring, automation) + riskPenalty),
    },
    claude: {
      feasibility: clamp(action + (risk === 'low' ? 0.1 : 0) - (risk === 'high' ? 0.15 : 0)),
      operational_complexity: clamp(risk === 'high' ? 0.36 : automation > 0.7 || logistics > 0.7 ? 0.58 : 0.68),
      sustainability: clamp(Math.max(recurring, demand) + riskPenalty),
    },
    grok: {
      market_demand: clamp(demand + (logistics > 0.7 ? 0.06 : 0)),
      trend_strength: clamp((/\b(?:growing|trend|surge|shortage|demand)\b/i.test(text) ? 0.78 : 0.5) + riskPenalty),
      validation: clamp((hasValue || /hiring|RFP|report|survey/i.test(text) ? 0.72 : 0.46) + riskPenalty),
    },
    gemini: {
      ecosystem_fit: clamp((automation > 0.7 || logistics > 0.7 ? 0.7 : 0.52) + riskPenalty),
      strategic_positioning: clamp(Math.max(demand, recurring) + riskPenalty),
      future_relevance: clamp((automation > 0.7 || /AI|future|emerging|digital/i.test(text) ? 0.8 : 0.48) + riskPenalty),
    },
    red_team: {
      fraud_risk: clamp(risk === 'high' ? 0.82 : risk === 'low' ? 0.24 : 0.48),
      contradiction_risk: clamp(/\b(?:guaranteed|instant|no risk|too good|secret)\b/i.test(text) ? 0.72 : 0.36),
      scam_risk: clamp(HIGH_RISK.test(text) ? 0.86 : 0.34),
    },
  }
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function familyOverall(scores: ScoutFamilyScores): Record<EconomicFamily, number> {
  return {
    chatgpt: average(Object.values(scores.chatgpt)),
    claude: average(Object.values(scores.claude)),
    grok: average(Object.values(scores.grok)),
    gemini: average(Object.values(scores.gemini)),
    red_team: 1 - average(Object.values(scores.red_team)),
  }
}

function assignedFamily(scores: ScoutFamilyScores, fallback: EconomicFamily): EconomicFamily {
  const ranked = Object.entries(familyOverall(scores))
    .filter(([family]) => family !== 'red_team')
    .sort((a, b) => b[1] - a[1])
  return (ranked[0]?.[0] as EconomicFamily | undefined) ?? fallback
}

export function normalizeScoutResults(input: {
  rawResults: readonly RawScoutResult[]
  domainId: EconomicOperationalDomainId
  fallbackFamily: EconomicFamily
}): NormalizedScoutCandidate[] {
  const byUrl = new Map<string, NormalizedScoutCandidate>()
  for (const raw of input.rawResults) {
    const text = `${raw.title} ${raw.snippet}`.replace(/\s+/g, ' ').trim()
    if (!raw.url || !/^https?:\/\//i.test(raw.url) || text.length < 20) continue
    const value = estimateValue(text)
    const risk = riskLevel(text)
    const scores = scoreFamilySignals(text, value !== null, risk)
    const overall = familyOverall(scores)
    const source = sourceFromUrl(raw.url)
    const confidence = clamp(
      0.35
      + (DEMAND.test(text) ? 0.16 : 0)
      + (ACTION.test(text) ? 0.12 : 0)
      + (value !== null ? 0.12 : 0)
      + (raw.provider === 'firecrawl' ? 0.06 : 0)
      + (typeof raw.rawScore === 'number' ? Math.min(0.12, raw.rawScore / 10) : 0),
    )
    const candidate: NormalizedScoutCandidate = {
      title: titleFrom(raw),
      summary: raw.snippet.replace(/\s+/g, ' ').trim().slice(0, 1000),
      url: raw.url,
      source,
      source_provider: raw.provider,
      category: input.domainId,
      estimated_value: value,
      confidence,
      risk_level: risk,
      required_actions: actionsFor(text),
      family_scores: scores,
      rank_score: clamp(average(Object.values(overall)) * 0.75 + confidence * 0.25),
      assigned_family: assignedFamily(scores, input.fallbackFamily),
      evidence: {
        query: raw.query,
        snippet: raw.snippet.slice(0, 1500),
        sources: [raw.url],
      },
    }
    const previous = byUrl.get(raw.url)
    if (!previous || candidate.rank_score > previous.rank_score) byUrl.set(raw.url, candidate)
  }
  return Array.from(byUrl.values()).sort((a, b) => b.rank_score - a.rank_score)
}

export function buildDecreeFallbackCandidate(input: {
  decree: string
  domainId: EconomicOperationalDomainId
  fallbackFamily: EconomicFamily
  reason: string
}): NormalizedScoutCandidate {
  const scores = scoreFamilySignals(input.decree, false, 'medium')
  return {
    title: input.domainId === 'income_ops'
      ? 'Investigate income generation opportunities'
      : `Investigate ${input.domainId.replace(/_/g, ' ')} opportunities`,
    summary: `Live scout did not return usable external candidates. Create a low-confidence investigation packet for human review before any action. Reason: ${input.reason}`,
    url: null,
    source: 'decree_fallback',
    source_provider: 'decree_fallback',
    category: input.domainId,
    estimated_value: null,
    confidence: 0.28,
    risk_level: 'medium',
    required_actions: [
      'Run live market scout',
      'Identify 3 monetizable opportunities',
      'Estimate speed to cash',
      'Estimate startup cost',
      "Rank top path for Ra'el",
    ],
    family_scores: scores,
    rank_score: 0.25,
    assigned_family: input.fallbackFamily,
    evidence: {
      query: input.decree,
      snippet: 'No live source snippet available. This fallback is an internal investigation placeholder only.',
      sources: [],
    },
  }
}
