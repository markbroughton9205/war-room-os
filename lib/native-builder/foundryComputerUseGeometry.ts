/**
 * Pure Computer Use geometry + state-confirmation contracts.
 * No AT-SPI / xdotool here — those stay in foundryComputerUse.ts.
 */

export type Rect = { x: number; y: number; width: number; height: number }

export type SemanticExpected = {
  name?: string
  role?: string
  text?: string
  absentName?: string
  anyOf?: Array<{ name: string; role?: string }>
}

export type ControlTiming = {
  control: string
  discoveryMs: number
  pollCount: number
  atspiFound: boolean
  activationMethod: 'AT_SPI_ACTION' | 'SEMANTIC_BOUNDS_CLICK' | 'SEMANTIC_DOM_CLICK' | 'COORDINATE_FALLBACK' | 'NONE' | 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW'
  expectedState: string
  expectedStateObserved: boolean
  retryUsed: boolean
}

export const SESSION_LIFECYCLE_CONTRACTS: Record<string, SemanticExpected> = {
  Foundry: {
    anyOf: [
      { name: 'New Session', role: 'button' },
      { name: 'Advanced / Operations', role: 'button' },
    ],
  },
  'New Session': {
    anyOf: [
      { name: 'Rename', role: 'button' },
      { name: 'Selected session' },
    ],
  },
  Rename: {
    anyOf: [
      { name: 'Session title', role: 'entry' },
      { name: 'Save', role: 'button' },
    ],
  },
  Save: {
    anyOf: [{ name: 'Rename', role: 'button' }],
  },
  Archive: {
    anyOf: [{ name: 'Confirm Archive', role: 'button' }],
  },
  'Confirm Archive': {
    absentName: 'Confirm Archive',
  },
  Restore: {
    anyOf: [
      { name: 'Rename', role: 'button' },
      { name: 'Selected session' },
    ],
  },
  'Advanced / Operations': {
    anyOf: [
      { name: 'Restore', role: 'button' },
      { name: 'Archived Sessions' },
    ],
  },
}

export function hitInsideWindow(hit: Rect, window: Rect, pad = 8): boolean {
  return (
    hit.x >= window.x - pad
    && hit.y >= window.y - pad
    && hit.x <= window.x + window.width + pad
    && hit.y <= window.y + window.height + pad
  )
}

export function pointInsideWindow(x: number, y: number, window: Rect, pad = 4): boolean {
  return (
    x >= window.x + pad
    && y >= window.y + pad
    && x <= window.x + window.width - pad
    && y <= window.y + window.height - pad
  )
}

export type DisplayTopology = {
  id: string
  connector?: string
  logical: Rect
  physical: Rect
  scale: number
  primary: boolean
  rotation: number
}

export type AccessibleNormalizeContext = {
  displays: DisplayTopology[]
  /** X11 / click coordinate frame of the verified War Room window. */
  appFrameX11: Rect
  /** AT-SPI application frame in SCREEN coords (often GDK logical). */
  appFrameAtspi?: Rect | null
}

export type NormalizedAccessible = {
  rect: Rect
  point: { x: number; y: number }
  space: 'physical' | 'logical-to-physical' | 'frame-affine' | 'display-unscale'
  displayId: string | null
  insideAppFrame: boolean
  insideDisplay: boolean
  intersection: Rect | null
  refused?: 'AT_SPI_POINT_OUTSIDE_APP_FRAME'
}

function rectArea(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right - x < 1 || bottom - y < 1) return null
  return { x, y, width: right - x, height: bottom - y }
}

export function rectsOverlapMeaningfully(hit: Rect, frame: Rect): boolean {
  const overlap = intersectRects(hit, frame)
  if (!overlap) return false
  const hitArea = rectArea(hit)
  const overlapArea = rectArea(overlap)
  if (overlap.width >= 8 && overlap.height >= 8) return true
  if (hitArea <= 0) return false
  return overlapArea / hitArea >= 0.25
}

export function displayContaining(point: { x: number; y: number }, displays: DisplayTopology[], space: 'logical' | 'physical'): DisplayTopology | null {
  const inside = displays.find(display => {
    const bounds = space === 'logical' ? display.logical : display.physical
    return point.x >= bounds.x
      && point.y >= bounds.y
      && point.x < bounds.x + bounds.width
      && point.y < bounds.y + bounds.height
  })
  if (inside) return inside
  if (!displays.length) return null
  return displays.reduce((best, display) => {
    const bounds = space === 'logical' ? display.logical : display.physical
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    const dist = (point.x - cx) ** 2 + (point.y - cy) ** 2
    const bestBounds = space === 'logical' ? best.logical : best.physical
    const bx = bestBounds.x + bestBounds.width / 2
    const by = bestBounds.y + bestBounds.height / 2
    const bestDist = (point.x - bx) ** 2 + (point.y - by) ** 2
    return dist < bestDist ? display : best
  })
}

export function logicalToPhysicalPoint(
  point: { x: number; y: number },
  display: DisplayTopology,
): { x: number; y: number } {
  const scale = display.scale > 0 ? display.scale : 1
  return {
    x: display.physical.x + (point.x - display.logical.x) * scale,
    y: display.physical.y + (point.y - display.logical.y) * scale,
  }
}

export function logicalToPhysicalRect(rect: Rect, display: DisplayTopology): Rect {
  const origin = logicalToPhysicalPoint(rect, display)
  const scale = display.scale > 0 ? display.scale : 1
  return { x: origin.x, y: origin.y, width: rect.width * scale, height: rect.height * scale }
}

function scaleRectAbout(rect: Rect, origin: Rect, scale: number): Rect {
  const safe = scale > 0 && Number.isFinite(scale) ? scale : 1
  return {
    x: origin.x + (rect.x - origin.x) * safe,
    y: origin.y + (rect.y - origin.y) * safe,
    width: rect.width * safe,
    height: rect.height * safe,
  }
}

function affineMapRect(rect: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  return {
    x: to.x + (rect.x - from.x) * sx,
    y: to.y + (rect.y - from.y) * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  }
}

export function pickSafeInteriorPoint(hit: Rect, frame: Rect): { x: number; y: number } | { error: 'AT_SPI_POINT_OUTSIDE_APP_FRAME' } {
  const overlap = intersectRects(hit, frame)
  if (!overlap || !rectsOverlapMeaningfully(hit, frame)) {
    return { error: 'AT_SPI_POINT_OUTSIDE_APP_FRAME' }
  }
  return {
    x: Math.round(overlap.x + overlap.width / 2),
    y: Math.round(overlap.y + overlap.height / 2),
  }
}

/**
 * Single transformation layer: AT-SPI SCREEN rect → X11 physical screen point.
 * Uses runtime display metadata only. Never guesses ×2 / 1.25 / 1.5.
 */
export function normalizeAccessiblePointToScreen(
  hit: Rect,
  context: AccessibleNormalizeContext,
): NormalizedAccessible {
  const frame = context.appFrameX11
  const candidates: Array<{ rect: Rect; space: NormalizedAccessible['space'] }> = [
    { rect: hit, space: 'physical' },
  ]
  const logicalDisplay = displayContaining({ x: hit.x, y: hit.y }, context.displays, 'logical')
  if (logicalDisplay) {
    candidates.push({ rect: logicalToPhysicalRect(hit, logicalDisplay), space: 'logical-to-physical' })
  }
  if (context.appFrameAtspi && context.appFrameAtspi.width > 0 && context.appFrameAtspi.height > 0) {
    candidates.push({ rect: affineMapRect(hit, context.appFrameAtspi, frame), space: 'frame-affine' })
  }
  const windowDisplay = displayContaining(
    { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
    context.displays,
    'physical',
  )
  if (windowDisplay && windowDisplay.scale > 0 && windowDisplay.scale !== 1) {
    candidates.push({
      rect: scaleRectAbout(hit, frame, 1 / windowDisplay.scale),
      space: 'display-unscale',
    })
  }

  let best: { rect: Rect; space: NormalizedAccessible['space']; overlap: Rect | null; score: number } | null = null
  for (const candidate of candidates) {
    const overlap = intersectRects(candidate.rect, frame)
    const interior = pickSafeInteriorPoint(candidate.rect, frame)
    const inside = !('error' in interior)
    const area = inside && overlap ? rectArea(overlap) : -1
    const score = area + (inside && candidate.space === 'physical' ? 1_000_000_000 : 0)
    if (!best || score > best.score) best = { ...candidate, overlap, score }
  }
  const chosen = best ?? { rect: hit, space: 'physical' as const, overlap: null, score: -1 }
  const interior = pickSafeInteriorPoint(chosen.rect, frame)
  const point = 'error' in interior
    ? { x: chosen.rect.x + chosen.rect.width / 2, y: chosen.rect.y + chosen.rect.height / 2 }
    : interior
  const physicalDisplay = displayContaining(point, context.displays, 'physical')
  const insideAppFrame = !('error' in interior)
  const insideDisplay = Boolean(physicalDisplay && pointInsideWindow(point.x, point.y, physicalDisplay.physical, 0))
  const pointerSafe = insideAppFrame && (insideDisplay || context.displays.length === 0)
  return {
    rect: chosen.rect,
    point: { x: Math.round(point.x), y: Math.round(point.y) },
    space: chosen.space,
    displayId: physicalDisplay?.id ?? windowDisplay?.id ?? null,
    insideAppFrame,
    insideDisplay,
    intersection: chosen.overlap,
    refused: pointerSafe ? undefined : 'AT_SPI_POINT_OUTSIDE_APP_FRAME',
  }
}

export function mapHitToWindowFrame(hit: Rect, window: Rect, scale = 1): Rect | null {
  const identity = hitInsideWindow(hit, window) ? hit : null
  if (identity) return identity
  const originTranslated = { ...hit, x: window.x + hit.x, y: window.y + hit.y }
  if (hitInsideWindow(originTranslated, window)) return originTranslated
  const runtimeScale = Number.isFinite(scale) && scale > 0 && scale !== 1 ? scale : null
  if (runtimeScale) {
    const scaled = scaleRectAbout(hit, window, 1 / runtimeScale)
    if (hitInsideWindow(scaled, window)) return scaled
    const up = scaleRectAbout(hit, window, runtimeScale)
    if (hitInsideWindow(up, window)) return up
  }
  return null
}

export function semanticClickPoint(hit: Rect, window: Rect): { x: number; y: number } | { error: 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW' } {
  const width = Math.max(1, hit.width)
  const height = Math.max(1, hit.height)
  const railRight = window.x + Math.min(240, Math.max(120, Math.floor(window.width * 0.12)))
  const overlapLeft = Math.max(hit.x, window.x + 8)
  const overlapRight = Math.min(hit.x + width, railRight)
  const localY = height / 2
  let x: number
  if (overlapRight - overlapLeft >= 10) {
    x = Math.round((overlapLeft + overlapRight) / 2)
  } else {
    const localX = width > 96 ? Math.min(24, Math.floor(width * 0.15)) : width / 2
    x = Math.round(hit.x + localX)
  }
  const y = Math.round(hit.y + localY)
  if (!pointInsideWindow(x, y, window)) return { error: 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW' }
  return { x, y }
}

export function preferCompactHits<T extends Rect>(hits: T[]): T[] {
  const ranked = [...hits].sort((a, b) => (a.width * a.height) - (b.width * b.height))
  const compact = ranked.filter(hit => hit.width >= 12 && hit.width <= 480 && hit.height >= 8 && hit.height <= 120)
  const rest = ranked.filter(hit => !compact.includes(hit))
  return compact.length ? [...compact, ...rest] : ranked
}

export function classifyActivation(input: {
  actionOk: boolean
  expectedObservedAfterAction: boolean
  boundsRetryUsed: boolean
  expectedObservedAfterBounds: boolean
  boundsOutsideWindow: boolean
  domRetryUsed?: boolean
  expectedObservedAfterDom?: boolean
}): ControlTiming['activationMethod'] {
  if (input.actionOk && input.expectedObservedAfterAction) return 'AT_SPI_ACTION'
  if (input.domRetryUsed && input.expectedObservedAfterDom) return 'SEMANTIC_DOM_CLICK'
  if (input.boundsOutsideWindow && !input.expectedObservedAfterDom && !input.expectedObservedAfterBounds) return 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW'
  if (input.boundsRetryUsed && input.expectedObservedAfterBounds) return 'SEMANTIC_BOUNDS_CLICK'
  if (input.actionOk && !input.expectedObservedAfterAction && !input.expectedObservedAfterBounds && !input.expectedObservedAfterDom) return 'NONE'
  return 'NONE'
}

export function actionSuccessIsNotStateSuccess(actionOk: boolean, expectedObserved: boolean): boolean {
  return actionOk && !expectedObserved
}

export function expectedStateLabel(expected: SemanticExpected): string {
  if (expected.anyOf?.length) return expected.anyOf.map(item => item.name).join('|')
  if (expected.absentName) return `absent:${expected.absentName}`
  return expected.name || expected.text || ''
}

export function shouldSkipHungApp(name: string | null | undefined): { skip: boolean; reason?: 'hung' | 'unnamed' } {
  if (name == null) return { skip: true, reason: 'hung' }
  if (!String(name).trim()) return { skip: true, reason: 'unnamed' }
  return { skip: false }
}
