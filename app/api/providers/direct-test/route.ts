import { NextResponse } from 'next/server'
import {
  invokeDirectCouncilProvider,
  type DirectProviderFamily,
} from '@/lib/council/providerDirectCall'
import { logCouncilPacketMetrics } from '@/lib/council/packetSizeLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { toDisplayText } from '@/lib/council/toDisplayText'
import { KIMI_DEFAULT_MODEL, MOONSHOT_API_BASE } from '@/lib/providers/kimi'

const DIRECT_PROVIDERS = new Set<DirectProviderFamily>([
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'red_team',
  'baby',
])

const DEFAULT_PROMPT = 'Reply with OK only.'

function parseProvider(raw: unknown): DirectProviderFamily | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase() as DirectProviderFamily
  return DIRECT_PROVIDERS.has(key) ? key : null
}

async function runDirectTest(provider: DirectProviderFamily, prompt: string, fullRetry: boolean) {
  const started = Date.now()
  const first = await invokeDirectCouncilProvider(provider, prompt)
  let result = first
  let fallbackUsed = false

  if (!fullRetry && !first.ok) {
    /* stability path: no orchestration retries */
  } else if (!first.ok) {
    const retry = await invokeDirectCouncilProvider(provider, prompt)
    if (retry.ok) {
      result = retry
      fallbackUsed = true
    }
  }

  const latencyMs = Date.now() - started
  const preview = result.text ? result.text.slice(0, 160) : ''
  const sup = tryWarRoomSupabase()

  await logCouncilPacketMetrics(sup.ok ? sup.client : null, {
    route: '/api/providers/direct-test',
    provider,
    promptCharCount: prompt.length,
    providerResponseCharCount: result.text.length,
    integrityRejectionReason: result.ok ? null : result.error ?? 'direct_test_failed',
    timedOut: result.transportStatus === 'timeout',
    fallbackUsed,
  })

  const kimiDiagnostics =
    provider === 'kimi'
      ? {
          hasKimiApiKey: result.kimiDiagnostics?.hasKimiApiKey ?? Boolean(process.env.KIMI_API_KEY?.trim()),
          hasMoonshotApiKey: result.kimiDiagnostics?.hasMoonshotApiKey ?? Boolean(process.env.MOONSHOT_API_KEY?.trim()),
          selectedEnvKeyName: result.kimiDiagnostics?.selectedEnvKeyName ?? null,
          baseUrl: result.kimiDiagnostics?.baseUrl ?? MOONSHOT_API_BASE,
          model: result.kimiDiagnostics?.model ?? KIMI_DEFAULT_MODEL,
          upstreamStatus: result.kimiDiagnostics?.upstreamStatus ?? null,
          sanitizedUpstreamErrorMessage: result.kimiDiagnostics?.sanitizedUpstreamErrorMessage ?? null,
        }
      : null

  if (provider === 'kimi') {
    console.info('[providers/direct-test][kimi]', {
      success: result.ok,
      transportStatus: result.transportStatus,
      errorKind: result.kimiErrorKind ?? null,
      error: result.ok ? null : result.error ?? 'provider call failed',
      diagnostics: kimiDiagnostics,
    })
  }

  return {
    provider,
    transportStatus: result.transportStatus,
    responseLength: result.text.length,
    responsePreview: preview,
    latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error ?? 'provider call failed',
    fallbackUsed,
    fullRetryEnabled: fullRetry,
    ...(provider === 'kimi'
      ? {
          kimiDiagnostics: {
            hasKimiApiKey: kimiDiagnostics?.hasKimiApiKey ?? false,
            hasMoonshotApiKey: kimiDiagnostics?.hasMoonshotApiKey ?? false,
            selectedEnvKeyName: kimiDiagnostics?.selectedEnvKeyName ?? null,
            baseUrl: kimiDiagnostics?.baseUrl ?? MOONSHOT_API_BASE,
            model: kimiDiagnostics?.model ?? KIMI_DEFAULT_MODEL,
            upstreamStatus: kimiDiagnostics?.upstreamStatus ?? null,
            sanitizedUpstreamErrorMessage: kimiDiagnostics?.sanitizedUpstreamErrorMessage ?? null,
          },
          kimiErrorKind: result.kimiErrorKind ?? null,
        }
      : {}),
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const provider = parseProvider(url.searchParams.get('provider'))
  if (!provider) {
    return NextResponse.json(
      { error: 'provider query required (chatgpt|claude|grok|gemini|kimi|red_team|baby)' },
      { status: 400 },
    )
  }
  const prompt = toDisplayText(url.searchParams.get('prompt')) || DEFAULT_PROMPT
  const fullRetry = url.searchParams.get('full') !== 'false'
  const body = await runDirectTest(provider, prompt, fullRetry)
  return NextResponse.json(body, { status: body.success ? 200 : 502 })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const provider = parseProvider(body.provider)
  if (!provider) {
    return NextResponse.json(
      { error: 'provider required (chatgpt|claude|grok|gemini|kimi|red_team|baby)' },
      { status: 400 },
    )
  }

  const url = new URL(req.url)
  const prompt = toDisplayText(body.prompt) || DEFAULT_PROMPT
  const fullRetry = url.searchParams.get('full') !== 'false' && body.full !== false
  const result = await runDirectTest(provider, prompt, fullRetry)
  return NextResponse.json(result, { status: result.success ? 200 : 502 })
}
