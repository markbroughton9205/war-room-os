import { existsSync } from 'node:fs'
import { CURSOR_AGENT_EXECUTABLE } from '@/lib/native-builder/cursorAgentProvider'
import { loadProviderHealth } from '@/lib/native-builder/foundryProviderHealth'
import { applyFoundryRuntimeConfig } from '@/lib/native-builder/foundryRuntimeConfig'

export type FoundryBrainStatus = {
  ready: boolean
  provider: string
  modelId: string
  configuredModel: string
  executablePresent: boolean
  lastError: string | null
  usageLimited: boolean
  detail: string
}

function splitProviderModel(configured: string): { provider: string; modelId: string } {
  const idx = configured.indexOf(':')
  if (idx <= 0) return { provider: configured || 'unknown', modelId: configured }
  return { provider: configured.slice(0, idx), modelId: configured.slice(idx + 1) }
}

export async function resolveFoundryBrainStatus(): Promise<FoundryBrainStatus> {
  const config = applyFoundryRuntimeConfig()
  const configuredModel = config.primaryModel
  const { provider, modelId } = splitProviderModel(configuredModel)
  const health = await loadProviderHealth()
  const record = health.find((entry) => entry.provider === provider)
  const lastError = record?.lastError ?? null
  const usageLimited = /usage limit|spend limit|quota/i.test(lastError ?? '')

  if (provider === 'cursor-agent') {
    const executablePresent = existsSync(CURSOR_AGENT_EXECUTABLE)
    const ready = executablePresent
    const detail = !executablePresent
      ? `Cursor Agent CLI missing at ${CURSOR_AGENT_EXECUTABLE}`
      : usageLimited
        ? `Cursor Agent ${modelId} configured; usage limit in effect`
        : `Cursor Agent ${modelId} configured`
    return {
      ready,
      provider,
      modelId,
      configuredModel,
      executablePresent,
      lastError,
      usageLimited,
      detail,
    }
  }

  return {
    ready: Boolean(configuredModel),
    provider,
    modelId,
    configuredModel,
    executablePresent: false,
    lastError,
    usageLimited,
    detail: configuredModel ? `${provider} ${modelId} configured` : 'No Foundry primary model configured',
  }
}
