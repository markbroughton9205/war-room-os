import { NextResponse } from 'next/server'
import { callXAIChat } from '@/lib/ai/providers/xai'
import { assertActionRouteAuthorized } from '@/lib/security/actionRouteGuard'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'

export const dynamic = 'force-dynamic'

type GrokChatRequest = {
  prompt?: string
  system?: string
  maxTokens?: number
}

export async function POST(request: Request) {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return environmentBlocked

  const unauthorized = await assertActionRouteAuthorized(request)
  if (unauthorized) return unauthorized

  let body: GrokChatRequest

  try {
    body = await request.json() as GrokChatRequest
  } catch {
    return NextResponse.json({ status: 'error', message: 'Invalid JSON body.' }, { status: 400 })
  }

  const prompt = body.prompt?.trim()
  if (!prompt) {
    return NextResponse.json({ status: 'error', message: 'Prompt is required.' }, { status: 400 })
  }

  const messages = [
    ...(body.system?.trim() ? [{ role: 'system' as const, content: body.system.trim() }] : []),
    { role: 'user' as const, content: prompt },
  ]
  const result = await callXAIChat({
    messages,
    maxTokens: body.maxTokens,
    timeoutMs: 30000,
  })

  return NextResponse.json({
    provider: 'xAI',
    label: 'xAI · grok',
    ...result,
  }, { status: result.status === 'not_connected' ? 503 : 200 })
}
