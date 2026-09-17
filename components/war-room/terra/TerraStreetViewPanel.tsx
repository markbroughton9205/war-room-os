'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildStreetViewCouncilHandoff,
  navigationFlags,
  selectAdjacentIndex,
  selectTurnIndex,
  STREET_VIEW_NO_COVERAGE_BODY,
  STREET_VIEW_NO_COVERAGE_TITLE,
  type StreetViewItem,
  type StreetViewLookupResult,
  type StreetViewOrigin,
} from '@/lib/terra/streetView'

export function TerraStreetViewPanel({
  origin,
  onClose,
  onGoToLocation,
  onSendToCouncil,
  canSendToCouncil,
  onStateChange,
}: {
  origin: StreetViewOrigin
  onClose: () => void
  onGoToLocation: (item: StreetViewItem) => void
  onSendToCouncil: (payload: ReturnType<typeof buildStreetViewCouncilHandoff>) => void
  canSendToCouncil?: boolean
  onStateChange?: (state: StreetViewLookupResult['state'] | 'LOADING') => void
}) {
  const [result, setResult] = useState<StreetViewLookupResult | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const onStateChangeRef = useRef(onStateChange)
  useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({
      lat: String(origin.latitude),
      lon: String(origin.longitude),
      radiusMeters: '80',
    })
    void fetch(`/api/terra/street-view?${params.toString()}`, { cache: 'no-store', credentials: 'include' })
      .then(async response => {
        const body = await response.json() as StreetViewLookupResult
        if (cancelled) return
        setResult(body)
        setIndex(0)
        onStateChangeRef.current?.(body.state)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Street-view lookup failed. No panorama was fabricated.')
          onStateChangeRef.current?.('ERROR_UPSTREAM')
        }
      })
    return () => {
      cancelled = true
    }
  }, [origin.latitude, origin.longitude, origin.context, origin.label])

  const item = result?.items[index] ?? null
  const flags = useMemo(() => navigationFlags(result?.items ?? [], index), [result, index])
  const loading = !result && !error
  const displayUrl = item?.imageUrl ?? item?.thumbUrl ?? null

  function move(step: -1 | 1) {
    const next = selectAdjacentIndex(result?.items.length ?? 0, index, step)
    if (next != null) setIndex(next)
  }

  function turn(direction: 'left' | 'right') {
    const next = selectTurnIndex(result?.items ?? [], index, direction)
    if (next != null) setIndex(next)
  }

  return (
    <aside
      className="pointer-events-auto w-[min(28rem,86vw)] overflow-hidden rounded-xl border border-cyan-300/40 bg-black/80 shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      data-testid="terra-street-view-panel"
      data-street-view-state={result?.state ?? (error ? 'ERROR_UPSTREAM' : 'LOADING')}
      data-street-view-context={origin.context}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">Street View</p>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <button type="button" disabled={!flags.canPrevious} onClick={() => move(-1)} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 disabled:opacity-30" data-testid="terra-street-view-previous">Previous</button>
          <button type="button" disabled={!flags.canNext} onClick={() => move(1)} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 disabled:opacity-30" data-testid="terra-street-view-next">Next</button>
          <button type="button" disabled={!flags.canTurnLeft} onClick={() => turn('left')} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 disabled:opacity-30" data-testid="terra-street-view-turn-left">Turn left</button>
          <button type="button" disabled={!flags.canTurnRight} onClick={() => turn('right')} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 disabled:opacity-30" data-testid="terra-street-view-turn-right">Turn right</button>
          <button type="button" disabled={!item} onClick={() => item && onGoToLocation(item)} className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-emerald-300 disabled:opacity-30" data-testid="terra-street-view-go-to-location">Go to location</button>
          <button type="button" disabled={!flags.canOpenSource} onClick={() => { const url = item?.viewerUrl ?? item?.sourceUrl; if (url) window.open(url, '_blank', 'noopener,noreferrer') }} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 disabled:opacity-30" data-testid="terra-street-view-source">Source</button>
          <button
            type="button"
            disabled={!canSendToCouncil || !result}
            onClick={() => result && onSendToCouncil(buildStreetViewCouncilHandoff({ origin, result, item }))}
            className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 disabled:border-white/10 disabled:text-slate-600"
            data-testid="terra-street-view-send-to-council"
          >
            Send to Council
          </button>
          <button type="button" onClick={onClose} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-400 hover:text-slate-200" data-testid="terra-street-view-close">Close</button>
        </div>
      </div>
      <div className="border-t border-white/10">
        {loading ? (
          <p className="px-2.5 py-6 text-center text-[11px] text-slate-400">Looking up public street imagery at the selected coordinates…</p>
        ) : error ? (
          <p className="px-2.5 py-6 text-center text-[11px] text-amber-200">{error}</p>
        ) : result?.state === 'AVAILABLE' && displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- lawful provider still/thumb only; not a Next-optimizable asset.
          <img src={displayUrl} alt={`${item?.provider} street-level image`} className="max-h-[min(22rem,42vh)] w-full bg-black object-contain" data-testid="terra-street-view-image" referrerPolicy="no-referrer" />
        ) : result?.state === 'AVAILABLE' && item ? (
          <div className="px-2.5 py-5" data-testid="terra-street-view-source-only">
            <p className="text-[12px] font-semibold text-cyan-100">Coverage found — no lawful image URL</p>
            <p className="mt-1 text-[11px] leading-snug text-slate-400">Terra will not fabricate a panorama. Use SOURCE for the provider viewer.</p>
          </div>
        ) : (
          <div className="px-2.5 py-5" data-testid="terra-street-view-no-coverage">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-amber-100">
              {result?.state === 'PROVIDER_AUTH_REQUIRED' || result?.state === 'AUTH_REQUIRED'
                ? 'Street View provider auth required'
                : result?.state === 'ERROR_UPSTREAM'
                  ? 'Street View unavailable'
                  : STREET_VIEW_NO_COVERAGE_TITLE}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-400">
              {result?.state === 'NO_COVERAGE' || !result
                ? STREET_VIEW_NO_COVERAGE_BODY
                : (result.honesty ?? STREET_VIEW_NO_COVERAGE_BODY)}
            </p>
          </div>
        )}
        <ul className="space-y-0.5 border-t border-white/10 px-2.5 py-2 font-mono text-[10px] text-slate-400">
          <li>provider {item?.provider ?? 'none'}</li>
          <li>image {item?.id ?? 'none'}</li>
          <li>sequence {item?.sequenceId ?? 'none'}</li>
          <li>query {origin.latitude.toFixed(5)}, {origin.longitude.toFixed(5)} · {origin.context}</li>
          <li>capture {item ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` : 'none'}</li>
          <li>captured {item?.capturedAt ?? 'UNKNOWN'}</li>
          <li>heading {item?.headingDeg != null ? `${Math.round(item.headingDeg)}°` : 'not reported'}</li>
          <li>distance {item ? `${Math.round(item.distanceMeters)} m` : 'none'}</li>
          <li>source {item?.sourceUrl ?? 'none'}</li>
          <li>license {item?.license ?? 'none'}</li>
          <li>attribution {item?.attribution ?? 'none'}</li>
          <li>auth {item?.authModel ?? result?.providersAttempted.map(row => `${row.provider}:${row.authModel}`).join(' · ') ?? 'none'}</li>
          <li>nominatim {String(result?.nominatimUsed ?? false)} · google {String(result?.googleUsed ?? false)}</li>
        </ul>
      </div>
    </aside>
  )
}
