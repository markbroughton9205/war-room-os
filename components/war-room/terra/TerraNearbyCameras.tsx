'use client'

import { nearbyPublicCameras, type NearbyCameraIndexFeature, type NearbyPublicCamera } from '@/lib/terra/godsEye/nearbyCameras'
import { nearbyCameraCoverageForPoint } from '@/lib/terra/godsEye/nearbyCameraCoverage'
import { CAMERA_DISCOVERY_EXPANDED_RADIUS_KM, CAMERA_DISCOVERY_RADIUS_KM } from '@/lib/terra/godsEye/cameraDiscovery'
import { IconCamera } from '@/components/war-room/council/CommandIcons'

function formatDistance(distanceKm: number): string {
  const miles = distanceKm * 0.621371
  if (miles < 0.1) return `${Math.round(distanceKm * 1000)} m`
  return `${miles.toFixed(1)} mi`
}

const FEED_CLASS: Record<NearbyPublicCamera['feedState'], string> = {
  AVAILABLE: 'text-cyan-300',
  STALE: 'text-amber-300',
  OFFLINE: 'text-slate-500',
  UNAVAILABLE: 'text-slate-500',
}

export function TerraNearbyCameras({
  latitude,
  longitude,
  originLabel,
  features,
  indexLoaded,
  authRequired,
  radiusKm = CAMERA_DISCOVERY_RADIUS_KM,
  selectedId,
  onSelect,
  onExpandRadius,
  onOpenOfficialViewer,
}: {
  latitude: number | null
  longitude: number | null
  originLabel: string
  features: readonly NearbyCameraIndexFeature[]
  indexLoaded?: boolean
  authRequired?: boolean
  radiusKm?: number
  selectedId?: string | null
  onSelect: (camera: NearbyPublicCamera) => void
  onExpandRadius?: () => void
  onOpenOfficialViewer?: (viewerUrl: string) => void
}) {
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return (
      <div className="pointer-events-auto rounded border border-white/10 bg-black/40 p-2" data-testid="terra-nearby-cameras">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Nearby cameras</p>
        <p className="mt-1 text-[10px] text-slate-500">Select a Terra location, or enable My Location. Device coordinates stay local — they are not sent to camera providers.</p>
      </div>
    )
  }

  const cameras = nearbyPublicCameras({ latitude, longitude, features, maxKm: radiusKm })
  const coverage = nearbyCameraCoverageForPoint({
    latitude,
    longitude,
    nearbyCount: cameras.length,
    indexLoaded,
    commanderAuthRequired: authRequired,
    radiusKm,
  })
  const canExpandRadius = coverage.locationState === 'NONE_WITHIN_RADIUS' && radiusKm < CAMERA_DISCOVERY_EXPANDED_RADIUS_KM && typeof onExpandRadius === 'function'
  return (
    <div className="pointer-events-auto max-h-[min(22rem,calc(100vh-16rem))] overflow-y-auto rounded border border-white/10 bg-black/40 p-2" data-testid="terra-nearby-cameras" data-coverage-state={coverage.locationState}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Nearby cameras</p>
        <span className="font-mono text-[9px] uppercase tracking-widest text-cyan-300" data-testid="terra-nearby-cameras-count">{cameras.length}</span>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">
        {originLabel} · regional public stills only · {coverage.locationState === 'PROVIDER_AUTH_REQUIRED' ? 'PARTIAL · PROVIDER AUTH REQUIRED' : coverage.locationState}
      </p>
      {coverage.locationState === 'AUTH_REQUIRED' ? (
        <p className="mt-1 text-[10px] text-amber-300/90">
          {coverage.reason}{' '}
          <a href="/login?next=/terra" className="underline decoration-amber-400/60 underline-offset-2">
            Commander sign in
          </a>
        </p>
      ) : coverage.locationState === 'PROVIDER_AUTH_REQUIRED' ? (
        <div className="mt-1 space-y-1">
          <p className="text-[10px] text-amber-300/90">{coverage.reason}</p>
          {coverage.coveringProviders.filter(row => row.endpointType === 'OFFICIAL_VIEWER' && row.viewerUrl).map(row => (
            onOpenOfficialViewer ? (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenOfficialViewer(row.viewerUrl as string)}
                className="block text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:underline"
              >
                Open official viewer · {row.agency}
              </button>
            ) : (
              <a
                key={row.id}
                href={row.viewerUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:underline"
              >
                OPEN OFFICIAL VIEWER · {row.agency}
              </a>
            )
          ))}
        </div>
      ) : cameras.length === 0 ? (
        <div className="mt-1 space-y-1">
          <p className="text-[10px] text-amber-300/90">{coverage.reason}</p>
          {coverage.coveringProviders.filter(row => row.endpointType === 'OFFICIAL_VIEWER' && row.viewerUrl).map(row => (
            onOpenOfficialViewer ? (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenOfficialViewer(row.viewerUrl as string)}
                className="block text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:underline"
              >
                Open official viewer · {row.agency}
              </button>
            ) : (
              <a
                key={row.id}
                href={row.viewerUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:underline"
              >
                OPEN OFFICIAL VIEWER · {row.agency}
              </a>
            )
          ))}
          {canExpandRadius ? (
            <button
              type="button"
              onClick={onExpandRadius}
              className="rounded border border-cyan-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200 hover:border-cyan-300/70"
              data-testid="terra-nearby-cameras-expand-radius"
            >
              Search {CAMERA_DISCOVERY_EXPANDED_RADIUS_KM} km
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="mt-1 space-y-1">
          {cameras.map(camera => (
            <li key={`${camera.layerId}:${camera.id}`}>
              <button
                type="button"
                onClick={() => onSelect(camera)}
                data-selected={selectedId === `${camera.layerId}:${camera.id}` ? 'true' : 'false'}
                className={`flex w-full items-start gap-1.5 rounded border px-1.5 py-1 text-left ${
                  selectedId === `${camera.layerId}:${camera.id}`
                    ? 'border-cyan-300/70 bg-cyan-950/40'
                    : 'border-white/10 hover:border-cyan-400/40'
                }`}
              >
                <span className="mt-0.5 text-cyan-300"><IconCamera size={12} /></span>
                <span className="min-w-0 flex-1">
                  <p className="text-[11px] text-slate-100">{camera.road || camera.location || camera.title}</p>
                  <p className="font-mono text-[10px] text-slate-400">
                    {camera.agency}
                    {camera.direction ? ` · ${camera.direction}` : ''}
                  </p>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-slate-500">
                    {formatDistance(camera.distanceKm)}
                    {' · CATALOG '}
                    <span className="text-emerald-400">{camera.catalogStatus}</span>
                    {' · CAPTURE '}
                    <span className={FEED_CLASS[camera.feedState]}>{camera.imageCaptureFreshness}</span>
                  </p>
                </span>
                <span className="shrink-0 rounded border border-cyan-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200">
                  View
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
