'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { WarRoomBackControl } from '@/components/war-room/WarRoomBackControl'
import {
  TERRA_MISSION_DEFAULT_SECTION,
  TERRA_MISSION_DRAWER_IDS,
  TERRA_MISSION_DRAWER_LABEL,
  TERRA_MISSION_DRAWER_SECTIONS,
  TERRA_MISSION_SECTION_LABEL,
  slotKey,
  type TerraMissionDrawerId,
  type TerraMissionSectionId,
} from '@/lib/terra/missionControl/mapping'
import { useTerraWorkspaceLayoutApiOptional } from '../workspace/TerraWorkspaceLayoutProvider'
import { useTerraMissionControl } from './TerraMissionControlProvider'

const DOCK_ICONS: Record<TerraMissionDrawerId, string> = {
  navigate: '⌖',
  earth: '◉',
  intelligence: '▣',
  time: '◷',
  tools: '⚙',
  media: '▶',
}

function Slot({ slot, className, children }: { slot: string; className?: string; children?: ReactNode }) {
  const { registerSlot } = useTerraMissionControl()
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    registerSlot(slot, ref.current)
    return () => registerSlot(slot, null)
  }, [registerSlot, slot])
  return (
    <div ref={ref} className={className} data-terra-mission-slot={slot}>
      {children}
    </div>
  )
}

function DrawerSections({ drawer }: { drawer: TerraMissionDrawerId }) {
  const { section, openDrawer } = useTerraMissionControl()
  const sections = TERRA_MISSION_DRAWER_SECTIONS[drawer]
  if (sections.length <= 1) return null
  return (
    <div className="flex flex-wrap gap-1 border-b border-white/10 px-2 py-1.5" data-testid="terra-context-drawer-sections">
      {sections.map(id => (
        <button
          key={id}
          type="button"
          data-testid={`terra-mission-section-${id}`}
          aria-pressed={section === id}
          className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest ${section === id ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400 hover:text-cyan-200'}`}
          onClick={() => openDrawer(drawer, id)}
        >
          {TERRA_MISSION_SECTION_LABEL[id]}
        </button>
      ))}
    </div>
  )
}

export function TerraMissionBar({
  orbiting,
  aerialFallback,
}: {
  orbiting: boolean
  aerialFallback?: ReactNode
}) {
  const { openDrawer, drawer, chromeEnabled } = useTerraMissionControl()
  if (!chromeEnabled) return null
  return (
    <header
      data-testid="terra-mission-bar"
      className="relative isolate z-[80] flex shrink-0 items-center gap-2 border-b border-cyan-500/25 bg-black/85 px-2 py-1.5 backdrop-blur-md"
    >
      <WarRoomBackControl variant="overlay" label="WAR ROOM" className="relative z-[1] shrink-0" />
      <div className="flex min-w-0 items-center gap-2">
        <span className="terra-live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
        <h1 className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">WAR ROOM · TERRA</h1>
        {orbiting ? <span className="text-[8px] uppercase tracking-widest text-cyan-300/80" data-testid="terra-living-orbit-badge">Living Orbit</span> : null}
      </div>
      <button
        type="button"
        data-testid="terra-mission-search-trigger"
        className="min-w-0 flex-1 truncate rounded border border-white/10 bg-black/50 px-2 py-1 text-left font-mono text-[11px] text-slate-500 hover:border-cyan-400/40 hover:text-cyan-200"
        onClick={() => openDrawer('navigate', 'search')}
      >
        Address, ZIP, city, landmark, or lat, lon
      </button>
      {aerialFallback}
      <span className="ml-auto text-[8px] uppercase tracking-widest text-slate-500" data-testid="terra-mission-drawer-state">
        {drawer ?? 'earth surface'}
      </span>
    </header>
  )
}

export function TerraControlDock() {
  const { chromeEnabled, drawer, toggleDrawer } = useTerraMissionControl()
  const layout = useTerraWorkspaceLayoutApiOptional()
  if (!chromeEnabled) return null
  return (
    <nav
      data-testid="terra-control-dock"
      className="pointer-events-auto absolute left-2 top-1/2 z-[70] flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-white/10 bg-black/70 p-1 backdrop-blur-md"
    >
      {TERRA_MISSION_DRAWER_IDS.map(id => (
        <button
          key={id}
          type="button"
          data-testid={`terra-dock-${id}`}
          aria-pressed={drawer === id}
          title={TERRA_MISSION_DRAWER_LABEL[id]}
          className={`flex h-9 w-9 flex-col items-center justify-center rounded-lg text-cyan-100 ${drawer === id ? 'bg-cyan-400/25 text-cyan-50' : 'hover:bg-white/10'}`}
          onClick={() => {
            if (id === 'media' && drawer !== 'media' && layout) {
              layout.store.openOrFocus('terra_media', layout.getViewport(), { width: 336, height: 168 })
            }
            toggleDrawer(id)
          }}
        >
          <span aria-hidden="true" className="text-[13px] leading-none">{DOCK_ICONS[id]}</span>
          <span className="mt-0.5 text-[6px] font-bold uppercase tracking-widest">{TERRA_MISSION_DRAWER_LABEL[id].slice(0, 4)}</span>
        </button>
      ))}
    </nav>
  )
}

export function TerraContextDrawer() {
  const { chromeEnabled, drawer, section, closeDrawer } = useTerraMissionControl()
  if (!chromeEnabled || !drawer || !section) return null
  return (
    <aside
      data-testid="terra-context-drawer"
      data-terra-drawer={drawer}
      data-terra-section={section}
      className="pointer-events-auto absolute bottom-3 right-3 top-3 z-[70] flex w-[min(26rem,92vw)] flex-col overflow-hidden rounded-2xl border border-cyan-300/25 bg-black/82 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">{TERRA_MISSION_DRAWER_LABEL[drawer]}</p>
        <span className="text-[9px] uppercase tracking-widest text-slate-500">{TERRA_MISSION_SECTION_LABEL[section]}</span>
        <button
          type="button"
          data-testid="terra-context-drawer-close"
          className="ml-auto rounded border border-white/15 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-slate-400 hover:text-slate-200"
          onClick={closeDrawer}
        >
          close
        </button>
      </div>
      <DrawerSections drawer={drawer} />
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {TERRA_MISSION_DRAWER_SECTIONS[drawer].map(id => (
          <div key={id} hidden={section !== id} data-terra-section-panel={id} className="min-w-0">
            <Slot slot={slotKey({ kind: 'drawer', drawer, section: id })} className="min-h-[4rem] w-full min-w-0" />
          </div>
        ))}
      </div>
    </aside>
  )
}

export function TerraRemote() {
  const { chromeEnabled, drawer, toggleDrawer } = useTerraMissionControl()
  const layout = useTerraWorkspaceLayoutApiOptional()
  if (!chromeEnabled) return null
  return (
    <div
      data-testid="terra-remote"
      className="pointer-events-auto absolute bottom-3 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/75 px-2 py-1 backdrop-blur-md"
    >
      {TERRA_MISSION_DRAWER_IDS.map(id => (
        <button
          key={id}
          type="button"
          data-testid={`terra-remote-${id}`}
          aria-pressed={drawer === id}
          className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-widest ${drawer === id ? 'bg-cyan-400/25 text-cyan-100' : 'text-slate-400 hover:text-cyan-200'}`}
          onClick={() => {
            if (id === 'media' && drawer !== 'media' && layout) {
              layout.store.openOrFocus('terra_media', layout.getViewport(), { width: 336, height: 168 })
            }
            toggleDrawer(id)
          }}
        >
          {id === 'intelligence' ? 'intel' : id}
        </button>
      ))}
    </div>
  )
}

export function TerraAlertHost() {
  const { chromeEnabled } = useTerraMissionControl()
  if (!chromeEnabled) return null
  return (
    <div data-testid="terra-alert-banners" className="pointer-events-none absolute left-1/2 top-3 z-[75] w-[min(22rem,90vw)] -translate-x-1/2">
      <Slot slot="banner" className="pointer-events-auto" />
    </div>
  )
}

export function TerraMediaStage() {
  const { chromeEnabled, drawer } = useTerraMissionControl()
  if (!chromeEnabled) return null
  const expanded = drawer === 'media'
  return (
    <div
      data-testid="terra-media-player"
      data-terra-media-chrome={expanded ? 'full' : 'compact'}
      className={`pointer-events-none absolute z-[72] ${expanded ? 'bottom-14 left-14 right-[min(27rem,94vw)] top-14' : 'bottom-14 left-14 w-[min(22rem,70vw)]'}`}
    >
      <Slot slot="player" className={`pointer-events-auto ${expanded ? 'h-full' : ''}`} />
    </div>
  )
}

export function TerraMissionControlChrome() {
  const { chromeEnabled } = useTerraMissionControl()
  if (!chromeEnabled) return null
  return (
    <>
      <TerraControlDock />
      <TerraContextDrawer />
      <TerraRemote />
      <TerraAlertHost />
      <TerraMediaStage />
    </>
  )
}

export function defaultSectionFor(drawer: TerraMissionDrawerId): TerraMissionSectionId {
  return TERRA_MISSION_DEFAULT_SECTION[drawer]
}
