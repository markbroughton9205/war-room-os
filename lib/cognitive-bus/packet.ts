import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { toDisplayText } from '@/lib/council/toDisplayText'
import type { ProviderPacketIntegrityStatus, StructuredProviderPacket } from '@/lib/cognitive-bus/types'
import { parseOpportunitiesFromText } from '@/lib/opportunities/parse'
import type { OpportunityPacket } from '@/lib/opportunities/schema'

export type BuildProviderPacketInput = {
  family: CouncilOrchestrationFamily
  providerId?: string
  displayText: string
  integrityStatus?: ProviderPacketIntegrityStatus
  confidence?: number
  contradictions?: string[]
  recommendations?: string[]
  escalationRequests?: string[]
  opportunities?: OpportunityPacket[]
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

function extractBulletLines(text: string, prefix: RegExp): string[] {
  return text
    .split(/\n/)
    .map(line => line.trim())
    .filter(line => prefix.test(line))
    .map(line => line.replace(prefix, '').trim())
    .filter(Boolean)
    .slice(0, 8)
}

/** Derive structured fields from sanitized provider text without fabricating consensus. */
export function buildStructuredProviderPacket(input: BuildProviderPacketInput): StructuredProviderPacket {
  const text = toDisplayText(input.displayText)
  const observations =
    extractBulletLines(text, /^[-*•]\s*(?:observation|finding)[:\s]*/i).length > 0
      ? extractBulletLines(text, /^[-*•]\s*(?:observation|finding)[:\s]*/i)
      : text
          .split(/\n+/)
          .map(s => s.trim())
          .filter(s => s.length > 24 && s.length < 480)
          .slice(0, 5)

  const contradictions =
    input.contradictions ??
    extractBulletLines(text, /^[-*•]\s*(?:contradiction|conflict)[:\s]*/i)
  const recommendations =
    input.recommendations ??
    extractBulletLines(text, /^[-*•]\s*(?:recommend|next step)[:\s]*/i)
  const escalation_requests =
    input.escalationRequests ??
    extractBulletLines(text, /^[-*•]\s*(?:escalat|approval)[:\s]*/i)

  let confidence = input.confidence
  if (confidence === undefined) {
    if (input.integrityStatus === 'verified') confidence = 0.85
    else if (input.integrityStatus === 'degraded') confidence = 0.55
    else if (input.integrityStatus === 'incomplete') confidence = 0.35
    else confidence = 0.5
  }

  const opportunities =
    input.opportunities?.length ? input.opportunities : parseOpportunitiesFromText(text)

  return {
    provider_id: input.providerId ?? input.family,
    family: input.family,
    timestamp: new Date().toISOString(),
    integrity_status: input.integrityStatus ?? 'unknown',
    observations: observations.length ? observations : text ? [text.slice(0, 360)] : [],
    confidence: clampConfidence(confidence),
    contradictions,
    recommendations,
    escalation_requests,
    opportunities,
  }
}

export function packetsConflict(
  left: StructuredProviderPacket,
  right: StructuredProviderPacket,
): boolean {
  if (left.family === right.family) return false
  const leftClaims = new Set(left.observations.map(o => o.toLowerCase().slice(0, 80)))
  for (const obs of right.contradictions) {
    const key = obs.toLowerCase().slice(0, 80)
    if (key && [...leftClaims].some(c => c.includes(key) || key.includes(c))) return true
  }
  if (left.contradictions.length && right.observations.length) return true
  return Math.abs(left.confidence - right.confidence) >= 0.45 && left.observations.length > 0 && right.observations.length > 0
}
