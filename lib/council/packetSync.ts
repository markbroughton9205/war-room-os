import type { CouncilDisciplineMode } from '@/lib/council/councilCommandTypes'
import type { IntentKind } from '@/lib/council/intentClassifier'

export type CouncilIntentTier = 'casual' | 'council_full' | 'income_ops' | string

const SYNC_CASUAL_MS = 1800
const SYNC_GREETING_MS = 900
const SYNC_ATTENDANCE_MS = 1200
const SYNC_COUNCIL_MS = 24_000
const SYNC_RESEARCH_MS = 20_000
const SYNC_EXECUTION_MS = 18_000
const SYNC_DEFAULT_MS = 22_000

/**
 * Minimum “council sync” window before releasing a packet after OPEN.
 * Shorter for natural chat; ~20–30s for full council modes.
 */
export function resolveCouncilPacketSyncMs(args: {
  intentTier: CouncilIntentTier
  mode: CouncilDisciplineMode
  /** Decree intent — short post-gather sync for greeting / attendance. */
  intentKind?: IntentKind
}): number {
  if (args.intentKind === 'greeting') return SYNC_GREETING_MS
  if (args.intentKind === 'attendance') return SYNC_ATTENDANCE_MS
  if (args.intentTier === 'casual') return SYNC_CASUAL_MS
  if (args.mode === 'attendance') return SYNC_ATTENDANCE_MS
  if (args.mode === 'research' || args.mode === 'analysis') return SYNC_RESEARCH_MS
  if (args.mode === 'execution' || args.mode === 'emergency') return SYNC_EXECUTION_MS
  if (args.mode === 'council' || args.mode === 'debate') return SYNC_COUNCIL_MS
  return SYNC_DEFAULT_MS
}
