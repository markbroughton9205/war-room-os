/**
 * Development-only gate for WR-TOOL frozen native router shadow scoring.
 * Production NODE_ENV is always off. Default development is also off unless
 * WR_TOOL_FROZEN_ROUTER_SHADOW is explicitly 1/true/on.
 * Never changes tool selection.
 */
export function isFrozenRouterShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  const flag = env.WR_TOOL_FROZEN_ROUTER_SHADOW?.trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'on'
}

export function frozenRouterShadowDisabledReason(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production') return 'production_node_env'
  const flag = env.WR_TOOL_FROZEN_ROUTER_SHADOW?.trim().toLowerCase()
  if (flag === '1' || flag === 'true' || flag === 'on') return ''
  return 'default_off'
}
