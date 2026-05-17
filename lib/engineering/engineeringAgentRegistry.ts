import { CODEX_ENGINEERING_AGENT } from './codexEngineeringAgent'
import { CURSOR_ENGINEERING_AGENT } from './cursorEngineeringAgent'

export type EngineeringAgentId =
  | 'cursor'
  | 'codex'
  | 'claude_architecture_reviewer'
  | 'red_team_risk_reviewer'
  | 'local_code_agent_bridge'
  | 'aider'
  | 'openhands'
  | 'continue'
  | 'goose'

export type EngineeringAgentRole =
  | 'preferred_manual_executor'
  | 'planned/cloud_engineering_executor'
  | 'architecture_reviewer'
  | 'risk_reviewer'
  | 'local_execution_bridge'
  | 'optional_local_engineering_connector'

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
    id: CODEX_ENGINEERING_AGENT.id,
    name: CODEX_ENGINEERING_AGENT.name,
    role: CODEX_ENGINEERING_AGENT.role,
    availability: CODEX_ENGINEERING_AGENT.availability,
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: CODEX_ENGINEERING_AGENT.missingConfiguration,
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
  {
    id: 'local_code_agent_bridge',
    name: 'Local Code Agent Bridge',
    role: 'local_execution_bridge',
    availability: 'planned',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Status bridge for local engineering engines. No autonomous repo writes are granted.',
  },
  {
    id: 'aider',
    name: 'Aider',
    role: 'optional_local_engineering_connector',
    availability: 'not_connected',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Optional local connector. Requires explicit configuration and approval before use.',
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    role: 'optional_local_engineering_connector',
    availability: 'not_connected',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Optional local connector. Requires explicit configuration and approval before use.',
  },
  {
    id: 'continue',
    name: 'Continue',
    role: 'optional_local_engineering_connector',
    availability: 'not_connected',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Optional IDE connector. Requires explicit configuration and approval before use.',
  },
  {
    id: 'goose',
    name: 'Goose',
    role: 'optional_local_engineering_connector',
    availability: 'not_connected',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Optional local connector. Requires explicit configuration and approval before use.',
  },
]

export function getPreferredEngineeringAgent() {
  return ENGINEERING_AGENT_REGISTRY.find(agent => agent.id === 'cursor') ?? ENGINEERING_AGENT_REGISTRY[0]
}

export function listEngineeringAgents() {
  return ENGINEERING_AGENT_REGISTRY.map(agent => ({ ...agent }))
}
