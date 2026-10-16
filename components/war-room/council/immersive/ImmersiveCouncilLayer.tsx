'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApplicationActivity } from '@/lib/ui/applicationActivity'
import { deriveProgressStars, type ProgressStar } from '@/lib/council/immersive/signals'
import { xrReadiness, type XrReadiness } from '@/lib/council/immersive/scene'
import { StarfieldCanvas } from './StarfieldCanvas'
import { MaterializingText, type MaterializingBlock } from './MaterializingText'
import { ProgressStars } from './ProgressStars'
import { PlanetObject, PlanetPanel } from './PlanetObject'
import { usePlanets } from './usePlanets'

export type MotionPref = 'auto' | 'reduced' | 'full'
type DrawerId = 'sessions' | 'conversation' | 'research' | 'missions' | 'systems' | 'computer' | 'settings' | 'planet-foundry' | 'planet-hvs' | 'planet-terra'

export type ImmersivePanels = {
  sessions: ReactNode
  conversation: ReactNode
  research: ReactNode
  missions: ReactNode
  systems: ReactNode
  computer: ReactNode
}

export type ImmersiveCouncilLayerProps = {
  blocks: MaterializingBlock[]
  stars: ProgressStar[]
  presenceLabel: string
  sessionTitle?: string
  composer: ReactNode
  globe: ReactNode
  panels: ImmersivePanels
  badges: { sessions: number; trash: number; archived: number; pendingMissions: number; liveMissions: number; research: string | null }
  /** True while a local model turn is running (animations drop to static so they never compete with inference). */
  modelBusy: boolean
  motionPref: MotionPref
  onMotionPref: (pref: MotionPref) => void
  onClassicView: () => void
  onOpenCouncilSettings?: () => void
}

const DOCK: Array<{ id: Exclude<DrawerId, `planet-${string}` | 'settings'> | 'settings'; label: string; key: string; side: 'left' | 'right'; glyph: string }> = [
  { id: 'sessions', label: 'Sessions', key: '1', side: 'left', glyph: '☰' },
  { id: 'conversation', label: 'Conversation', key: '2', side: 'right', glyph: '✉' },
  { id: 'research', label: 'Research', key: '3', side: 'right', glyph: '⌕' },
  { id: 'missions', label: 'Foundry missions', key: '4', side: 'right', glyph: '⚒' },
  { id: 'systems', label: 'Connected systems', key: '5', side: 'right', glyph: '◎' },
  { id: 'computer', label: 'Council computer', key: '6', side: 'right', glyph: '▣' },
  { id: 'settings', label: 'Settings & help', key: '7', side: 'right', glyph: '⚙' },
]

/** Read-only poll of the browser broker so the computer star reflects who really holds the session. */
function useComputerSignal(): { controlState: string; url: string | null } | null {
  const activity = useApplicationActivity()
  const [signal, setSignal] = useState<{ controlState: string; url: string | null } | null>(null)
  const visible = activity.visible
  const mult = activity.pollingMultiplier
  useEffect(() => {
    if (!visible) return
    let stop = false
    const load = async () => {
      try {
        const res = await fetch('/api/council/computer', { cache: 'no-store' })
        if (!res.ok) { if (!stop) setSignal(null); return }
        const j = await res.json() as { sessions?: Array<{ controlState: string; tabs?: Array<{ url?: string; active?: boolean }> }> }
        const s = (j.sessions ?? []).find(x => x.controlState === 'COMMANDER_CONTROL') ?? (j.sessions ?? []).find(x => x.controlState === 'AGENT_CONTROL')
        if (!stop) setSignal(s ? { controlState: s.controlState, url: s.tabs?.find(t => t.active)?.url ?? s.tabs?.[0]?.url ?? null } : null)
      } catch { if (!stop) setSignal(null) }
    }
    void load()
    const t = window.setInterval(() => { void load() }, 6000 * mult)
    return () => { stop = true; window.clearInterval(t) }
  }, [visible, mult])
  return signal
}

const CSS = `
@keyframes immersive-materialize { from { opacity: 0; filter: blur(5px); transform: translateY(3px); } to { opacity: 1; filter: blur(0); transform: none; } }
.immersive-materialize span { opacity: 0; animation: immersive-materialize 420ms ease-out forwards; }
@keyframes immersive-pulse { 0%,100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.18); } }
.immersive-star-pulse { display: inline-block; animation: immersive-pulse 1.8s ease-in-out infinite; }
@keyframes immersive-ring { 0% { transform: scale(1); opacity: .9; } 100% { transform: scale(1.22); opacity: 0; } }
.immersive-planet-ring { animation: immersive-ring 2.2s ease-out infinite; }
.immersive-composer textarea, .immersive-composer input[type="text"] { max-height: 5.5rem; }
@media (prefers-reduced-motion: reduce) {
  .immersive-materialize span { animation: none; opacity: 1; }
  .immersive-star-pulse, .immersive-planet-ring { animation: none; }
}
`

export function ImmersiveCouncilLayer(props: ImmersiveCouncilLayerProps) {
  const { composer, globe, panels, motionPref, onMotionPref, onClassicView, onOpenCouncilSettings } = props
  // Session state comes from the browser (ledger/local storage): render server-safe defaults until mounted so hydration never mismatches.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { queueMicrotask(() => setMounted(true)) }, [])
  const blocks = useMemo(() => (mounted ? props.blocks : []), [mounted, props.blocks])
  const computerSignal = useComputerSignal()
  const computerStar = mounted && computerSignal ? deriveProgressStars({ round: { phase: 'idle' }, computer: computerSignal }).filter(x => x.kind === 'computer') : []
  const stars = mounted ? [...props.stars, ...computerStar] : []
  const presenceLabel = mounted ? props.presenceLabel : 'Idle'
  const sessionTitle = mounted ? props.sessionTitle : undefined
  const badges = mounted ? props.badges : { sessions: 0, trash: 0, archived: 0, pendingMissions: 0, liveMissions: 0, research: null }
  const modelBusy = mounted ? props.modelBusy : false
  const activity = useApplicationActivity()
  const { planets, error: planetError, refreshedAt } = usePlanets()
  const [drawer, setDrawer] = useState<DrawerId | null>(null)
  const [conversationMounted, setConversationMounted] = useState(false)
  const [osReduced, setOsReduced] = useState(false)
  const [xr, setXr] = useState<XrReadiness | null>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const drawerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setOsReduced(m.matches)
    sync()
    m.addEventListener('change', sync)
    return () => m.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    let cancelled = false
    const xrApi = (navigator as Navigator & { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } }).xr
    if (!xrApi?.isSessionSupported) { queueMicrotask(() => { if (!cancelled) setXr(xrReadiness({ hasXr: Boolean(xrApi) })) }); return }
    xrApi.isSessionSupported('immersive-vr').then(ok => { if (!cancelled) setXr(xrReadiness({ hasXr: true, immersiveVrSupported: ok })) }).catch(() => { if (!cancelled) setXr(xrReadiness({ hasXr: true, immersiveVrSupported: false })) })
    return () => { cancelled = true }
  }, [])

  const reducedMotion = motionPref === 'reduced' || (motionPref === 'auto' && osReduced)
  const foundryLive = planets?.find(p => p.id === 'foundry')?.activity === true
  // Static whenever it could compete with inference or nobody is looking.
  const paused = modelBusy || foundryLive || !activity.visible || !activity.focused
  const planet = (id: 'foundry' | 'hvs' | 'terra') => planets?.find(p => p.id === id) ?? null

  const open = useCallback((id: DrawerId, from?: HTMLElement | null) => {
    lastFocus.current = from ?? (document.activeElement as HTMLElement | null)
    if (id === 'conversation') setConversationMounted(true)
    setDrawer(cur => (cur === id ? null : id))
  }, [])
  const close = useCallback(() => {
    setDrawer(null)
    queueMicrotask(() => lastFocus.current?.focus?.())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawer) { e.preventDefault(); close(); return }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const d = DOCK.find(x => x.key === e.key)
        if (d) { e.preventDefault(); open(d.id as DrawerId) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, close, open])

  useEffect(() => { if (drawer) queueMicrotask(() => drawerRef.current?.focus()) }, [drawer])

  const badgeFor = (id: string): string | null => {
    if (id === 'sessions') return badges.trash || badges.archived ? `${badges.sessions} · ${badges.trash} trash` : String(badges.sessions)
    if (id === 'missions') return badges.pendingMissions ? `${badges.pendingMissions} to approve` : badges.liveMissions ? `${badges.liveMissions} running` : null
    if (id === 'research') return badges.research
    return null
  }

  const drawerSide: 'left' | 'right' = drawer === 'sessions' ? 'left' : 'right'
  const drawerTitle = drawer?.startsWith('planet-') ? (planet(drawer.slice(7) as 'foundry' | 'hvs' | 'terra')?.name ?? 'Planet') : DOCK.find(d => d.id === drawer)?.label ?? ''
  const show = (id: DrawerId) => drawer === id
  const speakers = useMemo(() => Array.from(new Set(blocks.filter(b => b.role === 'member').map(b => b.label))), [blocks])

  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="immersive-council" data-view="immersive" data-motion={reducedMotion ? 'reduced' : paused ? 'paused' : 'live'}>
      <style>{CSS}</style>
      <StarfieldCanvas paused={paused} reducedMotion={reducedMotion} />

      <div className="absolute inset-0" data-testid="immersive-terra">{globe}</div>

      {/* Planets */}
      <div className="pointer-events-none absolute inset-y-0 left-[9%] z-20 flex items-center max-md:left-1 max-md:items-start max-md:pt-24"><PlanetObject status={planet('foundry')} reducedMotion={reducedMotion} onOpen={() => open('planet-foundry')} /></div>
      <div className="pointer-events-none absolute inset-y-0 right-[9%] z-20 flex items-center max-md:right-1 max-md:items-start max-md:pt-24"><PlanetObject status={planet('hvs')} reducedMotion={reducedMotion} onOpen={() => open('planet-hvs')} /></div>
      <div className="pointer-events-none absolute left-1/2 top-[3.2rem] z-20 -translate-x-1/2">
        <button type="button" onClick={() => open('planet-terra')} className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" data-testid="planet-terra" data-health={planet('terra')?.health ?? 'LOADING'} aria-label={`Terra: ${planet('terra')?.headline ?? 'reading status'}. Open Terra panel`}>
          Terra · {planet('terra') ? planet('terra')!.health.toLowerCase() : 'reading…'}
        </button>
      </div>

      {/* Header: session, presence, progress stars */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-center gap-1 px-14 pt-2 max-md:px-2">
        <div className="pointer-events-auto flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-300">
          <span className="max-w-[16rem] truncate font-bold text-white" data-testid="immersive-session-title">{sessionTitle || 'War Room'}</span>
          <span className="text-emerald-300" data-testid="immersive-presence">{presenceLabel}</span>
          {speakers.length ? <span className="hidden text-slate-400 sm:inline" data-testid="immersive-speakers">· {speakers.join(', ')}</span> : null}
        </div>
        <div className="pointer-events-auto"><ProgressStars stars={stars} reducedMotion={reducedMotion} /></div>
      </div>

      {/* Dock */}
      <nav className="absolute left-2 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1.5" aria-label="Council controls" data-testid="immersive-dock">
        {DOCK.map(d => {
          const badge = badgeFor(d.id)
          const active = drawer === d.id
          return (
            <button
              key={d.id}
              type="button"
              onClick={e => open(d.id as DrawerId, e.currentTarget)}
              className={`group relative flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-left text-[11px] backdrop-blur focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${active ? 'border-cyan-300/70 bg-cyan-300/15 text-white' : 'border-white/10 bg-black/55 text-slate-200 hover:bg-white/10'}`}
              aria-label={`${d.label} (Alt+${d.key})`}
              aria-pressed={active}
              data-testid={`dock-${d.id}`}
              title={`${d.label} — Alt+${d.key}`}
            >
              <span aria-hidden="true" className="w-4 text-center">{d.glyph}</span>
              <span className="hidden max-w-[10rem] truncate lg:inline">{d.label}</span>
              {badge ? <span className="rounded-full bg-cyan-300/15 px-1.5 text-[9px] text-cyan-200" data-testid={`dock-badge-${d.id}`}>{badge}</span> : null}
            </button>
          )
        })}
      </nav>

      {/* Materializing text + floating input */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-3 pb-12 sm:px-16">
        <div className="pointer-events-auto w-full max-w-3xl"><MaterializingText blocks={blocks} reducedMotion={reducedMotion} maxHeight="30vh" /></div>
        <div className="immersive-composer pointer-events-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-cyan-300/25 bg-[rgba(3,8,14,0.88)] shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-md" data-testid="immersive-input">{composer}</div>
      </div>

      {/* Drawers */}
      {drawer ? (
        <button type="button" aria-label="Close panel" tabIndex={-1} className="absolute inset-0 z-40 cursor-default bg-black/35" onClick={close} data-testid="immersive-scrim" />
      ) : null}
      <aside
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label={drawerTitle}
        aria-hidden={drawer ? undefined : true}
        className={`absolute top-0 z-50 flex h-full w-[min(34rem,96vw)] flex-col border-cyan-300/20 bg-[rgba(3,8,14,0.95)] shadow-[0_0_60px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-200 motion-reduce:transition-none ${drawerSide === 'left' ? 'left-0 border-r' : 'right-0 border-l'} ${drawer ? 'translate-x-0' : drawerSide === 'left' ? '-translate-x-full' : 'translate-x-full'}`}
        style={{ visibility: drawer ? 'visible' : 'hidden' }}
        data-testid="immersive-drawer"
        data-drawer={drawer ?? 'closed'}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">{drawerTitle}</h2>
          <button type="button" onClick={close} className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] uppercase tracking-widest text-slate-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" data-testid="immersive-drawer-close">Close (Esc)</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Always mounted (their polling and result hand-off must keep working), shown only when open. */}
          <div className={show('sessions') ? 'h-full' : 'hidden'}>{mounted ? panels.sessions : null}</div>
          <div className={show('missions') ? 'p-3' : 'hidden'}>{mounted ? panels.missions : null}</div>
          <div className={show('systems') ? 'p-3' : 'hidden'}>{mounted ? panels.systems : null}</div>
          <div className={show('computer') ? 'p-3' : 'hidden'}>{mounted ? panels.computer : null}</div>
          <div className={show('research') ? 'p-3 text-sm text-slate-200' : 'hidden'}>{mounted ? panels.research : null}</div>
          {conversationMounted ? <div className={show('conversation') ? 'h-full' : 'hidden'}>{panels.conversation}</div> : null}
          {(['foundry', 'hvs', 'terra'] as const).map(id => (
            show(`planet-${id}` as DrawerId) ? <div key={id}><PlanetPanel status={planet(id)} onClose={close} />{planetError ? <p className="px-4 pb-3 text-[11px] text-amber-300">{planetError}</p> : null}{refreshedAt ? <p className="px-4 pb-3 text-[10px] text-slate-500">Read from the live records at {new Date(refreshedAt).toLocaleTimeString()}.</p> : null}</div> : null
          ))}
          {show('settings') ? (
            <div className="space-y-4 p-4 text-sm text-slate-200" data-testid="immersive-settings">
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">View</h3>
                <div className="mt-2 flex gap-2">
                  <span className="rounded-full border border-cyan-300/60 bg-cyan-300/15 px-3 py-1 text-xs" aria-current="true">Immersive</span>
                  <button type="button" onClick={onClassicView} className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" data-testid="switch-classic">Classic panel view</button>
                </div>
              </section>
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">Motion</h3>
                <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Motion preference">
                  {(['auto', 'reduced', 'full'] as const).map(m => (
                    <button key={m} type="button" role="radio" aria-checked={motionPref === m} onClick={() => onMotionPref(m)} className={`rounded-full border px-3 py-1 text-xs capitalize focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${motionPref === m ? 'border-cyan-300/60 bg-cyan-300/15' : 'border-white/20 hover:bg-white/10'}`} data-testid={`motion-${m}`}>{m === 'auto' ? 'Follow system' : m}</button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Animation stops by itself while a local model turn or a Foundry mission is running, when the window is hidden, and when the system asks for reduced motion.</p>
              </section>
              {onOpenCouncilSettings ? <section><button type="button" onClick={onOpenCouncilSettings} className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10" data-testid="open-council-settings">Council settings</button></section> : null}
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">Keyboard</h3>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
                  {DOCK.map(d => <li key={d.id}><kbd className="rounded border border-white/20 px-1">Alt+{d.key}</kbd> {d.label}</li>)}
                  <li><kbd className="rounded border border-white/20 px-1">Esc</kbd> close the open panel</li>
                  <li><kbd className="rounded border border-white/20 px-1">Tab</kbd> move between controls, planets and signals</li>
                </ul>
              </section>
              <section data-testid="vr-readiness">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">VR (Meta Quest 3S)</h3>
                <p className="mt-1 text-xs text-slate-300">{xr ? `${xr.state === 'SUPPORTED_BY_BROWSER' ? 'WebXR immersive VR reported by this runtime.' : 'Not available in this runtime.'} ${xr.note}` : 'Checking WebXR…'}</p>
                <p className="mt-1 text-[11px] text-slate-400">The scene layout is defined for seated VR use (planets, floating panels, controller ray, snap turn) but has not been tested on a headset.</p>
              </section>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
