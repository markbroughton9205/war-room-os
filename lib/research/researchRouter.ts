import { callXAIChat } from '@/lib/ai/providers/xai'
import { tavilyWarRoomSearch } from '@/lib/internet/warRoomSearchProviders'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type LiveResearchRouterInput = {
  decreeText: string
  supabase: WarRoomSupabase | null
  conversationId?: string | null
  /** Hard cap for entire router wall time. */
  budgetMs?: number
}

export type DirectFetchSnippet = {
  url: string
  ok: boolean
  contentSnippet: string
  error?: string
  statusCode?: number
}

export type TavilyLeg = {
  ok: boolean
  results: { title: string; url: string; snippet: string }[]
  error?: string
  durationMs: number
}

export type GrokLeg = {
  ok: boolean
  text: string
  error?: string
}

export type LiveResearchRouterResult = {
  generatedAt: string
  searchQuery: string
  tavily: TavilyLeg
  grok: GrokLeg
  direct: DirectFetchSnippet[]
}

const MAX_DIRECT = 2
const MAX_SNIPPET = 2400
const FETCH_TIMEOUT_MS = 12_000

function isPrivateOrBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '0.0.0.0') return true
  if (h.endsWith('.local')) return true
  if (h === 'metadata.google.internal' || h.endsWith('.internal')) return true
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), d = Number(m[4])
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 100 && b >= 64 && b <= 127) return true /* CGNAT */
    if (d === 0 || d === 255) return true
  }
  return false
}

/**
 * Extract a small number of user-visible http(s) URLs for direct fetch.
 */
export function extractPublicHttpUrls(text: string, max = MAX_DIRECT): string[] {
  const re = /https?:\/\/[^\s\])>'"]+/gi
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null && found.length < max) {
    const u = m[0].replace(/[),.;]+$/g, '')
    try {
      const parsed = new URL(u)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
      if (isPrivateOrBlockedHost(parsed.hostname)) continue
      if (!found.includes(u)) found.push(u)
    } catch {
      /* skip */
    }
  }
  return found
}

function stripHtmlish(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchDirectSnippet(url: string): Promise<DirectFetchSnippet> {
  const started = Date.now()
  try {
    const ac = new AbortController()
    const tid = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'user-agent': 'WarRoomLiveResearch/1.0 (+https://war-room)',
        'accept': 'text/html,text/plain,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    clearTimeout(tid)
    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok) {
      return { url, ok: false, contentSnippet: '', error: `HTTP ${res.status}`, statusCode: res.status }
    }
    const okCt =
      /\btext\/(html|plain)\b/i.test(ct)
      || /\bapplication\/(json|xml)\b/i.test(ct)
      || /\bapplication\/xhtml\+xml\b/i.test(ct)
      || ct.includes('octet-stream')
    if (!okCt) {
      return { url, ok: false, contentSnippet: '', error: `unsupported content-type: ${ct}`, statusCode: res.status }
    }
    const buf = await res.arrayBuffer()
    const slice = buf.byteLength > 120_000 ? buf.slice(0, 120_000) : buf
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice)
    const cleaned = stripHtmlish(text).slice(0, MAX_SNIPPET)
    return {
      url,
      ok: cleaned.length > 40,
      contentSnippet: cleaned,
      statusCode: res.status,
      ...(Date.now() - started > 8000 ? { error: 'slow_response_truncated' } : {}),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { url, ok: false, contentSnippet: '', error: msg }
  }
}

function buildSearchQuery(decreeText: string): string {
  const withoutUrls = decreeText.replace(/https?:\/\/[^\s]+/g, ' ').replace(/\s+/g, ' ').trim()
  const q = withoutUrls.slice(0, 480)
  return q.length ? q : decreeText.slice(0, 480)
}

/**
 * Run Tavily (broad), Grok (social / framing), and validated direct URL fetches in parallel bands.
 * Does not call Gemini (secondary synthesis lives in `researchEvidence.ts`).
 */
export async function runLiveResearchRouter(input: LiveResearchRouterInput): Promise<LiveResearchRouterResult> {
  const generatedAt = new Date().toISOString()
  const searchQuery = buildSearchQuery(input.decreeText)
  const urls = extractPublicHttpUrls(input.decreeText, MAX_DIRECT)

  const tavilyP = tavilyWarRoomSearch(searchQuery, 6).then(r => {
    const results = (r.results ?? [])
      .filter(x => x.title && x.url && /^https?:\/\//i.test(String(x.url)))
      .map(x => ({
        title: String(x.title),
        url: String(x.url),
        snippet: String(x.content ?? '').slice(0, 900),
      }))
    if (r.ok) {
      return { ok: true as const, results, durationMs: r.durationMs }
    }
    let err = 'tavily_failed'
    if ('error' in r && r.error) err = String(r.error)
    else if ('skipped' in r && r.skipped && 'reason' in r) err = String(r.reason)
    return {
      ok: false as const,
      results,
      error: err,
      durationMs: r.durationMs,
    }
  })

  const grokP = (async (): Promise<GrokLeg> => {
    if (!process.env.XAI_API_KEY?.trim()) {
      return { ok: false, text: '', error: 'XAI_API_KEY missing' }
    }
    const result = await callXAIChat({
      messages: [
        {
          role: 'system',
          content:
            'You are Grok in War Room live research routing. Give concise framing: social/realtime *angle* and what to verify next. Do not claim you executed web search; you are reasoning from the user query only.',
        },
        {
          role: 'user',
          content: `Decree / question:\n${input.decreeText.slice(0, 2800)}\n\nSearch line (may be lossy):\n${searchQuery}`,
        },
      ],
      maxTokens: 520,
      timeoutMs: 14_000,
    })
    if (result.status !== 'online') {
      return { ok: false, text: result.text ?? '', error: result.error ?? result.status }
    }
    const text = (result.text ?? '').trim()
    return { ok: Boolean(text), text, error: text ? undefined : 'empty_grok' }
  })()

  const directP = Promise.all(urls.map(u => fetchDirectSnippet(u)))

  const [tRaw, grok, direct] = await Promise.all([tavilyP, grokP, directP])

  const tavily: TavilyLeg = tRaw.ok
    ? { ok: true, results: tRaw.results, durationMs: tRaw.durationMs }
    : { ok: false, results: tRaw.results, error: tRaw.error, durationMs: tRaw.durationMs }

  void input.supabase
  void input.conversationId

  return {
    generatedAt,
    searchQuery,
    tavily,
    grok,
    direct,
  }
}
