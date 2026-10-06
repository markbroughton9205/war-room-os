'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopBrowserCommand } from '@/lib/war-room-browser/desktopBridge'
import { WAR_ROOM_BROWSER_IPC, type WarRoomBrowserBounds, type WarRoomBrowserState } from '@/lib/war-room-browser/types'
import { classifyBrowserUrl } from '@/lib/war-room-browser/urlPolicy'

export function WarRoomBrowser({
  state,
  native,
  onState,
  onClose,
  onBounds,
  onOpenUrl,
  onOpenExternally,
}: {
  state: WarRoomBrowserState
  native: boolean
  onState: (state: WarRoomBrowserState) => void
  onClose: () => void
  onBounds: (bounds: WarRoomBrowserBounds) => void
  onOpenUrl: (url: string) => Promise<void>
  onOpenExternally?: (url: string) => Promise<void>
}) {
  const paneRef = useRef<HTMLDivElement | null>(null)
  const active = state.tabs.find(tab => tab.id === state.activeTabId) ?? state.tabs[0] ?? null
  const [draft, setDraft] = useState(active?.url ?? '')

  useEffect(() => {
    setDraft(active?.url ?? '')
  }, [active?.id, active?.url])

  useEffect(() => {
    const node = paneRef.current
    if (!node) return
    const publish = () => {
      const rect = node.getBoundingClientRect()
      onBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        visible: true,
      })
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    window.addEventListener('resize', publish)
    window.addEventListener('scroll', publish, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publish)
      window.removeEventListener('scroll', publish, true)
      onBounds({ x: 0, y: 0, width: 0, height: 0, visible: false })
    }
  }, [onBounds])

  const command = useCallback(async (channel: string, payload: Record<string, unknown> = {}) => {
    if (native) {
      const next = await desktopBrowserCommand(channel, payload)
      if (next) onState({ ...next, open: true })
    }
  }, [native, onState])

  const go = async () => {
    const classified = classifyBrowserUrl(draft)
    if (!classified.ok) {
      if (active) {
        onState({
          ...state,
          tabs: state.tabs.map(tab => tab.id === active.id ? { ...tab, error: classified.reason, loading: false } : tab),
        })
      }
      return
    }
    if (native) {
      await command(WAR_ROOM_BROWSER_IPC.navigate, { url: classified.url, tabId: active?.id })
      return
    }
    onState({
      ...state,
      tabs: state.tabs.map(tab => tab.id === active?.id ? { ...tab, url: classified.url, loading: true, error: null, title: classified.url } : tab),
    })
  }

  const closeTab = async (tabId: string) => {
    if (native) {
      const next = await desktopBrowserCommand(WAR_ROOM_BROWSER_IPC.closeTab, { tabId })
      if (next && next.tabs.length === 0) {
        onClose()
        return
      }
      if (next) onState({ ...next, open: next.tabs.length > 0 })
      return
    }
    const tabs = state.tabs.filter(tab => tab.id !== tabId)
    if (tabs.length === 0) {
      onClose()
      return
    }
    onState({ open: true, tabs, activeTabId: tabs[0].id })
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-stretch justify-center p-3" data-testid="war-room-browser-layer">
      <section
        role="dialog"
        aria-label="War Room Browser"
        data-testid="war-room-browser"
        data-war-room-browser="native"
        className="pointer-events-auto flex w-full max-w-[1200px] flex-col overflow-hidden rounded-2xl border border-cyan-400/35 bg-[rgba(4,10,16,0.96)] shadow-[0_24px_80px_rgba(0,0,0,0.62)]"
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-cyan-400/20 px-3 py-2">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-100">War Room Browser</p>
          <div className="flex min-w-0 flex-1 gap-1 overflow-auto" data-testid="war-room-browser-tabs">
            {state.tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`max-w-[12rem] truncate rounded-full border px-2 py-0.5 text-[10px] ${tab.id === active?.id ? 'border-emerald-400/70 text-emerald-100' : 'border-white/10 text-slate-400'}`}
                onClick={() => onState({ ...state, activeTabId: tab.id })}
              >
                {tab.title || tab.url}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-300"
            data-testid="war-room-browser-close"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
          <button type="button" data-testid="war-room-browser-back" disabled={!active?.canGoBack && native} className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-200 disabled:opacity-30" onClick={() => void command(WAR_ROOM_BROWSER_IPC.back)}>Back</button>
          <button type="button" data-testid="war-room-browser-forward" disabled={!active?.canGoForward && native} className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-200 disabled:opacity-30" onClick={() => void command(WAR_ROOM_BROWSER_IPC.forward)}>Forward</button>
          <button type="button" data-testid="war-room-browser-refresh" className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-200" onClick={() => void command(WAR_ROOM_BROWSER_IPC.reload)}>Refresh</button>
          {active ? (
            <button
              type="button"
              data-testid="war-room-browser-copy"
              className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-200"
              onClick={() => { void navigator.clipboard.writeText(active.url).catch(() => undefined) }}
            >
              Copy URL
            </button>
          ) : null}
          {active && onOpenExternally ? (
            <button
              type="button"
              data-testid="war-room-browser-open-external"
              className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-200"
              onClick={() => { void onOpenExternally(active.url) }}
            >
              Open externally
            </button>
          ) : null}
          <button type="button" data-testid="war-room-browser-stop" className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-200" onClick={() => void command(WAR_ROOM_BROWSER_IPC.stop)}>Stop</button>
          <form
            className="flex min-w-0 flex-1 gap-1"
            onSubmit={event => {
              event.preventDefault()
              void go()
            }}
          >
            <input
              value={draft}
              onChange={event => setDraft(event.target.value)}
              data-testid="war-room-browser-url"
              aria-label="Address"
              className="min-w-0 flex-1 rounded border border-cyan-400/25 bg-black/50 px-2 py-1 font-mono text-[11px] text-cyan-50 outline-none"
            />
            <button type="submit" className="rounded border border-emerald-400/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-emerald-200">Go</button>
          </form>
        </div>
        {active?.loading ? <p className="px-3 py-1 text-[10px] uppercase tracking-widest text-amber-300" data-testid="war-room-browser-loading">Loading</p> : null}
        {active?.error ? <p className="px-3 py-1 text-[10px] text-red-300" data-testid="war-room-browser-error">{active.error}</p> : null}
        <div ref={paneRef} className="relative min-h-[28rem] flex-1 bg-black" data-testid="war-room-browser-pane">
          {native ? (
            <div className="absolute inset-0" data-testid="war-room-browser-native-surface" data-browser-isolation="no-node" />
          ) : active ? (
            <iframe
              title={active.title || 'War Room Browser'}
              src={active.url}
              sandbox="allow-scripts allow-forms allow-same-origin"
              className="h-full w-full border-0 bg-white"
              data-testid="war-room-browser-iframe"
              onLoad={() => {
                onState({
                  ...state,
                  tabs: state.tabs.map(tab => tab.id === active.id ? { ...tab, loading: false, error: null } : tab),
                })
              }}
            />
          ) : (
            <p className="p-6 text-[11px] uppercase tracking-widest text-slate-500">No tab open.</p>
          )}
        </div>
        {active ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1">
            <p className="truncate font-mono text-[10px] text-slate-500" data-testid="war-room-browser-current-url">{active.url}</p>
            <p className="font-mono text-[10px] text-cyan-200" data-testid="war-room-browser-current-domain">
              {(() => { try { return new URL(active.url).hostname } catch { return '' } })()}
            </p>
          </div>
        ) : null}
        {active?.sourceContext ? (
          <aside className="border-t border-cyan-400/15 px-3 py-2 text-[10px] text-slate-300" data-testid="war-room-browser-source-context">
            <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-200">Source context</p>
            <p>Mission {active.sourceContext.mission_id ?? 'n/a'}</p>
            {active.sourceContext.claim_ids[0] ? <p>Supports claim {active.sourceContext.claim_ids[0]}</p> : null}
            {active.sourceContext.evidence_ids[0] ? <p>Evidence {active.sourceContext.evidence_ids[0]}</p> : null}
            <p>Status {active.sourceContext.verification_status ?? 'n/a'} · {active.sourceContext.source_authority} · {active.sourceContext.freshness_state}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <button type="button" data-testid="war-room-browser-back-to-mission" className="rounded border border-emerald-400/30 px-1.5 py-0.5 uppercase tracking-widest text-emerald-100" onClick={onClose}>Back to mission</button>
            </div>
          </aside>
        ) : null}
      </section>
    </div>
  )
}
