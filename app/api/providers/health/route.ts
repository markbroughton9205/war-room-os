import { NextResponse } from 'next/server'

type ProviderStatus = 'online' | 'standby' | 'error' | 'not_connected'

function keyStatus(keyName: string, routeAvailable = true): ProviderStatus {
  if (!process.env[keyName]) return 'not_connected'
  return routeAvailable ? 'online' : 'standby'
}

function geminiProviderHealth(): { status: ProviderStatus; label: string } {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    return { status: 'not_connected', label: 'Google · Gemini · not connected' }
  }
  return {
    status: 'standby',
    label: 'Google · Gemini · key present — live status in GET /api/engine-control/status',
  }
}

export async function GET() {
  const gemini = geminiProviderHealth()
  return NextResponse.json({
    tool: 'provider-health',
    status: 'complete',
    providers: {
      claude: keyStatus('ANTHROPIC_API_KEY'),
      chatgpt: keyStatus('OPENAI_API_KEY'),
      grok: keyStatus('XAI_API_KEY'),
      gemini: gemini.status,
      redteam: 'standby',
    },
    labels: {
      claude: process.env.ANTHROPIC_API_KEY ? 'Anthropic · Claude · online' : 'Anthropic · Claude · not connected',
      chatgpt: process.env.OPENAI_API_KEY ? 'OpenAI · ChatGPT · online' : 'OpenAI · ChatGPT · not connected',
      grok: process.env.XAI_API_KEY ? 'xAI · grok · online' : 'xAI · grok · not connected',
      gemini: gemini.label,
      redteam: 'War Room · Red Team · standby',
    },
  })
}
