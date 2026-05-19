import type { OpportunityPacket } from '@/lib/opportunities/schema'
import { familyRequiresOpportunity, OPPORTUNITY_REQUIRED_KEYS } from '@/lib/opportunities/schema'

export const VAGUE_OPPORTUNITY_PATTERNS = [
  /\bneed\s+more\s+data\b/i,
  /\bopportunity\s+exists\b/i,
  /\bmarket\s+uncertain\b/i,
  /\bunable\s+to\s+identify\s+(?:a\s+)?(?:specific\s+)?opportunit/i,
  /\btoo\s+early\s+to\s+recommend\b/i,
  /\binsufficient\s+data\s+to\s+propose\b/i,
  /\bwithout\s+live\s+signals?,?\s+(?:i\s+)?cannot\b/i,
]

export type OpportunityValidationResult = {
  ok: boolean
  vagueOnly: boolean
  hasActionable: boolean
  reason: string
  missingFields: string[]
}

export function hasActionableOpportunity(opportunities: OpportunityPacket[]): boolean {
  return opportunities.some(o => o.opportunityTitle.trim().length >= 6 && o.confidence > 0)
}

export function detectVagueOpportunityLanguage(text: string): boolean {
  return VAGUE_OPPORTUNITY_PATTERNS.some(pattern => pattern.test(text))
}

function missingRequiredFields(packet: OpportunityPacket): string[] {
  const missing: string[] = []
  for (const key of OPPORTUNITY_REQUIRED_KEYS) {
    const value = packet[key]
    if (key === 'toolsRequired' || key === 'risks') {
      if (!Array.isArray(value) || value.length === 0) missing.push(key)
      continue
    }
    if (key === 'confidence') {
      if (typeof value !== 'number' || value <= 0) missing.push(key)
      continue
    }
    if (typeof value !== 'string' || !value.trim() || value === 'unknown') missing.push(key)
  }
  return missing
}

export function validateOpportunityResponse(
  text: string,
  opportunities: OpportunityPacket[],
): OpportunityValidationResult {
  const vagueOnly = detectVagueOpportunityLanguage(text) && !hasActionableOpportunity(opportunities)
  const hasActionable = hasActionableOpportunity(opportunities)

  if (hasActionable) {
    const first = opportunities[0]!
    const missingFields = missingRequiredFields(first)
    if (missingFields.length) {
      return {
        ok: false,
        vagueOnly,
        hasActionable: false,
        reason: `opportunity missing required fields: ${missingFields.join(', ')}`,
        missingFields,
      }
    }
    return {
      ok: true,
      vagueOnly: false,
      hasActionable: true,
      reason: 'at least one actionable opportunity present',
      missingFields: [],
    }
  }

  if (vagueOnly) {
    return {
      ok: false,
      vagueOnly: true,
      hasActionable: false,
      reason: 'vague-only language without actionable opportunity packet',
      missingFields: OPPORTUNITY_REQUIRED_KEYS.slice(),
    }
  }

  return {
    ok: false,
    vagueOnly: false,
    hasActionable: false,
    reason: 'no actionable opportunity packet parsed',
    missingFields: OPPORTUNITY_REQUIRED_KEYS.slice(),
  }
}

export function opportunityIntegrityRequired(
  family: string,
  opportunities: OpportunityPacket[],
  text: string,
): boolean {
  if (!familyRequiresOpportunity(family as never)) return false
  const validation = validateOpportunityResponse(text, opportunities)
  return !validation.ok
}
