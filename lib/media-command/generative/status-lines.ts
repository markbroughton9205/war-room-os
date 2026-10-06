/**
 * HVS-GENERATIVE-VIDEO-01 — pure UI status-line formatting (shared by the GENERATE VIDEO panel and validators).
 * Only real states are shown; step progress appears only when the worker reported it. No invented percentages.
 */
import type { HvsGenerateVideoResult } from './types'

export function generationStateLine(result: HvsGenerateVideoResult | null): string {
  if (!result) return 'No generation yet.'
  const label = result.status.replace(/_/g, ' ')
  if (result.status === 'GENERATING' && result.progress) return `GENERATING · step ${result.progress.step}/${result.progress.totalSteps}`
  if (result.status === 'FAILED') return `FAILED · ${result.error?.code ?? 'GENERATION_FAILED'} — ${result.error?.message ?? ''}`.trim()
  if (result.status === 'COMPLETE') return `COMPLETE · ${result.durationSeconds ?? '?'}s ${result.width ?? '?'}×${result.height ?? '?'} @ ${result.fps ?? '?'} fps · asset ${result.outputAssetId}`
  return label
}
