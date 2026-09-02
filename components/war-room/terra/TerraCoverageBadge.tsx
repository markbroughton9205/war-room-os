'use client'

/**
 * God's Eye Phase 3 — the ONE shared coverage-truth badge every bounded-coverage Terra layer
 * renders through, so the Commander sees a single coherent 7-state model (lib/terra/
 * coverageTruth.ts) instead of per-layer bespoke vocabularies. Layers with a genuinely richer
 * resolver (maritime's RATE_LIMITED / DELAYED_DATA — lib/terra/maritimeCoverage.ts) map onto the
 * nearest truth state for color and pass their own label text via `label`, so the visual language
 * is unified without flattening real provider detail.
 */
import { TERRA_COVERAGE_TRUTH_LABELS, type TerraCoverageTruthState } from '@/lib/terra/coverageTruth'

const STATE_COLOR: Record<TerraCoverageTruthState, string> = {
  NO_COVERAGE: 'text-amber-400',
  NO_DATA: 'text-slate-400',
  LOADING: 'text-slate-400',
  LIVE: 'text-emerald-400',
  STALE: 'text-amber-400',
  OFFLINE: 'text-red-400',
  UNKNOWN: 'text-slate-400',
}

export function TerraCoverageBadge({ state, label }: { state: TerraCoverageTruthState; label?: string }) {
  return (
    <p className={`text-[10px] font-bold uppercase tracking-widest ${STATE_COLOR[state]}`}>
      {label ?? TERRA_COVERAGE_TRUTH_LABELS[state]}
    </p>
  )
}
