'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  DEFAULT_GIBS_LAYER_ID,
  GIBS_LAYERS,
  getGibsLayer,
  type GibsLayerDefinition,
} from '@/lib/earth-intelligence/gibsLayers'
import {
  EARLIEST_PLAUSIBLE_GIBS_DATE,
  buildGibsTileUrlTemplate,
  isRequestableIsoDate,
  todayUtcIsoDate,
} from '@/lib/earth-intelligence/gibsTileUrl'

const NASA_ATTRIBUTION =
  "Imagery provided by NASA Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System."

const STALL_TIMEOUT_MS = 12000

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00ff41]'

/**
 * `loading` — request in flight, nothing confirmed either way yet.
 * `ok` — at least one tile has actually loaded (see the `tileload` handler
 *   below); imagery is genuinely on screen.
 * `error` — every tile that finished, finished with an error.
 * `stalled` — the request never settled within STALL_TIMEOUT_MS and zero
 *   tiles loaded. Distinct from `error` on purpose: this is "we gave up
 *   waiting," not "NASA told us no" — never collapsed into `ok`.
 */
type LoadState = 'loading' | 'ok' | 'error' | 'stalled'
type ConfigurationIssue = 'layer-unavailable' | 'invalid-date' | null

export function EarthIntelligenceMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const loadTallyRef = useRef({ loaded: 0, errored: 0 })
  // Request-generation guard: every tile-layer request stamps its own id
  // here. Any async callback (Leaflet event or the stall timeout) checks
  // this before touching state, so a slow/stale callback from a layer or
  // date that's no longer current can never overwrite the active request's
  // state — including reporting false success for a removed layer.
  const requestIdRef = useRef(0)

  const [selectedLayerId, setSelectedLayerId] = useState(DEFAULT_GIBS_LAYER_ID)
  const [selectedDate, setSelectedDate] = useState(
    () => getGibsLayer(DEFAULT_GIBS_LAYER_ID)?.defaultDate ?? todayUtcIsoDate(),
  )
  const [opacity, setOpacity] = useState(1)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [controlsOpen, setControlsOpen] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  const selectedLayer = useMemo<GibsLayerDefinition>(
    () => getGibsLayer(selectedLayerId) ?? getGibsLayer(DEFAULT_GIBS_LAYER_ID)!,
    [selectedLayerId],
  )

  // Reset the date to the layer's own known-good default whenever the
  // selected layer changes — adjusted during render (React's documented
  // pattern for "resetting state when a dependency changes") rather than in
  // an Effect, so it doesn't fight the set-state-in-effect lint rule.
  const [layerIdForDateReset, setLayerIdForDateReset] = useState(selectedLayerId)
  if (selectedLayerId !== layerIdForDateReset) {
    setLayerIdForDateReset(selectedLayerId)
    if (selectedLayer.status === 'available') {
      setSelectedDate(selectedLayer.defaultDate ?? todayUtcIsoDate())
    }
  }

  const configurationIssue: ConfigurationIssue =
    selectedLayer.status !== 'available'
      ? 'layer-unavailable'
      : !isRequestableIsoDate(selectedDate)
        ? 'invalid-date'
        : null

  // Same pattern: flip back to "loading" as soon as a new request starts
  // (layer, date, or an explicit Retry), computed during render instead of
  // via a synchronous setState in an Effect.
  const requestKey = configurationIssue ? null : `${selectedLayer.id}:${selectedDate}:${retryNonce}`
  const [prevRequestKey, setPrevRequestKey] = useState(requestKey)
  if (requestKey !== prevRequestKey) {
    setPrevRequestKey(requestKey)
    if (requestKey) setLoadState('loading')
  }

  // Initialize the Leaflet map once.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = L.map(mapContainerRef.current, {
      center: [20, 0],
      zoom: 3,
      minZoom: 1,
      maxZoom: 12,
      worldCopyJump: true,
      attributionControl: false,
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Synchronize the active tile layer with the external Leaflet map whenever
  // the layer, date, or an explicit retry changes. All state updates here
  // happen inside Leaflet's own async event callbacks (or the stall
  // timeout), never synchronously in the effect body, and every callback is
  // gated by the request-generation guard above.
  //
  // Deps deliberately exclude `opacity` — an opacity change must never tear
  // down and refetch the current tile layer. See the dedicated opacity
  // effect below, which is the only thing that reacts to opacity.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current)
      tileLayerRef.current = null
    }
    if (configurationIssue) return

    let urlTemplate: string
    try {
      urlTemplate = buildGibsTileUrlTemplate(selectedLayer.id, selectedDate)
    } catch {
      return
    }

    const requestId = ++requestIdRef.current
    loadTallyRef.current = { loaded: 0, errored: 0 }

    const layer = L.tileLayer(urlTemplate, {
      tileSize: 256,
      maxNativeZoom: selectedLayer.maxNativeZoom,
      opacity,
      attribution: NASA_ATTRIBUTION,
      crossOrigin: true,
    })

    layer.on('loading', () => {
      if (requestIdRef.current !== requestId) return
      setLoadState('loading')
    })
    layer.on('tileload', () => {
      if (requestIdRef.current !== requestId) return
      loadTallyRef.current.loaded += 1
    })
    layer.on('tileerror', () => {
      if (requestIdRef.current !== requestId) return
      loadTallyRef.current.errored += 1
    })
    layer.on('load', () => {
      if (requestIdRef.current !== requestId) return
      // Success requires at least one confirmed tileload — never inferred
      // from "the queue emptied." That includes the edge case where the
      // queue was empty from the start (e.g. Leaflet computed a zero-size
      // tile range before layout settled): zero confirmed loads is treated
      // the same as a failure, never defaulted to 'ok'.
      setLoadState(loadTallyRef.current.loaded > 0 ? 'ok' : 'error')
    })

    tileLayerRef.current = layer
    layer.addTo(map)

    // Never claim success from elapsed time alone. If nothing has loaded by
    // the deadline, report the honest "stalled" state (with a Retry
    // control) instead of silently becoming indistinguishable from success.
    const stallTimeout = window.setTimeout(() => {
      if (requestIdRef.current !== requestId) return
      setLoadState(current => {
        if (current !== 'loading') return current
        return loadTallyRef.current.loaded > 0 ? 'ok' : 'stalled'
      })
    }, STALL_TIMEOUT_MS)

    return () => window.clearTimeout(stallTimeout)
    // `opacity` is read above only to seed the new layer's initial value —
    // deliberately excluded so an opacity-only change never tears down and
    // refetches the tile layer (see the dedicated opacity effect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayer, selectedDate, configurationIssue, retryNonce])

  // The only effect that reacts to opacity: live-updates the existing tile
  // layer in place. No teardown, no refetch, no change to map center/zoom.
  useEffect(() => {
    tileLayerRef.current?.setOpacity(opacity)
  }, [opacity])

  const displayState: LoadState | 'configuration-issue' = configurationIssue ? 'configuration-issue' : loadState
  const canRetry = displayState === 'error' || displayState === 'stalled'

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black md:flex-row">
      <div ref={mapContainerRef} className="relative z-0 h-[55vh] w-full shrink-0 md:h-full md:flex-1" />

      {displayState === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute left-3 top-3 z-[500] flex items-center gap-2 rounded border border-[#00ff41]/30 bg-black/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[#00ff41]"
        >
          <span className="war-room-loading-pulse h-2 w-2 rounded-full bg-[#00ff41]" aria-hidden="true" />
          Loading imagery…
        </div>
      )}

      {(displayState === 'error' || displayState === 'stalled' || displayState === 'configuration-issue') && (
        <div
          role="alert"
          className="absolute left-3 top-3 z-[500] max-w-xs rounded border border-amber-400/40 bg-black/85 px-3 py-2 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-amber-300"
        >
          <p>
            {displayState === 'configuration-issue' &&
              (configurationIssue === 'layer-unavailable'
                ? 'This layer is not rendered in Phase 1. See the notice in the layer list.'
                : 'No imagery available for this layer and date. NASA may not have published imagery yet, or the request failed. Try a different date or layer.')}
            {displayState === 'error' &&
              'No imagery available for this layer and date. NASA may not have published imagery yet, or the request failed.'}
            {displayState === 'stalled' &&
              'This request is taking longer than expected and did not complete. It has not been marked as loaded.'}
          </p>
          {canRetry && (
            <button
              type="button"
              onClick={() => setRetryNonce(n => n + 1)}
              className={['pointer-events-auto mt-2 rounded border border-amber-400/50 px-2 py-1 text-amber-200 hover:bg-amber-400/10', FOCUS_RING].join(' ')}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setControlsOpen(open => !open)}
        aria-expanded={controlsOpen}
        aria-controls="earth-intel-panel"
        className={[
          'absolute bottom-3 right-3 z-[500] rounded border border-[#FFD700]/50 bg-black/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[#FFD700] md:hidden',
          FOCUS_RING,
        ].join(' ')}
      >
        {controlsOpen ? 'Close panel' : 'Layers & controls'}
      </button>

      <aside
        id="earth-intel-panel"
        className={[
          'z-[400] w-full shrink-0 overflow-y-auto border-t border-white/10 bg-slate-950/95 font-mono backdrop-blur-xl md:h-full md:w-80 md:border-l md:border-t-0',
          controlsOpen ? 'block' : 'hidden md:block',
        ].join(' ')}
      >
        <div className="flex flex-col gap-4 p-4">
          <header className="border-b border-white/10 pb-3">
            <h1 className="text-xs font-semibold uppercase tracking-[0.3em] text-[#FFD700]">Earth Intelligence</h1>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">NASA GIBS satellite layers</p>
          </header>

          <section>
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300">Layer</h2>
            <div role="radiogroup" aria-label="Layer" className="flex flex-col gap-1.5">
              {GIBS_LAYERS.map(layer => (
                <LayerOption
                  key={layer.id}
                  layer={layer}
                  selected={layer.id === selectedLayerId}
                  onSelect={() => layer.status === 'available' && setSelectedLayerId(layer.id)}
                />
              ))}
            </div>
          </section>

          {selectedLayer.status === 'available' && (
            <section>
              {selectedLayer.temporalResolution === 'annual' ? (
                <>
                  <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300">Date</h2>
                  <p className="rounded border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[10px] uppercase tracking-wide text-slate-400">
                    {selectedLayer.defaultDate?.slice(0, 4)} annual composite — no date selection for this layer.
                  </p>
                </>
              ) : (
                <>
                  <label
                    htmlFor="earth-intel-date"
                    className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300"
                  >
                    Date
                  </label>
                  <input
                    id="earth-intel-date"
                    type="date"
                    value={selectedDate}
                    min={EARLIEST_PLAUSIBLE_GIBS_DATE}
                    max={todayUtcIsoDate()}
                    onChange={event => setSelectedDate(event.target.value)}
                    className={[
                      'w-full rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-slate-200 [color-scheme:dark]',
                      FOCUS_RING,
                    ].join(' ')}
                  />
                  {selectedLayer.temporalResolution === '8-day-composite' && (
                    <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-500">
                      8-day composite — GIBS resolves any date to its enclosing period.
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="earth-intel-opacity" className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300">
                Opacity
              </label>
              <span className="text-[10px] text-slate-400">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              id="earth-intel-opacity"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              onChange={event => setOpacity(Number(event.target.value))}
              aria-valuetext={`${Math.round(opacity * 100)}%`}
              className={['w-full accent-[#00ff41]', FOCUS_RING].join(' ')}
              disabled={selectedLayer.status !== 'available'}
            />
          </section>

          <section className="rounded border border-white/10 bg-white/[0.03] p-2.5">
            <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300">About this layer</h2>
            <p className="text-[11px] leading-relaxed text-slate-300">{selectedLayer.description}</p>
            {selectedLayer.caveat && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-amber-300">{selectedLayer.caveat}</p>
            )}
            {selectedLayer.status === 'unavailable' && selectedLayer.unavailableReason && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-amber-300">{selectedLayer.unavailableReason}</p>
            )}
          </section>

          {selectedLayer.legendUrl && (
            <section>
              <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300">Legend</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedLayer.legendUrl}
                alt={`${selectedLayer.label} legend`}
                className="w-full rounded border border-white/10 bg-white p-1.5"
              />
            </section>
          )}

          <footer className="border-t border-white/10 pt-3 text-[9px] leading-relaxed text-slate-500">
            {NASA_ATTRIBUTION}
          </footer>
        </div>
      </aside>
    </div>
  )
}

function LayerOption({
  layer,
  selected,
  onSelect,
}: {
  layer: GibsLayerDefinition
  selected: boolean
  onSelect: () => void
}) {
  const disabled = layer.status !== 'available'
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={[
        'flex items-center justify-between gap-2 rounded border px-2.5 py-2 text-left text-[11px] transition-colors',
        FOCUS_RING,
        disabled
          ? 'cursor-not-allowed border-white/5 bg-white/[0.02] text-slate-600'
          : selected
            ? 'border-[#00ff41]/50 bg-[#00ff41]/10 text-[#00ff41]'
            : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.05]',
      ].join(' ')}
    >
      <span className="uppercase tracking-wide">{layer.label}</span>
      {disabled && (
        <span className="rounded border border-amber-400/30 bg-amber-400/5 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-amber-300">
          Unavailable
        </span>
      )}
    </button>
  )
}
