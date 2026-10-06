/**
 * Action recognition honesty. Heuristic motion ≠ walking/running/fighting.
 */
import type { MediaTime } from './time'
import type { VideoObservation } from './video-intelligence'

export type ActionClassificationType = 'MODEL' | 'HEURISTIC'

export type ActionObservation = {
  actionLabel: string
  start: MediaTime
  end: MediaTime
  confidence: number
  evidence: Array<{ kind: string; note: string }>
  model: string | null
  backend: string
  classificationType: ActionClassificationType
}

export const FORBIDDEN_HEURISTIC_ACTION_CLAIMS = ['walking', 'running', 'fighting', 'driving', 'jumping'] as const

export function actionFromObservation(row: VideoObservation): ActionObservation[] {
  return (row.actions ?? []).map(a => {
    const extra = a as { classificationType?: ActionClassificationType; backend?: string; model?: string; evidence?: ActionObservation['evidence'] }
    const classificationType: ActionClassificationType = extra.classificationType === 'MODEL' ? 'MODEL' : 'HEURISTIC'
    return {
      actionLabel: a.label,
      start: row.timeRange?.start ?? row.timestamp,
      end: row.timeRange?.end ?? row.timestamp,
      confidence: a.confidence,
      evidence: extra.evidence ?? [{ kind: 'observation', note: a.label }],
      model: extra.model ?? null,
      backend: extra.backend ?? 'local-ffmpeg-vision',
      classificationType,
    }
  })
}

export function assertActionHonesty(actions: ActionObservation[]): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  for (const a of actions) {
    const label = a.actionLabel.toLowerCase()
    if (a.classificationType !== 'MODEL' && a.classificationType !== 'HEURISTIC') {
      errors.push(`${a.actionLabel} missing classificationType`)
    }
    if (a.classificationType === 'HEURISTIC' && FORBIDDEN_HEURISTIC_ACTION_CLAIMS.some(c => label.includes(c))) {
      errors.push(`HEURISTIC must not claim ${a.actionLabel}`)
    }
    if (a.classificationType === 'MODEL' && !a.model) errors.push(`MODEL action ${a.actionLabel} missing model id`)
  }
  return { ok: errors.length === 0, errors }
}

export const ACTION_RECOGNITION_STATUS = {
  trueModelInstalled: false,
  firstPath: 'foundation-only',
  ready: false as const,
  note: 'NOT READY for true action recognition. HIGH MOTION remains HEURISTIC.',
} as const
