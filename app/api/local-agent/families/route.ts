import { NextResponse } from 'next/server'
import { LOCAL_FAMILY_AGENTS } from '@/lib/local-agent/family-agents'
import { chooseFamilyProvider, getLMStudioModels, getOllamaModels, testLMStudioChat } from '@/lib/local-agent/providers'
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
    : { baseUrl: 'http://127.0.0.1:1234', models: [], error: lmStudioResult.reason instanceof Error ? lmStudioResult.reason.message : 'LM Studio check failed' }
  const lmStudioModel = lmStudioProbe.models[0]?.id ?? null
  const lmStudioFunctionalTest = lmStudioModel
    ? await testLMStudioChat(lmStudioProbe.baseUrl, lmStudioModel)
    : { functional: false, text: '', error: lmStudioProbe.error }
  const selected = chooseFamilyProvider({
    ollamaModels: availableModels,
    lmStudioModels: lmStudioProbe.models,
    lmStudioFunctional: lmStudioFunctionalTest.functional,
  })
  const familyAgents = LOCAL_FAMILY_AGENTS.map(agent => {
    const provider = selected.provider
    const model = provider === 'lm_studio' ? selected.model : agent.preferredModel
    const detected = provider === 'lm_studio'
      ? lmStudioProbe.models.length > 0
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
      },
    },
    preferredProvider: selected.provider,
    preferredModel: selected.model,
    familyAgents,
    checkedAt: new Date().toISOString(),
  }

  return NextResponse.json(body)
}
