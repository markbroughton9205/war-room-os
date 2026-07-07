import { CouncilEntity } from './CouncilEntity'
import type {
  CouncilEntityDefinition,
  CouncilEntityId,
  CouncilProviderFamilyAlias,
} from './types'

const GENESIS_TIMESTAMP = '2026-07-06T00:00:00.000Z'

export const COUNCIL_ENTITY_COMPATIBILITY: Record<CouncilProviderFamilyAlias, CouncilEntityId> = {
  'Claude Family': 'architect',
  'ChatGPT Family': 'strategist',
  'Gemini Family': 'librarian',
  'Grok Family': 'scout',
  'Kimi Family': 'engineer',
  'Red Team': 'skeptic',
  claude: 'architect',
  chatgpt: 'strategist',
  gemini: 'librarian',
  grok: 'scout',
  kimi: 'engineer',
  red_team: 'skeptic',
  'red team': 'skeptic',
}

export const COUNCIL_ENTITY_DEFINITIONS: CouncilEntityDefinition[] = [
  {
    id: 'architect',
    displayName: 'ARCHITECT',
    role: 'System architecture and engineering review',
    mission: ['System architecture', 'Engineering review', 'Long reasoning'],
    description: 'Permanent council identity for structural reasoning, design review, and system coherence.',
    specialties: ['architecture', 'engineering review', 'systems reasoning', 'long reasoning', 'feasibility'],
    preferredProviders: ['Claude'],
    fallbackProviders: ['ChatGPT', 'Gemini'],
    confidence: 0.7,
    experience: 0,
    status: 'foundation',
    createdAt: GENESIS_TIMESTAMP,
    updatedAt: GENESIS_TIMESTAMP,
    memoryEnabled: false,
    learningEnabled: false,
    personalityVersion: 'genesis-1',
  },
  {
    id: 'strategist',
    displayName: 'STRATEGIST',
    role: 'Business strategy, planning, synthesis, and writing',
    mission: ['Business strategy', 'Planning', 'Synthesis', 'Writing'],
    description: 'Permanent council identity for planning, orchestration, synthesis, and clear communication.',
    specialties: ['strategy', 'planning', 'synthesis', 'writing', 'communication'],
    preferredProviders: ['ChatGPT'],
    fallbackProviders: ['Claude', 'Gemini'],
    confidence: 0.7,
    experience: 0,
    status: 'foundation',
    createdAt: GENESIS_TIMESTAMP,
    updatedAt: GENESIS_TIMESTAMP,
    memoryEnabled: false,
    learningEnabled: false,
    personalityVersion: 'genesis-1',
  },
  {
    id: 'librarian',
    displayName: 'LIBRARIAN',
    role: 'Knowledge, research, pattern recognition, and cross reference',
    mission: ['Knowledge', 'Research', 'Pattern recognition', 'Cross reference'],
    description: 'Permanent council identity for knowledge organization, source comparison, and pattern memory.',
    specialties: ['knowledge', 'research', 'pattern recognition', 'cross reference', 'large context'],
    preferredProviders: ['Gemini'],
    fallbackProviders: ['ChatGPT', 'Claude'],
    confidence: 0.65,
    experience: 0,
    status: 'foundation',
    createdAt: GENESIS_TIMESTAMP,
    updatedAt: GENESIS_TIMESTAMP,
    memoryEnabled: false,
    learningEnabled: false,
    personalityVersion: 'genesis-1',
  },
  {
    id: 'scout',
    displayName: 'SCOUT',
    role: 'Current events, internet awareness, signals, and market intelligence',
    mission: ['Current events', 'Internet awareness', 'Signals', 'Market intelligence'],
    description: 'Permanent council identity for live signal awareness, market sensing, and external intelligence.',
    specialties: ['current events', 'internet awareness', 'signals', 'market intelligence', 'realtime radar'],
    preferredProviders: ['Grok'],
    fallbackProviders: ['ChatGPT', 'Gemini'],
    confidence: 0.65,
    experience: 0,
    status: 'foundation',
    createdAt: GENESIS_TIMESTAMP,
    updatedAt: GENESIS_TIMESTAMP,
    memoryEnabled: false,
    learningEnabled: false,
    personalityVersion: 'genesis-1',
  },
  {
    id: 'engineer',
    displayName: 'ENGINEER',
    role: 'Implementation planning, task sequencing, and technical execution',
    mission: ['Implementation planning', 'Task sequencing', 'Technical execution'],
    description: 'Permanent council identity for decomposing build work into executable technical steps.',
    specialties: ['implementation planning', 'task sequencing', 'technical execution', 'decomposition', 'operations'],
    preferredProviders: ['Kimi'],
    fallbackProviders: ['Claude', 'ChatGPT'],
    confidence: 0.6,
    experience: 0,
    status: 'foundation',
    createdAt: GENESIS_TIMESTAMP,
    updatedAt: GENESIS_TIMESTAMP,
    memoryEnabled: false,
    learningEnabled: false,
    personalityVersion: 'genesis-1',
  },
  {
    id: 'skeptic',
    displayName: 'SKEPTIC',
    role: 'Assumption challenge, flaw detection, and risk analysis',
    mission: ['Challenge assumptions', 'Find flaws', 'Risk analysis'],
    description: 'Permanent council identity for adversarial review, contradiction checks, and risk discipline.',
    specialties: ['challenge assumptions', 'find flaws', 'risk analysis', 'contradiction checking', 'stress test'],
    preferredProviders: ['RedTeam'],
    fallbackProviders: ['Claude', 'ChatGPT'],
    confidence: 0.7,
    experience: 0,
    status: 'foundation',
    createdAt: GENESIS_TIMESTAMP,
    updatedAt: GENESIS_TIMESTAMP,
    memoryEnabled: false,
    learningEnabled: false,
    personalityVersion: 'genesis-1',
  },
]

export class CouncilEntityRegistry {
  private entities: Map<CouncilEntityId, CouncilEntity>

  constructor(definitions: CouncilEntityDefinition[] = COUNCIL_ENTITY_DEFINITIONS) {
    this.entities = new Map(definitions.map(definition => [definition.id, new CouncilEntity(definition)]))
  }

  getEntity(id: CouncilEntityId): CouncilEntity | null {
    return this.entities.get(id) ?? null
  }

  getEntityForProviderFamily(alias: CouncilProviderFamilyAlias): CouncilEntity | null {
    return this.getEntity(COUNCIL_ENTITY_COMPATIBILITY[alias])
  }

  getAll(): CouncilEntity[] {
    return Array.from(this.entities.values())
  }

  findByRole(role: string): CouncilEntity[] {
    const requested = role.trim().toLowerCase()
    return this.getAll().filter(entity => entity.getRole().toLowerCase().includes(requested))
  }

  findBySkill(skill: string): CouncilEntity[] {
    return this.getAll().filter(entity => entity.supportsSkill(skill))
  }
}

export const councilEntityRegistry = new CouncilEntityRegistry()
