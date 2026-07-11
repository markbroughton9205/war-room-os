import { NextResponse } from 'next/server'

export type DeploymentEnvironment = 'production' | 'preview' | 'development' | 'local'

export type ActionRoutePolicy = {
  environment: DeploymentEnvironment
  liveActionsAllowed: boolean
  sessionAuthorizationAllowed: boolean
  actionSecretAuthorizationAllowed: boolean
}

export type ActionRoutePolicyEnv = {
  VERCEL_ENV?: string
  WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS?: string
}

function resolveDeploymentEnvironment(env: ActionRoutePolicyEnv): DeploymentEnvironment {
  const raw = env.VERCEL_ENV?.trim()
  if (raw === 'production') return 'production'
  if (raw === 'preview') return 'preview'
  if (raw === 'development') return 'development'
  return 'local'
}

/**
 * Environment is read from VERCEL_ENV only -- never from request body,
 * header, or a NEXT_PUBLIC_* variable (client-bundled, spoofable). Preview
 * and local/development default to zero live-action authority; Production
 * is unconditionally full authority regardless of the override flag.
 *
 * The override flag never applies to Preview, even if someone sets it in
 * that environment's own config -- Preview is a shared, externally
 * reachable deployment, unlike a developer's local machine.
 */
export function resolveActionRoutePolicy(env?: ActionRoutePolicyEnv): ActionRoutePolicy {
  const resolvedEnv: ActionRoutePolicyEnv = env ?? {
    VERCEL_ENV: process.env.VERCEL_ENV,
    WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS: process.env.WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS,
  }
  const environment = resolveDeploymentEnvironment(resolvedEnv)

  if (environment === 'production') {
    return {
      environment,
      liveActionsAllowed: true,
      sessionAuthorizationAllowed: true,
      actionSecretAuthorizationAllowed: true,
    }
  }

  const overrideEnabled = environment !== 'preview' && resolvedEnv.WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS === 'true'

  return {
    environment,
    liveActionsAllowed: overrideEnabled,
    sessionAuthorizationAllowed: overrideEnabled,
    actionSecretAuthorizationAllowed: overrideEnabled,
  }
}

/**
 * Must be the first statement in any action-triggering route handler --
 * before assertActionRouteAuthorized, before request body parsing, and
 * before any privileged client (Supabase admin, provider SDK) is
 * constructed. Returns null when live actions are allowed in the current
 * environment.
 */
export function assertLiveActionsAllowed(env?: ActionRoutePolicyEnv): NextResponse | null {
  if (!resolveActionRoutePolicy(env).liveActionsAllowed) {
    return NextResponse.json({ error: 'Not available in this environment.' }, { status: 403 })
  }
  return null
}
