'use client'

/**
 * Compact, at-a-glance Council status dot + label (Phase I). Reads the same matrixStatusBus the
 * Matrix background reads (lib/ui/matrixStatusBus.ts) -- one shared source of real runtime state,
 * never a second event system. 'error' only ever reaches this component when something upstream
 * (lib/council/liveChatPipeline.ts, components/war-room/terra/useTerraLayer.ts) reported a real
 * failure -- this component never invents severity from silence.
 */
import { useSyncExternalStore } from 'react'
import {
  getMatrixStatusServerSnapshot,
  getMatrixStatusSnapshot,
  subscribeMatrixStatus,
  type MatrixStatusKind,
} from '@/lib/ui/matrixStatusBus'

const STATUS_LABEL: Record<MatrixStatusKind, string> = {
  idle: 'CONNECTED',
  outbound: 'QUERYING',
  inbound: 'DATA INBOUND',
  working: 'PROCESSING',
  success: 'COMPLETE',
  verified: 'VERIFIED',
  warning: 'DEGRADED',
  error: 'CRITICAL',
}

const STATUS_DOT_CLASS: Record<MatrixStatusKind, string> = {
  idle: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]',
  outbound: 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.85)]',
  inbound: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.85)]',
  working: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.85)]',
  success: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.95)]',
  verified: 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.95)]',
  warning: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.85)]',
  error: 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.95)]',
}

const STATUS_TEXT_CLASS: Record<MatrixStatusKind, string> = {
  idle: 'text-emerald-300',
  outbound: 'text-violet-300',
  inbound: 'text-cyan-300',
  working: 'text-amber-300',
  success: 'text-emerald-300',
  verified: 'text-white',
  warning: 'text-amber-300',
  error: 'text-red-300',
}

export function CouncilRuntimeStatus() {
  const snapshot = useSyncExternalStore(subscribeMatrixStatus, getMatrixStatusSnapshot, getMatrixStatusServerSnapshot)
  const kind = snapshot.kind
  const label = STATUS_LABEL[kind] ?? 'UNKNOWN'

  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      role="status"
      aria-live="polite"
      aria-label={`Council runtime status: ${label}`}
      title={snapshot.message || label}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[kind] ?? STATUS_DOT_CLASS.idle}`} aria-hidden="true" />
      <span className={`whitespace-nowrap text-[8px] font-bold uppercase tracking-[0.16em] ${STATUS_TEXT_CLASS[kind] ?? STATUS_TEXT_CLASS.idle}`}>
        {label}
      </span>
    </div>
  )
}
