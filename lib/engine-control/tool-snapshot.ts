import type { ToolRoutingSnapshot } from './types'

/**
 * Builds internet/research flags for `routeCommand` inside API routes.
 * Uses same HTTP endpoints as the War Room tool panels (no duplicated probe logic).
 */
export async function buildToolRoutingSnapshotFromOrigin(origin: string | null): Promise<ToolRoutingSnapshot> {
  if (!origin) {
    return { internetReachable: false, researchConfigured: false }
  }

  try {
    const [internetRes, researchRes] = await Promise.all([
      fetch(`${origin}/api/tools/internet/status`, { cache: 'no-store', signal: AbortSignal.timeout(2000) }),
      fetch(`${origin}/api/tools/research`, { cache: 'no-store', signal: AbortSignal.timeout(2000) }),
    ])

    type InternetJson = { canUseInternet?: boolean }
    type ResearchJson = { tavilyConfigured?: boolean; firecrawlConfigured?: boolean }

    const internetJson: InternetJson = internetRes.ok ? (await internetRes.json()) as InternetJson : {}
    const researchJson: ResearchJson = researchRes.ok ? (await researchRes.json()) as ResearchJson : {}

    return {
      internetReachable: Boolean(internetJson.canUseInternet),
      researchConfigured: Boolean(researchJson.tavilyConfigured || researchJson.firecrawlConfigured),
    }
  } catch {
    return { internetReachable: false, researchConfigured: false }
  }
}

export async function requestOriginFromHeaders(): Promise<string | null> {
  const { headers } = await import('next/headers')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) return null
  return `${proto}://${host}`
}
