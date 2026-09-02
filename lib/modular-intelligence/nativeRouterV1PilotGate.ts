/**
 * Independent serving-pilot gate for Native Router V1.
 * Distinct from WR_NATIVE_ROUTER_V1_SHADOW (telemetry-only; production hard-off).
 *
 * Default OFF. Unset / 0 / false / off never enables serving.
 * Explicit 1 / true / on enables serving in development or production.
 * Kill switch: unset or set WR_NATIVE_ROUTER_V1_PILOT=0 (no code edit).
 */
export const NATIVE_ROUTER_V1_PILOT_FLAG = 'WR_NATIVE_ROUTER_V1_PILOT'

function flagOn(env: NodeJS.ProcessEnv): boolean {
  const flag = env.WR_NATIVE_ROUTER_V1_PILOT?.trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'on'
}

export function isNativeRouterV1PilotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagOn(env)
}

export function nativeRouterV1PilotDisabledReason(env: NodeJS.ProcessEnv = process.env): string {
  if (flagOn(env)) return ''
  return 'default_off'
}
