import 'server-only'

import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import {
  buildCouncilRosterSnapshot,
  withNebulaLocalDisplayOverride,
  type CouncilRosterSnapshot,
  type RosterPolicyOverride,
} from './rosterHealth'
import { localRoutingBypassesCloudFloorGate } from './backends/routingMode'
import { SEAT_LOCAL_ROLE_SLOT } from './backends/seatRoleSlot'
import { localRegistryEntryForSlot } from './backends/localModelRegistry'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export function readRosterPolicyOverrides(env: NodeJS.ProcessEnv = process.env): RosterPolicyOverride {
  return {
    chatgpt: env.WR_COUNCIL_ROSTER_CHATGPT,
    claude: env.WR_COUNCIL_ROSTER_CLAUDE,
    grok: env.WR_COUNCIL_ROSTER_GROK,
    gemini: env.WR_COUNCIL_ROSTER_GEMINI,
    red_team: env.WR_COUNCIL_ROSTER_RED_TEAM,
  }
}

export function resolveLiveCouncilRoster(env: NodeJS.ProcessEnv = process.env): CouncilRosterSnapshot {
  return buildCouncilRosterSnapshot({
    configured: {
      chatgpt: envHasUsableProviderSecret('OPENAI_API_KEY', env),
      claude: envHasUsableProviderSecret('ANTHROPIC_API_KEY', env),
      grok: envHasUsableProviderSecret('XAI_API_KEY', env),
      gemini: envHasUsableProviderSecret('GEMINI_API_KEY', env),
      red_team: envHasUsableProviderSecret('ANTHROPIC_API_KEY', env),
    },
    overrides: readRosterPolicyOverrides(env),
  })
}

export function familyIsFloorEligible(family: CouncilOrchestrationFamily, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveLiveCouncilRoster(env).families[family]?.floorEligible === true
}

/**
 * Commander-facing display variant of resolveLiveCouncilRoster(). Cloud-key floor eligibility used
 * for real external-routing decisions (app/api/chat/execute.ts's liveCouncilFloor) is completely
 * unaffected — this overlays local Nebula agent availability only for status/UI display, so the
 * Members panel and status banner don't report "0/4 PROVIDERS ACTIVE" while a LOCAL_FIRST/
 * LOCAL_ONLY/HYBRID Nebula Council is genuinely serving those seats via Ollama. Under the default
 * EXTERNAL_ONLY mode this returns the base snapshot unchanged.
 */
export function resolveDisplayCouncilRoster(env: NodeJS.ProcessEnv = process.env): CouncilRosterSnapshot {
  const base = resolveLiveCouncilRoster(env)
  if (!localRoutingBypassesCloudFloorGate()) return base
  const locallyEnabled: Partial<Record<CouncilOrchestrationFamily, boolean>> = {}
  for (const family of ['chatgpt', 'claude', 'grok', 'gemini', 'red_team'] as CouncilOrchestrationFamily[]) {
    const slot = SEAT_LOCAL_ROLE_SLOT[family]
    locallyEnabled[family] = Boolean(slot && localRegistryEntryForSlot(slot))
  }
  return withNebulaLocalDisplayOverride(base, locallyEnabled)
}
