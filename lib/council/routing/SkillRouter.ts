import { CouncilSkillRegistry, councilSkillRegistry } from '../skills'
import type { CouncilSkillCategory, CouncilSkillId } from '../skills/types'
import type { IntentClassification, SkillRoutingDecision } from './types'

const INTENT_PRIORITY_SKILLS: Partial<Record<IntentClassification['intent'], CouncilSkillId[]>> = {
  architecture: ['system_architecture', 'engineering_review', 'feasibility_analysis'],
  strategy: ['business_strategy', 'planning', 'synthesis'],
  research: ['research_review', 'source_comparison', 'internet_awareness'],
  implementation: ['implementation_planning', 'technical_execution_planning', 'task_sequencing'],
  review: ['engineering_review', 'source_comparison', 'risk_analysis'],
  risk: ['risk_analysis', 'assumption_challenge', 'contradiction_checking'],
  memory: ['knowledge_organization', 'cross_reference'],
  communication: ['synthesis', 'writing'],
  coordination: ['command_translation', 'operations_mapping', 'planning'],
  unknown: ['synthesis'],
}

const CATEGORY_FALLBACK_SKILLS: Partial<Record<CouncilSkillCategory, CouncilSkillId[]>> = {
  reasoning: ['system_architecture', 'feasibility_analysis', 'pattern_recognition'],
  planning: ['planning', 'task_sequencing', 'dependency_mapping'],
  research: ['research_review', 'source_comparison', 'internet_awareness'],
  implementation: ['implementation_planning', 'technical_execution_planning'],
  review: ['engineering_review', 'source_comparison'],
  risk: ['risk_analysis', 'contradiction_checking', 'scam_detection'],
  memory: ['knowledge_organization', 'cross_reference'],
  communication: ['synthesis', 'writing'],
  coordination: ['command_translation', 'operations_mapping'],
}

const unique = <T>(values: T[]): T[] => Array.from(new Set(values))

function describeCandidateSource(categoryMatched: boolean, toolMatched: boolean): string {
  if (categoryMatched && toolMatched) return 'category and tool lookup'
  if (categoryMatched) return 'category lookup'
  if (toolMatched) return 'tool lookup'
  return 'candidate lookup'
}

export class SkillRouter {
  constructor(private readonly registry: CouncilSkillRegistry = councilSkillRegistry) {}

  route(intent: IntentClassification): SkillRoutingDecision {
    const categoryCandidates = intent.candidateCategories.flatMap(category =>
      this.registry.findByCategory(category).map(skill => skill.load().id),
    )
    const toolCandidates = intent.candidateTools.flatMap(toolId =>
      this.registry.findByTool(toolId).map(skill => skill.load().id),
    )
    const categoryCandidateSet = new Set(categoryCandidates)
    const toolCandidateSet = new Set(toolCandidates)
    const candidateSkillIds = unique([...categoryCandidates, ...toolCandidates])
    const preferredSkills = INTENT_PRIORITY_SKILLS[intent.intent] ?? []
    const categoryFallbacks = intent.candidateCategories.flatMap(category => CATEGORY_FALLBACK_SKILLS[category] ?? [])
    const selectedSkillIds = unique([...preferredSkills, ...categoryFallbacks])
      .filter(skillId => candidateSkillIds.includes(skillId) || intent.intent === 'unknown')
      .slice(0, 4)
    const selectedOrFallbackSkillIds = selectedSkillIds.length > 0
      ? selectedSkillIds
      : preferredSkills.filter(skillId => this.registry.getSkill(skillId)).slice(0, 2)
    const selectedSet = new Set(selectedOrFallbackSkillIds)
    const rejectedSkillIds = candidateSkillIds
      .filter(skillId => !selectedSet.has(skillId))
      .map(skillId => ({
        skillId,
        reason: this.getRejectedSkillReason({
          skillId,
          intent,
          preferredSkills,
          categoryFallbacks,
          selectedLimit: 4,
          categoryMatched: categoryCandidateSet.has(skillId),
          toolMatched: toolCandidateSet.has(skillId),
        }),
      }))
    const confidence = Math.max(
      0.1,
      Math.min(0.95, intent.confidence - (selectedOrFallbackSkillIds.length === 0 ? 0.25 : 0)),
    )

    return {
      candidateSkillIds,
      rejectedSkillIds,
      selectedSkillIds: selectedOrFallbackSkillIds,
      confidence,
    }
  }

  private getRejectedSkillReason(input: {
    skillId: CouncilSkillId
    intent: IntentClassification
    preferredSkills: CouncilSkillId[]
    categoryFallbacks: CouncilSkillId[]
    selectedLimit: number
    categoryMatched: boolean
    toolMatched: boolean
  }): string {
    const source = describeCandidateSource(input.categoryMatched, input.toolMatched)
    const primaryOwner = this.registry.getPrimaryOwner(input.skillId)
    if (primaryOwner === null) {
      return `Matched by ${source}, but no owning Council Entity is registered for this skill.`
    }

    const priorityIndex = input.preferredSkills.indexOf(input.skillId)
    const fallbackIndex = input.categoryFallbacks.indexOf(input.skillId)
    const isIntentPriority = priorityIndex !== -1
    const isCategoryFallback = fallbackIndex !== -1

    if (input.toolMatched && !input.categoryMatched) {
      return `Matched only via tool lookup and was deprioritized against category-matched skills for ${input.intent.intent} intent.`
    }

    if (!isIntentPriority && !isCategoryFallback) {
      return `Matched by ${source}, but is not in the top-priority or category fallback skills for ${input.intent.intent} intent.`
    }

    if (
      (isIntentPriority && priorityIndex >= input.selectedLimit)
      || (isCategoryFallback && fallbackIndex >= input.selectedLimit)
    ) {
      return `Matched by ${source}, but fell outside the top ${input.selectedLimit} skill slots for this routing pass.`
    }

    return `Matched by ${source}, but was superseded by higher-priority ${input.intent.intent} route skills.`
  }
}
