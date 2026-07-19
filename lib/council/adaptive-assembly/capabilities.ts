export const COUNCIL_CAPABILITIES = [
  'general_reasoning',
  'strategic_planning',
  'systems_architecture',
  'software_engineering',
  'current_information',
  'evidence_research',
  'broad_knowledge_synthesis',
  'numerical_analysis',
  'comparative_analysis',
  'task_decomposition',
  'adversarial_review',
  'high_risk_review',
  'visual_reasoning',
  'historical_analysis',
  'concise_response',
  'deep_analysis',
  'synthesis',
  'tool_eligible',
  'research_eligible',
] as const

export type CouncilCapability = (typeof COUNCIL_CAPABILITIES)[number]

const CAPABILITY_SET = new Set<string>(COUNCIL_CAPABILITIES)

export function isCouncilCapability(value: unknown): value is CouncilCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value)
}

export function validateCapabilityList(values: readonly unknown[]): CouncilCapability[] {
  const invalid = values.filter(value => !isCouncilCapability(value))
  if (invalid.length) {
    throw new Error(`Unknown council capability: ${invalid.map(String).join(', ')}`)
  }
  return [...new Set(values as CouncilCapability[])]
}

