'use client'

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { composeLiveIntel, DRAWER_SECTION_ORDER, PRESENCE_LABEL, SOURCE_LABEL } from '@/lib/live-intel/composeLiveIntel'
import { getLiveIntelStoreSnapshot, subscribeLiveIntelStore } from '@/lib/live-intel/liveIntelStore'
import type { LiveIntelItem, LiveIntelSeverity, LiveIntelSource } from '@/lib/live-intel/types'
import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { CommanderPresencePhase } from '@/lib/council/live-orchestration/rosterHealth'

const TONE_DOT: Record<LiveIntelSeverity, string> = {
  info: 'bg-cyan-400',
  operational: 'bg-emerald-400',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
}

const TONE_TEXT: Record<LiveIntelSeverity, string> = {
  info: 'text-cyan-200',
  operational: 'text-emerald-200',
  warning: 'text-amber-200',
  critical: 'text-red-300',
}

const EMPTY_FEED_SOURCES: LiveIntelSource[] = ['ai-news', 'world']

function formatClock(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then) || then <= 0) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function DrawerItem({ item }: { item: LiveIntelItem }) {
  const clock = formatClock(item.timestamp)
  return (
    <article className="rounded-lg border border-white/8 bg-black/35 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[11px] font-semibold ${TONE_TEXT[item.severity]}`}>{item.title}</p>
        {clock ? <time className="shrink-0 text-[9px] uppercase tracking-widest text-slate-500" dateTime={item.timestamp}>{clock}</time> : null}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{item.message}</p>
    </article>
  )
}

export const CommanderLiveIntelRail = memo(function CommanderLiveIntelRail({
  liveResearchHud,
  presencePhase,
  terraNote,
  sourcesPreview,
}: {
  liveResearchHud: LiveResearchClientUi | null
  presencePhase: CommanderPresencePhase
  terraNote?: string | null
  sourcesPreview?: string | null
}) {
  const store = useSyncExternalStore(subscribeLiveIntelStore, getLiveIntelStoreSnapshot, getLiveIntelStoreSnapshot)
  const snapshot = useMemo(
    () => composeLiveIntel({
      presencePhase,
      liveResearchHud,
      terraNote,
      sourcesPreview,
      extraItems: store.extras,
    }),
    [presencePhase, liveResearchHud, terraNote, sourcesPreview, store.extras],
  )
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [open, close])

  const visibleBadges = snapshot.badges.filter(badge =>
    badge.source === 'war-room' || badge.connected || EMPTY_FEED_SOURCES.includes(badge.source),
  )

  return (
    <div ref={rootRef} className="relative z-30" data-testid="commander-live-intel-rail">
      <div
        className="flex min-h-9 items-center gap-2 overflow-x-auto border-b border-cyan-400/15 px-3 py-1.5 sm:px-4"
        style={{ background: 'rgba(2,8,14,0.88)' }}
      >
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-full border border-cyan-400/25 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-200 hover:bg-cyan-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(value => !value)}
          data-testid="live-intel-toggle"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${snapshot.unreadCount > 0 ? 'bg-cyan-400' : 'bg-emerald-400'}`} aria-hidden="true" />
          Live Intel
          {snapshot.unreadCount > 0 ? (
            <span className="rounded-full border border-cyan-400/30 px-1.5 text-[8px] tracking-widest text-cyan-100" data-testid="live-intel-unread">
              {snapshot.unreadCount}
            </span>
          ) : null}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {visibleBadges.map(badge => (
            <span
              key={badge.source}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/8 bg-black/30 px-2 py-0.5"
              data-testid={`live-intel-badge-${badge.source}`}
              data-connected={badge.connected ? 'true' : 'false'}
            >
              <span className={`h-1 w-1 rounded-full ${TONE_DOT[badge.tone]}`} aria-hidden="true" />
              <span className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-400">{badge.label}</span>
              {badge.connected && badge.count > 0 ? (
                <span className="text-[8px] tabular-nums text-cyan-200">{String(badge.count).padStart(2, '0')}</span>
              ) : null}
            </span>
          ))}
        </div>

        {snapshot.highlighted ? (
          <p className="hidden min-w-0 max-w-sm truncate text-[11px] text-slate-300 lg:block" title={snapshot.highlighted.message}>
            {snapshot.highlighted.title}
          </p>
        ) : null}

        <button
          type="button"
          className="shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-400 hover:bg-white/8 hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? 'Collapse Live Intel' : 'Expand Live Intel'}
          title={open ? 'Collapse Live Intel' : 'Expand Live Intel'}
          onClick={() => setOpen(value => !value)}
          data-testid="live-intel-expand"
        >
          {open ? '−' : '+'}
        </button>
      </div>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Live Intel"
          className="live-intel-motion absolute inset-x-3 top-full z-40 mt-1 max-h-[min(28rem,70vh)] overflow-hidden rounded-xl border border-cyan-400/40 bg-[rgba(4,10,16,0.96)] shadow-[0_18px_48px_rgba(0,0,0,0.72)] sm:inset-x-4"
          data-testid="live-intel-drawer"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-cyan-300">Live Intel</p>
            <p className="text-[10px] text-slate-500">{PRESENCE_LABEL[presencePhase]}</p>
          </div>
          <div className="max-h-[min(24rem,62vh)] space-y-4 overflow-y-auto p-3">
            {DRAWER_SECTION_ORDER.map(source => {
              const items = snapshot.groups[source] ?? []
              const emptyFeed = EMPTY_FEED_SOURCES.includes(source)
              if (!items.length && !emptyFeed) return null
              return (
                <section key={source} data-testid={`live-intel-section-${source}`}>
                  <p className="mb-2 text-[8px] font-bold uppercase tracking-[0.22em] text-slate-500">
                    {SOURCE_LABEL[source]}
                  </p>
                  {items.length ? items.map(item => (
                    <div key={item.id} className="mb-2 last:mb-0">
                      <DrawerItem item={item} />
                    </div>
                  )) : (
                    <p className="rounded-lg border border-white/8 bg-black/30 px-3 py-2 text-[11px] text-slate-500" data-testid="live-intel-empty-feed">
                      No intelligence feed connected.
                    </p>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
})
