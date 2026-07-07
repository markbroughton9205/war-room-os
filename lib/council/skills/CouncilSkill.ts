import type {
  CouncilSkillActivationStatus,
  CouncilSkillCategory,
  CouncilSkillDefinition,
  CouncilSkillRiskLevel,
  CouncilSkillSummary,
} from './types'
import type { CouncilEntityId } from '../entities/types'

export class CouncilSkill {
  private readonly definition: CouncilSkillDefinition

  constructor(definition: CouncilSkillDefinition) {
    this.definition = {
      ...definition,
      ownerEntityIds: [...definition.ownerEntityIds],
      supportingEntityIds: [...definition.supportingEntityIds],
      requiredTools: [...definition.requiredTools],
    }
  }

  load(): CouncilSkillDefinition {
    return this.toJSON()
  }

  getSummary(): CouncilSkillSummary {
    return {
      id: this.definition.id,
      displayName: this.definition.displayName,
      category: this.definition.category,
      ownerEntityIds: [...this.definition.ownerEntityIds],
      riskLevel: this.definition.riskLevel,
      approvalRequired: this.definition.approvalRequired,
      activationStatus: this.definition.activationStatus,
    }
  }

  getCategory(): CouncilSkillCategory {
    return this.definition.category
  }

  getDescription(): string {
    return this.definition.description
  }

  getOwnerEntityIds(): CouncilEntityId[] {
    return [...this.definition.ownerEntityIds]
  }

  getSupportingEntityIds(): CouncilEntityId[] {
    return [...this.definition.supportingEntityIds]
  }

  getRequiredTools(): string[] {
    return [...this.definition.requiredTools]
  }

  getRiskLevel(): CouncilSkillRiskLevel {
    return this.definition.riskLevel
  }

  requiresApproval(): boolean {
    return this.definition.approvalRequired
  }

  isMemoryEligible(): boolean {
    return this.definition.memoryEligible
  }

  isLearningEligible(): boolean {
    return this.definition.learningEligible
  }

  getActivationStatus(): CouncilSkillActivationStatus {
    return this.definition.activationStatus
  }

  isOwnedBy(entityId: CouncilEntityId): boolean {
    return this.definition.ownerEntityIds.includes(entityId)
  }

  isSupportedBy(entityId: CouncilEntityId): boolean {
    return this.definition.supportingEntityIds.includes(entityId)
  }

  toJSON(): CouncilSkillDefinition {
    return {
      ...this.definition,
      ownerEntityIds: [...this.definition.ownerEntityIds],
      supportingEntityIds: [...this.definition.supportingEntityIds],
      requiredTools: [...this.definition.requiredTools],
    }
  }
}
