'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  desktopBrowserCommand,
  desktopBrowserOpen,
  desktopBrowserSetBounds,
  isWarRoomDesktopShell,
  subscribeDesktopBrowserState,
} from '@/lib/war-room-browser/desktopBridge'
import { EMPTY_WAR_ROOM_BROWSER_STATE, WAR_ROOM_BROWSER_IPC, type WarRoomBrowserBounds, type WarRoomBrowserState, type WarRoomBrowserTab } from '@/lib/war-room-browser/types'
import { classifyBrowserUrl } from '@/lib/war-room-browser/urlPolicy'
import { WarRoomBrowser } from './WarRoomBrowser'

type BrowserApi = {
  open: boolean
  state: WarRoomBrowserState
  native: boolean
  openUrl: (url: string, sourceContext?: WarRoomBrowserTab['sourceContext']) => Promise<void>
  openExternally: (url: string) => Promise<void>
  close: () => void
}

const BrowserContext = createContext<BrowserApi | null>(null)

function newTab(url: string, sourceContext?: WarRoomBrowserTab['sourceContext']): WarRoomBrowserTab {
  return {
    id: `web-${Date.now().toString(36)}`,
    title: url,
    url,
    loading: true,
    error: null,
    canGoBack: false,
    canGoForward: false,
    sourceContext: sourceContext ?? null,
  }
}

export function WarRoomBrowserProvider({ children }: { children: ReactNode }) {
  const native = isWarRoomDesktopShell()
  const [state, setState] = useState<WarRoomBrowserState>(EMPTY_WAR_ROOM_BROWSER_STATE)

  useEffect(() => {
    if (!native) return
    return subscribeDesktopBrowserState(next => setState(next))
  }, [native])

  const openUrl = useCallback(async (raw: string, sourceContext?: WarRoomBrowserTab['sourceContext']) => {
    const classified = classifyBrowserUrl(raw)
    if (!classified.ok) return
    if (native) {
      const next = await desktopBrowserOpen(classified.url)
      if (next) {
        setState({
          ...next,
          open: true,
          tabs: next.tabs.map((tab, index) => index === next.tabs.length - 1 || tab.id === next.activeTabId
            ? { ...tab, sourceContext: sourceContext ?? tab.sourceContext ?? null }
            : tab),
        })
      }
      return
    }
    setState(prev => {
      const existing = prev.tabs.find(tab => tab.url === classified.url)
      const tab = existing
        ? { ...existing, sourceContext: sourceContext ?? existing.sourceContext ?? null }
        : newTab(classified.url, sourceContext)
      const tabs = existing ? prev.tabs.map(item => item.id === tab.id ? tab : item) : [...prev.tabs, tab]
      return { open: true, activeTabId: tab.id, tabs }
    })
  }, [native])

  const openExternally = useCallback(async (raw: string) => {
    const classified = classifyBrowserUrl(raw)
    if (!classified.ok) return
    const bridge = typeof window !== 'undefined'
      ? (window as Window & { warRoomDesktop?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } }).warRoomDesktop
      : null
    if (bridge) {
      await bridge.invoke('sovereign.openExternalSafe', classified.url)
      return
    }
    window.open(classified.url, '_blank', 'noopener,noreferrer')
  }, [])

  const close = useCallback(() => {
    if (native) {
      void desktopBrowserCommand(WAR_ROOM_BROWSER_IPC.close)
    }
    setState(EMPTY_WAR_ROOM_BROWSER_STATE)
  }, [native])

  const setBounds = useCallback((bounds: WarRoomBrowserBounds) => {
    if (native) void desktopBrowserSetBounds(bounds)
  }, [native])

  const api = useMemo<BrowserApi>(() => ({
    open: state.open,
    state,
    native,
    openUrl,
    openExternally,
    close,
  }), [close, native, openUrl, openExternally, state])

  return (
    <BrowserContext.Provider value={api}>
      {children}
      {state.open ? (
        <WarRoomBrowser
          state={state}
          native={native}
          onState={setState}
          onClose={close}
          onBounds={setBounds}
          onOpenUrl={openUrl}
          onOpenExternally={openExternally}
        />
      ) : null}
    </BrowserContext.Provider>
  )
}

export function useWarRoomBrowser(): BrowserApi {
  const ctx = useContext(BrowserContext)
  if (!ctx) {
    return {
      open: false,
      state: EMPTY_WAR_ROOM_BROWSER_STATE,
      native: false,
      openUrl: async () => undefined,
      openExternally: async () => undefined,
      close: () => undefined,
    }
  }
  return ctx
}
