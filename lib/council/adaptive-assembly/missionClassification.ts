import type { CouncilCapability } from './capabilities'
import type {
  CommanderOverride,
  EvidenceRequirement,
  MissionClassification,
  MissionClassificationKind,
  MissionRiskLevel,
  ParticipationPreset,
  RedTeamRequirement,
} from './types'

function uniqueCapabilities(values: CouncilCapability[]): CouncilCapability[] {
  return [...new Set(values)]
}

function hasAny(text: string, words: readonly string[]): boolean {
  return words.some(word => text.includes(word))
}

function hasOverride(overrides: readonly CommanderOverride[], overrideType: string): boolean {
  return overrides.some(override => override.overrideType === overrideType)
}

export function classifyMission(input: {
  commanderMessage: string
  commanderOverrides?: readonly CommanderOverride[]
}): MissionClassification {
  const normalized = input.commanderMessage.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const overrides = input.commanderOverrides ?? []
  const matchedKinds: MissionClassificationKind[] = []
  const required: CouncilCapability[] = ['general_reasoning']
  const optional: CouncilCapability[] = ['concise_response']
  const uncertaintyFlags: string[] = []
  const redTeamTriggerReasons: string[] = []
  let riskLevel: MissionRiskLevel = 'low'
  let evidenceRequirement: EvidenceRequirement = 'not_required'
  let liveDataRequirement: EvidenceRequirement = 'not_required'
  let redTeamRequirement: RedTeamRequirement = 'omitted'
  let recommendedDepth: MissionClassification['recommendedDepth'] = 'standard'
  let recommendedParticipationPreset: ParticipationPreset = 'standard'

  if (!normalized) {
    matchedKinds.push('requires_commander_clarification')
    uncertaintyFlags.push('empty_or_missing_mission_text')
  }

  if (hasAny(normalized, ['strategy', 'plan', 'business', 'roadmap', 'go to market'])) {
    matchedKinds.push('strategy')
    required.push('strategic_planning')
    optional.push('synthesis', 'broad_knowledge_synthesis')
  }

  if (hasAny(normalized, ['code', 'build', 'bug', 'debug', 'architecture', 'repo', 'software', 'deploy', 'implementation'])) {
    matchedKinds.push('engineering')
    required.push('software_engineering', 'systems_architecture')
    optional.push('task_decomposition', 'synthesis')
  }

  if (hasAny(normalized, ['latest', 'current', 'today', 'news', 'live', 'internet', 'web', 'search', 'online'])) {
    matchedKinds.push('current_intelligence')
    required.push('current_information')
    optional.push('evidence_research', 'research_eligible')
    evidenceRequirement = 'live_required'
    liveDataRequirement = 'live_required'
  }

  if (hasAny(normalized, ['research', 'verify', 'source', 'sources', 'evidence', 'compare'])) {
    matchedKinds.push('research')
    required.push('evidence_research')
    optional.push('comparative_analysis', 'research_eligible')
    if (evidenceRequirement !== 'live_required') evidenceRequirement = 'required'
  }

  if (hasAny(normalized, ['number', 'calculate', 'budget', 'cost', 'roi', 'rate', 'estimate'])) {
    matchedKinds.push('numerical')
    required.push('numerical_analysis')
    optional.push('comparative_analysis')
  }

  if (hasAny(normalized, ['history', 'historical', 'timeline', 'archive', 'precedent'])) {
    matchedKinds.push('historical')
    required.push('historical_analysis')
    optional.push('broad_knowledge_synthesis')
  }

  if (hasAny(normalized, ['legal', 'financial', 'payment', 'bank', 'identity', 'security', 'risk', 'danger', 'scam'])) {
    matchedKinds.push('high_risk')
    required.push('adversarial_review', 'high_risk_review')
    riskLevel = 'high'
    redTeamRequirement = 'mandatory'
    redTeamTriggerReasons.push('high_risk_mission_signal')
    recommendedDepth = 'deep'
    recommendedParticipationPreset = 'comprehensive'
  }

  if (hasAny(normalized, ['steps', 'sequence', 'decompose', 'task list', 'execute plan', 'workflow'])) {
    matchedKinds.push('execution_planning')
    required.push('task_decomposition')
    optional.push('strategic_planning')
  }

  if (hasOverride(overrides, 'require_red_team')) {
    redTeamRequirement = 'mandatory'
    redTeamTriggerReasons.push('commander_override_require_red_team')
  }

  if (hasOverride(overrides, 'require_live_research')) {
    required.push('current_information', 'evidence_research')
    evidenceRequirement = 'live_required'
    liveDataRequirement = 'live_required'
  }

  if (hasOverride(overrides, 'prioritize_depth') || hasOverride(overrides, 'force_comprehensive')) {
    recommendedDepth = 'deep'
    recommendedParticipationPreset = 'comprehensive'
  }

  if (hasOverride(overrides, 'prioritize_speed')) {
    recommendedDepth = 'concise'
    recommendedParticipationPreset = 'focused'
  }

  const distinctKinds = [...new Set(matchedKinds)]
  if (distinctKinds.length > 2) {
    uncertaintyFlags.push('multiple_candidate_mission_classes')
  }
  if (distinctKinds.length === 0) {
    distinctKinds.push('general')
    uncertaintyFlags.push('low_signal_general_classification')
  }

  let missionClassification: MissionClassificationKind
  if (distinctKinds.includes('requires_commander_clarification')) {
    missionClassification = 'requires_commander_clarification'
  } else if (distinctKinds.length > 2) {
    missionClassification = 'mixed'
  } else {
    missionClassification = distinctKinds[0] ?? 'unknown'
  }

  if (riskLevel !== 'high' && distinctKinds.includes('engineering')) riskLevel = 'medium'
  if (redTeamRequirement === 'omitted' && riskLevel === 'medium') redTeamRequirement = 'conditional'
  if (redTeamRequirement === 'omitted') redTeamRequirement = 'optional'

  return Object.freeze({
    missionClassification,
    requiredCapabilities: uniqueCapabilities(required),
    optionalCapabilities: uniqueCapabilities(optional),
    riskLevel,
    liveDataRequirement,
    evidenceRequirement,
    redTeamRequirement,
    redTeamTriggerReasons,
    synthesisRequirement: hasOverride(overrides, 'prevent_synthesis') ? 'prevented' : 'recommended',
    recommendedDepth,
    recommendedParticipationPreset,
    uncertaintyFlags,
  })
}

