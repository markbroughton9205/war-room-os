import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/** Soft role caps — merged with `CouncilCommand.responseLimits` in governor (min of caps). */
export const FAMILY_SOFT_CHAR_CAPS: Partial<Record<CouncilOrchestrationFamily, number>> = {
  chatgpt: 10_000,
  claude: 11_000,
  grok: 9000,
  gemini: 11_000,
  red_team: 8500,
  baby: 4000,
  kimi: 8000,
  bridge_architect: 8000,
}

/** Primary synthesis vs architecture emphasis — informs caps / future prompts; governor uses caps only. */
export const FAMILY_ROLE_LOCK: Partial<Record<CouncilOrchestrationFamily, 'synthesis' | 'architecture' | 'signals' | 'verification' | 'observer' | 'local'>> = {
  chatgpt: 'synthesis',
  claude: 'architecture',
  grok: 'signals',
  gemini: 'synthesis',
  red_team: 'verification',
  baby: 'observer',
  kimi: 'architecture',
  bridge_architect: 'local',
}

export function effectiveMaxCharsForFamily(
  family: CouncilOrchestrationFamily,
  commandMaxChars: number,
): number {
  const cap = FAMILY_SOFT_CHAR_CAPS[family]
  if (typeof cap === 'number' && Number.isFinite(cap)) {
    return Math.min(commandMaxChars, cap)
  }
  return commandMaxChars
}

export function familyRoleLockLabel(family: CouncilOrchestrationFamily): string | null {
  const r = FAMILY_ROLE_LOCK[family]
  if (!r) return null
  return r
}
