import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import { parseCouncilCommand } from '@/lib/council/commandParser'

export type ResolvedCouncilCommand = {
  command: CouncilCommand
  /** Ra’el decree text is sole authority for structured command. */
  source: 'rael_decree'
}

/**
 * Thin composition: latest Ra’el decree always wins (no autonomous steering).
 */
export function resolveActiveCommand(args: { latestDecreeText: string }): ResolvedCouncilCommand {
  const command = parseCouncilCommand(args.latestDecreeText)
  return {
    command: {
      ...command,
      authority: 'rael_explicit',
      scope: 'session',
    },
    source: 'rael_decree',
  }
}

/** Extra mode checks — warnings only; enforcement stays in governor + orchestration filter. */
export function councilModeExtensionWarnings(cmd: CouncilCommand): string[] {
  const w: string[] = []
  if (cmd.mode === 'silent' && cmd.targetFamilies.length === 0) {
    w.push('mode_silent_requires_family_mention_or_target')
  }
  if (cmd.mode === 'red_team_only' && cmd.targetFamilies.some(f => f !== 'red_team')) {
    w.push('mode_red_team_only_target_mismatch')
  }
  return w
}
