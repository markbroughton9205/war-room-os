'use client'

/**
 * God's Eye Phase 3 — the generic bounded-coverage traffic/transportation layer. One component
 * implements the exact pattern TerraShell previously copy-pasted per source (enabled toggle →
 * camera-view bbox query gated on camera scale and the source's own coverage envelope →
 * useTerraLayer → TerraFeatureLayer), parameterized by a TerraTrafficLayerDef so all 13
 * traffic layers (6 Phase 1/2 + 7 Phase 3) share one wiring path — and, critically, one coverage
 * truth model: every row resolves through lib/terra/coverageTruth.ts's resolveTerraCoverageTruth
 * and renders the shared TerraCoverageBadge, so NO_COVERAGE (camera outside the source's real
 * envelope) is never shown as "no data," a stale refresh is never re-labeled live, and a source
 * whose only real data is historical (WebTRIS ~2-month lag) can never report LIVE.
 * JARTIC hourly volumes are LIVE TRAFFIC VOLUMES of the latest published hour-band, not live signal phase.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Viewer as CesiumViewer } from 'cesium'
import { useTerraLayer } from './useTerraLayer'
import { TerraCoverageBadge } from './TerraCoverageBadge'
import { useTerraActiveLocation } from './TerraActiveLocationContext'
import { shouldAutoRefreshTerraLayer } from '@/lib/terra/terraTime'
import { resolveTerraCoverageTruth } from '@/lib/terra/coverageTruth'
import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import type { TerraGeoFeature, TerraTimeMode } from '@/lib/terra/types'
import type { TerraScaleLevel } from './useTerraCameraScale'
import { terraScaleMeetsMin } from './useTerraCameraScale'

const TerraFeatureLayer = dynamic(() => import('./TerraFeatureLayer').then(m => m.TerraFeatureLayer), { ssr: false })

export type TerraTrafficLayerDef = {
  layerId: string
  label: string
  /** Pluralizable count noun for the "N … in view" line ('camera' | 'event' | 'site' | 'station'). */
  unitNoun: string
  refreshMs: number
  cluster?: boolean
  /** True when the source's only real data is inherently historical (WebTRIS ~2-month batch).
   * JARTIC latest published hourly volumes are not historical — they are LIVE TRAFFIC VOLUMES. */
  allHistorical?: boolean
  /** Amber note rendered under the badge for lagged/historical sources — the honest-recency label. */
  recencyNote?: string
  /** Region phrase for the NO_COVERAGE / zoom-in hint ("Finland's road network", …). */
  coverageRegionLabel: string
  hasCoverage: (rectangle: TerraDegreeRectangle | null) => boolean
  buildQuery: (rectangle: TerraDegreeRectangle | null) => string | null
  /** Street-level layers (cameras, signals) stay off until this scale. Defaults to regional so only global is skipped. */
  minScaleLevel?: TerraScaleLevel
}

export type TerraTrafficLayerSelection =
  | { kind: 'feature'; layerId: string; featureId: string }
  | { kind: 'none' | 'miss' | 'ground' | 'urban-building' | 'urban-road' | 'urban-signal' }

export function TerraTrafficLayer({
  def,
  viewer,
  selection,
  onFeaturesChange,
  timeMode,
  cameraScaleLevel,
  rectangle,
  defaultEnabled,
  hideControls = false,
  forceEnabled = false,
  skipScaleGate = false,
  clusterOverride,
  onAuthRequired,
}: {
  def: TerraTrafficLayerDef
  viewer: CesiumViewer | null
  selection: TerraTrafficLayerSelection
  onFeaturesChange: (layerId: string, features: TerraGeoFeature[]) => void
  timeMode: TerraTimeMode
  cameraScaleLevel: TerraScaleLevel
  rectangle: TerraDegreeRectangle | null
  /** Off in the full workspace (a live external call stays a deliberate Commander action); on in
   * the God's Eye command center, which has no Data Layers toggle UI — the same convention every
   * bespoke Phase 1/2 traffic block in TerraShell already used. */
  defaultEnabled: boolean
  /** Command-center mode: fetch and render markers, but no toggle/status chrome (same headless
   * convention as TerraLayerRow's hideControls). */
  hideControls?: boolean
  /** Camera discovery federation: query this layer from the active Terra location even if the
   * advanced Layer Controls toggle is off. */
  forceEnabled?: boolean
  /** Camera discovery supplies a location-centered bbox; do not wait for city-scale globe zoom. */
  skipScaleGate?: boolean
  /** Camera federation LOD: cluster at country/city, individual pins at street. */
  clusterOverride?: boolean
  onAuthRequired?: (layerId: string, authRequired: boolean) => void
}) {
  const [enabled, setEnabled] = useState(defaultEnabled)
  const layerOn = enabled || forceEnabled

  useEffect(() => {
    if (forceEnabled) setEnabled(true)
  }, [forceEnabled])

  // The source's own coverage answer, computed independently of the enabled toggle, so the row
  // can distinguish "outside this provider's real envelope" from "inside but nothing returned."
  const hasCoverage = useMemo(() => def.hasCoverage(rectangle), [def, rectangle])

  // Gated off entirely at global camera scale (never a whole-country/world download) and null
  // while the layer is off — matching every other layer's "null query = don't fetch" convention.
  // The source's own builder additionally returns null outside its real coverage envelope.
  const boundingBoxQuery = useMemo(() => {
    if (!layerOn) return null
    if (!skipScaleGate && !terraScaleMeetsMin(cameraScaleLevel, def.minScaleLevel ?? 'regional')) return null
    return def.buildQuery(rectangle)
  }, [layerOn, skipScaleGate, cameraScaleLevel, def, rectangle])

  const autoRefreshAllowed = shouldAutoRefreshTerraLayer(timeMode)
  const feed = useTerraLayer(def.layerId, boundingBoxQuery !== null, def.refreshMs, autoRefreshAllowed, boundingBoxQuery)

  const lastCatalogRef = useRef<TerraGeoFeature[]>([])
  if (boundingBoxQuery !== null && (feed.features.length > 0 || feed.state === 'live' || feed.state === 'empty')) {
    lastCatalogRef.current = feed.features
  }
  useEffect(() => {
    // LOD unload returns empty features from useTerraLayer; keep the last catalog for Nearby /
    // inspect. Markers stay off because TerraFeatureLayer is gated on boundingBoxQuery.
    const published = boundingBoxQuery === null ? lastCatalogRef.current : feed.features
    const timeout = setTimeout(() => onFeaturesChange(def.layerId, published), 0)
    return () => clearTimeout(timeout)
  }, [def.layerId, feed.features, onFeaturesChange, boundingBoxQuery])

  const authRequired = feed.rootCause === 'COMMANDER_AUTH_REQUIRED'
  useEffect(() => {
    onAuthRequired?.(def.layerId, authRequired)
  }, [authRequired, def.layerId, onAuthRequired])

  const coverageState = useMemo(
    () =>
      resolveTerraCoverageTruth({
        hasKnownCoverage: hasCoverage,
        boundingBoxQuery,
        feedState: feed.state,
        lastErrorMessage: feed.lastErrorMessage,
        allFeaturesHistoricalOrStale: def.allHistorical ? (feed.features.length > 0 ? true : null) : null,
      }),
    [hasCoverage, boundingBoxQuery, feed.state, feed.lastErrorMessage, feed.features.length, def.allHistorical],
  )

  // WAR ROOM TERRA LINKED publisher: hand this layer's resolved coverage-truth state up through
  // TerraActiveLocationContext.layerCoverage (consumed by GodsEyeCommandCenter's Terra linked
  // pill). Publish-on-change only — the ref gate plus the deferred setTimeout mirror TerraShell's
  // aircraftSummary/maritimeSummary publish pattern, so 13 layer instances can't render-loop the
  // provider. Functional update keeps each layer's write additive under the shared record.
  const { setLayerCoverage } = useTerraActiveLocation()
  const lastPublishedCoverageRef = useRef<string | null>(null)
  useEffect(() => {
    if (!setLayerCoverage) return
    if (lastPublishedCoverageRef.current === coverageState) return
    lastPublishedCoverageRef.current = coverageState
    const timeout = setTimeout(() => {
      setLayerCoverage(prev => ({ ...prev, [def.layerId]: coverageState }))
    }, 0)
    return () => clearTimeout(timeout)
  }, [coverageState, def.layerId, setLayerCoverage])

  const selectedId = selection.kind === 'feature' && selection.layerId === def.layerId ? selection.featureId : null

  return (
    <>
      <TerraFeatureLayer
        layerId={def.layerId}
        viewer={viewer}
        enabled={boundingBoxQuery !== null}
        features={feed.features}
        selectedId={selectedId}
        cluster={clusterOverride ?? def.cluster}
        clusterKind={def.unitNoun === 'camera' ? 'camera' : undefined}
      />
      {!hideControls && (
        <div className="mt-1 border-t border-white/10 pt-2 first:border-t-0 first:pt-0 first:mt-0">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300">{def.label}</span>
            <button
              type="button"
              onClick={() => setEnabled(prev => !prev)}
              className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                layerOn ? 'border-emerald-400/60 text-emerald-400' : 'border-white/20 text-slate-500'
              }`}
              aria-pressed={layerOn}
            >
              {layerOn ? 'On' : 'Off'}
            </button>
          </div>
          {layerOn && (
            <div className="mt-1 space-y-1">
              {boundingBoxQuery === null && hasCoverage ? (
                // Coverage exists here but no bounded query is possible (global camera scale, or a
                // viewing angle whose rectangle exceeds the source's span cap) — "zoom in," never
                // a fabricated LIVE/NO_DATA state.
                <p className="text-[10.5px] text-amber-300/90">Zoom in, or pan to a smaller region over {def.coverageRegionLabel} — the current view is too wide for a bounded query.</p>
              ) : coverageState === 'NO_COVERAGE' ? (
                <>
                  <TerraCoverageBadge state={coverageState} />
                  <p className="text-[10.5px] text-amber-300/90">This source covers {def.coverageRegionLabel} only. This is a coverage gap, not a claim that nothing is happening here.</p>
                </>
              ) : (
                <>
                  <TerraCoverageBadge state={coverageState} />
                  {def.recencyNote && <p className="text-[10.5px] text-amber-300/90">{def.recencyNote}</p>}
                  <p className="text-[10.5px] text-slate-500">Provider status: {feed.liveStatus}</p>
                  <p className="text-[10.5px] text-slate-500">
                    Displayed data: {feed.displayedDataStatus === 'STALE_LAST_GOOD' ? 'STALE_LAST_GOOD' : feed.displayedDataStatus === 'CURRENT' ? 'CURRENT' : 'NONE'}
                  </p>
                  <p className="text-[10.5px] text-slate-500">
                    {feed.displayedDataStatus === 'STALE_LAST_GOOD'
                      ? `Item count: ${feed.features.length} ${def.unitNoun}${feed.features.length === 1 ? '' : 's'} retained`
                      : `${feed.features.length} ${def.unitNoun}${feed.features.length === 1 ? '' : 's'} in view`}
                    {feed.skippedCount > 0 && ` · ${feed.skippedCount} unprojectable`}
                  </p>
                  {feed.lastFetchedAt && (
                    <p className="text-[10.5px] text-slate-500">
                      {feed.displayedDataStatus === 'STALE_LAST_GOOD' ? 'Last success: ' : 'Last fetched: '}
                      {new Date(feed.lastFetchedAt).toLocaleTimeString()}
                    </p>
                  )}
                  {feed.lastErrorMessage && <p className={`text-[10.5px] ${feed.lastErrorMessage === 'AUTH_REQUIRED' ? 'text-amber-300' : 'text-red-400'}`}>{feed.lastErrorMessage}</p>}
                  <button
                    type="button"
                    onClick={feed.refresh}
                    className="mt-0.5 rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-emerald-400/60 hover:text-emerald-400"
                  >
                    Refresh now
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
