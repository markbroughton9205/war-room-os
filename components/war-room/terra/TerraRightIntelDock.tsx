'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { TerraLiveIntelPanel } from './TerraLiveIntelPanel'
import type { TerraLiveGeoObject, TerraLiveIntelSnapshot } from '@/lib/terra/liveGeoIntelligence'
import type { TerraEarthIntelPanelSnapshot, TerraLiveIntelItem } from '@/lib/terra/liveIntelPanelModel'
import { LiveIntelPreviewProvider, useLiveIntelPreview } from './LiveIntelPreviewController'

function DockPreviewLifecycle({ open, children }: { open: boolean; children: ReactNode }) {
  const { teardown } = useLiveIntelPreview()
  useEffect(() => {
    teardown()
  }, [open, teardown])
  return children
}

/**
 * Compact floating intel dock — glance-first, expand on demand.
 * Replaces the full-height right rail so the globe stays the hero.
 */
export function TerraRightIntelDock({
  snapshot,
  selected,
  fetchError,
  authRequired,
  pending,
  panel,
  inspectedItem,
  onInspectItem,
  onFlyToItem,
  hasSelection,
  commanderQuestion,
  onCommanderQuestionChange,
  onSendSelectedToCouncil,
  canSendToCouncil,
  onCreateAstraMission,
  canCreateAstraMission,
  onRunAstraMission,
  canRunAstraMission,
  astraStatus,
  observedDetail,
  relatedDetail,
}: {
  snapshot: TerraLiveIntelSnapshot
  selected: TerraLiveGeoObject | null
  fetchError?: string | null
  authRequired?: boolean
  pending?: boolean
  panel?: TerraEarthIntelPanelSnapshot | null
  inspectedItem?: TerraLiveIntelItem | null
  onInspectItem?: (item: TerraLiveIntelItem | null) => void
  onFlyToItem?: (item: TerraLiveIntelItem) => void
  hasSelection: boolean
  commanderQuestion: string
  onCommanderQuestionChange: (value: string) => void
  onSendSelectedToCouncil: () => void
  canSendToCouncil: boolean
  onCreateAstraMission: () => void
  canCreateAstraMission: boolean
  onRunAstraMission: () => void
  canRunAstraMission: boolean
  astraStatus: string | null
  observedDetail: ReactNode
  relatedDetail: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [pinned, setPinned] = useState(false)
  const liveCount = (panel ?? snapshot.panel)?.sections.reduce((sum, section) => sum + section.count, 0)
    ?? snapshot.layers.reduce((sum, layer) => sum + (layer.objectCount ?? 0), 0)
  const dockOpen = expanded || pinned
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null)
  const inspectFromDock = (item: TerraLiveIntelItem | null) => {
    if (item) setExpanded(true)
    onInspectItem?.(item)
  }

  return (
    <aside
      className="pointer-events-none relative flex w-[min(20rem,30vw)] flex-col items-stretch gap-1.5"
      data-testid="terra-right-intel-dock"
    >
      <LiveIntelPreviewProvider scrollRoot={scrollRoot}>
      <DockPreviewLifecycle open={dockOpen}>
      <div className={`pointer-events-auto overflow-hidden rounded-xl border bg-black/70 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl ${hasSelection ? 'border-cyan-300/45 terra-live-chip' : 'border-cyan-400/25'}`}>
        <div className="flex items-center gap-1 px-1.5 py-1">
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1 py-0.5 text-left"
            aria-expanded={dockOpen}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="terra-live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span className="truncate text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-200">Live intel</span>
              <span className="font-mono text-[9px] text-emerald-300/90">{liveCount}</span>
            </span>
            <span className="text-[9px] uppercase tracking-widest text-slate-500">{dockOpen ? '▾ inspect' : '▸ inspect'}</span>
          </button>
          <button
            type="button"
            onClick={() => setPinned(value => !value)}
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${pinned ? 'border-cyan-300/50 text-cyan-200' : 'border-white/15 text-slate-500'}`}
            aria-pressed={pinned}
            data-testid="terra-live-intel-pin"
          >
            {pinned ? 'pinned' : 'pin'}
          </button>
        </div>
        {!dockOpen ? (
          <div className="group/glance border-t border-white/10 px-2.5 py-2">
            <TerraLiveIntelPanel
              snapshot={snapshot}
              selected={selected}
              fetchError={fetchError}
              authRequired={authRequired}
              pending={pending}
              panelOverride={panel}
              inspectedItem={inspectedItem}
              onInspectItem={inspectFromDock}
              onFlyToItem={onFlyToItem}
              glance
            />
            {selected ? (
              <p className="mt-1.5 truncate text-[10px] text-slate-300" title={selected.title}>
                {selected.title}
              </p>
            ) : (
              <p className="mt-1.5 text-[10px] text-slate-500">Hover layers · click to inspect</p>
            )}
          </div>
        ) : (
          <div
            className="max-h-[min(62vh,34rem)] space-y-2 overflow-y-auto overscroll-contain border-t border-white/10 p-2"
            ref={setScrollRoot}
          >
            <TerraLiveIntelPanel
              snapshot={snapshot}
              selected={selected}
              fetchError={fetchError}
              authRequired={authRequired}
              pending={pending}
              panelOverride={panel}
              inspectedItem={inspectedItem}
              onInspectItem={inspectFromDock}
              onFlyToItem={onFlyToItem}
              onSendToCouncil={() => onSendSelectedToCouncil()}
              canSendToCouncil={canSendToCouncil}
              compact
            />
            <div className="rounded border border-emerald-400/20 bg-black/40 p-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-emerald-400/80">Council / ASTRA</p>
              <label className="block text-[9px] font-bold uppercase tracking-widest text-slate-500">
                Commander question
                <textarea
                  value={commanderQuestion}
                  onChange={event => onCommanderQuestionChange(event.target.value)}
                  rows={3}
                  placeholder="Analyze this object using only the supplied Terra intelligence. Separate observed facts from inference."
                  className="mt-1 w-full resize-y rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] font-normal normal-case tracking-normal text-slate-200 placeholder:text-slate-600"
                />
              </label>
              <button
                type="button"
                onClick={onSendSelectedToCouncil}
                disabled={!canSendToCouncil}
                className="mt-1.5 w-full rounded border border-emerald-400/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600"
              >
                Send to Council
              </button>
              <button
                type="button"
                onClick={onCreateAstraMission}
                disabled={!canCreateAstraMission}
                className="mt-1 w-full rounded border border-cyan-400/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600"
              >
                Create ASTRA mission
              </button>
              <button
                type="button"
                onClick={onRunAstraMission}
                disabled={!canRunAstraMission}
                className="mt-1 w-full rounded border border-cyan-400/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600"
              >
                Run ASTRA mission
              </button>
              <p className="mt-1 text-[10px] text-slate-500">
                {astraStatus ?? 'Selection is not create. Create is not execute.'}
              </p>
            </div>
            {observedDetail}
            {relatedDetail}
          </div>
        )}
      </div>
      </DockPreviewLifecycle>
      </LiveIntelPreviewProvider>
    </aside>
  )
}
