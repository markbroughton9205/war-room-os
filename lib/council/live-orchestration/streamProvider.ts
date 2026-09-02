import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import { configuredXAIModel } from '@/lib/ai/providers/xai'
import { geminiAllowedGenerateContentIds, geminiOrderedCandidates, fetchGeminiListModelsJson } from '@/lib/ai/providers/geminiGenerative'
import { streamOpenAiChat } from './adapters/openai'
import { streamAnthropicMessages } from './adapters/anthropic'
import { streamGrokChat } from './adapters/grok'
import { streamGeminiCouncil } from './adapters/gemini'
import { classifyProviderFailure } from './failureTaxonomy'
import { retryAfterMs, shouldRetryProviderAttempt } from './retryPolicy'
import { createStreamTimeoutController, resolveStreamTimeoutBudget, type StreamTimeoutBudget } from './timeoutPolicy'
import type { NormalizedProviderStreamResult, StreamDeltaHandler } from './streamContract'
import type { CouncilFailureLayer } from './types'

const CLAUDE_MODEL = 'claude-sonnet-5'

export type StreamedCouncilCall = {
  ok: boolean
  text: string
  partial: boolean
  status: 'OK' | 'FAILED' | 'TIMED_OUT' | 'UNAVAILABLE'
  httpStatus: number | 'timeout' | 'unavailable'
  error?: string
  failureLayer: CouncilFailureLayer
  attempt: number
  firstDeltaAt?: number
  abortReason?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function invokeFamilyStream(input: {
  family: CouncilOrchestrationFamily
  system: string
  prompt: string
  maxTokens: number
  signal: AbortSignal
  onDelta: StreamDeltaHandler
}): Promise<NormalizedProviderStreamResult> {
  if (input.family === 'chatgpt' || input.family === 'baby') {
    const key = process.env.OPENAI_API_KEY
    if (!envHasUsableProviderSecret('OPENAI_API_KEY') || !key) {
      return { ok: false, text: '', partial: false, httpStatus: 'unavailable', error: 'OPENAI_API_KEY not configured' }
    }
    return streamOpenAiChat({
      apiKey: key,
      model: 'gpt-4o',
      system: input.system,
      prompt: input.prompt,
      maxTokens: input.maxTokens,
      signal: input.signal,
      onDelta: input.onDelta,
    })
  }
  if (input.family === 'claude' || input.family === 'red_team') {
    const key = process.env.ANTHROPIC_API_KEY
    if (!envHasUsableProviderSecret('ANTHROPIC_API_KEY') || !key) {
      return { ok: false, text: '', partial: false, httpStatus: 'unavailable', error: 'ANTHROPIC_API_KEY not configured' }
    }
    return streamAnthropicMessages({
      apiKey: key,
      model: CLAUDE_MODEL,
      system: input.system,
      prompt: input.prompt,
      maxTokens: input.maxTokens,
      signal: input.signal,
      onDelta: input.onDelta,
    })
  }
  if (input.family === 'grok') {
    const key = process.env.XAI_API_KEY?.trim()
    if (!key) return { ok: false, text: '', partial: false, httpStatus: 'unavailable', error: 'XAI_API_KEY not configured' }
    return streamGrokChat({
      apiKey: key,
      model: configuredXAIModel(),
      system: input.system,
      prompt: input.prompt,
      maxTokens: input.maxTokens,
      signal: input.signal,
      onDelta: input.onDelta,
    })
  }
  if (input.family === 'gemini') {
    const key = process.env.GEMINI_API_KEY?.trim()
    if (!key) return { ok: false, text: '', partial: false, httpStatus: 'unavailable', error: 'GEMINI_API_KEY not configured' }
    const listed = await fetchGeminiListModelsJson(key, input.signal)
    if (!listed.ok) {
      return { ok: false, text: '', partial: false, httpStatus: listed.status, error: `Gemini list models failed (HTTP ${listed.status})` }
    }
    const modelId = geminiOrderedCandidates(geminiAllowedGenerateContentIds(listed.json))[0]
    if (!modelId) return { ok: false, text: '', partial: false, httpStatus: 'unavailable', error: 'Gemini model unavailable' }
    return streamGeminiCouncil({
      apiKey: key,
      modelId,
      system: input.system,
      prompt: input.prompt,
      maxTokens: input.maxTokens,
      signal: input.signal,
      onDelta: input.onDelta,
    })
  }
  return { ok: false, text: '', partial: false, httpStatus: 'unavailable', error: `${input.family} has no stream adapter` }
}

export async function streamCouncilFamily(input: {
  family: CouncilOrchestrationFamily
  system: string
  prompt: string
  maxTokens: number
  timeoutKind: 'social' | 'council' | 'research'
  parentSignal?: AbortSignal
  onDelta: StreamDeltaHandler
  budget?: StreamTimeoutBudget
}): Promise<StreamedCouncilCall> {
  const budget = input.budget ?? resolveStreamTimeoutBudget(input.timeoutKind)
  let attempt = 0
  let visible = false
  const wrappedDelta: StreamDeltaHandler = delta => {
    if (delta) visible = true
    input.onDelta(delta)
  }

  while (true) {
    attempt += 1
    const timeouts = createStreamTimeoutController(budget, input.parentSignal)
    try {
      const result = await invokeFamilyStream({
        family: input.family,
        system: input.system,
        prompt: input.prompt,
        maxTokens: input.maxTokens,
        signal: timeouts.signal,
        onDelta: delta => {
          timeouts.markFirstToken()
          wrappedDelta(delta)
        },
      })
      const abortReason = timeouts.reason()
      const layer = classifyProviderFailure({
        httpStatus: result.httpStatus,
        message: result.error,
        abortReason: abortReason === 'none' ? undefined : abortReason,
        parserError: result.parserError,
        visibleTokensEmitted: Boolean(result.text),
      })
      if (result.ok) {
        return {
          ok: true,
          text: result.text,
          partial: false,
          status: 'OK',
          httpStatus: result.httpStatus,
          failureLayer: layer,
          attempt,
          firstDeltaAt: result.firstDeltaAt,
        }
      }
      const retry = shouldRetryProviderAttempt({
        attempt,
        visibleTokensEmitted: visible || Boolean(result.text),
        layer,
        httpStatus: result.httpStatus,
      })
      if (retry) {
        await sleep(retryAfterMs(result.httpStatus))
        continue
      }
      const timedOut = result.httpStatus === 'timeout' || abortReason === 'first_token' || abortReason === 'idle' || abortReason === 'overall'
      return {
        ok: false,
        text: result.text,
        partial: result.partial,
        status: timedOut ? 'TIMED_OUT' : result.httpStatus === 'unavailable' ? 'UNAVAILABLE' : 'FAILED',
        httpStatus: timedOut ? 'timeout' : result.httpStatus,
        error: result.error,
        failureLayer: layer,
        attempt,
        firstDeltaAt: result.firstDeltaAt,
        abortReason,
      }
    } finally {
      timeouts.dispose()
    }
  }
}

export function familyIsStreamConfigured(family: CouncilOrchestrationFamily): boolean {
  if (family === 'chatgpt' || family === 'baby') return envHasUsableProviderSecret('OPENAI_API_KEY')
  if (family === 'claude' || family === 'red_team') return envHasUsableProviderSecret('ANTHROPIC_API_KEY')
  if (family === 'grok') return Boolean(process.env.XAI_API_KEY?.trim())
  if (family === 'gemini') return Boolean(process.env.GEMINI_API_KEY?.trim())
  return false
}
