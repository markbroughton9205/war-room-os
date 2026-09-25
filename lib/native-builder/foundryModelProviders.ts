import { streamCouncilFamily, familyIsStreamConfigured } from '@/lib/council/live-orchestration/streamProvider'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { requestLocalCoderJson, resolveLocalCoder } from './localCoder'
import { parseAndValidateModelDecision } from './foundryModelDecision'
import { buildFoundryModelPrompt, FOUNDRY_MODEL_SYSTEM_PROMPT } from './foundryModelPrompt'
import {
  FOUNDRY_LOCAL_DECISION_SCHEMA,
  FOUNDRY_LOCAL_GENERATE_OPTIONS,
  FOUNDRY_LOCAL_MODEL_SYSTEM_PROMPT,
  LOCAL_MODEL_MAX_REPAIRS,
  buildLocalFoundryModelPrompt,
  buildLocalRepairPrompt,
  estimateTokens,
  recordLocalModelCallMetrics,
} from './foundryLocalModelRuntime'
import { CursorAgentProvider } from './cursorAgentProvider'
import { combineAbortSignals } from './foundryAgentCancellation'
import type {
  FoundryMissionModel,
  FoundryModelProviderId,
  FoundryModelRequest,
  FoundryModelResponse,
} from './foundryModelTypes'

function failureClass(error: string): Extract<FoundryModelResponse, { ok: false }>['failureClass'] {
  if (/timeout|aborted|timed out/i.test(error)) return 'TIMEOUT'
  if (/context|token|too long|maximum length/i.test(error)) return 'CONTEXT_LIMIT'
  if (/unavailable|not configured|unreachable|no usable/i.test(error)) return 'UNAVAILABLE'
  return 'PROVIDER'
}

export abstract class BaseModel implements FoundryMissionModel {
  abstract readonly provider: FoundryModelProviderId
  abstract readonly model: string | null
  protected abstract invoke(request: FoundryModelRequest): Promise<
    { ok: true; text: string; model: string } | { ok: false; error: string; model?: string | null }
  >

  private async run(request: FoundryModelRequest): Promise<FoundryModelResponse> {
    if (request.abortSignal?.aborted) {
      return {
        ok: false,
        provider: this.provider,
        model: this.model,
        error: 'aborted',
        failureClass: 'TIMEOUT',
        latencyMs: 0,
      }
    }
    const started = Date.now()
    const result = await this.invoke(request)
    if (!result.ok) {
      return {
        ok: false,
        provider: this.provider,
        model: result.model ?? this.model,
        error: result.error,
        failureClass: failureClass(result.error),
        latencyMs: Date.now() - started,
      }
    }
    const parsed = parseAndValidateModelDecision(
      result.text,
      request.context.permissions,
      new Set(request.context.tools.map(tool => tool.name)),
      request.context.boundedRetryLock,
    )
    if (!parsed.ok) {
      return {
        ok: false,
        provider: this.provider,
        model: result.model,
        error: parsed.error,
        failureClass: 'MALFORMED',
        latencyMs: Date.now() - started,
      }
    }
    return {
      ok: true,
      provider: this.provider,
      model: result.model,
      decision: parsed.decision,
      rawText: result.text,
      latencyMs: Date.now() - started,
    }
  }

  reasonMission(request: FoundryModelRequest) { return this.run({ ...request, kind: 'reasonMission' }) }
  chooseNextAction(request: FoundryModelRequest) { return this.run({ ...request, kind: 'chooseNextAction' }) }
  diagnoseFailure(request: FoundryModelRequest) { return this.run({ ...request, kind: 'diagnoseFailure' }) }
  replan(request: FoundryModelRequest) { return this.run({ ...request, kind: 'replan' }) }
  summarizeProgress(request: FoundryModelRequest) { return this.run({ ...request, kind: 'summarizeProgress' }) }
}

class CouncilProviderModel extends BaseModel {
  readonly provider: FoundryModelProviderId
  readonly model: string
  constructor(
    provider: FoundryModelProviderId,
    private readonly family: CouncilOrchestrationFamily,
    model: string,
  ) {
    super()
    this.provider = provider
    this.model = model
  }

  protected async invoke(request: FoundryModelRequest) {
    if (!familyIsStreamConfigured(this.family)) {
      return { ok: false as const, error: `${this.provider} is not configured`, model: this.model }
    }
    const response = await streamCouncilFamily({
      family: this.family,
      system: FOUNDRY_MODEL_SYSTEM_PROMPT,
      prompt: buildFoundryModelPrompt(request),
      maxTokens: 4_000,
      timeoutKind: 'council',
      onDelta: () => undefined,
    })
    return response.ok
      ? { ok: true as const, text: response.text, model: this.model }
      : { ok: false as const, error: response.error ?? response.status, model: this.model }
  }
}

class OllamaModel extends BaseModel {
  readonly provider = 'ollama' as const
  constructor(readonly model: string) {
    super()
  }
  protected async invoke(request: FoundryModelRequest) {
    const prompt = buildLocalFoundryModelPrompt(request)
    const started = Date.now()
    const needsLongWrite = /file\.write path=(server|store|catalog|pipeline|events)\.mjs|file\.write path=(main|app)\.js|file\.write path=(about\.html|styles\.css)|file\.write path=lib\/(util|compute)\.js|file\.write path=src\/(index|blank|repo|slug|title|a|b|service)\.mjs|server\.mjs already listens|still missing POST routes|:memory:|DatabaseSync/i.test(
      `${request.context.userRequest}\n${request.context.importantFindings.join('\n')}\n${request.context.loopWarning ?? ''}`,
    )
    const generateOptions = needsLongWrite
      ? { ...FOUNDRY_LOCAL_GENERATE_OPTIONS, num_predict: 2_048 }
      : FOUNDRY_LOCAL_GENERATE_OPTIONS
    const first = await requestLocalCoderJson({
      role: 'FOUNDRY_MASTER',
      system: FOUNDRY_LOCAL_MODEL_SYSTEM_PROMPT,
      prompt,
      format: FOUNDRY_LOCAL_DECISION_SCHEMA,
      options: generateOptions,
      keepAlive: '30m',
    })
    if (!first.ok) {
      recordLocalModelCallMetrics({
        promptChars: prompt.length,
        promptTokensEst: estimateTokens(prompt),
        repairs: 0,
        schemaOk: false,
        latencyMs: Date.now() - started,
      })
      return { ok: false as const, error: first.detail, model: this.model }
    }
    let text = first.text
    let parsed = parseAndValidateModelDecision(
      text,
      request.context.permissions,
      new Set(request.context.tools.map(tool => tool.name)),
      request.context.boundedRetryLock,
    )
    let repairs = 0
    while (!parsed.ok && repairs < LOCAL_MODEL_MAX_REPAIRS) {
      repairs += 1
      const repaired = await requestLocalCoderJson({
        role: 'FOUNDRY_MASTER',
        system: FOUNDRY_LOCAL_MODEL_SYSTEM_PROMPT,
        prompt: buildLocalRepairPrompt(parsed.error, text),
        format: FOUNDRY_LOCAL_DECISION_SCHEMA,
        options: { ...generateOptions, num_predict: Math.max(generateOptions.num_predict, 400) },
        keepAlive: '30m',
      })
      if (!repaired.ok) break
      text = repaired.text
      parsed = parseAndValidateModelDecision(
        text,
        request.context.permissions,
        new Set(request.context.tools.map(tool => tool.name)),
        request.context.boundedRetryLock,
      )
    }
    recordLocalModelCallMetrics({
      promptChars: prompt.length,
      promptTokensEst: estimateTokens(prompt),
      repairs,
      schemaOk: parsed.ok,
      latencyMs: Date.now() - started,
    })
    return parsed.ok
      ? { ok: true as const, text, model: this.model }
      : { ok: true as const, text, model: this.model }
  }
}

class OpenAiCompatibleModel extends BaseModel {
  readonly provider: FoundryModelProviderId
  readonly model: string
  constructor(
    provider: FoundryModelProviderId,
    private readonly baseUrl: string,
    model: string,
    private readonly apiKey: string,
  ) {
    super()
    this.provider = provider
    this.model = model
  }

  protected async invoke(request: FoundryModelRequest) {
    if (!this.baseUrl || !this.model) return { ok: false as const, error: `${this.provider} endpoint/model unavailable`, model: this.model }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    const signal = combineAbortSignals([controller.signal, request.abortSignal]) ?? controller.signal
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: FOUNDRY_MODEL_SYSTEM_PROMPT },
            { role: 'user', content: buildFoundryModelPrompt(request) },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 4_000,
        }),
      })
      if (!response.ok) return { ok: false as const, error: `${this.provider} HTTP ${response.status}`, model: this.model }
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const text = json.choices?.[0]?.message?.content
      if (!text) return { ok: false as const, error: `${this.provider} returned no text`, model: this.model }
      return { ok: true as const, text, model: this.model }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error), model: this.model }
    } finally {
      clearTimeout(timeout)
    }
  }
}

class UnavailableFutureModel extends BaseModel {
  readonly model = null
  constructor(readonly provider: FoundryModelProviderId) { super() }
  protected async invoke() {
    return { ok: false as const, error: `${this.provider} adapter is reserved but not configured`, model: null }
  }
}

function configuredCompatibleProvider(): FoundryMissionModel | null {
  const baseUrl = process.env.FOUNDRY_OPENAI_COMPATIBLE_BASE_URL?.trim()
  const model = process.env.FOUNDRY_OPENAI_COMPATIBLE_MODEL?.trim()
  if (!baseUrl || !model) return null
  const requested = process.env.FOUNDRY_OPENAI_COMPATIBLE_PROVIDER?.trim().toLowerCase()
  const provider: FoundryModelProviderId =
    requested === 'kimi' || requested === 'deepseek' || requested === 'wrim'
      ? requested
      : 'openai-compatible'
  return new OpenAiCompatibleModel(
    provider,
    baseUrl,
    model,
    process.env.FOUNDRY_OPENAI_COMPATIBLE_API_KEY?.trim() ?? '',
  )
}

export async function configuredFoundryModels(opts?: { routingRetry?: boolean }): Promise<FoundryMissionModel[]> {
  const { applyFoundryRuntimeConfig } = await import('./foundryRuntimeConfig')
  applyFoundryRuntimeConfig()
  const models: FoundryMissionModel[] = []
  const preferred = process.env.FOUNDRY_PRIMARY_MODEL?.trim().toLowerCase()
  const fallback = process.env.FOUNDRY_FALLBACK_MODEL?.trim().toLowerCase()
  const cursorSpecs = [preferred, fallback]
    .filter((spec): spec is string => Boolean(spec?.startsWith('cursor-agent:')))
  for (const spec of [...new Set(cursorSpecs)]) {
    const model = spec.slice('cursor-agent:'.length).trim()
    if (model) models.push(new CursorAgentProvider(model))
  }
  const local = await resolveLocalCoder(opts?.routingRetry ? { routingRetry: true } : undefined)
  if (local.available && local.codingModel) models.push(new OllamaModel(local.codingModel))
  const compatible = configuredCompatibleProvider()
  if (compatible) models.push(compatible)
  if (familyIsStreamConfigured('claude')) models.push(new CouncilProviderModel('anthropic', 'claude', 'claude'))
  if (familyIsStreamConfigured('chatgpt')) models.push(new CouncilProviderModel('openai', 'chatgpt', 'gpt'))
  if (familyIsStreamConfigured('gemini')) models.push(new CouncilProviderModel('gemini', 'gemini', 'gemini'))
  if (familyIsStreamConfigured('grok')) models.push(new CouncilProviderModel('xai', 'grok', 'grok'))
  if (preferred || fallback) {
    const preferredProvider = preferred?.split(':', 1)[0]
    const fallbackProvider = fallback?.split(':', 1)[0]
    const rank = (provider: string) => provider === preferredProvider ? 0 : provider === fallbackProvider ? 1 : 2
    models.sort((a, b) => rank(a.provider) - rank(b.provider))
  }
  return models
}

export function futureFoundryModelAdapter(provider: 'kimi' | 'deepseek' | 'wrim'): FoundryMissionModel {
  return new UnavailableFutureModel(provider)
}

