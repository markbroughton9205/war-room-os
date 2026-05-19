import type { OpportunityPacket } from '@/lib/opportunities/schema'
import { OPPORTUNITY_REQUIRED_KEYS } from '@/lib/opportunities/schema'

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => asString(v)).filter(Boolean).slice(0, 12)
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,;|]/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 12)
  }
  return []
}

function asConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(asString(value))
  if (!Number.isFinite(n)) return 0
  if (n > 1 && n <= 100) return Math.round(n)
  if (n > 0 && n <= 1) return Math.round(n * 100)
  return Math.max(0, Math.min(100, Math.round(n)))
}

function normalizeOpportunity(raw: Record<string, unknown>): OpportunityPacket | null {
  const title = asString(raw.opportunityTitle ?? raw.title)
  if (!title || title.length < 6) return null
  const packet: OpportunityPacket = {
    opportunityTitle: title,
    startupCost: asString(raw.startupCost ?? raw.startup_cost, 'unknown'),
    estimatedRevenue: asString(raw.estimatedRevenue ?? raw.estimated_revenue, 'unknown'),
    timeToLaunch: asString(raw.timeToLaunch ?? raw.time_to_launch, 'unknown'),
    toolsRequired: asStringArray(raw.toolsRequired ?? raw.tools_required),
    targetCustomer: asString(raw.targetCustomer ?? raw.target_customer, 'unspecified'),
    executionDifficulty: asString(raw.executionDifficulty ?? raw.execution_difficulty, 'medium'),
    confidence: asConfidence(raw.confidence),
    risks: asStringArray(raw.risks),
    whyNow: asString(raw.whyNow ?? raw.why_now, 'unspecified'),
  }
  for (const key of OPPORTUNITY_REQUIRED_KEYS) {
    const value = packet[key]
    if (value === '' || value === 'unknown' || value === 'unspecified') {
      if (key === 'risks' || key === 'toolsRequired') continue
      if (key === 'confidence' && packet.confidence <= 0) return null
    }
  }
  if (!packet.risks.length) packet.risks = ['Execution risk not specified by provider']
  if (!packet.toolsRequired.length) packet.toolsRequired = ['To be validated']
  return packet
}

function extractJsonFence(text: string): string | null {
  const tagged = text.match(/```json\s+actionable_opportunities\s*([\s\S]*?)```/i)
  if (tagged?.[1]) return tagged[1].trim()
  const generic = text.match(/```json\s*([\s\S]*?"opportunities"[\s\S]*?)```/i)
  if (generic?.[1]) return generic[1].trim()
  const section = text.match(/###\s*actionable[_\s-]*opportunities[\s\S]*?```json\s*([\s\S]*?)```/i)
  if (section?.[1]) return section[1].trim()
  return null
}

/** Remove mandatory JSON block from operator-facing council prose. */
export function stripOpportunityJsonBlock(text: string): string {
  return text
    .replace(/```json\s+actionable_opportunities[\s\S]*?```/gi, '')
    .replace(/###\s*Mandatory actionable opportunities[\s\S]*?(?=\n###|\n##|$)/i, '')
    .trim()
}

/** Parse opportunity packets from provider prose + JSON block. */
export function parseOpportunitiesFromText(text: string): OpportunityPacket[] {
  const jsonText = extractJsonFence(text)
  if (!jsonText) return []
  try {
    const parsed = JSON.parse(jsonText) as unknown
    const list =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as { opportunities?: unknown }).opportunities
        : parsed
    if (!Array.isArray(list)) return []
    return list
      .map(item => (item && typeof item === 'object' ? normalizeOpportunity(item as Record<string, unknown>) : null))
      .filter((item): item is OpportunityPacket => Boolean(item))
  } catch {
    return []
  }
}
