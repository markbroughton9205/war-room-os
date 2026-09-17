'use client'

/**
 * Street Intelligence shell — MapillaryJS + Panoramax + own-imagery architecture.
 * Does not replace Cesium. Hosted Mapillary is AUTH_REQUIRED without a token.
 * Panoramax is LOCAL/REGIONAL when an instance URL is set. Own imagery stays NO_COVERAGE.
 */
import { useMemo, useState } from 'react'
import { streetImageryProviderStates, streetWorldLinkFromPose, type StreetImageryProviderId } from '@/lib/terra/godsEye/streetImagery'
import { MAPILLARYJS_STATUS, PANORAMAX_STATUS } from '@/lib/terra/godsEye/openStack'
import { mapillaryVistasResearchLane } from '@/lib/terra/godsEye/vistasResearch'
import { panoramaxProviderState } from '@/lib/terra/godsEye/panoramax'
import { TerraMapillaryViewport } from './TerraMapillaryViewport'

export function TerraStreetIntelligence({
  open,
  latitude,
  longitude,
  selectedPlace,
  localTime,
  nearbyIdentity,
  onClose,
}: {
  open: boolean
  latitude: number | null
  longitude: number | null
  selectedPlace: string | null
  localTime: string | null
  nearbyIdentity: string | null
  onClose: () => void
}) {
  const tokenConfigured = Boolean(process.env.NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN?.trim())
  const panoramaxUrl = process.env.NEXT_PUBLIC_PANORAMAX_INSTANCE_URL ?? null
  const providers = useMemo(() => streetImageryProviderStates(tokenConfigured ? 'configured' : null, panoramaxUrl), [tokenConfigured, panoramaxUrl])
  const [providerId, setProviderId] = useState<StreetImageryProviderId>('MAPILLARY_HOSTED')
  const vistas = mapillaryVistasResearchLane()
  const panoramax = panoramaxProviderState(panoramaxUrl)
  const link = streetWorldLinkFromPose({
    terraLatitude: latitude,
    terraLongitude: longitude,
    selectedPlace,
    pose: latitude !== null && longitude !== null ? {
      latitude,
      longitude,
      bearingDeg: null,
      capturedAt: null,
      imageId: null,
      imageUrl: null,
      provider: providerId,
      coverageState: providers.find(provider => provider.id === providerId)?.coverageState ?? 'NO_COVERAGE',
      sourceUrl: providerId === 'PANORAMAX' ? panoramax.instanceUrl : null,
      attribution: providerId === 'MAPILLARY_HOSTED'
        ? 'Mapillary contributors (CC BY-SA)'
        : providerId === 'PANORAMAX'
          ? 'Panoramax contributors'
          : 'War Room own imagery',
    } : null,
    localTime,
    nearbyIdentity,
  })

  if (!open) return null
  const active = providers.find(provider => provider.id === providerId) ?? providers[0]
  const viewportCopy = (() => {
    if (active.id === 'MAPILLARY_HOSTED') return null
    if (active.id === 'PANORAMAX') {
      return active.coverageState === 'NO_COVERAGE'
        ? 'PANORAMAX · NO_COVERAGE — set NEXT_PUBLIC_PANORAMAX_INSTANCE_URL for a self-host or regional instance. LOCAL/REGIONAL only. Not global Street View. INTERFACE_ONLY until an instance is configured.'
        : 'PANORAMAX · PARTIAL — instance configured. Coverage is that instance, never global Street View parity. Cesium stays the globe.'
    }
    if (active.coverageState === 'NO_COVERAGE') {
      return 'WAR ROOM OWN IMAGERY · NO_COVERAGE — architecture is ready; no sovereign panorama is ingested this pass. OWNED when Commander captures are ingested.'
    }
    return 'Street imagery viewport ready.'
  })()

  return (
    <aside
      className="pointer-events-auto w-[min(22rem,86vw)] overflow-hidden rounded-xl border border-cyan-300/30 bg-black/78 shadow-[0_16px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      data-testid="terra-street-intelligence"
      data-mapillaryjs={MAPILLARYJS_STATUS}
      data-panoramax={PANORAMAX_STATUS}
    >
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">Street Intelligence</p>
        <button type="button" onClick={onClose} className="text-[9px] uppercase tracking-widest text-slate-500 hover:text-slate-300">close</button>
      </div>
      <div className="border-t border-white/10 px-2.5 py-2 text-[10px] text-slate-400">
        <p className="font-mono uppercase tracking-widest text-cyan-300/80">MapillaryJS {MAPILLARYJS_STATUS.replaceAll('_', ' ')} · Panoramax {PANORAMAX_STATUS.replaceAll('_', ' ')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {providers.map(provider => (
            <button
              key={provider.id}
              type="button"
              onClick={() => setProviderId(provider.id)}
              className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${providerId === provider.id ? 'border-cyan-300/50 text-cyan-200' : 'border-white/15 text-slate-500'}`}
            >
              {provider.id === 'MAPILLARY_HOSTED' ? 'Mapillary hosted' : provider.id === 'PANORAMAX' ? 'Panoramax' : 'War Room own'}
            </button>
          ))}
        </div>
        {active.id === 'MAPILLARY_HOSTED' ? (
          <div className="mt-2">
            <TerraMapillaryViewport latitude={latitude} longitude={longitude} />
          </div>
        ) : (
          <div className="mt-2 grid h-28 place-items-center rounded border border-dashed border-cyan-400/20 bg-slate-950/60">
            <p className="px-3 text-center text-[10px] leading-snug text-slate-500">{viewportCopy}</p>
          </div>
        )}
        <ul className="mt-2 space-y-0.5 font-mono">
          <li>terra {link.terraLatitude !== null && link.terraLongitude !== null ? `${link.terraLatitude.toFixed(5)}, ${link.terraLongitude.toFixed(5)}` : 'no location'}</li>
          <li>place {link.selectedPlace ?? 'none'}</li>
          <li>bearing {link.viewBearingDeg !== null ? `${Math.round(link.viewBearingDeg)}°` : 'unknown'}</li>
          <li>local {link.localTime ?? 'UNAVAILABLE'}</li>
          <li>nearby {link.nearbyIdentity ?? 'unresolved'}</li>
          <li>building identity PIXEL-PERFECT: NO</li>
          <li>global street view parity: NO</li>
        </ul>
        <p className="mt-2 text-[9px] leading-snug text-slate-500">{active.honesty}</p>
        <p className="mt-1 text-[9px] leading-snug text-amber-300/80">{vistas.kind} · {vistas.license.split('—')[0].trim()} · not bundled</p>
      </div>
    </aside>
  )
}
