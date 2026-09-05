/**
 * WR-Engineer Phase 5 local coding-model adapter.
 *
 * Implements ModelAdapter by delegating HTTP to lib/native-builder/ollamaClient.ts (localhost
 * Ollama only). Identity/soul/user are never derived from the model name. Never throws out of
 * invoke() — an unreachable runtime is an honest ok:false result.
 *
 * Does not pull models, start training, write files, or bypass the Phase 4 inspect loop.
 */
import { probeOllama, requestOllamaCompletion, type OllamaCompletionResult, type OllamaProbeResult } from '@/lib/native-builder/ollamaClient'
import { boundSystemPrompt } from './localContext'
import { localEngineStatusFromProbe, recordLocalEngineTelemetry } from './localEngine'
import { classifyProviderFailure } from './providerFailure'
import {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_LOCAL_RUNTIME,
  LOCAL_INFERENCE_TIMEOUT_MS,
} from './engineTypes'
import type { ModelAdapter, ModelAdapterRequest, ModelAdapterResult } from './types'

export type LocalWrEngineerTransport = {
  probe: () => Promise<OllamaProbeResult>
  complete: (args: { model: string; prompt: string; system?: string }) => Promise<OllamaCompletionResult>
}

const defaultTransport: LocalWrEngineerTransport = {
  probe: probeOllama,
  complete: requestOllamaCompletion,
}

export type LocalWrEngineerModelAdapterOptions = {
  model?: string
  timeoutMs?: number
  transport?: LocalWrEngineerTransport
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export class LocalWrEngineerModelAdapter implements ModelAdapter {
  readonly id: string
  readonly runtime = DEFAULT_LOCAL_RUNTIME
  readonly modelName: string
  private readonly timeoutMs: number
  private readonly transport: LocalWrEngineerTransport

  constructor(options: LocalWrEngineerModelAdapterOptions = {}) {
    this.modelName = options.model?.trim() || DEFAULT_LOCAL_MODEL
    this.timeoutMs = options.timeoutMs ?? LOCAL_INFERENCE_TIMEOUT_MS
    this.transport = options.transport ?? defaultTransport
    this.id = `local_model:${this.runtime}:${this.modelName}`
  }

  async invoke(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    const started = Date.now()
    try {
      const probe = await this.transport.probe()
      const status = localEngineStatusFromProbe(probe, this.modelName)
      if (status !== 'READY') {
        const error = status === 'STARTING'
          ? `Local Ollama runtime is reachable but has not loaded ${this.modelName} yet.`
          : probe.detail || `Local Ollama runtime is unavailable (selected model ${this.modelName}).`
        const latencyMs = Date.now() - started
        recordLocalEngineTelemetry({
          lastLatencyMs: latencyMs,
          lastError: error,
          lastStatus: status,
          lastPromptBytes: Buffer.byteLength(request.systemPrompt, 'utf8') + Buffer.byteLength(request.userPrompt, 'utf8'),
          lastResponseBytes: 0,
          lastModel: this.modelName,
        })
        return {
          ok: false,
          text: '',
          adapterId: this.id,
          epistemicStatus: 'UNKNOWN',
          error,
          latencyMs,
          failureClass: classifyProviderFailure(error, 'unavailable'),
          runtime: this.runtime,
          modelName: this.modelName,
          answeredBy: 'local',
        }
      }

      const bounded = boundSystemPrompt(request.systemPrompt)
      const timeoutMs = request.timeoutMs ?? this.timeoutMs
      const completion = await this.completeOnce({
        model: this.modelName,
        prompt: request.userPrompt,
        system: bounded.text,
        timeoutMs,
      })
      const latencyMs = Date.now() - started
      if (!completion.ok) {
        const failureClass = classifyProviderFailure(completion.detail, completion.detail.toLowerCase().includes('timeout') ? 'timeout' : 'unavailable')
        recordLocalEngineTelemetry({
          lastLatencyMs: latencyMs,
          lastError: completion.detail,
          lastStatus: 'UNAVAILABLE',
          lastPromptBytes: bounded.bytes + Buffer.byteLength(request.userPrompt, 'utf8'),
          lastResponseBytes: 0,
          lastModel: this.modelName,
        })
        return {
          ok: false,
          text: '',
          adapterId: this.id,
          epistemicStatus: 'UNKNOWN',
          error: completion.detail,
          latencyMs,
          failureClass,
          runtime: this.runtime,
          modelName: this.modelName,
          answeredBy: 'local',
        }
      }

      recordLocalEngineTelemetry({
        lastLatencyMs: latencyMs,
        lastError: null,
        lastStatus: 'READY',
        lastPromptBytes: bounded.bytes + Buffer.byteLength(request.userPrompt, 'utf8'),
        lastResponseBytes: Buffer.byteLength(completion.text, 'utf8'),
        lastModel: completion.model,
      })
      return {
        ok: true,
        text: completion.text,
        adapterId: this.id,
        epistemicStatus: 'OBSERVED',
        latencyMs,
        runtime: this.runtime,
        modelName: completion.model,
        answeredBy: 'local',
        truncatedPrompt: bounded.truncated,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const latencyMs = Date.now() - started
      recordLocalEngineTelemetry({
        lastLatencyMs: latencyMs,
        lastError: message,
        lastStatus: 'UNAVAILABLE',
        lastModel: this.modelName,
      })
      return {
        ok: false,
        text: '',
        adapterId: this.id,
        epistemicStatus: 'UNKNOWN',
        error: message,
        latencyMs,
        failureClass: classifyProviderFailure(message),
        runtime: this.runtime,
        modelName: this.modelName,
        answeredBy: 'local',
      }
    }
  }

  private async completeOnce(args: {
    model: string
    prompt: string
    system: string
    timeoutMs: number
  }): Promise<OllamaCompletionResult> {
    const timedOut = { ok: false as const, detail: `Local inference timed out after ${args.timeoutMs}ms.` }
    return Promise.race([
      this.transport.complete({ model: args.model, prompt: args.prompt, system: args.system }),
      delay(args.timeoutMs).then(() => timedOut),
    ])
  }
}
