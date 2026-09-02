'use client'

/**
 * Compact God's Eye normalized health badge (RED/AMBER/GREEN/UNKNOWN) sitting beside the "War
 * Room Terra Linked" label. Purely presentational -- callers resolve the real status through
 * lib/terra/godsEyeStatusAdapter.ts (the one producer boundary) and pass it in, so this never
 * becomes a second status system. With no `status` prop this falls back to
 * UNKNOWN_GODS_EYE_STATUS: "no producer wired yet" must never read as GREEN.
 */
import { UNKNOWN_GODS_EYE_STATUS, type CouncilGodsEyeSeverity, type CouncilGodsEyeStatus as CouncilGodsEyeStatusValue } from '@/lib/terra/godsEyeStatusAdapter'

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

export function CouncilGodsEyeStatus({ status }: { status?: CouncilGodsEyeStatusValue }) {
  const resolved = status ?? UNKNOWN_GODS_EYE_STATUS
  return (
    <span
      className={`shrink-0 rounded border px-1 text-[8px] font-bold tracking-widest ${SEVERITY_CLASS[resolved.severity]}`}
      role="status"
      aria-label={`${SEVERITY_LABEL[resolved.severity]}${resolved.reason ? `: ${resolved.reason}` : ''}`}
      title={resolved.reason ?? SEVERITY_LABEL[resolved.severity]}
    >
      {SEVERITY_LABEL[resolved.severity]}
    </span>
  )
}
