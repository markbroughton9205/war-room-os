import { NextResponse } from 'next/server'
import { getLMStudioConfig, getLMStudioModels, invokeLMStudioPrompt, resolveLMStudioModel } from '@/lib/local-agent/providers'

export const dynamic = 'force-dynamic'

type LocalAgentTestRequest = {
  prompt?: string
  model?: string
}

export async function POST(request: Request) {
  let body: LocalAgentTestRequest = {}

  try {
    body = await request.json() as LocalAgentTestRequest
  } catch {
    body = {}
  }

  const prompt = body.prompt?.trim() || 'Reply with one short sentence confirming LM Studio is reachable.'
  const probe = await getLMStudioModels()
  const model = body.model?.trim() || resolveLMStudioModel(probe.models, probe.configuredModel)
  const result = await invokeLMStudioPrompt({
    prompt,
    model,
    baseUrl: probe.baseUrl,
    timeoutMs: 45000,
  })

  const responseBody = {
    provider: 'lm_studio',
    baseUrl: probe.baseUrl,
    configured: probe.configured,
    configuredModel: model,
    modelUsed: result.modelUsed,
    reachable: probe.models.length > 0,
    functional: result.functional,
    latencyMs: result.latencyMs,
    response: result.text,
    raw: result.raw,
    error: result.error,
    failureKind: result.failureKind,
    models: probe.models,
    approvalBoundary: 'Test invocation only. No repo mutation, shell execution, commit, push, deploy, or delete.',
  }

  return NextResponse.json(responseBody, { status: result.functional ? 200 : 503 })
}

export async function GET() {
  const config = getLMStudioConfig()
  const probe = await getLMStudioModels()

  return NextResponse.json({
    provider: 'lm_studio',
    baseUrl: probe.baseUrl,
    configured: probe.configured,
    configuredModel: probe.configuredModel,
    apiKeyConfigured: probe.apiKeyConfigured,
    defaultModel: config.model,
    resolvedModel: resolveLMStudioModel(probe.models, probe.configuredModel),
    reachable: probe.models.length > 0,
    models: probe.models,
    error: probe.error,
    failureKind: probe.failureKind,
    testHint: 'POST a JSON body with optional prompt and model to run /v1/chat/completions.',
  })
}
