'use client'

import { LOCAL_UI_ORIGIN } from '@/lib/sovereign-runtime/constants'
import { HVS_CANONICAL_PATH } from '@/lib/media-command/navigation'
import {
  HVS_INSTALLED_CORE_PORT,
  HVS_INSTALLED_UI_PORT,
  HVS_UNAVAILABLE_BODY,
  HVS_UNAVAILABLE_HEADLINE,
  HVS_UNAVAILABLE_RETRY,
} from '@/lib/media-command/war-room-integration'

export function HvsUnavailableState({
  onRetry,
}: {
  onRetry?: () => void
}) {
  function retry() {
    if (onRetry) {
      onRetry()
      return
    }
    window.location.assign(`${LOCAL_UI_ORIGIN}${HVS_CANONICAL_PATH}`)
  }

  return (
    <div
      className="mx-auto max-w-xl rounded-xl border border-amber-400/40 bg-black/70 p-6 text-amber-50"
      data-testid="hvs-unavailable"
      role="alert"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.34em] text-amber-200">{HVS_UNAVAILABLE_HEADLINE}</p>
      <p className="mt-3 text-sm text-slate-200">{HVS_UNAVAILABLE_BODY}</p>
      <button
        type="button"
        data-testid="hvs-unavailable-retry"
        className="mt-4 rounded border border-emerald-400/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-100"
        onClick={retry}
      >
        {HVS_UNAVAILABLE_RETRY}
      </button>
      <details className="mt-4 text-[11px] text-slate-500">
        <summary>Advanced details</summary>
        <p className="mt-2">Installed War Room UI port {HVS_INSTALLED_UI_PORT}. Core port {HVS_INSTALLED_CORE_PORT}.</p>
        <p>Higher Vision Studios is served by the same UI runtime. file:// routes are not used.</p>
      </details>
    </div>
  )
}
