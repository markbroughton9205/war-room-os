'use client'

/**
 * Compact God's Eye normalized health badge (RED/AMBER/GREEN/UNKNOWN) sitting beside the "War
 * Room Terra Linked" label. Reads the existing lib/terra/godsEyeStatusAdapter.ts -- the one
 * producer boundary the Council Foundation Rebuild will eventually fill in -- rather than
 * inventing a second status system. No caller here can pass a real input yet, so this always
 * renders UNKNOWN today; that is correct, not a bug: "no producer yet" must never read as GREEN.
 */
import { resolveCouncilGodsEyeStatus, type CouncilGodsEyeSeverity } from '@/lib/terra/godsEyeStatusAdapter'

const SEVERITY_LABEL: Record<CouncilGodsEyeSeverity, string> = {
  RED: "GOD'S EYE CRITICAL",
  AMBER: "GOD'S EYE DEGRADED",
  GREEN: "GOD'S EYE CLEAR",
  UNKNOWN: "GOD'S EYE UNKNOWN",
}

const SEVERITY_CLASS: Record<CouncilGodsEyeSeverity, string> = {
  RED: 'border-red-400/40 text-red-300',
  AMBER: 'border-amber-400/40 text-amber-300',
  GREEN: 'border-emerald-400/40 text-emerald-300',
  UNKNOWN: 'border-slate-400/30 text-slate-400',
}

export function CouncilGodsEyeStatus() {
  const status = resolveCouncilGodsEyeStatus()
  return (
    <span
      className={`shrink-0 rounded border px-1 text-[8px] font-bold tracking-widest ${SEVERITY_CLASS[status.severity]}`}
      role="status"
      aria-label={`${SEVERITY_LABEL[status.severity]}${status.reason ? `: ${status.reason}` : ''}`}
      title={status.reason ?? SEVERITY_LABEL[status.severity]}
    >
      {SEVERITY_LABEL[status.severity]}
    </span>
  )
}
