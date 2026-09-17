'use client'

/**
 * God's Eye federated traffic-camera inspect card. Cluster → marker → this card.
 * Shows the locked schema (id/provider/agency/region/road/direction/bearing/feedType/
 * freshness/coverage/auth/attribution) plus a still (never auto-embedded video) and
 * nearby cameras from the already-loaded local index.
 */
import type { TerraGeoFeature } from '@/lib/terra/types'
import {
  TERRA_TRAFFIC_CAMERA_HEALTH_LABELS,
  trafficCameraRecordFromProperties,
  type TerraTrafficCameraHealthState,
} from '@/lib/terra/trafficCameraRecord'
import { findNearbyTrafficCameras } from '@/lib/terra/nearbyTrafficCameras'
import { resolveTerraTrafficCameraStillUrl, isHtmlViewerOnlyCamera, viewerLinkLabel } from './terraTrafficCameraPreview'

const FRESHNESS_COLOR: Record<string, string> = {
  LIVE: 'text-emerald-400',
  still_image: 'text-emerald-400',
  live_video: 'text-emerald-400',
  STALE: 'text-amber-400',
  stale: 'text-amber-400',
  OFFLINE: 'text-red-400',
  offline: 'text-red-400',
  NO_COVERAGE: 'text-amber-400',
  AUTH_REQUIRED: 'text-amber-400',
  RATE_LIMITED: 'text-amber-400',
  UNAVAILABLE: 'text-slate-400',
  unknown: 'text-slate-400',
}

const PROVIDER_LABEL: Record<string, string> = {
  digitraffic_road_cameras: 'Fintraffic Digitraffic (Finland)',
  ontario_511_cameras: 'Ontario 511 (Canada)',
  hong_kong_td_cameras: 'Hong Kong Transport Department',
  quebec_511_cameras: 'Québec 511 (MTMD)',
  ohgo_cameras: 'ODOT / OHGO (Ohio)',
  ny511_cameras: 'New York State traffic cameras',
  caltrans_cwwp2_cameras: 'Caltrans CWWP2 (California)',
}

function Row({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={`${mono ? 'font-mono' : ''} ${color ?? 'text-slate-200'} text-right`}>{value}</dd>
    </div>
  )
}

function healthLabel(raw: string | null | undefined): string {
  if (!raw) return 'UNKNOWN'
  if (raw in TERRA_TRAFFIC_CAMERA_HEALTH_LABELS) return TERRA_TRAFFIC_CAMERA_HEALTH_LABELS[raw as TerraTrafficCameraHealthState]
  if (raw === 'still_image') return 'STILL IMAGE — CURRENT'
  if (raw === 'live_video') return 'LIVE VIDEO'
  return raw.replace(/_/g, ' ').toUpperCase()
}

export function TerraTrafficCameraInspectCard({
  feature,
  nearbyFeatures = [],
  onSelectNearby,
  compact = false,
}: {
  feature: TerraGeoFeature
  nearbyFeatures?: TerraGeoFeature[]
  onSelectNearby?: (feature: TerraGeoFeature) => void
  compact?: boolean
}) {
  const record = trafficCameraRecordFromProperties(feature.properties)
  const freshnessState = typeof feature.properties.freshnessState === 'string'
    ? feature.properties.freshnessState
    : typeof feature.properties.freshness === 'string'
      ? feature.properties.freshness
      : 'unknown'
  const coverageState = typeof feature.properties.coverageState === 'string' ? feature.properties.coverageState : null
  const authState = typeof feature.properties.authState === 'string' ? feature.properties.authState : null
  const feedType = typeof feature.properties.feedType === 'string' ? feature.properties.feedType : null
  const viewerUrl = typeof feature.properties.viewerUrl === 'string' ? feature.properties.viewerUrl : null
  const attribution = typeof feature.properties.attribution === 'string'
    ? feature.properties.attribution
    : PROVIDER_LABEL[feature.providerId] ?? feature.provenance.provider
  const mediaAvailable = freshnessState !== 'STALE' && freshnessState !== 'stale' && freshnessState !== 'OFFLINE' && freshnessState !== 'offline'
  const stillUrl = mediaAvailable && !isHtmlViewerOnlyCamera(feature) ? resolveTerraTrafficCameraStillUrl(feature) : null
  const coords = `${feature.latitude.toFixed(3)}°, ${feature.longitude.toFixed(3)}°`

  const nearby = (() => {
    const origin = { lat: feature.latitude, lon: feature.longitude }
    const byId = new Map<string, TerraGeoFeature>()
    const cameras = nearbyFeatures
      .filter(item => item.kind === 'traffic_camera' && item.id !== feature.id)
      .map(item => {
        byId.set(item.id, item)
        const props = trafficCameraRecordFromProperties(item.properties)
        return {
          id: item.id,
          provider: props.provider ?? item.providerId,
          agency: props.agency ?? item.providerId,
          country: props.country ?? '',
          region: props.region ?? '',
          road: props.road ?? null,
          locationName: props.locationName ?? item.title,
          lat: item.latitude,
          lon: item.longitude,
          direction: props.direction ?? null,
          bearing: props.bearing ?? null,
          feedType: props.feedType ?? 'STILL' as const,
          imageUrl: props.imageUrl ?? null,
          streamUrl: null,
          viewerUrl: props.viewerUrl ?? null,
          lastUpdated: props.lastUpdated ?? null,
          freshnessState: props.freshnessState ?? 'UNAVAILABLE' as const,
          coverageState: props.coverageState ?? 'UNAVAILABLE' as const,
          authState: props.authState ?? 'PUBLIC_NO_AUTH' as const,
          license: props.license ?? null,
          attribution: props.attribution ?? '',
          sourceUrl: props.sourceUrl ?? null,
        }
      })
    return findNearbyTrafficCameras(cameras, origin, 15).slice(0, 5).map(hit => ({ ...hit, feature: byId.get(hit.id) ?? null }))
  })()

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <dl className="space-y-1 text-[11px] text-slate-400">
        <Row label="Coordinates" value={coords} mono />
        {typeof record.id === 'string' && <Row label="Camera id" value={record.id} mono />}
        {typeof record.agency === 'string' && <Row label="Agency" value={record.agency} />}
        {typeof record.region === 'string' && <Row label="Region" value={`${record.country ?? ''} / ${record.region}`.replace(/^\s\/\s/, '')} />}
        {typeof feature.properties.road === 'string' && <Row label="Road" value={feature.properties.road} />}
        {typeof feature.properties.locationName === 'string' && <Row label="Location" value={feature.properties.locationName} />}
        {typeof feature.properties.direction === 'string' && (
          <Row label="Direction" value={feature.properties.direction.replace(/_/g, ' ')} />
        )}
        {typeof feature.properties.bearing === 'number' && <Row label="Bearing" value={`${Math.round(feature.properties.bearing)}°`} />}
        <Row label="Feed type" value={isHtmlViewerOnlyCamera(feature) ? 'HTML viewer at source (no direct still)' : feedType === 'REFRESHED_IMAGE' ? 'Refreshed still (not live video)' : 'Still image (refreshing)'} />
        <Row label="Status" value={healthLabel(freshnessState)} color={FRESHNESS_COLOR[freshnessState] ?? 'text-slate-300'} />
        {coverageState && <Row label="Coverage" value={healthLabel(coverageState)} color={FRESHNESS_COLOR[coverageState]} />}
        {authState && <Row label="Auth" value={authState.replace(/_/g, ' ')} />}
        {feature.timestamp && <Row label="Last updated" value={new Date(feature.timestamp).toLocaleString()} />}
        {!feature.timestamp && freshnessState === 'UNAVAILABLE' && (
          <Row label="Last updated" value="not reported — catalog has no image Last-Modified" />
        )}
        {typeof feature.properties.collectionIntervalSec === 'number' && (
          <Row label="Refresh interval" value={`${feature.properties.collectionIntervalSec}s`} />
        )}
        <Row label="Attribution" value={attribution} />
        {typeof feature.properties.license === 'string' && <Row label="License" value={feature.properties.license} />}
      </dl>

      {stillUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- proxied/provider-hosted camera still, not a Next-optimizable local asset.
        <img
          src={stillUrl}
          alt={`${feature.title} — road camera still image`}
          className="mt-2 w-full rounded border border-white/10"
          loading="lazy"
        />
      )}
      {!stillUrl && !viewerUrl && !mediaAvailable && (
        <p className={`mt-2 text-[10.5px] ${FRESHNESS_COLOR[freshnessState] ?? 'text-slate-400'}`}>
          {freshnessState === 'OFFLINE' || freshnessState === 'offline'
            ? 'Camera reported offline by source — no image requested.'
            : 'Camera still reported stale by source — no image requested.'}
        </p>
      )}
      {viewerUrl && (
        <a
          href={viewerUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block rounded border border-white/15 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:border-cyan-400/60"
        >
          {viewerLinkLabel(feature)}
        </a>
      )}
      {feature.providerId === 'caltrans_cwwp2_cameras' && (
        <p className="mt-1 text-[10px] text-slate-500">
          Stills only for map density. Caltrans fair-use: ≥10 concurrent streams need a written agreement — War Room never auto-embeds streams.
        </p>
      )}
      {feature.providerId === 'ny511_cameras' && (
        <p className="mt-1 text-[10px] text-slate-500">powered by 511NY — no implied NYSDOT endorsement.</p>
      )}

      {nearby.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Nearby cameras (local index)</p>
          <ul className="space-y-1">
            {nearby.map(hit => (
              <li key={hit.id}>
                {onSelectNearby && hit.feature ? (
                  <button
                    type="button"
                    onClick={() => onSelectNearby(hit.feature)}
                    className="w-full text-left text-[10.5px] text-cyan-300 hover:underline"
                  >
                    {hit.locationName} · {hit.distanceKm.toFixed(1)} km
                  </button>
                ) : (
                  <span className="text-[10.5px] text-slate-300">{hit.locationName} · {hit.distanceKm.toFixed(1)} km</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
