import { NextResponse } from 'next/server'

function tavilyConfigured() {
  return Boolean(process.env.TAVILY_API_KEY?.trim())
}

export async function GET() {
  const hasTavily = tavilyConfigured()
  return NextResponse.json({
    tool: 'web',
    tavilyConfigured: hasTavily,
    status: hasTavily ? 'standby' : 'config_needed',
    message: hasTavily
      ? 'Tavily API key present (web search standby until invoked).'
      : 'Set TAVILY_API_KEY for live web search.',
  })
}
