/**
 * Honest live-status vocabulary for Terra layer rows. Generic "ERROR — NO DATA" is only the
 * fallback when the root cause is unknown.
 */
export const TERRA_LAYER_LIVE_STATUSES = [
  'LIVE',
  'LIVE_EMPTY',
  'CACHED',
  'STALE',
  'PARTIAL',
  'NO_COVERAGE',
  'AUTH_REQUIRED',
  'PROVIDER_AUTH_REQUIRED',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'ERROR_UPSTREAM',
  'ERROR_PARSE',
  'LOADING',
] as const
export type TerraLayerLiveStatus = (typeof TERRA_LAYER_LIVE_STATUSES)[number]

export const TERRA_LAYER_ROOT_CAUSES = [
  'PUBLIC_SOURCE_REQUEST_FAILED',
  'PROVIDER_AUTH_REQUIRED',
  'COMMANDER_AUTH_REQUIRED',
  'NO_REGIONAL_COVERAGE',
  'UPSTREAM_RATE_LIMIT',
  'UPSTREAM_403',
  'UPSTREAM_404',
  'UPSTREAM_5XX',
  'PARSER_FAILURE',
  'EMPTY_HEALTHY_RESULT',
  'MISCONFIGURED_HEADERS',
  'MISSING_USER_AGENT',
  'MISSING_ENV',
  'UNKNOWN',
] as const
export type TerraLayerRootCause = (typeof TERRA_LAYER_ROOT_CAUSES)[number]

export const TERRA_LAYER_LIVE_STATUS_LABELS: Record<TerraLayerLiveStatus, string> = {
  LIVE: 'LIVE',
  LIVE_EMPTY: 'LIVE_EMPTY',
  CACHED: 'CACHED',
  STALE: 'STALE',
  PARTIAL: 'PARTIAL',
  NO_COVERAGE: 'NO_COVERAGE',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  PROVIDER_AUTH_REQUIRED: 'PROVIDER_AUTH_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR_UPSTREAM: 'ERROR_UPSTREAM',
  ERROR_PARSE: 'ERROR_PARSE',
  LOADING: 'LOADING…',
}

export function classifyTerraLayerRootCause(input: {
  httpStatus?: number | null
  category?: string | null
  message?: string | null
  emptyHealthy?: boolean
}): TerraLayerRootCause {
  if (input.emptyHealthy) return 'EMPTY_HEALTHY_RESULT'
  const status = input.httpStatus ?? null
  const message = input.message ?? ''
  const category = input.category ?? ''
  if (status === 429 || category === 'rate_limited' || /RATE_LIMITED|\b429\b/i.test(message)) return 'UPSTREAM_RATE_LIMIT'
  if (status === 401 || /COMMANDER|AUTH_REQUIRED|session missing/i.test(message)) return 'COMMANDER_AUTH_REQUIRED'
  if (status === 403 || /UPSTREAM_403|\b403\b/.test(message)) {
    if (/user-agent|User-Agent/i.test(message)) return 'MISSING_USER_AGENT'
    if (/not_configured|API_KEY|missing key/i.test(message)) return 'MISSING_ENV'
    return 'UPSTREAM_403'
  }
  if (status === 404 || /UPSTREAM_404|\b404\b/.test(message)) return 'UPSTREAM_404'
  if (status != null && status >= 500) return 'UPSTREAM_5XX'
  if (category === 'not_configured' || /not configured|API_KEY is not|OHGO_API_KEY|511NY_API_KEY/i.test(message)) return 'PROVIDER_AUTH_REQUIRED'
  if (category === 'parse_error' || /malformed|did not contain|not valid JSON|PARSER/i.test(message)) return 'PARSER_FAILURE'
  if (/NO_COVERAGE|outside .* envelope|no wired public camera/i.test(message)) return 'NO_REGIONAL_COVERAGE'
  if (/PROVIDER_AUTH|PUBLIC_KEY|ApiKey|Invalid Key/i.test(message)) return 'PROVIDER_AUTH_REQUIRED'
  if (/User-Agent|user-agent/i.test(message)) return 'MISSING_USER_AGENT'
  if (category === 'upstream_error' || status != null) return 'PUBLIC_SOURCE_REQUEST_FAILED'
  return 'UNKNOWN'
}

export function classifyTerraLayerLiveStatus(input: {
  feedState: 'loading' | 'live' | 'empty' | 'error' | 'stale'
  fromCache?: boolean
  rootCause?: TerraLayerRootCause | null
  featureCount?: number
}): TerraLayerLiveStatus {
  if (input.feedState === 'loading') return 'LOADING'
  if (input.feedState === 'stale') return 'STALE'
  if (input.feedState === 'live') return input.fromCache ? 'CACHED' : 'LIVE'
  if (input.feedState === 'empty') return 'LIVE_EMPTY'
  switch (input.rootCause) {
    case 'COMMANDER_AUTH_REQUIRED':
      return 'AUTH_REQUIRED'
    case 'PROVIDER_AUTH_REQUIRED':
    case 'MISSING_ENV':
      return 'PROVIDER_AUTH_REQUIRED'
    case 'UPSTREAM_RATE_LIMIT':
      return 'RATE_LIMITED'
    case 'NO_REGIONAL_COVERAGE':
      return 'NO_COVERAGE'
    case 'PARSER_FAILURE':
      return 'ERROR_PARSE'
    case 'UPSTREAM_403':
    case 'UPSTREAM_404':
    case 'UPSTREAM_5XX':
    case 'PUBLIC_SOURCE_REQUEST_FAILED':
      return 'ERROR_UPSTREAM'
    default:
      return 'ERROR_UPSTREAM'
  }
}
