import { NextResponse } from 'next/server'

type ProviderStatus = 'online' | 'standby' | 'error' | 'not_connected'

function keyStatus(keyName: string, routeAvailable = true): ProviderStatus {
  if (!process.env[keyName]) return 'not_connected'
  return routeAvailable ? 'online' : 'standby'
}

export async function GET() {
  return NextResponse.json({
    tool: 'provider-health',
    status: 'complete',
    providers: {
      claude: keyStatus('ANTHROPIC_API_KEY'),
      chatgpt: keyStatus('OPENAI_API_KEY'),
      grok: keyStatus('XAI_API_KEY'),
      gemini: keyStatus('GEMINI_API_KEY'),
      redteam: 'standby',
    },
    labels: {
      claude: process.env.ANTHROPIC_API_KEY ? 'Anthropic · Claude · online' : 'Anthropic · Claude · not connected',
      chatgpt: process.env.OPENAI_API_KEY ? 'OpenAI · ChatGPT · online' : 'OpenAI · ChatGPT · not connected',
      grok: process.env.XAI_API_KEY ? 'xAI · Grok · online' : 'xAI · Grok · not connected',
      gemini: process.env.GEMINI_API_KEY ? 'Google · Gemini · online' : 'Google · Gemini · not connected',
      redteam: 'War Room · Red Team · standby',
    },
  })
}
