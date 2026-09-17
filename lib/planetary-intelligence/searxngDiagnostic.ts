export const SEARXNG_FAILURE_CATEGORIES = [
  'CONNECTION_REFUSED',
  'DNS_FAILURE',
  'TIMEOUT',
  'HTTP_ERROR',
  'BAD_RESPONSE',
  'AUTH_ERROR',
  'SERVICE_NOT_RUNNING',
  'MISCONFIGURED_URL',
  'OTHER',
] as const
export type SearxngFailureCategory = (typeof SEARXNG_FAILURE_CATEGORIES)[number]

export type SearxngDiagnostic = {
  configured: boolean
  category: SearxngFailureCategory | 'LIVE' | 'NOT_CONFIGURED'
  label: string
  hostKind: 'loopback' | 'private' | 'public' | 'missing' | 'invalid'
  statusCode: number | null
  detail: string
}

export function classifySearxngFailure(input: {
  configured: boolean
  message?: string | null
  statusCode?: number | null
  warningCode?: string | null
}): SearxngFailureCategory | 'NOT_CONFIGURED' {
  if (!input.configured) return 'NOT_CONFIGURED'
  const blob = `${input.message ?? ''} ${input.warningCode ?? ''}`.toLowerCase()
  const status = input.statusCode ?? 0
  if (status === 401 || status === 403 || /auth/.test(blob)) return 'AUTH_ERROR'
  if (/econnrefused|connection refused/.test(blob)) return 'CONNECTION_REFUSED'
  if (/enotfound|dns|getaddrinfo/.test(blob)) return 'DNS_FAILURE'
  if (/timeout|aborterror|seaxng_timeout|searxng_timeout/.test(blob)) return 'TIMEOUT'
  if (/invalid.?response|bad.?response|not json/.test(blob)) return 'BAD_RESPONSE'
  if (/misconfigured|invalid url|searxng_not_configured/.test(blob)) return 'MISCONFIGURED_URL'
  if (status >= 400) return 'HTTP_ERROR'
  if (/unreachable|econnreset|fetch failed|und_err/.test(blob)) return 'SERVICE_NOT_RUNNING'
  return 'OTHER'
}

export function searxngOfflineLabel(category: SearxngFailureCategory | 'NOT_CONFIGURED'): string {
  if (category === 'NOT_CONFIGURED') return 'SEARXNG_NOT_CONFIGURED'
  if (category === 'CONNECTION_REFUSED' || category === 'SERVICE_NOT_RUNNING' || category === 'DNS_FAILURE') {
    return 'SEARXNG_CONFIG_PRESENT_SERVICE_OFFLINE'
  }
  return `SEARXNG_${category}`
}

function hostKindFromUrl(raw: string | undefined): SearxngDiagnostic['hostKind'] {
  if (!raw?.trim()) return 'missing'
  try {
    const host = new URL(raw).hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'loopback'
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host) || host.endsWith('.internal') || host.endsWith('.local')) return 'private'
    return 'public'
  } catch {
    return 'invalid'
  }
}

export async function diagnoseSearxng(env: Record<string, string | undefined> = process.env): Promise<SearxngDiagnostic> {
  const raw = env.SEARXNG_BASE_URL
  const hostKind = hostKindFromUrl(raw)
  if (!raw?.trim()) {
    return { configured: false, category: 'NOT_CONFIGURED', label: 'SEARXNG_NOT_CONFIGURED', hostKind, statusCode: null, detail: 'SEARXNG_BASE_URL missing' }
  }
  const { runSearxngSearch } = await import('@/lib/war-room-search/providers/searxng')
  const leg = await runSearxngSearch('war room searxng diagnostic ping', { pageSize: 1, env })
  if (leg.ok) {
    return { configured: true, category: 'LIVE', label: 'LIVE', hostKind, statusCode: leg.statusCode, detail: 'SearXNG returned results' }
  }
  const category = classifySearxngFailure({
    configured: true,
    message: leg.error,
    statusCode: leg.statusCode,
    warningCode: leg.warningCode,
  })
  const mapped = category === 'NOT_CONFIGURED' ? 'MISCONFIGURED_URL' : category
  return {
    configured: true,
    category: mapped,
    label: searxngOfflineLabel(mapped),
    hostKind,
    statusCode: leg.statusCode,
    detail: leg.warningCode || leg.error || mapped,
  }
}
