import type { CouncilProgressEventEnvelope } from '@/lib/council/progress-events/types'

export const NEBULA_COMMANDER_EVENT_LABELS = {
  request_created: 'Council Round Created',
  request_selection_resolved: 'Participants Selected',
  request_started: 'Council Round Created',
  family_waiting: 'Agent Queued',
  family_queued: 'Agent Queued',
  family_dispatched: 'Agent Started',
  family_response_started: 'Agent Started',
  family_response_completed: 'Agent Responded',
  family_failed: 'Agent Skipped',
  family_timed_out: 'Agent Skipped',
  family_skipped_by_policy: 'Agent Skipped',
  family_stopped_by_commander: 'Agent Skipped',
  family_not_reached: 'Agent Skipped',
  request_completed: 'Council Round Completed',
  request_failed: 'Council Round Completed · Degraded',
  request_timed_out: 'Council Round Completed · Degraded',
  request_cancelled: 'Council Round Completed · Degraded',
} as const

const ALWAYS_HIDDEN = new Set<CouncilProgressEventEnvelope['eventType']>([
  'family_prior_response_delivered',
  'family_reviewing_previous',
])

export function isHiddenFromCommanderTimeline(
  event: Pick<CouncilProgressEventEnvelope, 'eventType' | 'payload' | 'diagnostic'>,
): boolean {
  if (ALWAYS_HIDDEN.has(event.eventType)) return true
  if (event.eventType === 'diagnostic_recorded') {
    const code = event.payload.diagnostic?.code ?? event.diagnostic?.code
    return code === 'TEXT_DELTA'
  }
  return false
}

export function nebulaCommanderEventLabel(
  event: Pick<CouncilProgressEventEnvelope, 'eventType' | 'family' | 'payload'>,
): string | null {
  if (isHiddenFromCommanderTimeline(event)) return null
  if (event.eventType === 'family_response_started' && event.family === 'chatgpt') {
    return 'AURORA Synthesis Started'
  }
  if (event.eventType === 'request_completed' && event.payload.outcome && event.payload.outcome !== 'complete') {
    return 'Council Round Completed · Degraded'
  }
  const mapped = NEBULA_COMMANDER_EVENT_LABELS[event.eventType as keyof typeof NEBULA_COMMANDER_EVENT_LABELS]
  return mapped ?? null
}

export function containsLegacyFamilyEventLanguage(text: string): boolean {
  return /\b(families assigned|family prior response delivered|family reviewing previous|claude family|chatgpt family|gemini family|grok family|red team)\b/i.test(text)
}
