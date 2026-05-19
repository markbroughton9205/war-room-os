import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { liveSignalsAvailable } from '@/lib/opportunities/degradedMode'
import { parseOpportunitiesFromText } from '@/lib/opportunities/parse'
import { registerScoutOpportunities } from '@/lib/opportunities/store'
import { familyRequiresOpportunity } from '@/lib/opportunities/schema'
import type { ScoutOpportunity } from '@/lib/opportunities/schema'
import { validateOpportunityResponse, type OpportunityValidationResult } from '@/lib/opportunities/validate'
import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import type { ResponseIntegrityResult } from '@/lib/providers/responseIntegrity'

export type OpportunityEnforcementResult = {
  opportunities: ScoutOpportunity[]
  validation: OpportunityValidationResult
  integritySupplement: ResponseIntegrityResult | null
  registered: ScoutOpportunity[]
}

export function enforceCouncilOpportunities(args: {
  family: CouncilOrchestrationFamily
  text: string
  threadId: string
  liveResearchPacket?: LiveResearchEvidencePacket
}): OpportunityEnforcementResult {
  const opportunities = parseOpportunitiesFromText(args.text)
  const validation = validateOpportunityResponse(args.text, opportunities)
  const live = liveSignalsAvailable(args.liveResearchPacket)

  let registered: ScoutOpportunity[] = []
  if (validation.ok && opportunities.length) {
    registered = registerScoutOpportunities({
      threadId: args.threadId,
      family: args.family,
      packets: opportunities,
      liveSignalsAvailable: live,
    })
  }

  let integritySupplement: ResponseIntegrityResult | null = null
  if (familyRequiresOpportunity(args.family) && !validation.ok) {
    integritySupplement = {
      integrity_status: 'DEGRADED_RESPONSE_QUALITY',
      confidence: 90,
      reason: `opportunity integrity failed: ${validation.reason}`,
      retry_recommended: true,
      fallback_recommended: false,
      degraded_quality: true,
    }
  }

  return {
    opportunities: registered.length ? registered : [],
    validation,
    integritySupplement,
    registered,
  }
}
