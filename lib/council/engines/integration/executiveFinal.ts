import { ENGINE_COMPLETE_VERSION } from '../types'

export type CouncilEngineFinalPublic = {
  schema: typeof ENGINE_COMPLETE_VERSION
  ebc_canonical: true
  grants_authority: false
  auto_promotes: false
  trains_wrim: false
  live_trial: string | null
  world_entities: number
  deliberation: string | null
  portfolio: string | null
  watch: string | null
  trust: string | null
  approval: string | null
  graduation: string | null
  commander_status?: string
}

export function attachCouncilEngineFinalPublic(input: {
  live_trial?: string | null
  world_entities?: number
  deliberation?: string | null
  portfolio?: string | null
  watch?: string | null
  trust?: string | null
  approval?: string | null
  graduation?: string | null
  commander_status?: string
}): CouncilEngineFinalPublic {
  return {
    schema: ENGINE_COMPLETE_VERSION,
    ebc_canonical: true,
    grants_authority: false,
    auto_promotes: false,
    trains_wrim: false,
    live_trial: input.live_trial ?? null,
    world_entities: input.world_entities ?? 0,
    deliberation: input.deliberation ?? null,
    portfolio: input.portfolio ?? null,
    watch: input.watch ?? null,
    trust: input.trust ?? null,
    approval: input.approval ?? null,
    graduation: input.graduation ?? null,
    commander_status: input.commander_status,
  }
}
