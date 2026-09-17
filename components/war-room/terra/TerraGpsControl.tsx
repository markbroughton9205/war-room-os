'use client'

import {
  formatAccuracy,
  formatCoordinateFallback,
  formatLocationAge,
  sourceDisplayLabel,
  type CommanderLocationState,
} from '@/lib/terra/commanderLocation'
import { compactLocalLabel } from '@/lib/terra/geographicContext'

const UI_LABEL: Record<CommanderLocationState['uiState'], string> = {
  GPS_OFF: 'GPS OFF',
  REQUESTING_PERMISSION: 'REQUESTING PERMISSION',
  FOLLOWING: 'FOLLOWING',
  LOCATED: 'LOCATED',
  LOCATION_DENIED: 'LOCATION DENIED',
  LOCATION_UNAVAILABLE: 'LOCATION UNAVAILABLE',
  LOW_ACCURACY: 'LOW ACCURACY',
  STALE_LOCATION: 'STALE LOCATION',
  NATIVE_LOCATION_UNAVAILABLE: 'NATIVE LOCATION UNAVAILABLE',
  REVERSE_GEOCODE_UNAVAILABLE: 'REVERSE GEOCODE UNAVAILABLE',
}

export function TerraGpsControl({
  gps,
  deviceLabel,
  viewingLabel,
  viewingDetached,
  reverseGeocodeStatus,
  onReturnToMe,
}: {
  gps: CommanderLocationState & {
    locateOnce: () => void
    followMe: () => void
    stop: () => void
    setFollowCamera: (follow: boolean) => void
  }
  deviceLabel?: string | null
  viewingLabel?: string | null
  viewingDetached?: boolean
  reverseGeocodeStatus?: 'ok' | 'pending' | 'stale' | 'unavailable' | null
  onReturnToMe?: () => void
}) {
  const active = gps.tracking === 'LOCATING' || gps.tracking === 'FOLLOWING' || gps.tracking === 'DEGRADED'
  const hasFix = Boolean(gps.location)
  const failed = gps.uiState === 'LOCATION_DENIED' || gps.uiState === 'LOCATION_UNAVAILABLE' || gps.uiState === 'NATIVE_LOCATION_UNAVAILABLE'
  const statusLabel = reverseGeocodeStatus === 'unavailable' && hasFix
    ? UI_LABEL.REVERSE_GEOCODE_UNAVAILABLE
    : reverseGeocodeStatus === 'stale' && hasFix && gps.uiState === 'FOLLOWING'
      ? `${UI_LABEL.FOLLOWING} · NAME STALE`
      : UI_LABEL[gps.uiState]
  const accuracy = formatAccuracy(gps.location?.accuracyMeters ?? null)
  const age = gps.location ? formatLocationAge(gps.location.timestamp) : null
  const coords = gps.location ? formatCoordinateFallback(gps.location.lat, gps.location.lon) : null
  const locality = deviceLabel && !/^[-0-9]/.test(deviceLabel) ? deviceLabel : null

  return (
    <div
      className="pointer-events-auto flex max-w-[min(22rem,92vw)] flex-col gap-1 rounded border border-emerald-400/30 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-300 shadow-[0_0_18px_rgba(16,185,129,0.12)] backdrop-blur-md"
      data-testid="terra-location-control"
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className={active ? 'text-emerald-300' : 'text-slate-500'}>⌖</span>
        <span className="font-bold text-emerald-200/90">LOCATION</span>
        <span className={failed ? 'text-amber-200' : active ? 'text-emerald-300' : 'text-slate-400'}>
          ● {statusLabel}
        </span>
      </div>
      {hasFix && gps.location ? (
        <p className="font-mono text-[9px] normal-case tracking-normal text-slate-300" data-testid="terra-gps-fix">
          {locality ?? coords}
          {accuracy ? ` · ${accuracy}` : ''}
          {age ? ` · ${age}` : ''}
          {` · ${sourceDisplayLabel(gps.location.source)}`}
          {gps.location.speed != null ? ` · ${Math.round(gps.location.speed * 3.6)} km/h` : ''}
          {gps.location.altitude != null ? ` · ${Math.round(gps.location.altitude)} m` : ''}
        </p>
      ) : (
        <p className="max-w-prose text-[9px] normal-case tracking-normal text-slate-500" title={gps.reason}>
          {gps.reason}
        </p>
      )}
      {viewingDetached ? (
        <p className="text-[9px] normal-case tracking-normal text-cyan-200/90" data-testid="terra-location-split">
          DEVICE {compactLocalLabel({ placeName: deviceLabel }) ?? deviceLabel ?? coords ?? 'live GPS'}
          {' · VIEWING '}
          {compactLocalLabel({ placeName: viewingLabel }) ?? viewingLabel ?? 'other location'}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {!active ? (
          <>
            <button
              type="button"
              onClick={gps.locateOnce}
              className="rounded border border-white/20 px-1.5 py-0.5 font-bold text-slate-200"
              data-testid="terra-locate-once"
            >
              LOCATE ME
            </button>
            <button
              type="button"
              onClick={gps.followMe}
              className="rounded border border-emerald-400/50 px-1.5 py-0.5 font-bold text-emerald-200"
              data-testid="terra-follow-me"
            >
              FOLLOW ME
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={gps.stop}
            className="rounded border border-amber-400/50 px-1.5 py-0.5 font-bold text-amber-200"
            data-testid="terra-gps-toggle"
          >
            {gps.mode === 'FOLLOW_ME' ? 'STOP FOLLOWING' : 'STOP'}
          </button>
        )}
        {gps.mode === 'FOLLOW_ME' && gps.location ? (
          <button
            type="button"
            onClick={() => gps.setFollowCamera(!gps.followCamera)}
            className={`rounded border px-1.5 py-0.5 ${gps.followCamera ? 'border-emerald-400/60 text-emerald-300' : 'border-white/15 text-slate-400'}`}
            data-testid="terra-follow-camera"
          >
            FOLLOW CAMERA {gps.followCamera ? 'ON' : 'OFF'}
          </button>
        ) : null}
        {viewingDetached && onReturnToMe ? (
          <button
            type="button"
            onClick={onReturnToMe}
            className="rounded border border-cyan-400/50 px-1.5 py-0.5 font-bold text-cyan-200"
            data-testid="terra-return-to-me"
          >
            RETURN TO ME
          </button>
        ) : null}
      </div>
    </div>
  )
}
