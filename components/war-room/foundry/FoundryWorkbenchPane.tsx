'use client'

/**
 * W1 Foundry Workbench guest pane. Token never enters this renderer.
 * Electron main loads persist:foundry-workbench from the host URL.
 */
import { useEffect, useMemo, useRef } from 'react'

function desktopInvoke(channel: string, payload?: unknown): Promise<unknown> | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as unknown as { warRoomDesktop?: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> } }).warRoomDesktop
  if (!bridge) return null
  return bridge.invoke(channel, payload)
}

function paneBounds(node: HTMLDivElement | null, visible: boolean) {
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    visible,
  }
}

export function FoundryWorkbenchPane() {
  const paneRef = useRef<HTMLDivElement>(null)
  const guestRef = useRef<HTMLDivElement>(null)
  const electron = useMemo(
    () => Boolean(typeof window !== 'undefined' && (window as unknown as { warRoomDesktop?: unknown }).warRoomDesktop),
    [],
  )

  useEffect(() => {
    if (!electron) return
    void desktopInvoke('foundry.workbench.ensure')
    const guest = guestRef.current
    const publish = () => {
      const bounds = paneBounds(guest, true)
      if (!bounds) return
      void desktopInvoke('foundry.workbench.setBounds', bounds)
    }
    publish()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null
    if (guest && observer) observer.observe(guest)
    window.addEventListener('resize', publish)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', publish)
      void desktopInvoke('foundry.workbench.hide')
    }
  }, [electron])

  return (
    <div
      ref={paneRef}
      className="relative flex min-h-[360px] flex-1 flex-col overflow-hidden rounded border border-emerald-400/25 bg-black/40"
      data-testid="foundry-workbench-pane"
      data-workbench-isolation="no-node"
    >
      <button
        type="button"
        className="px-2 py-1 text-left text-[9px] font-bold uppercase tracking-[0.22em] text-emerald-400"
        data-testid="foundry-workbench-chrome"
        onMouseDown={() => {
          void desktopInvoke('foundry.workbench.returnFocus')
        }}
      >
        Foundry Workbench
        <span className="ml-2 text-[9px] font-normal uppercase tracking-widest text-slate-500">primary manual engineering surface</span>
      </button>
      <div ref={guestRef} className="min-h-[280px] flex-1" data-testid="foundry-workbench-guest" />
      {!electron ? (
        <p className="px-2 pb-2 text-[10px] text-slate-500">Workbench guest requires the War Room desktop host.</p>
      ) : null}
    </div>
  )
}
