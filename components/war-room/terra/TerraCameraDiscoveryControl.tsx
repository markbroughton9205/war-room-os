'use client'

import { IconCamera, IconNearby } from '@/components/war-room/council/CommandIcons'

export type TerraCameraDiscoveryUiState =
  | 'IDLE'
  | 'NEED_LOCATION'
  | 'AUTH_REQUIRED'
  | 'BOOTSTRAP_REQUIRED'
  | 'PROVIDER_AUTH_REQUIRED'
  | 'DISCOVERING'
  | 'NO_COVERAGE'
  | 'READY'

export function TerraCameraDiscoveryControl({
  state,
  coveringLabel,
  officialViewerUrl,
  onDiscover,
  onFocusNearby,
}: {
  state: TerraCameraDiscoveryUiState
  coveringLabel: string | null
  officialViewerUrl?: string | null
  onDiscover: () => void
  onFocusNearby: () => void
}) {
  const commanderAuthBlocked = state === 'AUTH_REQUIRED' || state === 'BOOTSTRAP_REQUIRED'
  const loginHref = '/login?next=/terra'
  return (
    <div className="pointer-events-auto flex max-w-[min(28rem,92vw)] flex-col gap-1 rounded border border-cyan-400/30 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-300 shadow-[0_0_18px_rgba(34,211,238,0.08)] backdrop-blur-md">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onFocusNearby}
          className="inline-flex items-center gap-1 rounded border border-white/15 px-1.5 py-0.5 font-bold text-slate-400 hover:border-cyan-300/50 hover:text-cyan-200"
          data-testid="terra-nearby-focus"
          title="Show Nearby inventory"
        >
          <IconNearby size={12} />
          Nearby
        </button>
        <button
          type="button"
          onClick={onDiscover}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-bold ${
            state === 'READY' || state === 'DISCOVERING'
              ? 'border-cyan-300/70 text-cyan-200'
              : commanderAuthBlocked
                ? 'border-amber-400/70 text-amber-200'
                : 'border-white/15 text-slate-300 hover:border-cyan-300/50 hover:text-cyan-200'
          }`}
          data-testid="terra-camera-discover"
          title="Discover public traffic cameras at the active Terra location"
        >
          <IconCamera size={12} />
          Camera
        </button>
      </div>
      {state === 'NEED_LOCATION' ? (
        <p className="max-w-prose text-[9px] normal-case tracking-normal text-amber-200" data-testid="terra-camera-discover-status">
          Search, click the globe, or use My Location first. GPS is optional.
        </p>
      ) : commanderAuthBlocked ? (
        <p className="max-w-prose text-[9px] normal-case tracking-normal text-amber-200" data-testid="terra-camera-discover-status">
          AUTH REQUIRED{coveringLabel ? ` · ${coveringLabel} covers this region` : ''}.{' '}
          <a href={loginHref} className="underline decoration-amber-400/60 underline-offset-2 hover:text-amber-100">
            Commander sign in
          </a>
          {' '}(/login?next=/terra). This is not NO_COVERAGE and not provider-key absence.
        </p>
      ) : state === 'PROVIDER_AUTH_REQUIRED' ? (
        <p className="max-w-prose text-[9px] normal-case tracking-normal text-amber-200" data-testid="terra-camera-discover-status">
          PARTIAL · PROVIDER AUTH REQUIRED{coveringLabel ? ` · ${coveringLabel}` : ''}. This is not Commander login required and not NO_COVERAGE.
          {officialViewerUrl ? (
            <>
              {' '}
              <a href={officialViewerUrl} target="_blank" rel="noreferrer" className="underline decoration-amber-400/60 underline-offset-2 hover:text-amber-100">
                OPEN OFFICIAL VIEWER
              </a>
            </>
          ) : null}
        </p>
      ) : state === 'NO_COVERAGE' ? (
        <p className="max-w-prose text-[9px] normal-case tracking-normal text-amber-200" data-testid="terra-camera-discover-status">
          NO_COVERAGE — no registered public camera provider covers this Terra location. Coverage stays REGIONAL / AGENCY_DEPENDENT.
        </p>
      ) : state === 'DISCOVERING' ? (
        <p className="max-w-prose text-[9px] normal-case tracking-normal text-cyan-200" data-testid="terra-camera-discover-status">
          Querying {coveringLabel ?? 'covering camera providers'}…
        </p>
      ) : coveringLabel ? (
        <p className="max-w-prose text-[9px] normal-case tracking-normal text-slate-500" data-testid="terra-camera-discover-status">
          {coveringLabel}
        </p>
      ) : (
        <p className="max-w-prose text-[9px] normal-case tracking-normal text-slate-500" data-testid="terra-camera-discover-status">
          Cameras use the active Terra location. GPS is not required.
        </p>
      )}
    </div>
  )
}
