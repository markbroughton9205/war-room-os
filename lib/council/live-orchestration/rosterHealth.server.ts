import 'server-only'

import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import {
  buildCouncilRosterSnapshot,
  type CouncilRosterSnapshot,
  type RosterPolicyOverride,
} from './rosterHealth'
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
