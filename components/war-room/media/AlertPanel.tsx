'use client'

import { useMediaPlayback } from './MediaPlaybackProvider'

/**
 * Phase 1 boundary only. Does not fetch NWS and does not duck audio.
 * Future adapter must preserve zone-only alerts.
 */
export function AlertPanel() {
  const { state, controller } = useMediaPlayback()
  const duck = state.alertDuckState

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-[rgba(3,8,14,0.55)] p-3" data-testid="media-alert-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">Alerts</h3>
        <span className="rounded-full border border-white/12 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-400">
          {state.station?.city ?? 'No location'}
        </span>
        <label className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
          Alert ducking
          <button
            type="button"
            role="switch"
            aria-checked={duck.enabled}
            data-testid="media-alert-duck-toggle"
            className={`rounded-full border px-2 py-0.5 ${
              duck.enabled ? 'border-emerald-400/50 text-emerald-200' : 'border-white/12 text-slate-500'
            }`}
            onClick={() => controller.setDuckEnabled(!duck.enabled)}
          >
            {duck.enabled ? 'On' : 'Off'}
          </button>
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        No live NWS alerts this pass.
      </p>
      {duck.ducking ? (
        <p className="mt-1 text-[10px] text-amber-300">Audio is ducked.</p>
      ) : null}
    </section>
  )
}
