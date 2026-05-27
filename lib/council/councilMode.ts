/**
 * Live Council flow mode: Direct | Stable Group | Full Council.
 *
 * Test prompts (stable group smoke):
 * - "What should we prioritize this week?" — expect 4–6 sentence turns, plain language.
 * - "Quick check: is the council responding?" — greeting-style; no integrity RED TEAM wall.
 * - "@grok what's the signal on this?" — direct mode must still win over stable group.
 */

export const COUNCIL_FLOW_MODE_STORAGE_KEY = 'war-room-council-flow-mode'
export const COUNCIL_FLOW_MODE_ENV = 'COUNCIL_MODE'

export type CouncilFlowMode = 'direct' | 'stable_group' | 'full_council'

export const COUNCIL_FLOW_MODE_LABELS: Record<CouncilFlowMode, string> = {
  direct: 'Direct',
  stable_group: 'Stable Group Chat — families build on each other with heavy systems off.',
  full_council: 'Full Council',
}

/** Canonical sequential order for stable group conversation. */
export const STABLE_GROUP_FAMILY_ORDER = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'red_team',
] as const

export type StableGroupFamily = (typeof STABLE_GROUP_FAMILY_ORDER)[number]

const FLOW_MODE_SET = new Set<string>(['direct', 'stable_group', 'full_council'])

export function parseCouncilFlowMode(raw: unknown): CouncilFlowMode | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase().replace(/-/g, '_')
  if (v === 'stable_group_chat' || v === 'stable_group') return 'stable_group'
  if (v === 'full_council' || v === 'full') return 'full_council'
  if (v === 'direct') return 'direct'
  return FLOW_MODE_SET.has(v) ? (v as CouncilFlowMode) : null
}

/** Server env default (`COUNCIL_MODE`); falls back to stable group while stabilizing. */
export function readCouncilFlowModeFromEnv(): CouncilFlowMode | null {
  return parseCouncilFlowMode(process.env[COUNCIL_FLOW_MODE_ENV])
}

/** True when `COUNCIL_STABILITY_MODE` is on — stabilization period for the product. */
export function isCouncilStabilizing(): boolean {
  const raw = process.env.COUNCIL_STABILITY_MODE
  return raw === 'true' || raw === '1'
}

/** Default flow while stabilizing: stable group instead of full council. */
export function getDefaultCouncilFlowMode(): CouncilFlowMode {
  const fromEnv = readCouncilFlowModeFromEnv()
  if (fromEnv) return fromEnv
  if (isCouncilStabilizing()) return 'stable_group'
  return 'stable_group'
}

export function resolveCouncilFlowMode(
  clientMode: unknown,
  legacyCouncilMode?: unknown,
): CouncilFlowMode {
  return (
    parseCouncilFlowMode(clientMode)
    ?? parseCouncilFlowMode(legacyCouncilMode)
    ?? readCouncilFlowModeFromEnv()
    ?? getDefaultCouncilFlowMode()
  )
}

export function isStableGroupChatMode(mode?: CouncilFlowMode | null): boolean {
  return mode === 'stable_group'
}

export function isDirectCouncilFlowMode(mode?: CouncilFlowMode | null): boolean {
  return mode === 'direct'
}

export function isFullCouncilFlowMode(mode?: CouncilFlowMode | null): boolean {
  return mode === 'full_council'
}
