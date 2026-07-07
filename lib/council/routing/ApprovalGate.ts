import { CouncilSkillRegistry, councilSkillRegistry } from '../skills'
import type { CouncilSkillId, CouncilSkillRiskLevel } from '../skills/types'
import type { ApprovalDecision } from './types'

const RISK_ORDER: Record<CouncilSkillRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  financial: 4,
  legal: 4,
  identity: 4,
  deployment: 4,
}

export class ApprovalGate {
  constructor(private readonly skillRegistry: CouncilSkillRegistry = councilSkillRegistry) {}

  evaluate(selectedSkillIds: CouncilSkillId[]): ApprovalDecision {
    const selectedSkills = selectedSkillIds
      .map(skillId => this.skillRegistry.getSkill(skillId))
      .filter(skill => skill !== null)
    const approvalRequired = selectedSkills.some(skill => skill.requiresApproval())
    const riskLevel = selectedSkills.reduce<CouncilSkillRiskLevel>((highest, skill) => {
      const skillRisk = skill.getRiskLevel()
      return RISK_ORDER[skillRisk] > RISK_ORDER[highest] ? skillRisk : highest
    }, 'low')

    return {
      approvalRequired,
      riskLevel,
    }
  }
}
