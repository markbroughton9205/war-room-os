/**
 * #22 Phase 1 — Council auto-research authority classification (Gate B).
 *
 * READ-ONLY DISCOVERY / SEARCH / PASSIVE PUBLIC FETCH → BOUNDED_ALLOWED (session-scoped).
 * PERSISTENT CRAWL / SOURCE EXPANSION → existing crawler governance (NOT auto-research).
 * EXTERNAL MUTATION / PAID SPEND → NOT auto-authorized.
 *
 * Does not disable useful research — classifies it correctly.
 */
import type { PolicyAuthorityLevel, RiskTier } from '@/lib/agent-capability-matrix/types'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'

export const COUNCIL_AUTO_RESEARCH_CAPABILITIES = [
  'SEARCH',
  'READ',
  'FETCH',
  'CRAWL',
  'PERSIST',
  'EXTERNAL_MUTATION',
  'PAID_SPEND',
] as const
export type CouncilAutoResearchCapability = (typeof COUNCIL_AUTO_RESEARCH_CAPABILITIES)[number]

export type CouncilAutoResearchClass = {
  capability: CouncilAutoResearchCapability
  authority: PolicyAuthorityLevel
  riskTier: RiskTier
  autoAllowedInCouncilSession: boolean
  notes: string
}

export const COUNCIL_AUTO_RESEARCH_CLASSIFICATION: readonly CouncilAutoResearchClass[] = Object.freeze([
  {
    capability: 'SEARCH',
    authority: 'BOUNDED_ALLOWED',
    riskTier: 'TIER_0_READ_OBSERVE',
    autoAllowedInCouncilSession: true,
    notes: 'Server-driven live research under Commander chat/ASTRA execute session.',
  },
  {
    capability: 'READ',
    authority: 'BOUNDED_ALLOWED',
    riskTier: 'TIER_0_READ_OBSERVE',
    autoAllowedInCouncilSession: true,
    notes: 'Read discovery results / RSS / NWS / provider documents.',
  },
  {
    capability: 'FETCH',
    authority: 'BOUNDED_ALLOWED',
    riskTier: 'TIER_0_READ_OBSERVE',
    autoAllowedInCouncilSession: true,
    notes: 'Passive public HTTP fetch and research-engine provider GETs/POSTs for retrieval.',
  },
  {
    capability: 'CRAWL',
    authority: 'APPROVAL_REQUIRED',
    riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
    autoAllowedInCouncilSession: false,
    notes: 'Persistent crawl / corpus expansion uses CrawlApproval — not Council auto-research.',
  },
  {
    capability: 'PERSIST',
    authority: 'APPROVAL_REQUIRED',
    riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
    autoAllowedInCouncilSession: false,
    notes: 'Durable memory/corpus writes are not auto-research side effects.',
  },
  {
    capability: 'EXTERNAL_MUTATION',
    authority: 'DENIED',
    riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
    autoAllowedInCouncilSession: false,
    notes: 'Council auto-research must not mutate external accounts or resources.',
  },
  {
    capability: 'PAID_SPEND',
    authority: 'DENIED',
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    autoAllowedInCouncilSession: false,
    notes: 'Metered provider calls for retrieval are discovery costs, not financial spend/transfer authority.',
  },
])

export type CouncilAutoResearchRequest = {
  /** Intended capability for this invocation. */
  capability: CouncilAutoResearchCapability
  /** True when running inside an authenticated Council/ASTRA Commander session path. */
  commanderSessionContext: boolean
  /** True if the call would expand crawl corpus / approved-URL crawl. */
  crawlExpansion?: boolean
  /** True if the call would perform external non-discovery mutation. */
  externalMutation?: boolean
  /** True if the call would spend/transfer money (not merely metered API retrieval). */
  financialSpend?: boolean
}

/**
 * Classify and gate a Council auto-research attempt.
 * Read-only discovery remains usable; mutation/crawl/spend fail closed.
 */
export function evaluateCouncilAutoResearch(request: CouncilAutoResearchRequest): PolicyDecision {
  if (request.financialSpend) {
    return {
      outcome: 'DENY',
      reasonCode: 'POLICY_DENIED',
      reason: 'Council auto-research does not authorize financial spend/transfer.',
      actionKind: 'council_auto_research',
      canonicalKind: 'financial',
      riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
      technicalReach: 'NO_REACH',
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }

  if (request.externalMutation) {
    return {
      outcome: 'DENY',
      reasonCode: 'POLICY_DENIED',
      reason: 'Council auto-research does not authorize external mutation.',
      actionKind: 'council_auto_research',
      canonicalKind: 'external_account',
      riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
      technicalReach: 'NO_REACH',
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }

  if (request.crawlExpansion || request.capability === 'CRAWL') {
    return {
      outcome: 'REQUIRE_APPROVAL',
      reasonCode: 'APPROVAL_MISSING',
      reason: 'Persistent crawl/source expansion requires CrawlApproval — not auto-research.',
      actionKind: 'council_auto_research',
      canonicalKind: 'external_account',
      riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
      technicalReach: 'EXECUTE_CONTROLLED',
      policyAuthority: 'APPROVAL_REQUIRED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }

  if (request.capability === 'PERSIST') {
    return {
      outcome: 'REQUIRE_APPROVAL',
      reasonCode: 'APPROVAL_MISSING',
      reason: 'Durable persist is not part of Council auto-research authority.',
      actionKind: 'council_auto_research',
      canonicalKind: null,
      riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
      technicalReach: 'WRITE_BOUNDED',
      policyAuthority: 'APPROVAL_REQUIRED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }

  const row = COUNCIL_AUTO_RESEARCH_CLASSIFICATION.find(c => c.capability === request.capability)
  if (!row || !row.autoAllowedInCouncilSession) {
    return {
      outcome: 'DENY',
      reasonCode: 'POLICY_DENIED',
      reason: `Council auto-research capability ${request.capability} is not auto-allowed.`,
      actionKind: 'council_auto_research',
      canonicalKind: null,
      riskTier: row?.riskTier ?? 'TIER_3_EXTERNAL_REMOTE_MUTATION',
      technicalReach: null,
      policyAuthority: row?.authority ?? 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }

  if (!request.commanderSessionContext) {
    return {
      outcome: 'REQUIRE_APPROVAL',
      reasonCode: 'APPROVAL_MISSING',
      reason: 'Council auto-research requires Commander session context (SESSION_APPROVAL semantics).',
      actionKind: 'council_auto_research',
      canonicalKind: null,
      riskTier: row.riskTier,
      technicalReach: 'READ_ONLY',
      policyAuthority: 'BOUNDED_ALLOWED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 401,
    }
  }

  return {
    outcome: 'ALLOW',
    reasonCode: 'ALLOWED_BOUNDED_READ',
    reason:
      'Council auto-research classified as SESSION_BOUNDED read-only discovery/search/fetch under Commander session.',
    actionKind: 'council_auto_research',
    canonicalKind: null,
    riskTier: row.riskTier,
    technicalReach: 'READ_ONLY',
    policyAuthority: 'BOUNDED_ALLOWED',
    requiresApproval: false,
    approvalSatisfied: true,
    httpStatus: 200,
  }
}

/** Final Gate B label for docs/audit. */
export const COUNCIL_AUTO_RESEARCH_AUTHORITY_LABEL =
  'SESSION_BOUNDED_READ_ONLY_DISCOVERY' as const
