import { NextResponse } from 'next/server'

export async function GET() {
  const configured = Boolean(process.env.XAI_API_KEY)

  return NextResponse.json({
    tool: 'income-grok-live-search',
    status: configured ? 'online' : 'not_connected',
    provider: 'xAI',
    model: configured ? 'Grok · configured' : 'Grok · not connected',
    message: configured
      ? 'Grok/live search route is configured. Live search execution is not wired yet.'
      : 'Grok/live search integration route ready. XAI_API_KEY is not configured.',
    opportunities: [],
  })
}
