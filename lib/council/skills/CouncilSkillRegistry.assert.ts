import { COUNCIL_ENTITY_DEFINITIONS } from '../entities/CouncilEntityRegistry'
import {
  COUNCIL_SKILL_DEFINITIONS,
  CouncilSkillRegistry,
} from './CouncilSkillRegistry'
import { COUNCIL_SPECIALTY_TO_SKILL, specialtyToSkillId } from './skillCompatibility'
import type {
  CouncilSkillDefinition,
  CouncilSkillId,
  CouncilSkillRiskLevel,
} from './types'

type AssertionResult = {
  ok: boolean
  errors: string[]
}

const SPECIAL_RISK_LEVELS = new Set<CouncilSkillRiskLevel>([
  'financial',
  'legal',
  'identity',
  'deployment',
])

function isSnakeCase(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value)
}

function assertSkillDefinition(
  definition: CouncilSkillDefinition,
  seenIds: Set<CouncilSkillId>,
  entityIds: Set<string>,
  errors: string[],
): void {
  if (seenIds.has(definition.id)) {
    errors.push(`Duplicate skill id: ${definition.id}`)
  }
  seenIds.add(definition.id)

  if (!isSnakeCase(definition.id)) {
    errors.push(`Skill id must be lowercase snake case: ${definition.id}`)
  }

  if (definition.ownerEntityIds.length === 0) {
    errors.push(`Skill has no owner entity: ${definition.id}`)
  }

  for (const ownerId of definition.ownerEntityIds) {
    if (!entityIds.has(ownerId)) {
      errors.push(`Skill ${definition.id} references unknown owner entity: ${ownerId}`)
    }
  }

  for (const supportId of definition.supportingEntityIds) {
    if (!entityIds.has(supportId)) {
      errors.push(`Skill ${definition.id} references unknown supporting entity: ${supportId}`)
    }
  }

  if (SPECIAL_RISK_LEVELS.has(definition.riskLevel) && !definition.approvalRequired) {
    errors.push(`Special-risk skill must require approval: ${definition.id}`)
  }

  if (definition.requiredTools.length > 0 && !definition.approvalRequired) {
    errors.push(`Tool-backed skill must require approval by default: ${definition.id}`)
  }
}

export function assertCouncilSkillRegistry(): AssertionResult {
  const errors: string[] = []
  const registry = new CouncilSkillRegistry()
  const seenIds = new Set<CouncilSkillId>()
  const entityIds = new Set(COUNCIL_ENTITY_DEFINITIONS.map(entity => entity.id))

  for (const definition of COUNCIL_SKILL_DEFINITIONS) {
    assertSkillDefinition(definition, seenIds, entityIds, errors)

    if (!registry.getSkill(definition.id)) {
      errors.push(`Registry cannot retrieve skill: ${definition.id}`)
    }

    for (const ownerId of definition.ownerEntityIds) {
      if (!registry.entitySupportsSkill(ownerId, definition.id)) {
        errors.push(`Registry does not report owner support for ${ownerId}:${definition.id}`)
      }
    }
  }

  for (const [specialty, skillId] of Object.entries(COUNCIL_SPECIALTY_TO_SKILL)) {
    if (!registry.getSkill(skillId)) {
      errors.push(`Specialty maps to unknown skill: ${specialty} -> ${skillId}`)
    }
    if (specialtyToSkillId(specialty) !== skillId) {
      errors.push(`Specialty lookup mismatch: ${specialty} -> ${skillId}`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  }
}
