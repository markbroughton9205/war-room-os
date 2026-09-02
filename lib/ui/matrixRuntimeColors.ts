import type { MatrixStatusKind } from './matrixStatusBus'

/**
 * Single source of truth for "runtime event kind -> visual treatment" so every Matrix canvas
 * (components/MatrixCodeRain.tsx today; components/war-room/live-room/MatrixRain.tsx if it is
 * ever brought onto the active render path) renders the same real-event semantics instead of each
 * canvas inventing its own palette. Colors follow the Council Command UI + Functional Matrix
 * Runtime mission doctrine:
 *
 * idle    - ambient green, no claim of activity
 * working - amber: processing/deliberation/bounded wait
 * outbound- violet: an outbound request/query was just sent
 * inbound - cyan: a provider/Council response physically arrived
 * success - green: a routine successful completion
 * verified- bright white-neutral: a rare, high-confidence first-verified-data moment
 * warning - amber: degraded but not failed
 * error   - red: a real failure/disconnect/timeout
 */
export const MATRIX_RUNTIME_RGB: Record<MatrixStatusKind, string> = {
  idle: '0, 255, 65',
  working: '234, 179, 8',
  outbound: '167, 139, 250',
  inbound: '34, 211, 238',
  success: '52, 235, 128',
  verified: '240, 245, 250',
  warning: '234, 179, 8',
  error: '248, 113, 113',
}

/** Brief, restrained multiplier on baseline stream alpha -- never a full-screen flash. */
export const MATRIX_RUNTIME_INTENSITY: Record<MatrixStatusKind, number> = {
  idle: 1,
  working: 1.12,
  outbound: 1.2,
  inbound: 1.22,
  success: 1.3,
  verified: 1.45,
  warning: 1.15,
  error: 1.18,
}

export function matrixRuntimeRgb(kind: MatrixStatusKind): string {
  return MATRIX_RUNTIME_RGB[kind] ?? MATRIX_RUNTIME_RGB.idle
}

export function matrixRuntimeIntensity(kind: MatrixStatusKind): number {
  return MATRIX_RUNTIME_INTENSITY[kind] ?? 1
}
