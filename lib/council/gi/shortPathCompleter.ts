import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import { listModelTargets } from '@/lib/model-router/registry'
import { dispatchModelRequest } from '@/lib/model-router/dispatch'
import { probeOllama, requestOllamaStreamingCompletion } from '@/lib/native-builder/ollamaClient'
import { localRegistryEntryForSlot } from '@/lib/council/live-orchestration/backends/localModelRegistry'
import type { ModelTarget } from '@/lib/model-router/types'
import type { ModelPlacement, ShortPathCompleter, ShortPathCompletion } from './types'

const SHORT_SYSTEM = [
  'You are War Room Divine Council in short-path mode: one practical engineering assistant, not a panel and not a fantasy narrator.',
  'Answer naturally, directly, and in the Commander\'s current context.',
  'Do not invent missions, rifts, cinematic stakes, or events that did not happen.',
  'Do not mention seats, claim IDs, or tool registry IDs.',
  'Do not pretend to browse or probe live systems. If current facts are required, say you need to check.',
].join(' ')

export function isGiEng02ShortPathCompleteEnabled(
  env: NodeJS.Dict<string> | undefined = typeof process !== 'undefined' ? process.env : undefined,
): boolean {
  const raw = env?.GI_ENG_02_SHORT_PATH_COMPLETE
  return typeof raw === 'string' && /^(1|true|yes|on)$/i.test(raw.trim())
}

export type ShortPathCompleterOptions = {
  forceProviderFailure?: boolean
  env?: NodeJS.ProcessEnv
}

/**
 * Capability routing, not seat identity. SHORT_PATH must not bind ORION=provider X.
 */
export function selectShortPathModelTarget(
  env: NodeJS.ProcessEnv = process.env,
): { target: ModelTarget | null; placement: ModelPlacement; reason: string } {
  const targets = listModelTargets().filter(row => row.dispatchable && row.availability !== 'unavailable')
  const preferOrder = ['chatgpt', 'claude', 'gemini', 'grok'] as const
  const configured = preferOrder.filter(family => {
    if (family === 'chatgpt') return envHasUsableProviderSecret('OPENAI_API_KEY', env)
    if (family === 'claude') return envHasUsableProviderSecret('ANTHROPIC_API_KEY', env)
    if (family === 'gemini') return envHasUsableProviderSecret('GEMINI_API_KEY', env)
    return envHasUsableProviderSecret('XAI_API_KEY', env)
  })
  for (const family of configured) {
    const target = targets.find(row => row.providerFamily === family)
    if (target) {
      return { target, placement: 'CLOUD', reason: `Conversation-capable hosted model via ${family} (seat identity unused).` }
    }
  }
  return { target: null, placement: 'NONE', reason: 'No dispatchable hosted model configured. Quality completer used unless a live local model is invoked; not labeled LOCAL.' }
}

function modelInstalled(probeModels: readonly string[], modelId: string): boolean {
  return probeModels.some(name => name === modelId || name.startsWith(`${modelId.split(':')[0]}:`))
}

export async function selectLiveShortPathTarget(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  target: ModelTarget | null
  placement: ModelPlacement
  reason: string
  local_model?: string
}> {
  const hosted = selectShortPathModelTarget(env)
  if (hosted.target) return hosted
  const probe = await probeOllama(env)
  const general = localRegistryEntryForSlot('GENERAL')
  if (probe.available && general && modelInstalled(probe.models, general.modelId)) {
    return {
      target: null,
      placement: 'LOCAL',
      local_model: general.modelId,
      reason: `Hosted keys absent. Live local Ollama ${general.modelId} will generate (seat unused).`,
    }
  }
  return {
    target: null,
    placement: 'NONE',
    reason: probe.available
      ? `Ollama reachable but GENERAL model ${general?.modelId ?? 'unset'} is not installed.`
      : `No hosted key and Ollama unavailable: ${probe.detail}`,
  }
}

async function completeViaLocal(input: {
  text: string
  history: readonly string[]
  model: string
}): Promise<ShortPathCompletion> {
  const started = Date.now()
  const prompt = [
    input.history.length ? `Prior turns:\n${input.history.map((turn, i) => `${i + 1}. ${turn}`).join('\n')}` : '',
    `Commander: ${input.text}`,
  ].filter(Boolean).join('\n\n')
  const response = await requestOllamaStreamingCompletion({
    model: input.model,
    prompt,
    system: SHORT_SYSTEM,
    timeoutMs: 90_000,
    keepAlive: '5m',
    options: { num_predict: 500, temperature: 0.4 },
  })
  const latency_ms = Date.now() - started
  if (!response.ok || !response.text.trim()) {
    return {
      text: '',
      placement: 'NONE',
      model_invoked: false,
      provider_family: 'local_ollama',
      display_name: input.model,
      latency_ms,
      fallback: 'provider_error',
      failure: response.ok ? 'empty_local_completion' : response.detail,
      status: 'error',
    }
  }
  return {
    text: response.text.trim(),
    placement: 'LOCAL',
    model_invoked: true,
    provider_family: 'local_ollama',
    display_name: response.model || input.model,
    latency_ms,
    ttft_ms: response.metrics.ttftMs,
    fallback: 'none',
    status: 'ok',
  }
}

export function createModelBackedShortPathCompleter(
  fallback: ShortPathCompleter,
  options: ShortPathCompleterOptions = {},
): ShortPathCompleter {
  return async input => {
    const env = options.env ?? process.env
    if (!isGiEng02ShortPathCompleteEnabled(env)) {
      const fallbackResult = await fallback(input)
      return { ...fallbackResult, fallback: 'flag_off', model_invoked: false }
    }
    const history = (input.prior_turns ?? input.envelope.context.prior_turns ?? []).slice(-6)
    if (options.forceProviderFailure) {
      const fallbackResult = await fallback(input)
      return {
        ...fallbackResult,
        placement: 'NONE',
        model_invoked: false,
        fallback: 'provider_error',
        failure: 'forced_provider_failure',
        status: 'error',
      }
    }
    const live = await selectLiveShortPathTarget(env)
    if (live.target) {
      const prompt = [
        history.length ? `Prior turns:\n${history.map((turn, i) => `${i + 1}. ${turn}`).join('\n')}` : '',
        `Commander: ${input.text}`,
      ].filter(Boolean).join('\n\n')
      const started = Date.now()
      const response = await dispatchModelRequest({
        target: live.target,
        message: prompt,
        system: SHORT_SYSTEM,
        maxTokens: 700,
        timeoutMs: 18_000,
      })
      const latency_ms = Date.now() - started
      if (response.status !== 'ok' || !response.content.trim()) {
        if (live.placement === 'CLOUD') {
          const localAttempt = await selectLiveShortPathTarget({ ...env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', XAI_API_KEY: '' })
          if (localAttempt.local_model) {
            const local = await completeViaLocal({ text: input.text, history, model: localAttempt.local_model })
            if (local.model_invoked) {
              return { ...local, placement: 'HYBRID', fallback: 'none', failure: response.errorMessage }
            }
          }
        }
        const fallbackResult = await fallback(input)
        return {
          ...fallbackResult,
          placement: 'NONE',
          model_invoked: false,
          provider_family: live.target.providerFamily,
          latency_ms,
          fallback: 'provider_error',
          failure: response.errorMessage ?? response.status,
          status: response.status,
        }
      }
      return {
        text: response.content.trim(),
        placement: live.placement,
        model_invoked: true,
        provider_family: live.target.providerFamily,
        display_name: live.target.displayName,
        latency_ms,
        fallback: 'none',
        status: 'ok',
      }
    }
    if (live.local_model) {
      const local = await completeViaLocal({ text: input.text, history, model: live.local_model })
      if (local.model_invoked) return local
      const fallbackResult = await fallback(input)
      return {
        ...fallbackResult,
        placement: 'NONE',
        model_invoked: false,
        provider_family: 'local_ollama',
        display_name: live.local_model,
        latency_ms: local.latency_ms,
        fallback: 'provider_error',
        failure: local.failure,
        status: 'error',
      }
    }
    const fallbackResult = await fallback(input)
    return { ...fallbackResult, fallback: 'no_target', model_invoked: false, failure: live.reason }
  }
}

export function shortPathPlacementTruth(input: { model_invoked: boolean; placement: ModelPlacement }): ModelPlacement {
  if (!input.model_invoked) return 'NONE'
  return input.placement
}

export async function withIsolatedShortPathCompleteFlag<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.GI_ENG_02_SHORT_PATH_COMPLETE
  process.env.GI_ENG_02_SHORT_PATH_COMPLETE = '1'
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.GI_ENG_02_SHORT_PATH_COMPLETE
    else process.env.GI_ENG_02_SHORT_PATH_COMPLETE = prev
  }
}
