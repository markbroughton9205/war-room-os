'use client'

import { IconCamera } from '@/components/war-room/council/CommandIcons'
import {
  CAMERA_DIRECTORY_DISTANCE_FILTERS,
  CAMERA_DIRECTORY_STATUS_FILTERS,
  cameraCoverageEmptyCopy,
  cameraDirectoryRows,
  cameraProviderAdapterContracts,
  type CameraDirectoryDistanceFilter,
  type CameraDirectoryStatusFilter,
  type CameraProviderAdapterContract,
  type GodsEyeCameraLod,
} from '@/lib/terra/godsEye/cameraFederation'

export function TerraGodsEyeCameraDirectory({
  lod,
  providers,
  features,
  origin,
  query,
  providerFilter,
  statusFilter,
  distanceFilter,
  onQueryChange,
  onProviderFilterChange,
  onStatusFilterChange,
  onDistanceFilterChange,
  onSelect,
}: {
  lod: GodsEyeCameraLod
  providers: readonly CameraProviderAdapterContract[]
  features: readonly {
    id: string
    layerId: string
    kind: string
    title: string
    latitude: number
    longitude: number
    providerId?: string | null
    timestamp?: string | null
    provenance?: { provider?: string; fromCache?: boolean; isHistorical?: boolean; retrievedAt?: string | null; sourceUrl?: string | null }
    properties?: Record<string, unknown>
  }[]
  origin: { latitude: number; longitude: number } | null
  query: string
  providerFilter: string
  statusFilter: CameraDirectoryStatusFilter
  distanceFilter: CameraDirectoryDistanceFilter
  onQueryChange: (value: string) => void
  onProviderFilterChange: (value: string) => void
  onStatusFilterChange: (value: CameraDirectoryStatusFilter) => void
  onDistanceFilterChange: (value: CameraDirectoryDistanceFilter) => void
  onSelect: (row: { id: string; layerId: string }) => void
}) {
  const allProviders = cameraProviderAdapterContracts()
  const rows = cameraDirectoryRows({
    features,
    origin,
    query,
    providerFilter,
    statusFilter,
    distanceFilter,
  })
  const empty = cameraCoverageEmptyCopy()
  const noCoverage = providers.length === 0
  const countLabel = lod === 'PLANET'
    ? `${providers.length} providers`
    : `${rows.length} nearby / region`

  return (
    <aside
      className="pointer-events-auto w-[min(22rem,86vw)] overflow-hidden rounded-xl border border-cyan-300/35 bg-black/72 shadow-[0_16px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      data-testid="gods-eye-camera-directory"
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
          <IconCamera size={12} />
          Cameras
        </p>
        <span className="font-mono text-[10px] text-slate-400">{countLabel}</span>
      </div>
      {noCoverage ? (
        <div className="border-t border-white/10 px-2.5 py-3" data-testid="gods-eye-camera-no-coverage">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-200">{empty.title}</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-amber-100">{empty.body}</p>
        </div>
      ) : (
        <div className="max-h-[min(22rem,46vh)] space-y-2 overflow-y-auto border-t border-white/10 px-2.5 py-2">
          <ul className="space-y-1" data-testid="gods-eye-camera-provider-directory">
            {providers.map(row => (
              <li key={row.id} className="rounded border border-white/10 px-1.5 py-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-200">{row.displayName}</p>
                <p className="font-mono text-[9px] text-slate-500">{row.region}</p>
                <p className="text-[9px] uppercase tracking-widest text-cyan-300/80">{row.catalogLabel}</p>
                {row.authState === 'PROVIDER_AUTH_REQUIRED' ? (
                  <p className="text-[9px] uppercase tracking-widest text-amber-200">Provider auth required / partial</p>
                ) : null}
              </li>
            ))}
          </ul>
          {lod !== 'PLANET' ? (
            <>
              <input
                type="search"
                value={query}
                onChange={event => onQueryChange(event.target.value)}
                placeholder="Search cameras..."
                data-testid="gods-eye-camera-search"
                className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
              />
              <label className="block text-[9px] uppercase tracking-widest text-slate-500">
                Provider
                <select
                  value={providerFilter}
                  onChange={event => onProviderFilterChange(event.target.value)}
                  data-testid="gods-eye-camera-provider-filter"
                  className="mt-0.5 w-full rounded border border-white/15 bg-black/40 px-1.5 py-1 text-[10px] uppercase tracking-widest text-slate-200"
                >
                  <option value="ALL">All</option>
                  {allProviders.filter(row => row.fetchableLayerIds.length > 0).map(row => (
                    <option key={row.id} value={row.fetchableLayerIds[0]}>
                      {row.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[9px] uppercase tracking-widest text-slate-500">
                Status
                <select
                  value={statusFilter}
                  onChange={event => onStatusFilterChange(event.target.value as CameraDirectoryStatusFilter)}
                  data-testid="gods-eye-camera-status-filter"
                  className="mt-0.5 w-full rounded border border-white/15 bg-black/40 px-1.5 py-1 text-[10px] uppercase tracking-widest text-slate-200"
                >
                  {CAMERA_DIRECTORY_STATUS_FILTERS.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="block text-[9px] uppercase tracking-widest text-slate-500">
                Distance
                <select
                  value={distanceFilter}
                  onChange={event => onDistanceFilterChange(event.target.value as CameraDirectoryDistanceFilter)}
                  data-testid="gods-eye-camera-distance-filter"
                  className="mt-0.5 w-full rounded border border-white/15 bg-black/40 px-1.5 py-1 text-[10px] uppercase tracking-widest text-slate-200"
                >
                  {CAMERA_DIRECTORY_DISTANCE_FILTERS.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <ul className="space-y-1" data-testid="gods-eye-camera-directory-rows">
                {rows.map(row => (
                  <li key={`${row.layerId}:${row.id}`}>
                    <button
                      type="button"
                      onClick={() => onSelect({ id: row.id, layerId: row.layerId })}
                      className="flex w-full items-center gap-2 rounded border border-white/10 px-1.5 py-1 text-left hover:border-cyan-300/40"
                    >
                      <IconCamera size={14} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-slate-100">{row.road ? `${row.road}` : row.title}</span>
                        <span className="block truncate font-mono text-[9px] text-slate-500">{row.agency}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-slate-400">
                        {row.distanceKm == null ? row.pinState : `${(row.distanceKm * 0.621371).toFixed(1)} mi`}
                      </span>
                      <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-cyan-300">View</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </aside>
  )
}
