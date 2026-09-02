/**
 * Development-only gate for WR-TOOL trajectory observation.
 * Production (NODE_ENV === 'production') is always off. No hidden production activation.
 *
 * Development/test: on unless WR_TOOL_TRAJECTORY_OBSERVER is '0' or 'false'.
 */

export function isTrajectoryObservationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  const flag = env.WR_TOOL_TRAJECTORY_OBSERVER?.trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'off') return false
  return true
}

export function trajectoryObservationDisabledReason(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production') return 'production_node_env'
  const flag = env.WR_TOOL_TRAJECTORY_OBSERVER?.trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'off') return 'explicit_opt_out'
  return ''
}
