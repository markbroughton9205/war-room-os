import type { MatrixChannel } from './matrixStatusBus'

/**
 * Single source of truth for "matrix palette channel -> visual treatment" so every Matrix canvas
 * (components/MatrixCodeRain.tsx today; components/war-room/live-room/MatrixRain.tsx if it is
 * ever brought onto the active render path) renders the same real-event semantics instead of each
 * canvas inventing its own palette. Keyed by lib/ui/matrixStatusBus.ts's MatrixChannel -- the
 * Mac-lane channel model that legacy matrixStatus() kinds already resolve onto -- rather than by
 * the old per-kind vocabulary, so this stays the one place a channel maps to a color no matter
 * which bridge (runtimeEventBridge.ts, a legacy matrixStatus() call site) produced it. Colors
 * follow the Council Command UI + Functional Matrix Runtime mission doctrine:
 *
 * green  - idle/ambient baseline and routine successful completion, no claim of activity beyond that
 * amber  - processing/synthesis/degraded-but-not-failed/bounded wait
 * violet - an outbound request/query was just sent
 * cyan   - a provider/Council response physically arrived
 * white  - bright, rare, high-confidence verified-completion moment
 * red    - a real failure/disconnect/timeout
 */
export const MATRIX_RUNTIME_RGB: Record<MatrixChannel, string> = {
  green: '52, 235, 128',
  amber: '234, 179, 8',
  violet: '167, 139, 250',
  cyan: '34, 211, 238',
  white: '240, 245, 250',
  red: '248, 113, 113',
}

/** Brief, restrained multiplier on baseline stream alpha -- never a full-screen flash. */
export const MATRIX_RUNTIME_INTENSITY: Record<MatrixChannel, number> = {
  green: 1.1,
  amber: 1.15,
  violet: 1.2,
  cyan: 1.22,
  white: 1.45,
  red: 1.18,
}

export function matrixRuntimeRgb(channel: MatrixChannel): string {
  return MATRIX_RUNTIME_RGB[channel] ?? MATRIX_RUNTIME_RGB.green
}

export function matrixRuntimeIntensity(channel: MatrixChannel): number {
  return MATRIX_RUNTIME_INTENSITY[channel] ?? 1
}
