import { NEBULA_AGENTS_BY_ID, type NebulaAgentId } from './identity'
import { stripHiddenReasoning } from './thinkingStrip'

const INTERNAL_SCHEMA_KEYS = [
  'failureModes',
  'likelihood',
  'impact',
  'mitigation',
  'strongestCounterexample',
  'recoveryPlan',
  'rejectionConditions',
  'evidencePackets',
  'missingEvidence',
  'contradictorySignals',
  'searchCoverage',
  'searchCoverageNotes',
  'claims',
  'verdict',
  'evidenceIds',
  'staleSources',
  'missingTests',
  'components',
  'interfaces',
  'dataModel',
  'operationalRisks',
  'tests',
  'testPlan',
  'decisionOrSynthesis',
  'supportingFindings',
  'taskGraph',
  'selectedSpecialists',
] as const

const FRONTIER_SPEAKER = /\b(chatgpt|openai|claude|anthropic|grok|xai|gemini|google|moonshot|kimi)\b/i
const LEGACY_FAMILY_LANGUAGE =
  /\b(families assigned|family prior response delivered|family reviewing previous|claude family|chatgpt family|gemini family|grok family|kimi family|red team)\b/i

export type PresentedAgentMessage = {
  agentId: NebulaAgentId | null
  speaker: string
  role: string
  prose: string
  structuredOutput: Record<string, unknown> | null
}

export function looksLikeStructuredDump(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true
  return INTERNAL_SCHEMA_KEYS.some(key => new RegExp(`["']?${key}["']?\\s*:`).test(trimmed))
}

export function parseStructuredObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    const parts = value
      .map(item => {
        if (typeof item === 'string') return item.trim()
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          return firstString(record.summary ?? record.claim ?? record.failureModes ?? record.text)
        }
        return null
      })
      .filter((item): item is string => Boolean(item))
    return parts[0] ?? null
  }
  return null
}

export function structuredToProse(agentId: NebulaAgentId | null, body: Record<string, unknown>): string {
  const name = agentId ? NEBULA_AGENTS_BY_ID[agentId].name : 'Council'
  const role = agentId ? NEBULA_AGENTS_BY_ID[agentId].role : 'Council'
  const lead =
    firstString(body.decisionOrSynthesis)
    ?? firstString(body.summary)
    ?? firstString(body.objective)
    ?? firstString(body.verdict)
    ?? firstString(body.mitigation)
    ?? firstString(body.strongestCounterexample)
    ?? firstString(body.recoveryPlan)
    ?? firstString(body.evidencePackets)
    ?? firstString(body.failureModes)
    ?? firstString(body.components)
    ?? firstString(body.practicalRecommendations)
    ?? firstString(body.claims)
  if (lead) return lead
  const keys = Object.keys(body).slice(0, 3).join(', ')
  return `${name} completed a ${role.toLowerCase()} pass. Internal fields (${keys}) are retained in Inspector, not chat.`
}

export function presentAgentMessage(params: {
  agentId?: NebulaAgentId | null
  speaker?: string
  role?: string
  raw: string
}): PresentedAgentMessage {
  const agentId = params.agentId ?? null
  const speaker = params.speaker ?? (agentId ? NEBULA_AGENTS_BY_ID[agentId].name : 'Council')
  const role = params.role ?? (agentId ? NEBULA_AGENTS_BY_ID[agentId].role : 'Council')
  const cleaned = stripHiddenReasoning(params.raw)
  const structured = parseStructuredObject(cleaned)
  if (structured && looksLikeStructuredDump(cleaned)) {
    return {
      agentId,
      speaker,
      role,
      prose: structuredToProse(agentId, structured),
      structuredOutput: structured,
    }
  }
  return {
    agentId,
    speaker,
    role,
    prose: cleaned,
    structuredOutput: structured,
  }
}

export function containsLegacyFamilyLanguage(text: string): boolean {
  return LEGACY_FAMILY_LANGUAGE.test(text)
}

export function containsFrontierSpeakerIdentity(text: string): boolean {
  return FRONTIER_SPEAKER.test(text)
}

export function roleLineForChat(speaker: string, role: string): string {
  const shortRole = role.split('/')[0]?.trim() || role
  return `${speaker} · ${shortRole.toUpperCase()}`
}
