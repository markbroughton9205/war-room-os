import type { DeliberationTurnRole } from '@/lib/council/family-deliberation/types'
import type { CouncilMessageStage } from './types'

const ROLE_TO_STAGE: Record<DeliberationTurnRole, CouncilMessageStage> = {
  opening_position: 'OPENING',
  direct_response: 'RESPONSE',
  red_team_challenge: 'RED_TEAM',
  revision_or_stand_firm: 'REVISION',
  council_synthesis: 'SYNTHESIS',
}

export function stageFromDeliberationRole(role: DeliberationTurnRole | null | undefined): CouncilMessageStage {
  if (!role) return 'UNKNOWN_STAGE'
  return ROLE_TO_STAGE[role] ?? 'UNKNOWN_STAGE'
}

export function stageLabel(stage: CouncilMessageStage): string {
  if (stage === 'RED_TEAM') return 'CHALLENGE'
  if (stage === 'SYNTHESIS') return 'FINAL'
  if (stage === 'COMMANDER') return 'DECREE'
  return stage.replace(/_/g, ' ')
}

export function actorStageLine(actor: string, stage: CouncilMessageStage): string {
  const shortActor = actor.replace(/\s+Family$/i, '').trim() || actor
  return `${shortActor} · ${stageLabel(stage)}`
}

/** Legacy rows without truthful stage metadata must not be invented. */
export function stageFromPersistedMetadata(metadata: Record<string, unknown> | null | undefined): CouncilMessageStage {
  const raw = metadata?.councilStage ?? metadata?.council_stage
  if (typeof raw !== 'string') return 'LEGACY'
  const upper = raw.trim().toUpperCase()
  const allowed: CouncilMessageStage[] = [
    'COMMANDER',
    'OPENING',
    'RESPONSE',
    'DEBATE',
    'RED_TEAM',
    'REVISION',
    'SYNTHESIS',
    'RESEARCH_STATUS',
    'SYSTEM',
    'LEGACY',
    'UNKNOWN_STAGE',
  ]
  return (allowed as string[]).includes(upper) ? (upper as CouncilMessageStage) : 'LEGACY'
}
