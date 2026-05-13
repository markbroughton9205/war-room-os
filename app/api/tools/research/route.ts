import { NextResponse } from 'next/server'

export async function GET() {
  const tavily = Boolean(process.env.TAVILY_API_KEY?.trim())
  const firecrawl = Boolean(process.env.FIRECRAWL_API_KEY?.trim())

  let status: 'online' | 'standby' | 'partial' | 'config_needed'
  let message: string

  if (tavily && firecrawl) {
    status = 'standby'
    message = 'Tavily and Firecrawl keys present (research standby until invoked).'
  } else if (tavily || firecrawl) {
    status = 'partial'
    message = tavily
      ? 'Tavily configured; add FIRECRAWL_API_KEY for full research stack.'
      : 'Firecrawl configured; add TAVILY_API_KEY for full research stack.'
  } else {
    status = 'config_needed'
    message = 'Set TAVILY_API_KEY and FIRECRAWL_API_KEY for multi-source research.'
  }

  return NextResponse.json({
    tool: 'research',
    status,
    tavilyConfigured: tavily,
    firecrawlConfigured: firecrawl,
    message,
  })
}
