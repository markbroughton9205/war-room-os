'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { filterMediaStations, type MediaLocationHint } from '@/lib/media/browse'
import { playbackModeLabel, sourceFamilyLabel } from '@/lib/media/sourceFamily'
import { mediaStreamStatusLabel } from '@/lib/media/playbackStatus'
import {
  MEDIA_GENRE_FILTERS,
  MEDIA_GEO_SCOPES,
  MEDIA_SOURCE_FILTERS,
  type MediaGenreFilter,
  type MediaGeoScope,
  type MediaSourceFilter,
} from '@/lib/media/types'
import { TERRA_MEDIA_PANEL_ID } from '@/lib/terra/workspace/panelIds'
import { TERRA_WORKSPACE_DEFAULT_SETTINGS } from '@/lib/terra/workspace/layout'
import { NowPlaying } from '@/components/war-room/media/NowPlaying'
import { PlayerControls } from '@/components/war-room/media/PlayerControls'
import { SourceInfo } from '@/components/war-room/media/SourceInfo'
import { StationArt } from '@/components/war-room/media/StationArt'
import { StationBrowser } from '@/components/war-room/media/StationBrowser'
import { MediaTabs } from '@/components/war-room/media/MediaTabs'
import { useMediaPlayback } from '@/components/war-room/media/MediaPlaybackProvider'
import { useTerraWorkspaceLayoutApiOptional } from '@/components/war-room/terra/workspace/TerraWorkspaceLayoutProvider'
import type { TerraWorkspaceSnapshot } from '@/components/war-room/terra/workspace/terraWorkspaceStore'

const CHIP = 'rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest'
const CHIP_ON = 'border-emerald-400/80 bg-emerald-400 text-slate-950'
const CHIP_OFF = 'border-white/12 text-slate-300 hover:border-cyan-300/40'

const FUTURE_TABS = ['Politics', 'Entertainment', 'Sports', 'Live Events'] as const

export function TerraMediaPanel({
  locationHint,
}: {
  commanderQuestion?: string
  locationHint?: MediaLocationHint | null
}) {
  const { state, controller, stations } = useMediaPlayback()
  const workspace = useTerraWorkspaceLayoutApiOptional()
  const workspaceSnapshot = useSyncExternalStore(
    workspace?.store.subscribe ?? emptySubscribe,
    workspace?.store.getSnapshot ?? emptyWorkspaceSnapshot,
    workspace?.store.getSnapshot ?? emptyWorkspaceSnapshot,
  )
  const chrome = workspaceSnapshot.panels[TERRA_MEDIA_PANEL_ID]?.playerChrome === 'compact' ? 'compact' : 'full'
  const compact = chrome === 'compact'
  const [search, setSearch] = useState('')
  const [geo, setGeo] = useState<MediaGeoScope>('local')
  const [source, setSource] = useState<MediaSourceFilter>('all')
  const [genre, setGenre] = useState<MediaGenreFilter>('ALL')

  useEffect(() => {
    controller.notifySurfaceMounted()
    return () => controller.notifySurfaceUnmounted()
  }, [controller])

  const filtered = useMemo(() => {
    const hasPlace = Boolean(locationHint?.city || locationHint?.state || locationHint?.label)
    const effectiveGeo = !hasPlace && geo !== 'global' ? 'global' : geo
    return filterMediaStations({
      stations,
      search,
      geo: effectiveGeo,
      source,
      genre,
      location: locationHint,
    })
  }, [stations, search, geo, source, genre, locationHint])

  const setChrome = (next: 'full' | 'compact') => {
    workspace?.store.setPlayerChrome(TERRA_MEDIA_PANEL_ID, next)
  }
  const minimize = () => {
    workspace?.store.setMinimized(TERRA_MEDIA_PANEL_ID, true)
  }

  if (compact) {
    const station = state.station
    const live = state.playbackState === 'playing'
    const streamStatus = mediaStreamStatusLabel(state.playbackState)
    return (
      <div
        className="w-[min(22rem,92vw)] overflow-hidden rounded-b-lg border border-t-0 border-white/15 bg-black/80 p-2"
        data-testid="terra-media-panel"
        data-terra-media-chrome="compact"
        data-terra-media-fullscreen="false"
      >
        <div className="flex gap-2" data-testid="terra-media-compact">
          <StationArt station={station} size="sm" live={live} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-black tracking-tight text-white">
              {station ? `${station.callSign}${station.frequency ? ` ${station.frequency}` : ''}` : 'No station selected'}
            </p>
            <p className="truncate text-[11px] text-slate-300">{station?.name ?? 'War Room Media'}</p>
            <p className="truncate text-[10px] text-slate-500">{station?.city ?? ''}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] font-bold uppercase tracking-widest">
              <span className={live ? 'text-emerald-300' : 'text-slate-500'} data-testid="media-stream-status">
                {streamStatus}
              </span>
              {station ? (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-emerald-200/90">{station.verificationState}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-cyan-200/80">{sourceFamilyLabel(station.sourceFamily)}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="mt-2">
          <PlayerControls compact />
        </div>
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            className="rounded border border-cyan-300/40 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-200"
            data-testid="terra-media-full"
            onClick={() => setChrome('full')}
          >
            Full
          </button>
          <button
            type="button"
            className="ml-auto rounded border border-white/15 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-slate-300"
            data-testid="terra-media-minimize"
            onClick={minimize}
          >
            Min
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex h-[min(34rem,70vh)] w-[min(45rem,92vw)] max-h-[70vh] max-w-[92vw] flex-col overflow-hidden rounded-b-lg border border-t-0 border-white/15 bg-black/80"
      data-testid="terra-media-panel"
      data-terra-media-chrome="full"
      data-terra-media-fullscreen="false"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2" data-testid="terra-media-full-header">
        <div className="min-w-0">
          <p className="text-[12px] font-black uppercase tracking-[0.16em] text-white">War Room Media</p>
          <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Local · Regional · Global</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="rounded border border-cyan-300/40 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-200"
            data-testid="terra-media-compact-toggle"
            onClick={() => setChrome('compact')}
          >
            Compact
          </button>
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-slate-300"
            data-testid="terra-media-minimize"
            onClick={minimize}
          >
            Minimize
          </button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap gap-1 px-3 pt-2" data-testid="terra-media-geo-filters">
        {MEDIA_GEO_SCOPES.map(scope => (
          <button
            key={scope}
            type="button"
            data-testid={`terra-media-geo-${scope}`}
            aria-pressed={geo === scope}
            className={`${CHIP} ${geo === scope ? CHIP_ON : CHIP_OFF}`}
            onClick={() => setGeo(scope)}
          >
            {scope}
          </button>
        ))}
        {MEDIA_SOURCE_FILTERS.map(family => (
          <button
            key={family}
            type="button"
            data-testid={`terra-media-source-${family}`}
            aria-pressed={source === family}
            className={`${CHIP} ${source === family ? CHIP_ON : CHIP_OFF}`}
            onClick={() => setSource(family)}
          >
            {family === 'all' ? 'All sources' : sourceFamilyLabel(family === 'iheart' ? 'iheart' : family === 'direct' ? 'direct' : family === 'public' ? 'public' : 'international')}
          </button>
        ))}
      </div>

      <MediaTabs />

      <div className="flex shrink-0 flex-wrap gap-1 px-3" data-testid="terra-media-future-tabs">
        {FUTURE_TABS.map(tab => (
          <button
            key={tab}
            type="button"
            disabled
            title={`${tab} is not available this pass`}
            className={`${CHIP} cursor-not-allowed border-white/8 text-slate-600`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="px-3 py-2">
        <input
          type="search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search station, callsign, city, genre, source…"
          data-testid="terra-media-search"
          className="w-full rounded-md border border-white/12 bg-black/40 px-2 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/50"
        />
      </div>

      <div className="flex shrink-0 flex-wrap gap-1 px-3 pb-2" data-testid="terra-media-genre-filters">
        {MEDIA_GENRE_FILTERS.map(item => (
          <button
            key={item}
            type="button"
            data-testid={`terra-media-genre-${item.replace(/[^A-Z0-9]+/g, '-').toLowerCase()}`}
            aria-pressed={genre === item}
            className={`${CHIP} ${genre === item ? CHIP_ON : CHIP_OFF}`}
            onClick={() => setGenre(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden px-3 pb-3 md:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)]">
        <StationBrowser stations={filtered} heading="Stations / Media" />
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          <NowPlaying />
          {state.station ? (
            <p className="px-1 text-[9px] uppercase tracking-widest text-slate-500" data-testid="terra-media-source-provenance">
              Source: {sourceFamilyLabel(state.station.sourceFamily)} · {playbackModeLabel(state.station.playbackMode)}
            </p>
          ) : null}
          <SourceInfo />
        </div>
      </div>
    </div>
  )
}

function emptySubscribe(): () => void {
  return () => undefined
}

function emptyWorkspaceSnapshot(): TerraWorkspaceSnapshot {
  return {
    panels: {},
    zOrder: [],
    draggingId: null,
    settings: { ...TERRA_WORKSPACE_DEFAULT_SETTINGS },
    attention: {},
  }
}
