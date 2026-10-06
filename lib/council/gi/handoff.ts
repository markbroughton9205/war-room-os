import {
  ENGINEERING_HANDOFF_SCHEMA,
  RESEARCH_HANDOFF_SCHEMA,
  type EngineeringHandoffV1,
  type HandoffTarget,
  type ModuleHandoffV1,
  type ResearchHandoffV1,
} from './types'
import { evaluateAuthority } from './authorityMatrix'

export type CreateHandoffInput = {
  text: string
  room_id: string
  session_id: string
  mission_id?: string
  target: HandoffTarget
  now?: string
}

export function createEngineeringHandoff(input: CreateHandoffInput | Omit<CreateHandoffInput, 'target'>): EngineeringHandoffV1 {
  const created_at = input.now ?? new Date().toISOString()
  const authority = evaluateAuthority({ tool_id: 'foundry.handoff', path: 'HANDOFF', capability_available: true })
  return {
    schema_version: ENGINEERING_HANDOFF_SCHEMA,
    handoff_id: `handoff_foundry_${created_at.replace(/[^0-9]/g, '')}`,
    room_id: input.room_id,
    session_id: input.session_id,
    mission_id: input.mission_id,
    objective: input.text.trim(),
    context_refs: [],
    acceptance: ['No Council git/patch/deploy.', 'Foundry remains owner of code mutation.', 'GI-ENG-01 does not execute this handoff.'],
    authority: authority.authority_class,
    non_goals: ['Council-authored patches', 'silent git push', 'Foundry runtime mutation from GI-ENG-01'],
    created_at,
    target: 'FOUNDRY',
    executed: false,
  }
}

export function createResearchHandoff(input: CreateHandoffInput | Omit<CreateHandoffInput, 'target'>): ResearchHandoffV1 {
  const created_at = input.now ?? new Date().toISOString()
  return {
    schema_version: RESEARCH_HANDOFF_SCHEMA,
    handoff_id: `handoff_broker_${created_at.replace(/[^0-9]/g, '')}`,
    room_id: input.room_id,
    session_id: input.session_id,
    mission_id: input.mission_id,
    objective: input.text.trim(),
    context_refs: [],
    authority: 'HOLD',
    created_at,
    target: 'BROWSER_BROKER',
    executed: false,
  }
}

export function createModuleHandoff(input: CreateHandoffInput & { target: 'TERRA' | 'HVS' | 'MEDIA' }): ModuleHandoffV1 {
  const created_at = input.now ?? new Date().toISOString()
  return {
    schema_version: 'war-room.module-handoff.v1',
    handoff_id: `handoff_${input.target.toLowerCase()}_${created_at.replace(/[^0-9]/g, '')}`,
    room_id: input.room_id,
    session_id: input.session_id,
    mission_id: input.mission_id,
    objective: input.text.trim(),
    context_refs: [],
    authority: 'REQUIRE_AUTH',
    created_at,
    target: input.target,
    executed: false,
  }
}

export function createTypedHandoff(input: CreateHandoffInput): EngineeringHandoffV1 | ResearchHandoffV1 | ModuleHandoffV1 {
  if (input.target === 'FOUNDRY') return createEngineeringHandoff(input)
  if (input.target === 'BROWSER_BROKER') return createResearchHandoff(input)
  return createModuleHandoff({ ...input, target: input.target })
}
