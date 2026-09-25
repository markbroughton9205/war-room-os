/**
 * Screenshot capture policy for the shared Browser Broker.
 * Never blindly fullPage an unbounded document.
 */

export const SCREENSHOT_STRATEGIES = [
  'DIRECT_VIEWPORT',
  'DIRECT_FULL_PAGE',
  'BOUNDED_FULL_PAGE',
  'TILED_CAPTURE',
  'VIEWPORT_FALLBACK',
  'UNSAFE_REJECT',
] as const
export type ScreenshotStrategy = (typeof SCREENSHOT_STRATEGIES)[number]

export type ScreenshotMetrics = {
  pageWidth: number
  pageHeight: number
  viewportWidth: number
  viewportHeight: number
  deviceScaleFactor: number
  estimatedPixels: number
  clipHeight: number
}

export type ScreenshotPlan = {
  strategy: ScreenshotStrategy
  fullPage: boolean
  clip: { x: number; y: number; width: number; height: number } | null
  tiles: Array<{ x: number; y: number; width: number; height: number }>
  metrics: ScreenshotMetrics
  reason: string
}

export const SCREENSHOT_LIMITS = {
  maxDirectPixels: 8_000_000,
  maxStitchPixels: 16_000_000,
  maxSafeHeight: 8_000,
  maxUnsafeHeight: 40_000,
  tileHeight: 1_800,
  maxTiles: 8,
  timeoutMs: 15_000,
} as const

export function estimatePixels(width: number, height: number, dpr: number): number {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const scale = Math.max(1, dpr || 1)
  return Math.floor(w * h * scale * scale)
}

export function planScreenshot(input: {
  pageWidth: number
  pageHeight: number
  viewportWidth: number
  viewportHeight: number
  deviceScaleFactor?: number
  wantFullPage?: boolean
}): ScreenshotPlan {
  const dpr = Math.max(1, Math.min(input.deviceScaleFactor || 1, 3))
  const viewportWidth = Math.max(1, Math.floor(input.viewportWidth || 1280))
  const viewportHeight = Math.max(1, Math.floor(input.viewportHeight || 720))
  const pageWidth = Math.max(viewportWidth, Math.floor(input.pageWidth || viewportWidth))
  const pageHeight = Math.max(viewportHeight, Math.floor(input.pageHeight || viewportHeight))
  const metrics: ScreenshotMetrics = {
    pageWidth,
    pageHeight,
    viewportWidth,
    viewportHeight,
    deviceScaleFactor: dpr,
    estimatedPixels: estimatePixels(pageWidth, pageHeight, dpr),
    clipHeight: Math.min(pageHeight, SCREENSHOT_LIMITS.maxSafeHeight),
  }

  if (!input.wantFullPage) {
    return {
      strategy: 'DIRECT_VIEWPORT',
      fullPage: false,
      clip: null,
      tiles: [],
      metrics: { ...metrics, estimatedPixels: estimatePixels(viewportWidth, viewportHeight, dpr) },
      reason: 'viewport capture requested',
    }
  }

  if (pageHeight > SCREENSHOT_LIMITS.maxUnsafeHeight || metrics.estimatedPixels > SCREENSHOT_LIMITS.maxStitchPixels * 2) {
    return {
      strategy: 'UNSAFE_REJECT',
      fullPage: false,
      clip: null,
      tiles: [],
      metrics,
      reason: `document too large for capture (${pageWidth}x${pageHeight} dpr=${dpr} px=${metrics.estimatedPixels})`,
    }
  }

  if (metrics.estimatedPixels <= SCREENSHOT_LIMITS.maxDirectPixels && pageHeight <= SCREENSHOT_LIMITS.maxSafeHeight) {
    return {
      strategy: 'DIRECT_FULL_PAGE',
      fullPage: true,
      clip: null,
      tiles: [],
      metrics,
      reason: 'full page within direct capture budget',
    }
  }

  if (pageHeight <= SCREENSHOT_LIMITS.maxSafeHeight * 1.5 && estimatePixels(pageWidth, SCREENSHOT_LIMITS.maxSafeHeight, dpr) <= SCREENSHOT_LIMITS.maxDirectPixels) {
    return {
      strategy: 'BOUNDED_FULL_PAGE',
      fullPage: false,
      clip: { x: 0, y: 0, width: pageWidth, height: SCREENSHOT_LIMITS.maxSafeHeight },
      tiles: [],
      metrics: { ...metrics, clipHeight: SCREENSHOT_LIMITS.maxSafeHeight, estimatedPixels: estimatePixels(pageWidth, SCREENSHOT_LIMITS.maxSafeHeight, dpr) },
      reason: 'bounded clip instead of unbounded fullPage',
    }
  }

  const tiles: ScreenshotPlan['tiles'] = []
  let y = 0
  while (y < pageHeight && tiles.length < SCREENSHOT_LIMITS.maxTiles) {
    const height = Math.min(SCREENSHOT_LIMITS.tileHeight, pageHeight - y)
    tiles.push({ x: 0, y, width: pageWidth, height })
    y += height
  }
  const tilePixels = tiles.reduce((sum, tile) => sum + estimatePixels(tile.width, tile.height, dpr), 0)
  if (tilePixels <= SCREENSHOT_LIMITS.maxStitchPixels) {
    return {
      strategy: 'TILED_CAPTURE',
      fullPage: false,
      clip: null,
      tiles,
      metrics: { ...metrics, estimatedPixels: tilePixels, clipHeight: y },
      reason: `tiled capture ${tiles.length} segments`,
    }
  }

  return {
    strategy: 'VIEWPORT_FALLBACK',
    fullPage: false,
    clip: null,
    tiles: [],
    metrics: { ...metrics, estimatedPixels: estimatePixels(viewportWidth, viewportHeight, dpr) },
    reason: 'full-page budget exceeded; viewport fallback',
  }
}

export function normalizeUrl(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.protocol}//${host}${path}${parsed.search}`
  } catch {
    return url.trim().replace(/\/+$/, '')
  }
}
