import { callXAIChat } from '@/lib/ai/providers/xai'
import { firecrawlWarRoomSearch, tavilyWarRoomSearch } from '@/lib/internet/warRoomSearchProviders'
import { insertInternetLog } from '@/lib/internet/warRoomInternetLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type SearchProviderId = 'grok' | 'tavily' | 'firecrawl'

export type WarRoomSearchOrchestrationInput = {
  query: string
  providers?: SearchProviderId[]
  conversationId?: string | null
  actionId?: string | null
  supabase: WarRoomSupabase | null
}

export type WarRoomSearchOrchestrationResult = {
  query: string
  providerOrder: SearchProviderId[]
  blocks: Record<string, unknown>
}

function defaultProviders(): SearchProviderId[] {
  const grokOn = Boolean(process.env.XAI_API_KEY?.trim())
  if (grokOn) return ['grok', 'tavily', 'firecrawl']
  return ['tavily', 'firecrawl', 'grok']
}

function normalizeProviders(requested?: SearchProviderId[]): SearchProviderId[] {
  const uniq = [...new Set((requested?.length ? requested : defaultProviders()))]
  return uniq.filter((p): p is SearchProviderId => p === 'grok' || p === 'tavily' || p === 'firecrawl')
}

/**
 * When Grok is configured it runs first (realtime framing), then parallel web providers.
 */
export async function orchestrateWarRoomSearch(input: WarRoomSearchOrchestrationInput): Promise<WarRoomSearchOrchestrationResult> {
  const providerOrder = normalizeProviders(input.providers)
  const blocks: Record<string, unknown> = {}
  const grokConfigured = Boolean(process.env.XAI_API_KEY?.trim())

  const runGrok = async () => {
    if (!providerOrder.includes('grok')) return
    const started = Date.now()
    if (!grokConfigured) {
      blocks.grok = { skipped: true, reason: 'XAI_API_KEY missing' }
      await insertInternetLog(input.supabase, {
        conversation_id: input.conversationId,
        action_id: input.actionId,
        provider: 'grok',
        operation: 'search',
        query: input.query,
        status_code: null,
        duration_ms: Date.now() - started,
        metadata: { skipped: true },
      })
      return
    }
    const result = await callXAIChat({
      messages: [
        {
          role: 'system',
          content:
            'You are Grok Family in Ra\'el\'s War Room internet search layer. Give a concise, factual answer or framing for the user query. Do not claim you ran live web search unless results are pasted in the user message.',
        },
        {
          role: 'user',
          content: `User search query:\n${input.query}\n\nAnswer briefly; cite uncertainty where needed.`,
        },
      ],
      maxTokens: 700,
      timeoutMs: 28000,
    })
    const durationMs = Date.now() - started
    blocks.grok = { status: result.status, text: result.text, model: result.model, error: result.error }
    await insertInternetLog(input.supabase, {
      conversation_id: input.conversationId,
      action_id: input.actionId,
      provider: 'grok',
      operation: 'search',
      query: input.query,
      status_code: result.status === 'online' ? 200 : result.status === 'not_connected' ? 503 : 502,
      duration_ms: durationMs,
      metadata: { model: result.model, providerStatus: result.status },
    })
  }

  const runTavily = async () => {
    if (!providerOrder.includes('tavily')) return
    const r = await tavilyWarRoomSearch(input.query)
    blocks.tavily = r
    await insertInternetLog(input.supabase, {
      conversation_id: input.conversationId,
      action_id: input.actionId,
      provider: 'tavily',
      operation: 'search',
      query: input.query,
      status_code: r.statusCode,
      duration_ms: r.durationMs,
      metadata: { ok: r.ok, skipped: 'skipped' in r ? r.skipped : false, resultCount: 'results' in r ? r.results.length : 0 },
    })
  }

  const runFirecrawl = async () => {
    if (!providerOrder.includes('firecrawl')) return
    const r = await firecrawlWarRoomSearch(input.query)
    blocks.firecrawl = r
    await insertInternetLog(input.supabase, {
      conversation_id: input.conversationId,
      action_id: input.actionId,
      provider: 'firecrawl',
      operation: 'search',
      query: input.query,
      status_code: r.statusCode,
      duration_ms: r.durationMs,
      metadata: { ok: r.ok, skipped: 'skipped' in r ? r.skipped : false, resultCount: 'results' in r ? r.results.length : 0 },
    })
  }

  if (grokConfigured && providerOrder.includes('grok') && providerOrder.indexOf('grok') === 0) {
    await runGrok()
    await Promise.all([runTavily(), runFirecrawl()])
  } else {
    await Promise.all([runGrok(), runTavily(), runFirecrawl()])
  }

  return { query: input.query, providerOrder, blocks }
}
