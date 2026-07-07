import { ApprovalGate } from './ApprovalGate'
import { EntityRouter } from './EntityRouter'
import { IntentEngine } from './IntentEngine'
import { SkillRouter } from './SkillRouter'
import { createRoutingNote } from './RoutingNote'
import type { CouncilDecisionInput, IntentClarificationReason, RoutingNote } from './types'

function describeClarification(reasonKind: IntentClarificationReason): string {
  switch (reasonKind) {
    case 'ambiguous_categories':
      return 'Multiple candidate routes detected. Commander clarification recommended.'
    case 'low_signal':
      return 'Low-confidence intent match; insufficient signal to route with certainty. Commander clarification recommended.'
    case 'none':
    default:
      return 'Routing decision created from intent, skill ownership, entity ownership, and skill approval metadata.'
  }
}

export class CouncilDecisionEngine {
  constructor(
    private readonly intentEngine: IntentEngine = new IntentEngine(),
    private readonly skillRouter: SkillRouter = new SkillRouter(),
    private readonly entityRouter: EntityRouter = new EntityRouter(),
    private readonly approvalGate: ApprovalGate = new ApprovalGate(),
  ) {}

  decide(input: CouncilDecisionInput): RoutingNote {
    const decisionPath: string[] = []

    const intent = this.intentEngine.classify(input.message)
    decisionPath.push(`Intent classified as ${intent.intent}.`)

    const skillDecision = this.skillRouter.route(intent)
    decisionPath.push(`Skill router selected ${skillDecision.selectedSkillIds.length} skill(s).`)

    if (skillDecision.rejectedSkillIds.length > 0) {
      decisionPath.push(`Skill router rejected ${skillDecision.rejectedSkillIds.length} candidate skill(s).`)
    }

    const entityDecision = this.entityRouter.route(skillDecision.selectedSkillIds)
    decisionPath.push(`Entity router selected ${entityDecision.selectedEntityIds.length} council entity/entities.`)

    const approvalDecision = this.approvalGate.evaluate(skillDecision.selectedSkillIds)
    decisionPath.push(
      approvalDecision.approvalRequired
        ? `Approval gate requires approval at ${approvalDecision.riskLevel} risk.`
        : `Approval gate cleared route at ${approvalDecision.riskLevel} risk.`,
    )

    if (intent.clarificationRecommended) {
      decisionPath.push(describeClarification(intent.clarificationReason))
    }

    decisionPath.push('Provider selection deferred to Phase 46D.')

    const reason = describeClarification(intent.clarificationReason)

    return createRoutingNote({
      intent,
      skillDecision,
      entityDecision,
      approvalDecision,
      reason,
      decisionPath,
      timestamp: input.timestamp,
      routingId: input.routingId,
    })
  }
}
