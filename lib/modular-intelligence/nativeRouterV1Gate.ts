/**
 * Development-only gate for Native Router V1 shadow scoring.
 * Default development is also off (default_off) unless
 * WR_NATIVE_ROUTER_V1_SHADOW is explicitly 1/true/on.
 * Never changes tool selection.
 */
export function isNativeRouterV1ShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  const flag = env.WR_NATIVE_ROUTER_V1_SHADOW?.trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'on'
}

export function nativeRouterV1ShadowDisabledReason(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production') return 'production_node_env'
  const flag = env.WR_NATIVE_ROUTER_V1_SHADOW?.trim().toLowerCase()
  if (flag === '1' || flag === 'true' || flag === 'on') return ''
  return 'default_off'
}
