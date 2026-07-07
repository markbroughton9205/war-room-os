import { councilEntityRegistry } from '../entities/CouncilEntityRegistry'
import { CouncilSkillRegistry, councilSkillRegistry } from '../skills'
import type { CouncilEntityId } from '../entities/types'
import type { EntityRoutingDecision } from './types'
import type { CouncilSkillId } from '../skills/types'

const unique = <T>(values: T[]): T[] => Array.from(new Set(values))

export class EntityRouter {
  constructor(private readonly skillRegistry: CouncilSkillRegistry = councilSkillRegistry) {}

  route(selectedSkillIds: CouncilSkillId[]): EntityRoutingDecision {
    const ownerEntityIds = selectedSkillIds.flatMap(skillId => this.skillRegistry.getPrimaryOwner(skillId) ?? [])
    const supportingEntityIds = selectedSkillIds.flatMap(skillId => this.skillRegistry.getSupportingEntities(skillId))
    const selectedEntityIds = unique([...ownerEntityIds, ...supportingEntityIds])
      .filter(entityId => councilEntityRegistry.getEntity(entityId) !== null)
      .slice(0, 6) as CouncilEntityId[]
    const confidence = selectedEntityIds.length > 0 ? 0.85 : 0.2

    return {
      selectedEntityIds,
      confidence,
    }
  }
}
