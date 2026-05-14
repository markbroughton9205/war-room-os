import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
import { sourceFromUrl } from '@/lib/income/tavily'
import { tryPersistMemoryProposalFromModelOutput } from '@/lib/memory/ingestFromModel'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const TAVILY_URL = 'https://api.tavily.com/search'
const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
const BABY_MODEL = 'gpt-4o'
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

async function loadMemoryContext() {
  try {
    const supabase = createSupabaseServerClient()
    const { data, error } = await supabase
      .from('memories')
      .select('content, source, family, tags, importance, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_MEMORY_ITEMS)

    if (error) return []
    return data ?? []
  } catch {
    return []
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

async function callBabyAi(prompt: string, system: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return 'I am here in private mode, but the Baby AI chat provider is not configured yet.'
  }

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
  return data.choices?.[0]?.message?.content || 'Baby AI Observer did not respond.'
}

export async function POST(req: Request) {
  const { message, history = [] } = await req.json()
  const userMessage = String(message ?? '').trim()

  if (!userMessage) {
    return NextResponse.json({ error: 'No message' }, { status: 400 })
  }

  const memories = await loadMemoryContext()
  const researchIntent = detectResearchIntent(userMessage)
  const research = researchIntent
    ? await runBabyResearch(userMessage)
    : {
      researchUsed: false,
      researchError: null,
      sources: [] as BabyResearchSource[],
      extractedContent: null as string | null,
    }
  const memoryContext = memories.length
    ? memories.map(memory => `- ${memory.content}`).join('\n')
    : 'No saved memory context available.'
  const researchContext = research.researchUsed && research.sources.length
    ? research.sources.map((item, index) => `${index + 1}. ${item.title} (${item.url})\n${item.snippet}`).join('\n\n')
    : researchIntent
      ? `Research was requested, but no usable sources were returned. ${research.researchError ?? ''}`.trim()
      : 'No web research requested.'
  const extractedContext = research.extractedContent
    ? `Firecrawl extracted top source content:\n${research.extractedContent}`
    : 'No Firecrawl extraction available.'
  const privateThread = Array.isArray(history)
    ? history.slice(-12).map((entry: BabyMessage) => `${entry.role === 'rael' ? "Ra'el" : 'Baby AI Observer'}: ${entry.content}`).join('\n')
    : 'Private room just opened.'

  const system = `You are Baby AI Observer.
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

  const prompt = `Saved memory context:
${memoryContext}

Web research context:
${researchContext}

${extractedContext}

Private chat history:
${privateThread}

Ra'el: ${userMessage}

Respond as Baby AI Observer in private mode. Keep it natural, useful, and concise.`

  const reply = await callBabyAi(prompt, system)

  const supWar = tryWarRoomSupabase()
  await tryPersistMemoryProposalFromModelOutput({
    client: supWar.ok ? supWar.client : null,
    responseText: typeof reply === 'string' ? reply : String(reply),
    fallbackPartition: 'Baby AI Observer',
    conversationId: null,
    extraMetadata: { route: '/api/baby/chat' },
  })

  return NextResponse.json({
    reply,
    providerLabel: 'War Room Native',
    memoryContextCount: memories.length,
    memoryContextActive: memories.length > 0,
    researchUsed: research.researchUsed,
    researchError: research.researchError,
    researchSourceCount: research.sources.length,
    lastResearchTime: research.researchUsed ? new Date().toISOString() : null,
    sources: research.sources,
    recommendMemorySave: shouldRecommendMemorySave(userMessage, reply),
  })
}
