import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type ProviderFamilyKey = 'claude' | 'chatgpt' | 'grok' | 'gemini' | 'redteam'

/** Presence/config classification — does not assert live API connectivity. */
export type ProviderAvailability = 'configured' | 'not_configured' | 'probe_required'

function trimmedEnv(key: string): boolean {
  return Boolean(process.env[key]?.trim())
}

/**
 * Maps availability to the legacy `providers` map consumed by older UI code.
 * Avoids reporting `online` from credential presence alone.
 */
function legacyConnectionStatus(avail: ProviderAvailability): 'online' | 'standby' | 'error' | 'not_connected' {
  if (avail === 'not_configured') return 'not_connected'
  return 'standby'
}

export async function GET() {
  const availability: Record<ProviderFamilyKey, ProviderAvailability> = {
    claude: trimmedEnv('ANTHROPIC_API_KEY') ? 'configured' : 'not_configured',
    chatgpt: trimmedEnv('OPENAI_API_KEY') ? 'configured' : 'not_configured',
    grok: trimmedEnv('XAI_API_KEY') ? 'configured' : 'not_configured',
    gemini: trimmedEnv('GEMINI_API_KEY') ? 'configured' : 'not_configured',
    redteam: 'probe_required',
  }

  const providers = {
    claude: legacyConnectionStatus(availability.claude),
    chatgpt: legacyConnectionStatus(availability.chatgpt),
    grok: legacyConnectionStatus(availability.grok),
    gemini: legacyConnectionStatus(availability.gemini),
    redteam: 'standby' as const,
  }

  const labels = {
    claude:
      availability.claude === 'not_configured'
        ? 'Anthropic · Claude · not configured'
        : 'Anthropic · Claude · key configured (live probe required)',
    chatgpt:
      availability.chatgpt === 'not_configured'
        ? 'OpenAI · ChatGPT · not configured'
        : 'OpenAI · ChatGPT · key configured (live probe required)',
    grok:
      availability.grok === 'not_configured'
        ? 'xAI · Grok · not configured'
        : 'xAI · Grok · key configured (live probe required)',
    gemini:
      availability.gemini === 'not_configured'
        ? 'Google · Gemini · not configured'
        : 'Google · Gemini · key configured — live engine status via GET /api/engine-control/status',
    redteam: 'War Room · Red Team · standby',
  }

  return NextResponse.json({
    tool: 'provider-health',
    status: 'complete',
    availability,
    providers,
    labels,
    guidance:
      '`availability` reflects credential/configuration hints only; use GET /api/engine-control/status or GET /api/debug/provider-health for live preflight where enabled.',
    deprecatedSemantics: {
      providersOnlineFromKeysOnly:
        'Removed: keys alone no longer imply `providers.* === "online"` (mapped to standby when configured). Prefer `availability`.',
    },
  })
}
