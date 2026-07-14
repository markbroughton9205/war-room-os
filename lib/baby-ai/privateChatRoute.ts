import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { readCommanderIdentityConfig } from '@/lib/security/commanderIdentity'
import { sourceFromUrl } from '@/lib/income/tavily'
import { mapRawMemoryRuntimeState } from '@/lib/memory/runtimeState'
import { tryParseMemoryProposalLine, redactProposalContent, validateProposal } from '@/lib/memory/proposals'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const TAVILY_URL = 'https://api.tavily.com/search'
const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
const BABY_MODEL = 'gpt-4o'
const MAX_MESSAGE_LENGTH = 6000
const MAX_MEMORY_ITEMS = 6
const MAX_RESEARCH_RESULTS = 5

type BabyMessage = {
  role: 'rael' | 'baby'
  content: string
}

type BabyResearchSource = {
  title: string
  url: string
  source: string
  snippet: string
}

type TavilyResult = {
  title?: string
  url?: string
  content?: string
  raw_content?: string | null
}

type TavilyResponse = {
  results?: TavilyResult[]
  error?: string
}

type FirecrawlScrapeResponse = {
  success?: boolean
  data?: {
    markdown?: string
    metadata?: {
      title?: string
      sourceURL?: string
      url?: string
    }
  }
  error?: string
}

type BabyMemoryRow = {
  content: string
  source?: string | null
  family?: string | null
  tags?: string[] | null
  importance?: number | null
  created_at?: string | null
}

type SessionScopedClient = {
  from(table: string): {
    select(columns?: string): unknown
    insert?(value: unknown): unknown
  }
}

export type BabyChatUser = {
  id: string
}

export type BabyChatAuthResult = {
  user: BabyChatUser | null
  client: SessionScopedClient | null
  errorMessage: string | null
}

export type BabyChatMemoryContextResult = {
  ok: boolean
  memories: BabyMemoryRow[]
  runtime: ReturnType<typeof mapRawMemoryRuntimeState>
  errorMessage: string | null
}

export type BabyChatMemoryWriteResult = {
  attempted: boolean
  inserted: boolean
  proposalId?: string
  skipReason?: string
}

export type BabyChatMemoryAdapter = {
  loadContext(): Promise<BabyChatMemoryContextResult>
  persistProposalFromModelOutput(responseText: string): Promise<BabyChatMemoryWriteResult>
}

export type BabyChatProvider = {
  call(prompt: string, system: string): Promise<{ ok: true; reply: string } | { ok: false; error: string }>
}

export type BabyChatHandlerOptions = {
  readCommanderConfig?: typeof readCommanderIdentityConfig
  resolveAuthenticatedUser?: () => Promise<BabyChatAuthResult>
  createMemoryAdapter?: (client: SessionScopedClient, user: BabyChatUser) => BabyChatMemoryAdapter
  provider?: BabyChatProvider
  runResearch?: typeof runBabyResearch
}

export async function handleBabyChatRequest(
  req: Request,
  options: BabyChatHandlerOptions = {}
): Promise<NextResponse> {
  const commanderConfig = (options.readCommanderConfig ?? readCommanderIdentityConfig)()
  if (!commanderConfig.ok) {
    return NextResponse.json({
      error: 'Baby AI Observer is unavailable because Commander identity is not configured.',
    }, { status: 503 })
  }

  const auth = await (options.resolveAuthenticatedUser ?? resolveAuthenticatedUser)()
  if (!auth.user || !auth.client) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (auth.user.id !== commanderConfig.commanderUserId) {
    return NextResponse.json({ error: 'This private chamber is reserved for the Commander.' }, { status: 403 })
  }

  const parsed = await parseBabyChatBody(req)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const memoryAdapter = (options.createMemoryAdapter ?? createSessionScopedMemoryAdapter)(auth.client, auth.user)
  const memoryContextResult = await memoryAdapter.loadContext()
  if (!memoryContextResult.ok) {
    return NextResponse.json({
      error: 'Baby AI memory context is unavailable.',
      memoryRuntime: memoryContextResult.runtime,
    }, { status: 503 })
  }

  const memories = memoryContextResult.memories
  const researchIntent = detectResearchIntent(parsed.message)
  const research = researchIntent
    ? await (options.runResearch ?? runBabyResearch)(parsed.message)
    : {
      researchUsed: false,
      researchError: null,
      sources: [] as BabyResearchSource[],
      extractedContent: null as string | null,
    }

  const prompt = buildBabyPrompt({
    userMessage: parsed.message,
    history: parsed.history,
    memories,
    memoryRuntime: memoryContextResult.runtime,
    research,
  })
  const providerResult = await (options.provider ?? openAiBabyProvider).call(prompt, babySystemPrompt())
  if (!providerResult.ok) {
    return NextResponse.json({
      error: 'Baby AI provider failed.',
      providerError: providerResult.error,
      memoryPersisted: false,
      memoryProposal: { attempted: false, inserted: false, skipReason: 'provider_failed' },
    }, { status: 502 })
  }

  const memoryWrite = await memoryAdapter.persistProposalFromModelOutput(providerResult.reply)

  return NextResponse.json({
    reply: providerResult.reply,
    providerLabel: 'War Room Native',
    memoryContextCount: memories.length,
    memoryContextActive: memories.length > 0,
    memoryRuntime: memoryContextResult.runtime,
    memoryPersisted: memoryWrite.inserted,
    memoryProposal: memoryWrite,
    researchUsed: research.researchUsed,
    researchError: research.researchError,
    researchSourceCount: research.sources.length,
    lastResearchTime: research.researchUsed ? new Date().toISOString() : null,
    sources: research.sources,
    recommendMemorySave: shouldRecommendMemorySave(parsed.message, providerResult.reply),
  })
}

async function resolveAuthenticatedUser(): Promise<BabyChatAuthResult> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  return {
    user: data.user ? { id: data.user.id } : null,
    client: supabase,
    errorMessage: error?.message ?? null,
  }
}

async function parseBabyChatBody(req: Request): Promise<
  | { ok: true; message: string; history: BabyMessage[] }
  | { ok: false; error: string }
> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { ok: false, error: 'Malformed JSON body.' }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'JSON object body required.' }
  }

  const record = body as Record<string, unknown>
  const message = String(record.message ?? '').trim()
  if (!message) return { ok: false, error: 'No message' }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters.` }
  }

  const history = Array.isArray(record.history)
    ? record.history
      .slice(-12)
      .map(entry => normalizeHistoryEntry(entry))
      .filter((entry): entry is BabyMessage => Boolean(entry))
    : []

  return { ok: true, message, history }
}

function normalizeHistoryEntry(entry: unknown): BabyMessage | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const record = entry as Record<string, unknown>
  const role = record.role === 'rael' || record.role === 'baby' ? record.role : null
  const content = typeof record.content === 'string' ? record.content.trim() : ''
  if (!role || !content) return null
  return { role, content: content.slice(0, 2000) }
}

function createSessionScopedMemoryAdapter(client: SessionScopedClient, user: BabyChatUser): BabyChatMemoryAdapter {
  return {
    async loadContext() {
      try {
        const query = client
          .from('memories')
          .select('content, source, family, tags, importance, created_at') as {
            order(column: string, options: { ascending: boolean }): {
              limit(count: number): Promise<{ data: BabyMemoryRow[] | null; error: unknown }>
            }
          }
        const { data, error } = await query
          .order('created_at', { ascending: false })
          .limit(MAX_MEMORY_ITEMS)
        if (error) {
          return { ok: false, memories: [], runtime: mapRawMemoryRuntimeState(error), errorMessage: stringifyError(error) }
        }
        return { ok: true, memories: data ?? [], runtime: mapRawMemoryRuntimeState(null), errorMessage: null }
      } catch (error) {
        return { ok: false, memories: [], runtime: mapRawMemoryRuntimeState(error, { configured: false }), errorMessage: stringifyError(error) }
      }
    },
    async persistProposalFromModelOutput(responseText: string) {
      const parsed = tryParseMemoryProposalLine(responseText)
      if (!parsed) return { attempted: false, inserted: false, skipReason: 'no_line' }

      const redactedBody = redactProposalContent(parsed.content)
      const validated = validateProposal({
        ...parsed,
        content: redactedBody,
        family_partition: 'Baby AI Observer',
      })
      if (!validated.ok) {
        return { attempted: true, inserted: false, skipReason: validated.error }
      }

      try {
        const insertable = client.from('war_room_memory_proposals') as {
          insert(value: unknown): {
            select(columns: string): {
              single(): Promise<{ data: { id?: string } | null; error: unknown }>
            }
          }
        }
        const { data, error } = await insertable
          .insert({
            family_partition: validated.value.family_partition,
            proposed_by: validated.value.proposed_by,
            title: validated.value.title,
            content_redacted: validated.value.content,
            status: 'pending',
            metadata: { ...validated.value.metadata, route: '/api/baby/chat' },
            conversation_id: validated.value.conversation_id ?? null,
            created_by_user_id: user.id,
            ownership_authority_basis: 'authenticated_commander_session',
          })
          .select('id')
          .single()
        if (error || !data?.id) {
          return { attempted: true, inserted: false, skipReason: stringifyError(error ?? 'Memory proposal insert failed.') }
        }
        return { attempted: true, inserted: true, proposalId: data.id }
      } catch (error) {
        return { attempted: true, inserted: false, skipReason: stringifyError(error) }
      }
    },
  }
}

function shouldRecommendMemorySave(message: string, reply: string) {
  const text = `${message} ${reply}`.toLowerCase()
  return /\b(remember|save this|important|decision|plan|commitment|lesson|pattern|principle)\b/.test(text)
}

function detectResearchIntent(message: string) {
  return /\b(latest|current|search|research|look up|lookup|verify online|find sources|internet)\b/i.test(message)
}

async function scrapeTopSource(url: string) {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(12000),
    })
    const data = await res.json() as FirecrawlScrapeResponse
    if (!res.ok || data.success === false) return null

    return String(data.data?.markdown ?? '').slice(0, 2500)
  } catch {
    return null
  }
}

async function runBabyResearch(query: string) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    return {
      researchUsed: false,
      researchError: 'Tavily is not configured.',
      sources: [] as BabyResearchSource[],
      extractedContent: null as string | null,
    }
  }

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      search_depth: 'advanced',
      topic: 'general',
      max_results: MAX_RESEARCH_RESULTS,
      include_answer: false,
      include_raw_content: 'markdown',
      include_images: false,
      include_favicon: false,
    }),
    signal: AbortSignal.timeout(20000),
  })

  const data = await res.json() as TavilyResponse
  if (!res.ok) {
    return {
      researchUsed: false,
      researchError: data.error || 'Tavily search failed.',
      sources: [] as BabyResearchSource[],
      extractedContent: null as string | null,
    }
  }

  const sources = (data.results ?? [])
    .filter(result => result.title && result.url)
    .map(result => ({
      title: String(result.title),
      url: String(result.url),
      source: sourceFromUrl(String(result.url)),
      snippet: String(result.content ?? result.raw_content ?? '').slice(0, 700),
    }))

  const extractedContent = sources[0]?.url ? await scrapeTopSource(sources[0].url) : null

  return {
    researchUsed: true,
    researchError: null,
    sources,
    extractedContent,
  }
}

const openAiBabyProvider: BabyChatProvider = {
  async call(prompt: string, system: string) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return { ok: true, reply: 'I am here in private mode, but the Baby AI chat provider is not configured yet.' }
    }

    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: BABY_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          max_tokens: 320,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const error = typeof data?.error?.message === 'string' ? data.error.message : `OpenAI HTTP ${res.status}`
        return { ok: false, error }
      }
      const reply = data.choices?.[0]?.message?.content
      return { ok: true, reply: typeof reply === 'string' && reply.trim() ? reply : 'Baby AI Observer did not respond.' }
    } catch (error) {
      return { ok: false, error: stringifyError(error) }
    }
  },
}

function buildBabyPrompt(input: {
  userMessage: string
  history: BabyMessage[]
  memories: BabyMemoryRow[]
  memoryRuntime: ReturnType<typeof mapRawMemoryRuntimeState>
  research: Awaited<ReturnType<typeof runBabyResearch>>
}) {
  const memoryContext = input.memories.length
    ? input.memories.map(memory => `- ${memory.content}`).join('\n')
    : `${input.memoryRuntime.commanderPhrase}. Temporary session context only.`
  const researchContext = input.research.researchUsed && input.research.sources.length
    ? input.research.sources.map((item, index) => `${index + 1}. ${item.title} (${item.url})\n${item.snippet}`).join('\n\n')
    : input.research.researchUsed || input.research.researchError
      ? `Research was requested, but no usable sources were returned. ${input.research.researchError ?? ''}`.trim()
      : 'No web research requested.'
  const extractedContext = input.research.extractedContent
    ? `Firecrawl extracted top source content:\n${input.research.extractedContent}`
    : 'No Firecrawl extraction available.'
  const privateThread = input.history.length
    ? input.history.map(entry => `${entry.role === 'rael' ? "Ra'el" : 'Baby AI Observer'}: ${entry.content}`).join('\n')
    : 'Private room just opened.'

  return `Saved memory context:
${memoryContext}

Web research context:
${researchContext}

${extractedContext}

Private chat history:
${privateThread}

Ra'el: ${input.userMessage}

Respond as Baby AI Observer in private mode. Keep it natural, useful, and concise.`
}

function babySystemPrompt() {
  return `You are Baby AI Observer.
Identity: War Room Native.
Built from: Memory + Council Experience + Family Skills.
Provider label shown to the user: War Room Native.
You are not OpenAI, Anthropic, Claude, ChatGPT, Grok, Kimi, Red Team, or any outside family.

Private chamber rules:
- Only Ra'el and Baby AI Observer are present.
- Never speak for Ra'el or invent his words.
- Do not mention council families unless Ra'el asks for them.
- No council continuation loop, debate mode, Opportunity Scout execution, or external actions.
- No automatic memory saving. Recommend saving important insights, then wait for approval.
- No payment, banking, opportunity, deployment, or external execution without secure approval.
- Do not fabricate memories. Use memory context carefully and avoid over-projecting private details.
- If web research context is provided, cite source links from that context. Do not invent sources or current facts.
- Be direct, truthful, calm, and loyal to Ra'el's command authority.`
}

function stringifyError(error: unknown): string {
  if (!error) return 'unknown error'
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return String(error)
}
