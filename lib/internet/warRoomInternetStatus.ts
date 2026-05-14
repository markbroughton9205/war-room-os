import { buildInternetToolMatrix } from '@/lib/internet/probes'

const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function probeGeminiList(): Promise<{ configured: boolean; reachable: boolean; notes: string }> {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) {
    return { configured: false, reachable: false, notes: 'GEMINI_API_KEY is not set.' }
  }
  try {
    const res = await fetch(`${GEMINI_REST_BASE}/models?pageSize=1`, {
      method: 'GET',
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(7000),
      cache: 'no-store',
    })
    if (res.ok) {
      return { configured: true, reachable: true, notes: 'Gemini list-models probe succeeded (read-only).' }
    }
    return { configured: true, reachable: false, notes: `Gemini list-models returned HTTP ${res.status}.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Gemini probe failed.'
    return { configured: true, reachable: false, notes: msg }
  }
}

export type WarRoomInternetLayerStatus = {
  lastChecked: string
  tavily: { apiKeyPresent: boolean } & { status: string; notes: string }
  firecrawl: { apiKeyPresent: boolean } & { status: string; notes: string }
  grok: { apiKeyPresent: boolean } & { status: string; notes: string }
  gemini: { apiKeyPresent: boolean; configured: boolean; reachable: boolean; notes: string }
  fetch: {
    allowed: boolean
    exampleComProbe: { status: string; notes: string }
  }
  toolsMatrix: Awaited<ReturnType<typeof buildInternetToolMatrix>>
}

export async function buildWarRoomInternetLayerStatus(): Promise<WarRoomInternetLayerStatus> {
  const [matrix, gemini, exampleCom] = await Promise.all([
    buildInternetToolMatrix(),
    probeGeminiList(),
    (async () => {
      try {
        const r = await fetch('https://example.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) })
        return r.ok
          ? { status: 'reachable', notes: 'Outbound HTTPS fetch to example.com succeeded.' }
          : { status: 'error', notes: `example.com returned HTTP ${r.status}.` }
      } catch (e) {
        return { status: 'error', notes: e instanceof Error ? e.message : 'Probe failed.' }
      }
    })(),
  ])

  const t = matrix.tools.tavily
  const f = matrix.tools.firecrawl
  const g = matrix.tools.grok_xai

  return {
    lastChecked: matrix.lastChecked,
    tavily: {
      apiKeyPresent: Boolean(process.env.TAVILY_API_KEY?.trim()),
      status: t.status,
      notes: t.notes,
    },
    firecrawl: {
      apiKeyPresent: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
      status: f.status,
      notes: f.notes,
    },
    grok: {
      apiKeyPresent: Boolean(process.env.XAI_API_KEY?.trim()),
      status: g.status,
      notes: g.notes,
    },
    gemini: {
      apiKeyPresent: Boolean(process.env.GEMINI_API_KEY?.trim()),
      configured: gemini.configured,
      reachable: gemini.reachable,
      notes: gemini.notes,
    },
    fetch: {
      allowed: true,
      exampleComProbe: exampleCom,
    },
    toolsMatrix: matrix,
  }
}
