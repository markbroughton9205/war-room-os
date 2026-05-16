import { parseEconomicOperationalCommand } from '@/lib/economic/commands'

export type EconomicOpsRoutingResolution =
  | {
      mode: 'economic_ops'
      reason: 'economic_command'
      forcedLegacyResearch: false
    }
  | {
      mode: 'research' | 'council'
      reason: 'forced_legacy_research' | 'no_economic_command'
      forcedLegacyResearch: boolean
    }

const FORCE_LEGACY_RESEARCH = /\b(?:force|use|run|legacy)\s+(?:legacy\s+)?(?:research|web\s+research|internet\s+research)\b|\bresearch\s+mode\b/i

export function resolveEconomicOpsRouting(text: string): EconomicOpsRoutingResolution {
  const raw = typeof text === 'string' ? text : ''
  if (FORCE_LEGACY_RESEARCH.test(raw)) {
    return { mode: 'research', reason: 'forced_legacy_research', forcedLegacyResearch: true }
  }

  const parsed = parseEconomicOperationalCommand(raw)
  if (parsed.matched) {
    return { mode: 'economic_ops', reason: 'economic_command', forcedLegacyResearch: false }
  }

  return { mode: 'council', reason: 'no_economic_command', forcedLegacyResearch: false }
}

export function isEconomicOpsCommand(text: string): boolean {
  return resolveEconomicOpsRouting(text).mode === 'economic_ops'
}

export function logEconomicOpsResolvedMode(args: {
  decree: string
  resolvedMode: string
  source: 'client' | 'server'
  reason?: string
}): void {
  console.info('[war-room-routing]', {
    decree: args.decree.slice(0, 160),
    resolvedMode: args.resolvedMode,
    source: args.source,
    reason: args.reason ?? null,
  })
}
