import { assertAllExternalActionsApprovalGated } from '@/lib/economic/approvalSafeguards'
import { parseEconomicOperationalCommand } from '@/lib/economic/commands'
import { ECONOMIC_DOMAIN_REGISTRY } from '@/lib/economic/domains'
import { extractEconomicOpportunities } from '@/lib/economic/extraction'
import { ECONOMIC_FAMILY_ROLE_REGISTRY } from '@/lib/economic/familyRoles'
import { createOpportunityDraft, validateOpportunity } from '@/lib/economic/opportunities'
import { assertProposalExternalUseBlockedUntilApproved, createProposalDraft } from '@/lib/economic/proposals'
import { resolveEconomicOpsRouting } from '@/lib/economic/routing'
import { ECONOMIC_OPERATIONAL_DOMAINS } from '@/lib/economic/types'
import { workflowRequiresHumanApproval } from '@/lib/economic/workflowQueue'

export function assertEconomicDomainRegistryComplete(): void {
  const registered = new Set(ECONOMIC_DOMAIN_REGISTRY.map(domain => domain.id))
  for (const domainId of ECONOMIC_OPERATIONAL_DOMAINS) {
    if (!registered.has(domainId)) {
      throw new Error(`Missing economic domain registry entry: ${domainId}`)
    }
  }

  for (const domain of ECONOMIC_DOMAIN_REGISTRY) {
    if (!domain.providerPriority.length) throw new Error(`Domain lacks provider priority: ${domain.id}`)
    if (!domain.allowedTools.length) throw new Error(`Domain lacks allowed tools: ${domain.id}`)
    if (domain.outputStructure.approvalGate !== 'human_required') {
      throw new Error(`Domain output is not human approval gated: ${domain.id}`)
    }
  }
}

export function assertEconomicFamilyRolesGuidanceOnly(): void {
  for (const role of ECONOMIC_FAMILY_ROLE_REGISTRY) {
    if (role.routingUse !== 'guidance_only') {
      throw new Error(`Economic family role is not guidance-only: ${role.family}`)
    }
  }
}

export function assertEconomicCommandFoundations(): void {
  const examples = [
    'scan opportunities',
    'research market gaps',
    'generate income ideas',
    'analyze freight demand',
    'create outreach proposal',
    'investigate automation business',
    'identify underserved industries',
    'build acquisition targets',
  ]

  for (const input of examples) {
    const parsed = parseEconomicOperationalCommand(input)
    if (!parsed.matched) throw new Error(`Economic command did not parse: ${input}`)
    const route = resolveEconomicOpsRouting(input)
    if (route.mode !== 'economic_ops') throw new Error(`Economic command did not route as economic_ops: ${input}`)
    workflowRequiresHumanApproval(parsed.workflow)
    if (!parsed.recommendedFamilies.length) throw new Error(`Economic command lacks routing guidance: ${input}`)
  }
}

export function assertEconomicOpportunityFoundation(): void {
  const opportunity = createOpportunityDraft({
    title: 'Test opportunity',
    category: 'income_ops',
    source: 'assertion',
    required_actions: ['human_review'],
  })
  const valid = validateOpportunity(opportunity)
  if (!valid.ok) throw new Error(valid.error)
  if (opportunity.status !== 'discovered') throw new Error('Opportunity should begin as discovered.')
  if (!opportunity.source_provider) throw new Error('Opportunity should track source provider.')
  if (!opportunity.dedupe_key) throw new Error('Opportunity should include a dedupe key.')
}

export function assertEconomicProposalFoundation(): void {
  const proposal = createProposalDraft({
    output_type: 'outreach_draft',
    assigned_family: 'chatgpt',
    title: 'Approval gated draft',
    body: 'Draft only. Do not send externally without approval.',
  })
  assertProposalExternalUseBlockedUntilApproved(proposal)
  if (!proposal.approval_required) throw new Error('Proposal should require approval.')
}

export function assertEconomicOperationsFoundations(): void {
  assertAllExternalActionsApprovalGated()
  assertEconomicDomainRegistryComplete()
  assertEconomicFamilyRolesGuidanceOnly()
  assertEconomicCommandFoundations()
  assertEconomicOpportunityFoundation()
  assertEconomicProposalFoundation()
}

export function assertEconomicOpportunityExtraction(): void {
  const extracted = extractEconomicOpportunities({
    decree: 'scan opportunities',
    sessionId: 'assertion-session',
    providerAnalyses: [{
      provider_family: 'grok',
      content: '- Local service audit offer: $1500 monthly, medium risk, high confidence',
    }],
  })
  if (!extracted.commandMatched) throw new Error('Economic extraction should match command.')
  if (extracted.opportunities.length !== 1) throw new Error('Economic extraction should produce one opportunity.')
  if (!extracted.summary.includes('Opportunity Scout')) throw new Error('Economic summary should be operational.')
}
