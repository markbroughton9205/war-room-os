'use client'

import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { TERRA_WORKSPACE_DOCKS, TERRA_WORKSPACE_KEYBOARD_STEP_LARGE_PX, TERRA_WORKSPACE_KEYBOARD_STEP_PX, zIndexForRank, type TerraWorkspaceDock } from '@/lib/terra/workspace/layout'
import { TERRA_WORKSPACE_DOCKABLE_IDS, TERRA_WORKSPACE_PANEL_TITLE, type TerraWorkspacePanelId } from '@/lib/terra/workspace/panelIds'
import { useTerraWorkspacePanelState } from './TerraWorkspaceLayoutProvider'

export function TerraWorkspacePanel({
  id,
  title,
  children,
  sticky,
  minimizable = true,
  dockable,
  className = '',
}: {
  id: TerraWorkspacePanelId
  title?: string
  children: ReactNode
  sticky?: ReactNode
  minimizable?: boolean
  dockable?: boolean
  className?: string
}) {
  const { record, rank, dragging, attention, store, api } = useTerraWorkspacePanelState(id)
  const rootRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ pointerId: number; originX: number; originY: number; startX: number; startY: number } | null>(null)
  const label = title ?? TERRA_WORKSPACE_PANEL_TITLE[id]
  const canDock = dockable ?? TERRA_WORKSPACE_DOCKABLE_IDS.includes(id)
  const pinnedTop = id === 'workspace_control'

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const applySize = () => {
      const rect = node.getBoundingClientRect()
      const size = { width: Math.max(48, rect.width), height: Math.max(28, rect.height) }
      api.registerSize(id, size)
      if (store.getSnapshot().draggingId === id) return
      store.ensurePanel(id, api.getViewport(), size)
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (dragRef.current) {
        dragRef.current = null
        store.setDragging(null)
        api.isolateGlobe(false)
      }
    }
  }, [api, id, store])

  const sizeOf = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    return { width: Math.max(48, rect?.width ?? 320), height: Math.max(28, rect?.height ?? 120) }
  }

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    store.setDragging(null)
    api.isolateGlobe(false)
    store.persistNow()
  }

  const onHandlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (record.locked) {
      store.front(id, true)
      return
    }
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.preventDefault()
    event.stopPropagation()
    store.front(id, false)
    store.setDragging(id)
    api.isolateGlobe(true)
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startX: record.x,
      startY: record.y,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* Untrusted/synthetic pointers still move through handle listeners. */
    }
  }

  const onHandlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    store.move(
      id,
      drag.startX + (event.clientX - drag.originX),
      drag.startY + (event.clientY - drag.originY),
      api.getViewport(),
      sizeOf(),
      false,
    )
  }

  const onHandleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || record.locked) return
    const step = event.shiftKey ? TERRA_WORKSPACE_KEYBOARD_STEP_LARGE_PX : TERRA_WORKSPACE_KEYBOARD_STEP_PX
    let dx = 0
    let dy = 0
    if (event.key === 'ArrowLeft') dx = -step
    if (event.key === 'ArrowRight') dx = step
    if (event.key === 'ArrowUp') dy = -step
    if (event.key === 'ArrowDown') dy = step
    if (!dx && !dy) return
    event.preventDefault()
    store.front(id, false)
    store.move(id, record.x + dx, record.y + dy, api.getViewport(), sizeOf(), true)
  }

  return (
    <section
      ref={rootRef}
      className={`pointer-events-auto absolute left-0 top-0 max-w-[min(100%,calc(100vw-1rem))] ${className}`}
      style={{
        transform: `translate3d(${Math.round(record.x)}px, ${Math.round(record.y)}px, 0)`,
        zIndex: zIndexForRank(rank, dragging, pinnedTop),
        willChange: dragging ? 'transform' : undefined,
      }}
      data-testid={`terra-workspace-panel-${id}`}
      data-terra-panel-id={id}
      data-terra-panel-locked={record.locked ? 'true' : 'false'}
      data-terra-panel-minimized={record.minimized ? 'true' : 'false'}
      data-terra-panel-dock={record.dock}
      data-terra-panel-dragging={dragging ? 'true' : 'false'}
      onPointerDownCapture={() => store.smartClick(id, api.getViewport(), sizeOf())}
    >
      <div className="flex items-center gap-1 rounded-t-lg border border-b-0 border-white/15 bg-black/80 px-1.5 py-0.5 backdrop-blur-md">
        <button
          type="button"
          className={`min-w-0 flex-1 touch-none truncate text-left text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-100/90 ${record.locked ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          tabIndex={0}
          aria-label={`${label} panel. Drag to reposition. Alt plus arrow keys move. Shift for a larger step. Alt+Shift+R resets layout.`}
          data-testid={`terra-workspace-handle-${id}`}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onHandleKeyDown}
        >
          {label}
        </button>
        {record.minimized && attention ? (
          <span
            key={`${attention.reason}-${attention.unseenCount}`}
            className="animate-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
            style={{ animationIterationCount: 3 }}
            data-testid={`terra-workspace-attention-${id}`}
            title={`Unseen: ${attention.reason}`}
          />
        ) : null}
        {record.minimized && attention && attention.unseenCount > 1 ? (
          <span className="shrink-0 text-[8px] font-bold text-amber-300" data-testid={`terra-workspace-attention-count-${id}`}>
            {attention.unseenCount}
          </span>
        ) : null}
        {canDock ? (
          <select
            className="h-5 max-w-[4.5rem] rounded border border-white/15 bg-black/70 px-0.5 text-[8px] uppercase tracking-widest text-slate-300"
            value={record.dock}
            aria-label={`Dock ${label}`}
            data-testid={`terra-workspace-dock-${id}`}
            onChange={event => store.setDock(id, event.target.value as TerraWorkspaceDock, api.getViewport(), sizeOf())}
          >
            {TERRA_WORKSPACE_DOCKS.map(dock => (
              <option key={dock} value={dock}>{dock}</option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-widest ${record.locked ? 'border-amber-300/50 text-amber-200' : 'border-white/15 text-slate-400'}`}
          aria-pressed={record.locked}
          data-testid={`terra-workspace-lock-${id}`}
          onClick={() => store.setLocked(id, !record.locked)}
        >
          {record.locked ? 'locked' : 'lock'}
        </button>
        {minimizable ? (
          <button
            type="button"
            className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-slate-400"
            aria-pressed={record.minimized}
            data-testid={`terra-workspace-minimize-${id}`}
            onClick={() => store.setMinimized(id, !record.minimized)}
          >
            {record.minimized ? 'restore' : 'min'}
          </button>
        ) : null}
      </div>
      {sticky}
      <div className={record.minimized ? 'hidden' : undefined} aria-hidden={record.minimized || undefined}>
        {children}
      </div>
    </section>
  )
}
