import { INTERNET_TOOL_REGISTRY } from '@/lib/tools/internet/registry'
import type { InternetToolHealth, InternetToolId, InternetToolStatus } from '@/lib/tools/internet/types'

export async function probeTavily(): Promise<Pick<InternetToolHealth, 'status' | 'notes'>> {
  const apiKey = process.env.TAVILY_API_KEY?.trim()
  if (!apiKey) return { status: 'config_needed', notes: 'TAVILY_API_KEY is missing.' }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'status check', max_results: 1, include_answer: false }),
      signal: AbortSignal.timeout(7000),
    })
    if (response.ok) return { status: 'reachable', notes: 'Tavily responded to a minimal server-side search check.' }
    return { status: 'error', notes: `Tavily returned HTTP ${response.status}.` }
  } catch (error) {
    return { status: 'error', notes: error instanceof Error ? error.message : 'Tavily reachability check failed.' }
  }
}

export async function probeFirecrawl(): Promise<Pick<InternetToolHealth, 'status' | 'notes'>> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
  if (!apiKey) return { status: 'config_needed', notes: 'FIRECRAWL_API_KEY is missing.' }

  try {
    const response = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'status check', limit: 1, sources: ['web'] }),
      signal: AbortSignal.timeout(7000),
    })
    if (response.ok) return { status: 'reachable', notes: 'Firecrawl responded to a minimal server-side search check.' }
    return { status: 'error', notes: `Firecrawl returned HTTP ${response.status}.` }
  } catch (error) {
    return { status: 'error', notes: error instanceof Error ? error.message : 'Firecrawl reachability check failed.' }
  }
}

export async function probeXAI(): Promise<Pick<InternetToolHealth, 'status' | 'notes'>> {
  const apiKey = process.env.XAI_API_KEY?.trim()
  if (!apiKey) return { status: 'config_needed', notes: 'XAI_API_KEY is missing.' }

  try {
    const response = await fetch('https://api.x.ai/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(7000),
    })
    if (response.ok) return { status: 'reachable', notes: 'xAI API responded to a server-side models check.' }
    return { status: 'error', notes: `xAI returned HTTP ${response.status}.` }
  } catch (error) {
    return { status: 'error', notes: error instanceof Error ? error.message : 'xAI reachability check failed.' }
  }
}

export async function probeDirectFetch(): Promise<Pick<InternetToolHealth, 'status' | 'notes'>> {
  try {
    const response = await fetch('https://example.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(7000),
    })
    if (response.ok) return { status: 'reachable', notes: 'Server-side fetch reached example.com.' }
    return { status: 'error', notes: `Direct fetch returned HTTP ${response.status}.` }
  } catch (error) {
    return { status: 'error', notes: error instanceof Error ? error.message : 'Direct fetch failed.' }
  }
}

async function probeTool(id: InternetToolId): Promise<Pick<InternetToolHealth, 'status' | 'notes'>> {
  if (id === 'tavily') return probeTavily()
  if (id === 'firecrawl') return probeFirecrawl()
  if (id === 'grok_xai') return probeXAI()
  return probeDirectFetch()
}

export async function buildInternetToolMatrix(): Promise<{
  tools: Record<InternetToolId, InternetToolHealth>
  lastChecked: string
}> {
  const lastChecked = new Date().toISOString()
  const entries = await Promise.all(INTERNET_TOOL_REGISTRY.map(async tool => {
    const result = await probeTool(tool.id)
    const status: InternetToolStatus = result.status
    return {
      id: tool.id,
      name: tool.name,
      status,
      lastChecked,
      notes: result.notes || tool.notes,
    } satisfies InternetToolHealth
  }))
  const tools = entries.reduce((acc, tool) => {
    acc[tool.id] = tool
    return acc
  }, {} as Record<InternetToolId, InternetToolHealth>)

  return {
    tools,
    lastChecked,
  }
}
