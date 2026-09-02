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

// Keyed by every string MatrixStatusKind can actually be: the five legacy kinds a
// matrixStatus() caller passes, plus the six matrixChannelStatus() palette channels a
// runtimeEventBridge.ts caller passes directly as `kind` (lib/ui/matrixStatusBus.ts's `publish`
// stores whatever kind string it was given). Covering both keeps this legible for legacy callers
// (PROCESSING vs DEGRADED, both amber) without a second status vocabulary.
const STATUS_LABEL: Record<MatrixStatusKind, string> = {
  idle: 'CONNECTED',
  working: 'PROCESSING',
  success: 'COMPLETE',
  warning: 'DEGRADED',
  error: 'CRITICAL',
  violet: 'QUERYING',
  cyan: 'DATA INBOUND',
  amber: 'PROCESSING',
  green: 'COMPLETE',
  red: 'CRITICAL',
  white: 'VERIFIED',
}

const STATUS_DOT_CLASS: Record<MatrixStatusKind, string> = {
  idle: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]',
  working: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.85)]',
  success: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.95)]',
  warning: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.85)]',
  error: 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.95)]',
  violet: 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.85)]',
  cyan: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.85)]',
  amber: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.85)]',
  green: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.95)]',
  red: 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.95)]',
  white: 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.95)]',
}

const STATUS_TEXT_CLASS: Record<MatrixStatusKind, string> = {
  idle: 'text-emerald-300',
  working: 'text-amber-300',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  error: 'text-red-300',
  violet: 'text-violet-300',
  cyan: 'text-cyan-300',
  amber: 'text-amber-300',
  green: 'text-emerald-300',
  red: 'text-red-300',
  white: 'text-white',
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
