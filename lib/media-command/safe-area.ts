/**
 * Title-safe / action-safe geometry. Viewer assistance only — never burned into the master.
 * Insets are normalized fractions of the output frame so 16:9, 9:16, and 1:1 share one definition.
 */
import type { OutputAspect } from './types'

export type SafeRegion = {
  left: number
  top: number
  right: number
  bottom: number
}

export type SafeBox = {
  x: number
  y: number
  width: number
  height: number
}

export const TITLE_SAFE_INSET = 0.10
export const ACTION_SAFE_INSET = 0.05

export function safeRegion(kind: 'title' | 'action'): SafeRegion {
  const inset = kind === 'title' ? TITLE_SAFE_INSET : ACTION_SAFE_INSET
  return { left: inset, top: inset, right: 1 - inset, bottom: 1 - inset }
}

export function aspectDimensions(aspect: OutputAspect | string): { width: number; height: number } {
  if (aspect === '9:16') return { width: 1080, height: 1920 }
  if (aspect === '1:1') return { width: 1080, height: 1080 }
  return { width: 1920, height: 1080 }
}

export function boxInside(box: SafeBox, region: SafeRegion, epsilon = 0.004): boolean {
  return (
    box.x + epsilon >= region.left
    && box.y + epsilon >= region.top
    && box.x + box.width - epsilon <= region.right
    && box.y + box.height - epsilon <= region.bottom
  )
}

export type SafeStatus = 'SAFE' | 'WARNING'

export type SafeWarning = {
  id: string
  kind: 'caption' | 'title' | 'lower-third' | 'logo' | 'graphic'
  status: SafeStatus
  message: string
  box: SafeBox
}

export function clampBoxToRegion(box: SafeBox, region: SafeRegion): SafeBox {
  const width = Math.min(box.width, region.right - region.left)
  const height = Math.min(box.height, region.bottom - region.top)
  const x = Math.min(Math.max(box.x, region.left), region.right - width)
  const y = Math.min(Math.max(box.y, region.top), region.bottom - height)
  return { x, y, width, height }
}

export function centerOf(box: SafeBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
