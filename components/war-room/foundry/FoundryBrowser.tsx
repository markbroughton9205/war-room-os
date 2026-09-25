'use client'

/**
 * War Room-owned browser chrome. Primary project OPEN target.
 * Electron uses an isolated WebContentsView (no Node APIs). Fallback is a sandboxed iframe
 * for loopback only — never window.open / ChatGPT / system browser.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { classifyBrowserUrl } from '@/lib/war-room-browser/urlPolicy'

type Tab = {
  id: string
  url: string
  title: string
  loading: boolean
  error: string | null
}

function desktopInvoke(channel: string, payload?: unknown): Promise<unknown> | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as unknown as { warRoomDesktop?: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> } }).warRoomDesktop
  if (!bridge) return null
  return bridge.invoke(channel, payload)
}

function paneBounds(node: HTMLDivElement | null) {
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    visible: true,
  }
}

export function FoundryBrowser({
  initialUrl,
  title,
  onClose,
}: {
  initialUrl: string
  title?: string
  onClose: () => void
}) {
  const classifiedInitial = classifyBrowserUrl(initialUrl)
  const [tabs, setTabs] = useState<Tab[]>(() => [{
    id: 'tab-1',
    url: classifiedInitial.ok ? classifiedInitial.url : initialUrl,
    title: title || initialUrl,
    loading: classifiedInitial.ok,
    error: classifiedInitial.ok ? null : classifiedInitial.reason,
  }])
  const [activeId, setActiveId] = useState('tab-1')
  const [address, setAddress] = useState(classifiedInitial.ok ? classifiedInitial.url : initialUrl)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const classified = classifyBrowserUrl(initialUrl)
    const url = classified.ok ? classified.url : initialUrl
    setTabs(current => {
      const match = current.find(tab => tab.url === url || tab.url === `${url}/` || `${tab.url}/` === url)
      if (match) {
        setActiveId(match.id)
        setAddress(match.url)
        return current
      }
      const id = `tab-${Date.now()}`
      setActiveId(id)
      setAddress(url)
      return [...current, {
        id,
        url,
        title: title || url,
        loading: classified.ok,
        error: classified.ok ? null : classified.reason,
      }]
    })
  }, [initialUrl, title])
  const paneRef = useRef<HTMLDivElement>(null)
  const electron = useMemo(() => Boolean(typeof window !== 'undefined' && (window as unknown as { warRoomDesktop?: unknown }).warRoomDesktop), [])
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]
  const activeClassified = classifyBrowserUrl(active?.url ?? '')
  const iframeAllowed = Boolean(active && !electron && activeClassified.ok && activeClassified.kind === 'local')

  useEffect(() => {
    if (!electron || !active) return
    void desktopInvoke('warRoomBrowser.open', { url: active.url, tabId: active.id })
    void desktopInvoke('warRoom.browser.open', { url: active.url })
  }, [electron, active?.id, active?.url])

  useEffect(() => {
    if (!electron) return
    return () => {
      void desktopInvoke('warRoomBrowser.hide')
      void desktopInvoke('warRoom.browser.close')
    }
  }, [electron])

  useEffect(() => {
    if (!electron) return
    const pane = paneRef.current
    const publish = () => {
      const bounds = paneBounds(pane)
      if (!bounds) return
      void desktopInvoke('warRoom.browser.setBounds', bounds)
    }
    publish()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null
    if (pane && observer) observer.observe(pane)
    window.addEventListener('resize', publish)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', publish)
      void desktopInvoke('warRoom.browser.setBounds', { x: 0, y: 0, width: 0, height: 0, visible: false })
    }
  }, [electron])

  const load = (raw: string) => {
    const classified = classifyBrowserUrl(raw)
    if (!classified.ok) {
      setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, error: classified.reason, loading: false } : tab))
      return
    }
    if (!electron && classified.kind !== 'local') {
      setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, error: 'Public pages open in the native War Room Browser surface.', loading: false } : tab))
      return
    }
    setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, url: classified.url, title: classified.url, loading: true, error: null } : tab))
    setAddress(classified.url)
    if (electron) {
      void desktopInvoke('warRoomBrowser.navigate', { url: classified.url, tabId: activeId })
      void desktopInvoke('warRoom.browser.navigate', { url: classified.url, tabId: activeId })
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-stretch justify-center bg-black/80 p-4" data-testid="war-room-browser-layer">
    <div className="foundry-glass relative z-20 flex min-h-[420px] w-full max-w-6xl flex-col rounded-lg border border-cyan-400/30" data-testid="war-room-browser" data-browser-isolation="no-node">
      <p className="px-3 pt-2 text-[9px] font-black uppercase tracking-[0.22em] text-cyan-100">War Room Browser</p>
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-2 py-1">
        <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300" data-testid="war-room-browser-back" onClick={() => { frameRef.current?.contentWindow?.history.back(); void desktopInvoke('warRoomBrowser.back'); void desktopInvoke('warRoom.browser.back') }}>Back</button>
        <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300" data-testid="war-room-browser-forward" onClick={() => { frameRef.current?.contentWindow?.history.forward(); void desktopInvoke('warRoomBrowser.forward'); void desktopInvoke('warRoom.browser.forward') }}>Forward</button>
        <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300" data-testid="war-room-browser-reload" aria-label="Reload" onClick={() => { frameRef.current?.contentWindow?.location.reload(); void desktopInvoke('warRoomBrowser.reload'); void desktopInvoke('warRoom.browser.reload') }}>Reload</button>
        <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300" data-testid="war-room-browser-stop" onClick={() => { void desktopInvoke('warRoomBrowser.stop'); void desktopInvoke('warRoom.browser.stop'); setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, loading: false } : tab)) }}>Stop</button>
        <form
          className="min-w-[12rem] flex-1"
          onSubmit={event => {
            event.preventDefault()
            load(address.trim())
          }}
        >
          <input
            value={address}
            onChange={event => setAddress(event.target.value)}
            aria-label="Address"
            data-testid="war-room-browser-address"
            className="w-full rounded border border-cyan-400/30 bg-black/50 px-2 py-1 font-mono text-[11px] text-cyan-100 outline-none"
          />
        </form>
        <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-400" data-testid="war-room-browser-close" onClick={onClose}>Close</button>
      </div>
      <div className="flex gap-1 overflow-auto border-b border-white/10 px-2 py-1" data-testid="war-room-browser-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`max-w-[12rem] truncate rounded border px-2 py-0.5 text-[10px] ${tab.id === activeId ? 'border-cyan-400/50 text-cyan-100' : 'border-white/10 text-slate-500'}`}
            onClick={() => { setActiveId(tab.id); setAddress(tab.url) }}
          >
            {tab.title}
          </button>
        ))}
        <button
          type="button"
          className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-500"
          data-testid="war-room-browser-new-tab"
          onClick={() => {
            const id = `tab-${Date.now()}`
            setTabs(current => [...current, { id, url: active?.url ?? initialUrl, title: 'New tab', loading: false, error: null }])
            setActiveId(id)
          }}
        >
          +
        </button>
        <button
          type="button"
          className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-500"
          data-testid="war-room-browser-close-tab"
          onClick={() => {
            if (tabs.length <= 1) {
              onClose()
              return
            }
            const next = tabs.filter(tab => tab.id !== activeId)
            setTabs(next)
            setActiveId(next[0]!.id)
            setAddress(next[0]!.url)
            void desktopInvoke('warRoom.browser.closeTab', { tabId: activeId })
          }}
        >
          Close tab
        </button>
      </div>
      {active?.loading ? <p className="px-3 py-1 text-[10px] uppercase tracking-widest text-cyan-300" data-testid="war-room-browser-loading">Loading</p> : null}
      {active?.error ? <p className="px-3 py-1 text-[10px] text-red-400" data-testid="war-room-browser-error">{active.error}</p> : null}
      <div ref={paneRef} className="min-h-0 flex-1 bg-black" data-testid="war-room-browser-pane">
        {electron ? (
          <div className="flex h-full min-h-[360px] items-center justify-center text-[11px] uppercase tracking-widest text-slate-500" data-testid="war-room-browser-native-surface">War Room Browser view</div>
        ) : iframeAllowed ? (
          <iframe
            ref={frameRef}
            title={active.title}
            src={active.url}
            sandbox="allow-scripts allow-forms allow-same-origin"
            className="h-full min-h-[360px] w-full border-0 bg-white"
            data-testid="war-room-browser-frame"
            onLoad={() => setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, loading: false, title: tab.url } : tab))}
          />
        ) : null}
      </div>
      {active ? <p className="truncate px-3 py-1 font-mono text-[10px] text-slate-500" data-testid="war-room-browser-current-url">{active.url}</p> : null}
    </div>
    </div>
  )
}
