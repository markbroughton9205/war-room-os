import {
  bringToFront,
  clampPanelPosition,
  dockedPosition,
  parseWorkspaceLayout,
  reconcilePanelPosition,
  TERRA_WORKSPACE_LAYOUT_KEY,
  type TerraWorkspaceDock,
  type TerraWorkspaceLayoutV1,
  type TerraWorkspacePanelRecord,
  type TerraWorkspacePreset,
} from '@/lib/terra/workspace/layout'
import {
  defaultPanelDock,
  defaultPanelPosition,
  TERRA_GLOBE_FOCUS_MINIMIZE,
  TERRA_INTEL_FOCUS_MINIMIZE,
  TERRA_WORKSPACE_FLOATING_MINIMIZE_IDS,
  TERRA_WORKSPACE_PANEL_IDS,
  type TerraWorkspacePanelId,
} from '@/lib/terra/workspace/panelIds'

export type WorkspaceViewport = { width: number; height: number }
export type WorkspacePanelSize = { width: number; height: number }

export type TerraWorkspaceSnapshot = {
  panels: Partial<Record<TerraWorkspacePanelId, TerraWorkspacePanelRecord>>
  zOrder: TerraWorkspacePanelId[]
  draggingId: TerraWorkspacePanelId | null
}

const EMPTY: TerraWorkspaceSnapshot = { panels: {}, zOrder: [], draggingId: null }

function cloneSnapshot(snapshot: TerraWorkspaceSnapshot): TerraWorkspaceSnapshot {
  return {
    panels: { ...snapshot.panels },
    zOrder: snapshot.zOrder.slice(),
    draggingId: snapshot.draggingId,
  }
}

function defaultRecord(id: TerraWorkspacePanelId, viewport: WorkspaceViewport, size?: WorkspacePanelSize): TerraWorkspacePanelRecord {
  const dock = defaultPanelDock(id)
  const fallback = defaultPanelPosition(id, viewport.width, viewport.height)
  const panelWidth = size?.width ?? 320
  const panelHeight = size?.height ?? 120
  const positioned = dock === 'float'
    ? clampPanelPosition({
      x: fallback.x,
      y: fallback.y,
      panelWidth,
      panelHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    })
    : dockedPosition({
      dock,
      panelWidth,
      panelHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      x: fallback.x,
      y: fallback.y,
    })
  return {
    ...positioned,
    vw: viewport.width,
    vh: viewport.height,
    locked: false,
    minimized: false,
    dock,
  }
}

export class TerraWorkspaceLayoutStore {
  private snapshot: TerraWorkspaceSnapshot = EMPTY
  private listeners = new Set<() => void>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): TerraWorkspaceSnapshot => this.snapshot

  hydrateFromStorage(viewport: WorkspaceViewport): void {
    if (typeof window === 'undefined') return
    const parsed = parseWorkspaceLayout(window.localStorage.getItem(TERRA_WORKSPACE_LAYOUT_KEY))
    if (!parsed) return
    this.snapshot = {
      panels: parsed.panels,
      zOrder: parsed.zOrder.filter((id): id is TerraWorkspacePanelId => (TERRA_WORKSPACE_PANEL_IDS as readonly string[]).includes(id)),
      draggingId: null,
    }
    this.reconcile(viewport, {})
  }

  reset(viewport: WorkspaceViewport, sizes: Partial<Record<TerraWorkspacePanelId, WorkspacePanelSize>> = {}): void {
    const panels: TerraWorkspaceSnapshot['panels'] = {}
    for (const id of TERRA_WORKSPACE_PANEL_IDS) {
      panels[id] = defaultRecord(id, viewport, sizes[id])
    }
    this.snapshot = { panels, zOrder: ['workspace_control'], draggingId: null }
    this.emit()
    this.persistNow()
  }

  applyPreset(preset: TerraWorkspacePreset, viewport: WorkspaceViewport, sizes: Partial<Record<TerraWorkspacePanelId, WorkspacePanelSize>>): void {
    this.reset(viewport, sizes)
    if (preset === 'globe_focus') {
      for (const id of TERRA_GLOBE_FOCUS_MINIMIZE) this.setMinimized(id, true)
      this.setDock('timeline', 'bottom', viewport, sizes.timeline ?? { width: 640, height: 96 }, false)
      this.setMinimized('search_command', false)
      this.setMinimized('workspace_control', false)
      this.setMinimized('timeline', false)
    }
    if (preset === 'intel_focus') {
      for (const id of TERRA_INTEL_FOCUS_MINIMIZE) this.setMinimized(id, true)
      this.setDock('live_intel', 'right', viewport, sizes.live_intel ?? { width: 320, height: 360 }, false)
      this.setMinimized('live_intel', false)
      this.setDock('nearby_cameras', 'left', viewport, sizes.nearby_cameras ?? { width: 320, height: 200 }, false)
      this.setMinimized('search_command', false)
      this.setMinimized('workspace_control', false)
    }
    this.persistNow()
  }

  ensurePanel(id: TerraWorkspacePanelId, viewport: WorkspaceViewport, size: WorkspacePanelSize): TerraWorkspacePanelRecord {
    const existing = this.snapshot.panels[id]
    if (existing) {
      const nextPos = reconcilePanelPosition({
        record: existing,
        panelWidth: size.width,
        panelHeight: size.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      })
      if (nextPos.x !== existing.x || nextPos.y !== existing.y || existing.vw !== viewport.width || existing.vh !== viewport.height) {
        this.patchPanel(id, { ...existing, ...nextPos, vw: viewport.width, vh: viewport.height }, false)
      }
      return this.snapshot.panels[id] ?? existing
    }
    const record = defaultRecord(id, viewport, size)
    this.patchPanel(id, record, true)
    this.front(id, false)
    return record
  }

  setDragging(id: TerraWorkspacePanelId | null): void {
    if (this.snapshot.draggingId === id) return
    this.snapshot = { ...this.snapshot, draggingId: id }
    this.emit()
  }

  move(id: TerraWorkspacePanelId, x: number, y: number, viewport: WorkspaceViewport, size: WorkspacePanelSize, persist: boolean): void {
    const current = this.snapshot.panels[id]
    if (current?.locked) return
    const next = clampPanelPosition({
      x,
      y,
      panelWidth: size.width,
      panelHeight: size.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    })
    this.patchPanel(id, {
      x: next.x,
      y: next.y,
      vw: viewport.width,
      vh: viewport.height,
      locked: current?.locked ?? false,
      minimized: current?.minimized ?? false,
      dock: 'float',
    }, persist)
  }

  setDock(id: TerraWorkspacePanelId, dock: TerraWorkspaceDock, viewport: WorkspaceViewport, size: WorkspacePanelSize, persist = true): void {
    const current = this.snapshot.panels[id] ?? defaultRecord(id, viewport, size)
    const next = dock === 'float'
      ? { x: current.x, y: current.y }
      : dockedPosition({
        dock,
        panelWidth: size.width,
        panelHeight: size.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        x: current.x,
        y: current.y,
      })
    this.patchPanel(id, {
      ...current,
      ...next,
      dock,
      vw: viewport.width,
      vh: viewport.height,
    }, persist)
  }

  setLocked(id: TerraWorkspacePanelId, locked: boolean): void {
    const current = this.snapshot.panels[id]
    if (!current || current.locked === locked) return
    this.patchPanel(id, { ...current, locked }, true)
  }

  setMinimized(id: TerraWorkspacePanelId, minimized: boolean): void {
    const current = this.snapshot.panels[id]
    if (!current) return
    if (current.minimized === minimized) return
    this.patchPanel(id, { ...current, minimized }, true)
  }

  lockAll(locked: boolean): void {
    const panels = { ...this.snapshot.panels }
    for (const id of TERRA_WORKSPACE_PANEL_IDS) {
      const current = panels[id]
      if (!current || id === 'workspace_control') continue
      panels[id] = { ...current, locked }
    }
    this.snapshot = { ...this.snapshot, panels }
    this.emit()
    this.persistNow()
  }

  minimizeFloating(minimized: boolean): void {
    const panels = { ...this.snapshot.panels }
    for (const id of TERRA_WORKSPACE_FLOATING_MINIMIZE_IDS) {
      const current = panels[id]
      if (!current) continue
      if (minimized && current.dock !== 'float' && id !== 'left_rail') continue
      panels[id] = { ...current, minimized }
    }
    this.snapshot = { ...this.snapshot, panels }
    this.emit()
    this.persistNow()
  }

  restoreAll(): void {
    const panels = { ...this.snapshot.panels }
    for (const id of TERRA_WORKSPACE_PANEL_IDS) {
      const current = panels[id]
      if (!current) continue
      panels[id] = { ...current, minimized: false }
    }
    this.snapshot = { ...this.snapshot, panels }
    this.emit()
    this.persistNow()
  }

  front(id: TerraWorkspacePanelId, persist: boolean): void {
    const zOrder = bringToFront(this.snapshot.zOrder, id)
    if (zOrder.length === this.snapshot.zOrder.length && zOrder.every((item, index) => item === this.snapshot.zOrder[index])) return
    this.snapshot = { ...this.snapshot, zOrder }
    this.emit()
    if (persist) this.persistSoon()
  }

  reconcile(viewport: WorkspaceViewport, sizes: Partial<Record<TerraWorkspacePanelId, WorkspacePanelSize>>): void {
    let changed = false
    const panels: TerraWorkspaceSnapshot['panels'] = { ...this.snapshot.panels }
    for (const id of Object.keys(panels) as TerraWorkspacePanelId[]) {
      const record = panels[id]
      if (!record) continue
      const size = sizes[id] ?? { width: 320, height: 200 }
      const next = reconcilePanelPosition({
        record,
        panelWidth: size.width,
        panelHeight: size.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      })
      if (next.x !== record.x || next.y !== record.y || record.vw !== viewport.width || record.vh !== viewport.height) {
        panels[id] = { ...record, ...next, vw: viewport.width, vh: viewport.height }
        changed = true
      }
    }
    if (!changed) return
    this.snapshot = { ...this.snapshot, panels }
    this.emit()
    this.persistSoon()
  }

  rank(id: TerraWorkspacePanelId): number {
    const index = this.snapshot.zOrder.indexOf(id)
    return index < 0 ? this.snapshot.zOrder.length : index
  }

  private patchPanel(id: TerraWorkspacePanelId, record: TerraWorkspacePanelRecord, persist: boolean): void {
    this.snapshot = {
      ...this.snapshot,
      panels: { ...this.snapshot.panels, [id]: record },
    }
    this.emit()
    if (persist) this.persistSoon()
  }

  private persistSoon(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => this.persistNow(), 16)
  }

  persistNow(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (typeof window === 'undefined') return
    const payload: TerraWorkspaceLayoutV1 = {
      version: 1,
      panels: this.snapshot.panels,
      zOrder: this.snapshot.zOrder,
    }
    try {
      window.localStorage.setItem(TERRA_WORKSPACE_LAYOUT_KEY, JSON.stringify(payload))
    } catch {
      /* Quota or private-mode — layout still works in-session. */
    }
  }

  private emit(): void {
    this.snapshot = cloneSnapshot(this.snapshot)
    for (const listener of this.listeners) listener()
  }
}
