import { resolveActionRoutePolicy, assertLiveActionsAllowed, type ActionRoutePolicyEnv } from './actionRoutePolicy'

export type ActionRoutePolicyValidationResult = {
  caseId: string
  description: string
  expected: string
  observed: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

function validation(
  caseId: string,
  description: string,
  expected: string,
  observed: string,
  notes: string[] = []
): ActionRoutePolicyValidationResult {
  return { caseId, description, expected, observed, result: expected === observed ? 'PASS' : 'FAIL', notes }
}

export async function runGate16ActionRoutePolicyValidation(): Promise<ActionRoutePolicyValidationResult[]> {
  return [
    productionUnconditionalAuthority(),
    previewZeroAuthority(),
    developmentZeroAuthorityByDefault(),
    localUndefinedZeroAuthorityByDefault(),
    gate16_10_vercelEnvAbsentResolvesToLocalNotError(),
    gate16_11_overrideFlagNoEffectInPreview(),
    gate16_12_overrideFlagNoOpInProduction(),
    overrideFlagWorksInLocal(),
    overrideFlagWorksInDevelopment(),
    gate16_08_sessionAndSecretIrrelevantWhenBlocked(),
    gate16_09_policyOnlyReadsVercelEnvAndOverrideFlag(),
    assertLiveActionsAllowedReturnsNullWhenAllowed(),
    await assertLiveActionsAllowedReturns403WhenBlocked(),
    hardInvariantAuthMethodsFalseWheneverLiveActionsFalse(),
  ]
}

function productionUnconditionalAuthority(): ActionRoutePolicyValidationResult {
  const policy = resolveActionRoutePolicy({ VERCEL_ENV: 'production' })
  const observed = policy.environment === 'production' &&
    policy.liveActionsAllowed === true &&
    policy.sessionAuthorizationAllowed === true &&
    policy.actionSecretAuthorizationAllowed === true
    ? 'production_full_authority'
    : `unexpected:${JSON.stringify(policy)}`
  return validation('gate16_01_production_unconditional', 'Production gets full authority unconditionally.', 'production_full_authority', observed)
}

function previewZeroAuthority(): ActionRoutePolicyValidationResult {
  const policy = resolveActionRoutePolicy({ VERCEL_ENV: 'preview' })
  const observed = policy.environment === 'preview' &&
    policy.liveActionsAllowed === false &&
    policy.sessionAuthorizationAllowed === false &&
    policy.actionSecretAuthorizationAllowed === false
    ? 'preview_zero_authority'
    : `unexpected:${JSON.stringify(policy)}`
  return validation('gate16_02_preview_zero_authority', 'Preview defaults to zero live-action authority.', 'preview_zero_authority', observed)
}

function developmentZeroAuthorityByDefault(): ActionRoutePolicyValidationResult {
  const policy = resolveActionRoutePolicy({ VERCEL_ENV: 'development' })
  const observed = policy.environment === 'development' && policy.liveActionsAllowed === false
    ? 'development_zero_authority_default'
    : `unexpected:${JSON.stringify(policy)}`
  return validation('gate16_03_development_zero_authority_default', '`vercel dev` (VERCEL_ENV=development) defaults to zero authority without the override flag.', 'development_zero_authority_default', observed)
}

function localUndefinedZeroAuthorityByDefault(): ActionRoutePolicyValidationResult {
  const policy = resolveActionRoutePolicy({})
  const observed = policy.environment === 'local' && policy.liveActionsAllowed === false
    ? 'local_zero_authority_default'
    : `unexpected:${JSON.stringify(policy)}`
  return validation('gate16_06_local_default_matches_preview', 'Bare local run (VERCEL_ENV entirely absent) defaults to zero authority, same posture as Preview.', 'local_zero_authority_default', observed)
}

function gate16_10_vercelEnvAbsentResolvesToLocalNotError(): ActionRoutePolicyValidationResult {
  let threw = false
  let policy: ReturnType<typeof resolveActionRoutePolicy> | null = null
  try {
    policy = resolveActionRoutePolicy({})
  } catch {
    threw = true
  }
  const observed = !threw && policy?.environment === 'local'
    ? 'resolved_to_local_no_error'
    : threw ? 'threw' : `unexpected:${JSON.stringify(policy)}`
  return validation('gate16_10_vercel_env_absent_no_error', 'VERCEL_ENV entirely absent resolves cleanly to \'local\', not an exception, and not Production.', 'resolved_to_local_no_error', observed)
}

function gate16_11_overrideFlagNoEffectInPreview(): ActionRoutePolicyValidationResult {
  const policy = resolveActionRoutePolicy({ VERCEL_ENV: 'preview', WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS: 'true' })
  const observed = policy.liveActionsAllowed === false ? 'override_ignored_in_preview' : 'override_incorrectly_applied'
  return validation('gate16_11_override_no_effect_in_preview', 'Override flag set to true while VERCEL_ENV=preview has zero effect.', 'override_ignored_in_preview', observed)
}

function gate16_12_overrideFlagNoOpInProduction(): ActionRoutePolicyValidationResult {
  const withFlagFalse = resolveActionRoutePolicy({ VERCEL_ENV: 'production', WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS: 'false' })
  const withFlagTrue = resolveActionRoutePolicy({ VERCEL_ENV: 'production', WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS: 'true' })
  const withFlagAbsent = resolveActionRoutePolicy({ VERCEL_ENV: 'production' })
  const observed = withFlagFalse.liveActionsAllowed === true &&
    withFlagTrue.liveActionsAllowed === true &&
    withFlagAbsent.liveActionsAllowed === true
    ? 'flag_is_noop_in_production'
    : `unexpected:${JSON.stringify({ withFlagFalse, withFlagTrue, withFlagAbsent })}`
  return validation('gate16_12_override_noop_in_production', 'Override flag value (true, false, or absent) makes no difference in Production -- already unconditional.', 'flag_is_noop_in_production', observed)
}

function overrideFlagWorksInLocal(): ActionRoutePolicyValidationResult {
  const policy = resolveActionRoutePolicy({ WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS: 'true' })
  const observed = policy.environment === 'local' && policy.liveActionsAllowed === true
    ? 'override_grants_authority_in_local'
    : `unexpected:${JSON.stringify(policy)}`
  return validation('gate16_13_override_works_in_local', 'Override flag correctly restores authority in local dev (VERCEL_ENV absent) -- proves the flag is not simply inert everywhere.', 'override_grants_authority_in_local', observed)
}

function overrideFlagWorksInDevelopment(): ActionRoutePolicyValidationResult {
  const policy = resolveActionRoutePolicy({ VERCEL_ENV: 'development', WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS: 'true' })
  const observed = policy.environment === 'development' && policy.liveActionsAllowed === true
    ? 'override_grants_authority_in_development'
    : `unexpected:${JSON.stringify(policy)}`
  return validation('gate16_14_override_works_in_development', 'Override flag correctly restores authority under `vercel dev` (VERCEL_ENV=development).', 'override_grants_authority_in_development', observed)
}

function gate16_08_sessionAndSecretIrrelevantWhenBlocked(): ActionRoutePolicyValidationResult {
  // assertLiveActionsAllowed takes no Request/session/secret argument at all --
  // structurally incapable of being satisfied by session or secret material.
  // This proves case 8 by construction: there is no code path through which a
  // valid session or a valid secret could make this return null in a blocked
  // environment, because neither is ever passed in.
  const takesNoAuthMaterial = assertLiveActionsAllowed.length <= 1 // only optional env param
  const blockedResult = assertLiveActionsAllowed({ VERCEL_ENV: 'preview' })
  const observed = takesNoAuthMaterial && blockedResult !== null
    ? 'blocked_regardless_of_session_or_secret'
    : 'unexpected'
  return validation(
    'gate16_08_secret_absence_not_compensated_by_session',
    'Function signature accepts no session/secret material, so environment blocking cannot be bypassed by either -- structural guarantee, not just an empirical one.',
    'blocked_regardless_of_session_or_secret',
    observed
  )
}

function gate16_09_policyOnlyReadsVercelEnvAndOverrideFlag(): ActionRoutePolicyValidationResult {
  // Intentionally probing that extra/spoofable-looking keys shaped like a
  // NEXT_PUBLIC_* variable or a request header are ignored -- the object
  // literal is cast rather than typed inline so these extra keys don't
  // trigger excess-property checking, but resolveActionRoutePolicy only
  // ever reads VERCEL_ENV and WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS regardless.
  const withBogusKeys = resolveActionRoutePolicy({
    VERCEL_ENV: 'preview',
    WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS: 'true',
    NEXT_PUBLIC_VERCEL_ENV: 'production',
    'x-war-room-environment-override': 'production',
  } as ActionRoutePolicyEnv)
  const observed = withBogusKeys.environment === 'preview' && withBogusKeys.liveActionsAllowed === false
    ? 'only_real_keys_read_bogus_keys_ignored'
    : `unexpected:${JSON.stringify(withBogusKeys)}`
  return validation(
    'gate16_09_no_client_influence',
    'Extra keys shaped like a NEXT_PUBLIC_* variable or a spoofed header have zero effect -- only VERCEL_ENV and WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS are ever read.',
    'only_real_keys_read_bogus_keys_ignored',
    observed
  )
}

function assertLiveActionsAllowedReturnsNullWhenAllowed(): ActionRoutePolicyValidationResult {
  const result = assertLiveActionsAllowed({ VERCEL_ENV: 'production' })
  return validation('gate16_15_allowed_returns_null', 'assertLiveActionsAllowed returns null (proceed) when policy allows live actions.', 'null', result === null ? 'null' : 'non_null')
}

async function is403WithBody(res: NonNullable<ReturnType<typeof assertLiveActionsAllowed>>): Promise<boolean> {
  if (res.status !== 403) return false
  const body = await res.json() as { error?: string }
  return body.error === 'Not available in this environment.'
}

async function assertLiveActionsAllowedReturns403WhenBlocked(): Promise<ActionRoutePolicyValidationResult> {
  const result = assertLiveActionsAllowed({ VERCEL_ENV: 'preview' })
  const observed = result !== null && await is403WithBody(result) ? 'blocked_403_with_body' : 'unexpected'
  return validation('gate16_16_blocked_returns_403', 'assertLiveActionsAllowed returns a 403 NextResponse with the expected body when policy blocks live actions.', 'blocked_403_with_body', observed)
}

function hardInvariantAuthMethodsFalseWheneverLiveActionsFalse(): ActionRoutePolicyValidationResult {
  const cases: ActionRoutePolicyEnv[] = [
    {},
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'preview', WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS: 'true' },
    { VERCEL_ENV: 'development' },
  ]
  const allHold = cases.every(env => {
    const p = resolveActionRoutePolicy(env)
    return p.liveActionsAllowed === false
      ? p.sessionAuthorizationAllowed === false && p.actionSecretAuthorizationAllowed === false
      : true
  })
  return validation(
    'gate16_17_hard_invariant_auth_methods_false_with_live_actions_false',
    'Whenever liveActionsAllowed is false, both auth-method flags are also false -- never independently true.',
    'invariant_holds',
    allHold ? 'invariant_holds' : 'invariant_violated'
  )
}
