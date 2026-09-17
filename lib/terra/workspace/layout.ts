import type { TerraWorkspacePanelId } from './panelIds'

export const TERRA_WORKSPACE_LAYOUT_KEY = 'terra-workspace-layout:v1'
export const TERRA_WORKSPACE_Z_BASE = 50
export const TERRA_WORKSPACE_Z_SPAN = 20
export const TERRA_WORKSPACE_HANDLE_MIN_PX = 48
export const TERRA_WORKSPACE_MARGIN_PX = 8
export const TERRA_WORKSPACE_KEYBOARD_STEP_PX = 8
export const TERRA_WORKSPACE_KEYBOARD_STEP_LARGE_PX = 32
export const TERRA_WORKSPACE_CONTROL_Z = 78

export const TERRA_WORKSPACE_DOCKS = ['float', 'left', 'right', 'top', 'bottom'] as const
export type TerraWorkspaceDock = (typeof TERRA_WORKSPACE_DOCKS)[number]
export type TerraWorkspacePreset = 'default' | 'globe_focus' | 'intel_focus'

export type TerraWorkspacePanelRecord = {
  x: number
  y: number
  vw: number
  vh: number
  locked: boolean
  minimized: boolean
  dock: TerraWorkspaceDock
}

export type TerraWorkspaceLayoutV1 = {
  version: 1
  panels: Partial<Record<TerraWorkspacePanelId, TerraWorkspacePanelRecord>>
  zOrder: TerraWorkspacePanelId[]
}

export function isWorkspaceDock(value: unknown): value is TerraWorkspaceDock {
  return typeof value === 'string' && (TERRA_WORKSPACE_DOCKS as readonly string[]).includes(value)
}

export function clampPanelPosition(input: {
  x: number
  y: number
  panelWidth: number
  panelHeight: number
  viewportWidth: number
  viewportHeight: number
}): { x: number; y: number } {
  const margin = TERRA_WORKSPACE_MARGIN_PX
  const minVisible = TERRA_WORKSPACE_HANDLE_MIN_PX
  const maxX = Math.max(margin, input.viewportWidth - minVisible)
  const maxY = Math.max(margin, input.viewportHeight - minVisible)
  const minX = Math.min(margin, input.viewportWidth - Math.min(input.panelWidth, minVisible))
  const minY = margin
  return {
    x: Math.min(maxX, Math.max(minX, input.x)),
    y: Math.min(maxY, Math.max(minY, input.y)),
  }
}

export function dockedPosition(input: {
  dock: TerraWorkspaceDock
  panelWidth: number
  panelHeight: number
  viewportWidth: number
  viewportHeight: number
  x?: number
  y?: number
}): { x: number; y: number } {
  const { dock, panelWidth, panelHeight, viewportWidth, viewportHeight } = input
  const centerX = Math.max(8, (viewportWidth - panelWidth) / 2)
  const raw = dock === 'left'
    ? { x: 8, y: input.y ?? 8 }
    : dock === 'right'
      ? { x: Math.max(8, viewportWidth - panelWidth - 8), y: input.y ?? 8 }
      : dock === 'top'
        ? { x: centerX, y: 8 }
        : dock === 'bottom'
          ? { x: centerX, y: Math.max(8, viewportHeight - panelHeight - 8) }
          : { x: input.x ?? 8, y: input.y ?? 8 }
  return clampPanelPosition({
    x: raw.x,
    y: raw.y,
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
  })
}

/** Replay a saved layout onto a new viewport. Scale by saved size, then clamp. Docked panels re-snap. */
export function reconcilePanelPosition(input: {
  record: TerraWorkspacePanelRecord
  panelWidth: number
  panelHeight: number
  viewportWidth: number
  viewportHeight: number
}): { x: number; y: number } {
  if (input.record.dock && input.record.dock !== 'float') {
    return dockedPosition({
      dock: input.record.dock,
      panelWidth: input.panelWidth,
      panelHeight: input.panelHeight,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      x: input.record.x,
      y: input.record.y,
    })
  }
  const scaleX = input.record.vw > 0 ? input.viewportWidth / input.record.vw : 1
  const scaleY = input.record.vh > 0 ? input.viewportHeight / input.record.vh : 1
  return clampPanelPosition({
    x: input.record.x * scaleX,
    y: input.record.y * scaleY,
    panelWidth: input.panelWidth,
    panelHeight: input.panelHeight,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
  })
}

export function zIndexForRank(rank: number, dragging: boolean, pinnedTop = false): number {
  if (pinnedTop) return TERRA_WORKSPACE_CONTROL_Z
  const bounded = Math.max(0, Math.min(TERRA_WORKSPACE_Z_SPAN - 1, rank))
  return TERRA_WORKSPACE_Z_BASE + bounded + (dragging ? 1 : 0)
}

export function bringToFront(order: TerraWorkspacePanelId[], id: TerraWorkspacePanelId): TerraWorkspacePanelId[] {
  const next = order.filter(item => item !== id)
  next.push(id)
  return next
}

export function normalizePanelRecord(raw: Partial<TerraWorkspacePanelRecord> | undefined): TerraWorkspacePanelRecord | null {
  if (!raw || typeof raw.x !== 'number' || typeof raw.y !== 'number') return null
  return {
    x: raw.x,
    y: raw.y,
    vw: typeof raw.vw === 'number' && raw.vw > 0 ? raw.vw : 1920,
    vh: typeof raw.vh === 'number' && raw.vh > 0 ? raw.vh : 1080,
    locked: Boolean(raw.locked),
    minimized: Boolean(raw.minimized),
    dock: isWorkspaceDock(raw.dock) ? raw.dock : 'float',
  }
}

export function parseWorkspaceLayout(raw: string | null): TerraWorkspaceLayoutV1 | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as TerraWorkspaceLayoutV1
    if (parsed?.version !== 1 || typeof parsed.panels !== 'object' || parsed.panels == null) return null
    const panels: TerraWorkspaceLayoutV1['panels'] = {}
    for (const [id, record] of Object.entries(parsed.panels)) {
      const normalized = normalizePanelRecord(record)
      if (normalized) panels[id as TerraWorkspacePanelId] = normalized
    }
    return {
      version: 1,
      panels,
      zOrder: Array.isArray(parsed.zOrder) ? parsed.zOrder : [],
    }
  } catch {
    return null
  }
}
