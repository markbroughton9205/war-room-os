/**
 * Load Capability Atlas skills on demand. Never dump the full library into agent context.
 */
import { assessMissionCapabilities, loadMissionSkillPacks } from './capability-atlas/plannerGate'
import { loadCapabilityAtlas } from './capability-atlas/store'
import { FOUNDRY_ROLE_CATALOG } from './foundryAgentRoles'
import type { FoundryAgentRole } from './foundryAgentTypes'

export type FoundryLoadedSkill = {
  skillId: string
  purpose: string
  whenToUse: string
  prerequisites: string[]
  tools: string[]
  procedure: string
  validation: string
  failurePatterns: string[]
  evidence: string
}

export function loadSkillsForRole(input: {
  role: FoundryAgentRole
  missionText: string
  workspaceContext?: string
}): { skills: FoundryLoadedSkill[]; skillIds: string[]; packText: string } {
  const spec = FOUNDRY_ROLE_CATALOG[input.role]
  const atlas = loadCapabilityAtlas()
  const assessment = assessMissionCapabilities({
    missionText: `${input.missionText}\n${spec.skillHints.join(' ')}`,
    missionKind: 'app_builder',
    workspaceContext: input.workspaceContext,
    requestedSkillIds: spec.skillHints,
    repoTruth: input.workspaceContext,
  })
  const requested = (assessment.selectedPackSkillIds.length ? assessment.selectedPackSkillIds : assessment.requiredSkills).slice(0, 3)
  const packs = loadMissionSkillPacks(atlas, requested)
  const skills: FoundryLoadedSkill[] = packs.map(pack => ({
    skillId: pack.skillId,
    purpose: pack.metadata.name,
    whenToUse: `Role ${input.role}. ${spec.routingReason}`,
    prerequisites: pack.relevantRepoOwnershipMemory.slice(0, 4),
    tools: pack.knownToolCommands.length ? pack.knownToolCommands : spec.tools,
    procedure: pack.briefProceduralGuidance,
    validation: pack.validationMethods.join('; ') || spec.validationGate,
    failurePatterns: pack.commonFailurePatterns,
    evidence: pack.officialSources.map(source => source.url).join(' ') || 'Capability Atlas compact pack',
  }))
  if (!skills.length) {
    skills.push({
      skillId: `foundry.role.${input.role.toLowerCase()}`,
      purpose: spec.responsibility,
      whenToUse: spec.routingReason,
      prerequisites: [],
      tools: spec.tools,
      procedure: spec.expectedOutputs.join(', '),
      validation: spec.validationGate,
      failurePatterns: ['Generic skill text must not override Commander intent or repo truth.'],
      evidence: 'Role-native compact pack; full atlas not dumped.',
    })
  }
  return {
    skills,
    skillIds: skills.map(skill => skill.skillId),
    packText: skills.map(skill => `${skill.skillId}: ${skill.purpose}\n${skill.procedure}`).join('\n').slice(0, 1200),
  }
}
