import type { CouncilResolutionSessionState } from '@/lib/council/sessionLifecycle'

export type SessionBarrierArgs = {
  sessionState: CouncilResolutionSessionState
  /** Epoch ms when provider completed (or client received) the reply. */
  messageTimestampMs: number
  /** Epoch ms when packet was closed — late if strictly after close. */
  closeTimestampMs: number | null
}

/**
 * Late visible replies after packet CLOSE (same round) should be suppressed.
 */
export function shouldSuppressVisibleLateResponse(args: SessionBarrierArgs): boolean {
  if (args.sessionState !== 'CLOSED') return false
  if (args.closeTimestampMs == null) return false
  return args.messageTimestampMs > args.closeTimestampMs
}
