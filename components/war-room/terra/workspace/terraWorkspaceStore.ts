import {
  bringToFront,
  clampPanelPosition,
  computeSmartOrganizeLayout,
  dockedPosition,
  parseWorkspaceLayout,
  reconcilePanelPosition,
  recoverPanelPosition,
  TERRA_WORKSPACE_DEFAULT_SETTINGS,
  TERRA_WORKSPACE_LAYOUT_KEY,
  type TerraWorkspaceDock,
  type TerraWorkspaceLayoutV1,
  type TerraWorkspacePanelRecord,
  type TerraWorkspacePreset,
  type TerraWorkspaceSettings,
} from '@/lib/terra/workspace/layout'
import {
  defaultPanelDock,
  defaultPanelPosition,
  TERRA_GLOBE_FOCUS_MINIMIZE,
  TERRA_INTEL_FOCUS_MINIMIZE,
  TERRA_SMART_CLICK_ROUTES,
  TERRA_WORKSPACE_FLOATING_MINIMIZE_IDS,
  TERRA_WORKSPACE_PANEL_IDS,
  type TerraSmartClickInteractionKind,
  type TerraWorkspacePanelId,
} from '@/lib/terra/workspace/panelIds'

export type WorkspaceViewport = { width: number; height: number }
export type WorkspacePanelSize = { width: number; height: number }

/** Session-only — never written to localStorage (persistNow only serializes panels/zOrder). An
 * "unseen since last opened" signal is inherently transient, not part of the saved layout. */
export type TerraWorkspaceAttentionState = {
  reason: string
  unseenCount: number
  pulseUntil: number
}

export type TerraWorkspaceSnapshot = {
  panels: Partial<Record<TerraWorkspacePanelId, TerraWorkspacePanelRecord>>
  zOrder: TerraWorkspacePanelId[]
  draggingId: TerraWorkspacePanelId | null
  settings: TerraWorkspaceSettings
  attention: Partial<Record<TerraWorkspacePanelId, TerraWorkspaceAttentionState>>
}

const EMPTY: TerraWorkspaceSnapshot = {
  panels: {},
  zOrder: [],
  draggingId: null,
  settings: TERRA_WORKSPACE_DEFAULT_SETTINGS,
  attention: {},
}

/** How long a freshly-flagged panel keeps its brief pulse before settling into the static
 * highlighted state (mission: "2-3 short cycles, then remain static," never continuous). */
const ATTENTION_PULSE_MS = 2400

function cloneSnapshot(snapshot: TerraWorkspaceSnapshot): TerraWorkspaceSnapshot {
  return {
    panels: { ...snapshot.panels },
    zOrder: snapshot.zOrder.slice(),
    draggingId: snapshot.draggingId,
    settings: { ...snapshot.settings },
    attention: { ...snapshot.attention },
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
      settings: { ...TERRA_WORKSPACE_DEFAULT_SETTINGS, ...parsed.settings },
      attention: {},
    }
    this.reconcile(viewport, {})
  }

  reset(viewport: WorkspaceViewport, sizes: Partial<Record<TerraWorkspacePanelId, WorkspacePanelSize>> = {}): void {
    const panels: TerraWorkspaceSnapshot['panels'] = {}
    for (const id of TERRA_WORKSPACE_PANEL_IDS) {
      panels[id] = defaultRecord(id, viewport, sizes[id])
    }
    this.snapshot = { ...this.snapshot, panels, zOrder: ['workspace_control'], draggingId: null }
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
    // Restoring is the Commander explicitly looking at it now — clear any pending attention.
    // (Mission: "clear attention when Commander restores panel," never merely on a rerender.)
    if (!minimized && this.snapshot.attention[id]) this.clearAttention(id)
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

  /** WORKSPACE → SMART ORGANIZE. Reflows the currently-visible HUD/control panels into the
   * command-center layout (see computeSmartOrganizeLayout); leaves minimized panels and large
   * contextual viewers untouched. Deliberately does not persist — it previews an arrangement.
   * Only an explicit Save (persistNow) commits it, so Reset/Save semantics stay distinct from
   * Smart Organize and a reload without Save returns the last-saved Commander layout. */
  smartOrganize(viewport: WorkspaceViewport, sizes: Partial<Record<TerraWorkspacePanelId, WorkspacePanelSize>>): void {
    const placements = computeSmartOrganizeLayout({
      panels: this.snapshot.panels,
      sizes,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    })
    if (placements.length === 0) return
    const panels = { ...this.snapshot.panels }
    for (const placement of placements) {
      const current = panels[placement.id]
      if (!current) continue
      panels[placement.id] = { ...current, x: placement.x, y: placement.y, dock: placement.dock, vw: viewport.width, vh: viewport.height }
    }
    this.snapshot = { ...this.snapshot, panels }
    this.emit()
  }

  setSmartClickEnabled(enabled: boolean): void {
    if (this.snapshot.settings.smartClick === enabled) return
    this.snapshot = { ...this.snapshot, settings: { ...this.snapshot.settings, smartClick: enabled } }
    this.emit()
    this.persistNow()
  }

  setSmartOpenEnabled(enabled: boolean): void {
    if (this.snapshot.settings.smartOpen === enabled) return
    this.snapshot = { ...this.snapshot, settings: { ...this.snapshot.settings, smartOpen: enabled } }
    this.emit()
    this.persistNow()
  }

  clearAttention(id: TerraWorkspacePanelId): void {
    if (!this.snapshot.attention[id]) return
    const attention = { ...this.snapshot.attention }
    delete attention[id]
    this.snapshot = { ...this.snapshot, attention }
    this.emit()
  }

  /** Marks a minimized panel as having unseen relevant context: a brief pulse, then a static
   * highlighted state until the Commander restores it or dismisses it explicitly. Never clears
   * on its own from a rerender, never auto-restores (that's Smart Open's job, separately). */
  private markAttention(id: TerraWorkspacePanelId, reason: string): void {
    const existing = this.snapshot.attention[id]
    const attention = {
      ...this.snapshot.attention,
      [id]: {
        reason,
        unseenCount: (existing?.unseenCount ?? 0) + 1,
        pulseUntil: Date.now() + ATTENTION_PULSE_MS,
      },
    }
    this.snapshot = { ...this.snapshot, attention }
    this.emit()
  }

  /** Smart Click's per-panel-click behavior: always brings the panel to front (so it renders on
   * top of whatever previously covered it — ordinary sibling overlap needs nothing more than
   * that), then, only for unlocked float panels, recovers it fully on-screen and clear of the
   * pinned WORKSPACE control's corner. Locked panels and docked panels are fronted and left
   * exactly where they are — Commander placement and dock membership are never overridden. */
  smartClick(id: TerraWorkspacePanelId, viewport: WorkspaceViewport, size: WorkspacePanelSize): void {
    this.front(id, true)
    if (!this.snapshot.settings.smartClick) return
    const current = this.snapshot.panels[id]
    if (!current || current.locked || current.dock !== 'float') return
    const recovered = recoverPanelPosition({
      x: current.x,
      y: current.y,
      panelWidth: size.width,
      panelHeight: size.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      avoidPinnedControl: id !== 'workspace_control',
    })
    if (recovered.x !== current.x || recovered.y !== current.y) {
      this.patchPanel(id, { ...current, x: recovered.x, y: recovered.y }, true)
    }
  }

  /** The one deterministic Smart Click interaction router (mission section 6/11): a real Terra
   * interaction (camera/weather/building/...) resolves to exactly one primary panel and zero or
   * more secondary panels. An open primary panel is smart-clicked to front; a minimized primary
   * panel gets an attention pulse — or, if Smart Open is enabled, is restored and fronted
   * instead. Secondary panels only ever receive attention when minimized; they never open on
   * their own, so one interaction never explodes into several open panels. */
  notifyInteraction(kind: TerraSmartClickInteractionKind, viewport: WorkspaceViewport, sizes: Partial<Record<TerraWorkspacePanelId, WorkspacePanelSize>>): void {
    const route = TERRA_SMART_CLICK_ROUTES[kind]
    const primary = this.snapshot.panels[route.primary]
    if (primary) {
      if (primary.minimized) {
        if (this.snapshot.settings.smartOpen) {
          this.setMinimized(route.primary, false)
          this.front(route.primary, true)
        } else {
          this.markAttention(route.primary, kind)
        }
      } else {
        this.smartClick(route.primary, viewport, sizes[route.primary] ?? { width: 320, height: 200 })
      }
    }
    for (const secondaryId of route.secondary) {
      const secondary = this.snapshot.panels[secondaryId]
      if (secondary?.minimized) this.markAttention(secondaryId, kind)
    }
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
      settings: this.snapshot.settings,
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
