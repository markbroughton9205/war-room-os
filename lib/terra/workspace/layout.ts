import type { TerraWorkspacePanelId } from './panelIds'

export type TerraSmartOrganizePlacement = { id: TerraWorkspacePanelId; x: number; y: number; dock: 'float' }

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

export const TERRA_MEDIA_PLAYER_CHROMES = ['full', 'compact'] as const
export type TerraMediaPlayerChrome = (typeof TERRA_MEDIA_PLAYER_CHROMES)[number]

export type TerraWorkspacePanelRecord = {
  x: number
  y: number
  vw: number
  vh: number
  locked: boolean
  minimized: boolean
  dock: TerraWorkspaceDock
  /** Closed panels are unregistered from view but remain in the persisted layout.
   * Distinct from minimized (title bar still visible). Rail launchers reopen them. */
  closed?: boolean
  /** terra_media only: same panel, compact vs full chrome. Independent of PLAYING/PAUSED. */
  playerChrome?: TerraMediaPlayerChrome
}

export type TerraWorkspaceSettings = {
  smartClick: boolean
  smartOpen: boolean
  /** Mission-control chrome hosts panels in drawers. false restores classic floating panels. */
  missionControlChrome: boolean
}

export const TERRA_WORKSPACE_DEFAULT_SETTINGS: TerraWorkspaceSettings = {
  smartClick: true,
  smartOpen: false,
  missionControlChrome: true,
}

export type TerraWorkspaceLayoutV1 = {
  version: 1
  panels: Partial<Record<TerraWorkspacePanelId, TerraWorkspacePanelRecord>>
  zOrder: TerraWorkspacePanelId[]
  settings?: Partial<TerraWorkspaceSettings>
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

/** Smart Click's "shift only enough to expose useful content" recovery. Bringing a panel to
 * front already resolves ordinary sibling-panel overlap (the panel now renders on top of
 * whatever used to cover it), so the only real occlusion risk left is the pinned WORKSPACE
 * control (always top-most at TERRA_WORKSPACE_CONTROL_Z, fixed near the top-left corner) and
 * the panel being fully or partially off-screen. This clamps on-screen and, for float panels
 * other than the control itself, nudges clear of the control's corner if they'd overlap it. */
export function recoverPanelPosition(input: {
  x: number
  y: number
  panelWidth: number
  panelHeight: number
  viewportWidth: number
  viewportHeight: number
  avoidPinnedControl: boolean
}): { x: number; y: number } {
  const clamped = clampPanelPosition(input)
  if (!input.avoidPinnedControl) return clamped
  const controlZoneWidth = 228
  const controlZoneHeight = 160
  const overlapsControl = clamped.x < controlZoneWidth && clamped.y < controlZoneHeight
  if (!overlapsControl) return clamped
  return clampPanelPosition({
    ...input,
    x: clamped.x,
    y: controlZoneHeight,
  })
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
    closed: Boolean(raw.closed),
    playerChrome: raw.playerChrome === 'compact' ? 'compact' : raw.playerChrome === 'full' ? 'full' : undefined,
  }
}

export function panelIsHidden(record: TerraWorkspacePanelRecord | undefined): boolean {
  return !record || record.minimized || Boolean(record.closed)
}

/** Reflowed by Smart Organize; every other panel (large viewers, the pinned workspace control)
 * keeps whatever position it already has — Smart Organize arranges the HUD/control chrome
 * around the globe, it does not relocate contextual viewers the Commander just opened. */
const SMART_ORGANIZE_TOP_IDS: readonly TerraWorkspacePanelId[] = ['search_command', 'globe_status', 'hazard_counters']
const SMART_ORGANIZE_LEFT_IDS: readonly TerraWorkspacePanelId[] = ['left_rail', 'nearby_cameras', 'camera_directory']
const SMART_ORGANIZE_RIGHT_IDS: readonly TerraWorkspacePanelId[] = ['live_intel', 'terra_media', 'gods_eye_controls', 'camera_discovery', 'area_live_controls', 'location_gps', 'weather_drawer', 'weather_toast']
const SMART_ORGANIZE_BOTTOM_IDS: readonly TerraWorkspacePanelId[] = ['timeline', 'radar']

export function smartOrganizeRectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function resolveSmartOrganizeOverlaps(input: {
  placements: TerraSmartOrganizePlacement[]
  sizes: Partial<Record<TerraWorkspacePanelId, { width: number; height: number }>>
  viewportWidth: number
  viewportHeight: number
}): TerraSmartOrganizePlacement[] {
  const margin = TERRA_WORKSPACE_MARGIN_PX
  const sizeOf = (id: TerraWorkspacePanelId) => input.sizes[id] ?? { width: 280, height: 96 }
  const next = input.placements.map(row => ({ ...row }))
  const rectOf = (row: TerraSmartOrganizePlacement) => {
    const size = sizeOf(row.id)
    return { x: row.x, y: row.y, width: size.width, height: size.height }
  }
  let moved = true
  let guard = 0
  while (moved && guard < 24) {
    moved = false
    guard += 1
    for (let i = 0; i < next.length; i += 1) {
      for (let j = i + 1; j < next.length; j += 1) {
        const left = next[i]!
        const right = next[j]!
        const a = rectOf(left)
        const b = rectOf(right)
        if (!smartOrganizeRectsOverlap(a, b)) continue
        const aLeftBand = a.x + a.width / 2 < input.viewportWidth / 2
        const bLeftBand = b.x + b.width / 2 < input.viewportWidth / 2
        if (aLeftBand && !bLeftBand) {
          const placed = clampPanelPosition({
            x: a.x + a.width + margin,
            y: b.y,
            panelWidth: b.width,
            panelHeight: b.height,
            viewportWidth: input.viewportWidth,
            viewportHeight: input.viewportHeight,
          })
          right.x = placed.x
          right.y = placed.y
        } else if (!aLeftBand && bLeftBand) {
          const placed = clampPanelPosition({
            x: b.x + b.width + margin,
            y: a.y,
            panelWidth: a.width,
            panelHeight: a.height,
            viewportWidth: input.viewportWidth,
            viewportHeight: input.viewportHeight,
          })
          left.x = placed.x
          left.y = placed.y
        } else if (a.y <= b.y) {
          const placed = clampPanelPosition({
            x: b.x,
            y: a.y + a.height + margin,
            panelWidth: b.width,
            panelHeight: b.height,
            viewportWidth: input.viewportWidth,
            viewportHeight: input.viewportHeight,
          })
          right.x = placed.x
          right.y = placed.y
        } else {
          const placed = clampPanelPosition({
            x: a.x,
            y: b.y + b.height + margin,
            panelWidth: a.width,
            panelHeight: a.height,
            viewportWidth: input.viewportWidth,
            viewportHeight: input.viewportHeight,
          })
          left.x = placed.x
          left.y = placed.y
        }
        moved = true
      }
    }
  }
  return next
}

/** Pure layout heuristic for the WORKSPACE → SMART ORGANIZE action. Packs the currently-visible
 * (non-minimized) HUD/control panels into top/left/right/bottom bands sized from each panel's
 * actual measured dimensions (never assumed fixed sizes), leaving the center of the viewport —
 * the globe's focal area — clear, and clamps every result on-screen via clampPanelPosition so
 * nothing is ever placed off-screen. A final overlap pass separates any remaining AABB collisions
 * (for example a left-docked Terra Media sitting on Nearby Cameras) without hardcoded pair offsets.
 * Does not decide persistence — callers choose whether/when to save the result. */
export function computeSmartOrganizeLayout(input: {
  panels: Partial<Record<TerraWorkspacePanelId, TerraWorkspacePanelRecord>>
  sizes: Partial<Record<TerraWorkspacePanelId, { width: number; height: number }>>
  viewportWidth: number
  viewportHeight: number
}): TerraSmartOrganizePlacement[] {
  const { panels, sizes, viewportWidth, viewportHeight } = input
  const margin = TERRA_WORKSPACE_MARGIN_PX
  const sizeOf = (id: TerraWorkspacePanelId) => sizes[id] ?? { width: 280, height: 96 }
  const isVisible = (id: TerraWorkspacePanelId) => {
    const record = panels[id]
    return record !== undefined && !record.minimized && !record.closed
  }
  const place = (id: TerraWorkspacePanelId, x: number, y: number, width: number, height: number): TerraSmartOrganizePlacement => {
    const clamped = clampPanelPosition({ x, y, panelWidth: width, panelHeight: height, viewportWidth, viewportHeight })
    return { id, x: clamped.x, y: clamped.y, dock: 'float' }
  }
  const results: TerraSmartOrganizePlacement[] = []

  // TOP band: left-to-right, starting clear of the pinned workspace control at the top-left.
  let topX = 240
  for (const id of SMART_ORGANIZE_TOP_IDS) {
    if (!isVisible(id)) continue
    const size = sizeOf(id)
    results.push(place(id, topX, margin, size.width, size.height))
    topX += size.width + margin
  }

  // LEFT column: stacked, below the workspace control.
  let leftY = 148
  for (const id of SMART_ORGANIZE_LEFT_IDS) {
    if (!isVisible(id)) continue
    const size = sizeOf(id)
    results.push(place(id, margin, leftY, size.width, size.height))
    leftY += size.height + margin
  }

  // RIGHT column: stacked, right-aligned.
  let rightY = margin
  for (const id of SMART_ORGANIZE_RIGHT_IDS) {
    if (!isVisible(id)) continue
    const size = sizeOf(id)
    results.push(place(id, viewportWidth - size.width - 12, rightY, size.width, size.height))
    rightY += size.height + margin
  }

  // BOTTOM row: centered as a group, hugging the bottom edge.
  const bottomVisible = SMART_ORGANIZE_BOTTOM_IDS.filter(isVisible)
  const bottomTotalWidth = bottomVisible.reduce((sum, id) => sum + sizeOf(id).width, 0) + margin * Math.max(0, bottomVisible.length - 1)
  let bottomX = Math.max(margin, (viewportWidth - bottomTotalWidth) / 2)
  for (const id of bottomVisible) {
    const size = sizeOf(id)
    bottomX = bottomX
    results.push(place(id, bottomX, viewportHeight - size.height - 12, size.width, size.height))
    bottomX += size.width + margin
  }

  return resolveSmartOrganizeOverlaps({
    placements: results,
    sizes,
    viewportWidth,
    viewportHeight,
  })
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
    const settings = parsed.settings && typeof parsed.settings === 'object'
      ? {
        smartClick: typeof parsed.settings.smartClick === 'boolean' ? parsed.settings.smartClick : TERRA_WORKSPACE_DEFAULT_SETTINGS.smartClick,
        smartOpen: typeof parsed.settings.smartOpen === 'boolean' ? parsed.settings.smartOpen : TERRA_WORKSPACE_DEFAULT_SETTINGS.smartOpen,
        missionControlChrome: typeof parsed.settings.missionControlChrome === 'boolean' ? parsed.settings.missionControlChrome : TERRA_WORKSPACE_DEFAULT_SETTINGS.missionControlChrome,
      }
      : undefined
    return {
      version: 1,
      panels,
      zOrder: Array.isArray(parsed.zOrder) ? parsed.zOrder : [],
      settings,
    }
  } catch {
    return null
  }
}
