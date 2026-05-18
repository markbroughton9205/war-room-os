import { CURSOR_ENGINEERING_AGENT } from './cursorEngineeringAgent'

export type EngineeringAgentId =
  | 'cursor'
  | 'claude_architecture_reviewer'
  | 'red_team_risk_reviewer'

export type EngineeringAgentRole =
  | 'preferred_manual_executor'
  | 'architecture_reviewer'
  | 'risk_reviewer'

export type EngineeringAgentAvailability =
  | 'available_manual'
  | 'available'
  | 'configured'
  | 'detected'
  | 'not_connected'
  | 'unavailable'
  | 'planned'

export type EngineeringAgentRegistryEntry = {
  id: EngineeringAgentId
  name: string
  role: EngineeringAgentRole
  availability: EngineeringAgentAvailability
  approvalRequired: true
  canMutateFromWarRoom: false
  notes: string
}

export const ENGINEERING_AGENT_REGISTRY: EngineeringAgentRegistryEntry[] = [
  {
    id: CURSOR_ENGINEERING_AGENT.id,
    name: CURSOR_ENGINEERING_AGENT.name,
    role: CURSOR_ENGINEERING_AGENT.role,
    availability: CURSOR_ENGINEERING_AGENT.availability,
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: CURSOR_ENGINEERING_AGENT.notes,
  },
  {
    id: 'claude_architecture_reviewer',
    name: 'Claude',
    role: 'architecture_reviewer',
    availability: 'available',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Reviews implementation plans, architecture, invariants, and cross-module risk.',
  },
  {
    id: 'red_team_risk_reviewer',
    name: 'Red Team',
    role: 'risk_reviewer',
    availability: 'available',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Reviews failure modes, approval boundaries, rollback risk, and regression exposure.',
  },
]

export function getPreferredEngineeringAgent() {
  return ENGINEERING_AGENT_REGISTRY.find(agent => agent.id === 'cursor') ?? ENGINEERING_AGENT_REGISTRY[0]
}

export function listEngineeringAgents() {
  return ENGINEERING_AGENT_REGISTRY.map(agent => ({ ...agent }))
}
