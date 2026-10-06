'use client'

/**
 * Compact God's Eye normalized health badge (RED/AMBER/GREEN/UNKNOWN) sitting beside the "War
 * Room Terra Linked" label. Purely presentational -- callers resolve the real status through
 * lib/terra/godsEyeStatusAdapter.ts (the one producer boundary) and pass it in, so this never
 * becomes a second status system. With no `status` prop this falls back to
 * UNKNOWN_GODS_EYE_STATUS: "no producer wired yet" must never read as GREEN.
 */
import { godsEyePublicLabel, UNKNOWN_GODS_EYE_STATUS, type CouncilGodsEyeSeverity, type CouncilGodsEyeStatus as CouncilGodsEyeStatusValue } from '@/lib/terra/godsEyeStatusAdapter'

const SEVERITY_CLASS: Record<CouncilGodsEyeSeverity, string> = {
  RED: 'border-red-400/40 text-red-300',
  AMBER: 'border-amber-400/40 text-amber-300',
  GREEN: 'border-emerald-400/40 text-emerald-300',
  UNKNOWN: 'border-slate-400/30 text-slate-400',
}

export function CouncilGodsEyeStatus({ status }: { status?: CouncilGodsEyeStatusValue }) {
  const resolved = status ?? UNKNOWN_GODS_EYE_STATUS
  const label = godsEyePublicLabel(resolved)
  const reason = resolved.reason?.trim() || ''
  return (
    <span
      className={`shrink-0 rounded border px-1 text-[8px] font-bold tracking-widest ${SEVERITY_CLASS[resolved.severity]}`}
      role="status"
      data-testid="gods-eye-status"
      data-godseye-state={label}
      data-godseye-reason={reason}
      aria-label={reason ? `${label}: ${reason}` : label}
      title={reason || label}
    >
      {label}
      {reason ? <span className="ml-1 font-normal normal-case tracking-normal opacity-80">· {reason}</span> : null}
    </span>
  )
}
