import { NextResponse } from 'next/server'
import { LOCAL_FAMILY_AGENTS } from '@/lib/local-agent/family-agents'
import { chooseFamilyProvider, getLMStudioModels, getOllamaModels, resolveLMStudioModel, testLMStudioChat } from '@/lib/local-agent/providers'
import type { LocalFamilyAgentsResponse } from '@/lib/local-agent/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [ollamaResult, lmStudioResult] = await Promise.allSettled([
    getOllamaModels(),
    getLMStudioModels(),
  ])
  const availableModels = ollamaResult.status === 'fulfilled' ? ollamaResult.value : []
  const lmStudioProbe = lmStudioResult.status === 'fulfilled'
    ? lmStudioResult.value
    : {
      baseUrl: 'http://127.0.0.1:1234/v1',
      models: [],
      error: lmStudioResult.reason instanceof Error ? lmStudioResult.reason.message : 'LM Studio check failed',
      failureKind: 'unknown' as const,
      configured: false,
      configuredModel: 'google/gemma-4-e4b',
      modelFromEnv: false,
      apiKeyConfigured: false,
      handshakeState: 'handshake_failed' as const,
    }
  const lmStudioModel = resolveLMStudioModel(lmStudioProbe.models, lmStudioProbe.configuredModel)
  const lmStudioFunctionalTest = lmStudioProbe.models.length > 0
    ? await testLMStudioChat(lmStudioProbe.baseUrl, lmStudioModel)
    : {
      functional: false,
      text: '',
      error: lmStudioProbe.error,
      failureKind: lmStudioProbe.failureKind,
      latencyMs: 0,
      modelUsed: lmStudioModel,
      raw: null,
    }
  const selected = chooseFamilyProvider({
    ollamaModels: availableModels,
    lmStudioModels: lmStudioProbe.models,
    lmStudioFunctional: lmStudioFunctionalTest.functional,
    lmStudioModel,
  })
  const familyAgents = LOCAL_FAMILY_AGENTS.map(agent => {
    const provider = selected.provider
    const model = provider === 'lm_studio' ? selected.model : agent.preferredModel
    const detected = provider === 'lm_studio'
      ? lmStudioProbe.models.some(item => item.id === model)
      : availableModels.some(item => item.name === agent.preferredModel)
    const functional = provider === 'lm_studio'
      ? lmStudioFunctionalTest.functional
      : detected

    return {
      ...agent,
      status: functional ? 'available' as const : 'inactive' as const,
      modelInstalled: detected,
      provider,
      model,
      detected,
      functional,
    }
  })

  const body: LocalFamilyAgentsResponse = {
    ollamaDetected: availableModels.length > 0,
    lmStudioDetected: lmStudioProbe.models.length > 0,
    availableModels,
    lmStudioModels: lmStudioProbe.models,
    providers: {
      ollama: {
        provider: 'ollama',
        detected: availableModels.length > 0,
        reachable: availableModels.length > 0,
        functional: availableModels.length > 0,
        models: availableModels,
        error: ollamaResult.status === 'rejected' && ollamaResult.reason instanceof Error ? ollamaResult.reason.message : null,
      },
      lmStudio: {
        provider: 'lm_studio',
        detected: lmStudioProbe.models.length > 0,
        reachable: lmStudioProbe.models.length > 0,
        functional: lmStudioFunctionalTest.functional,
        models: lmStudioProbe.models,
        error: lmStudioFunctionalTest.error,
        configured: lmStudioProbe.configured,
        configuredModel: lmStudioModel,
        failureKind: lmStudioFunctionalTest.failureKind,
        handshakeState: lmStudioFunctionalTest.functional
          ? 'prompt_verified'
          : lmStudioProbe.models.length > 0
            ? 'degraded'
            : lmStudioProbe.handshakeState,
        latencyMs: lmStudioFunctionalTest.latencyMs,
        modelUsed: lmStudioFunctionalTest.modelUsed,
        testResponsePreview: lmStudioFunctionalTest.text ? lmStudioFunctionalTest.text.slice(0, 160) : null,
      },
    },
    preferredProvider: selected.provider,
    preferredModel: selected.model,
    familyAgents,
    checkedAt: new Date().toISOString(),
  }

  return NextResponse.json(body)
}
