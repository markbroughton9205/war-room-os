import { randomUUID } from 'node:crypto'
import type {
  FoundryMissionModel,
  FoundryModelProviderId,
  FoundryModelRequest,
  FoundryModelRequestKind,
  FoundryModelResponse,
} from './foundryModelTypes'
import { configuredFoundryModels } from './foundryModelProviders'
import { applyFoundryRuntimeConfig, type FoundryProviderPolicy } from './foundryRuntimeConfig'
import { authorizeResourceAction, beginResourceUsage, completeResourceUsage } from './foundryResourceGovernor'
import { createWrimStep400ModelIfHealthy } from './reasoning-kernel/wrim-worker'

export type FoundryModelRouteReason =
  | 'PRIMARY_AVAILABLE'
  | 'PRIMARY_USAGE_LIMIT'
  | 'POLICY_LOCAL'
  | 'POLICY_REMOTE'
  | 'PINNED'
  | 'FALLBACK'

export type FoundryModelRouteOptions = {
  pinProvider?: FoundryModelProviderId | null
  pinModel?: string | null
  policy?: FoundryProviderPolicy
  primaryUsageLimited?: boolean
  requestedProvider?: string | null
  missionId?: string | null
  graphId?: string | null
  taskId?: string | null
}

export type FoundryModelRouteResult = {
  response: FoundryModelResponse
  attempts: Array<{ provider: FoundryModelProviderId; ok: boolean; error?: string }>
  requestedProvider: string | null
  selectedProvider: FoundryModelProviderId | null
  selectedModel: string | null
  reason: FoundryModelRouteReason
}

function invoke(model: FoundryMissionModel, kind: FoundryModelRequestKind, request: FoundryModelRequest) {
  if (kind === 'reasonMission') return model.reasonMission(request)
  if (kind === 'diagnoseFailure') return model.diagnoseFailure(request)
  if (kind === 'replan') return model.replan(request)
  if (kind === 'summarizeProgress') return model.summarizeProgress(request)
  return model.chooseNextAction(request)
}

function selectModels(
  models: FoundryMissionModel[],
  options?: FoundryModelRouteOptions,
): { models: FoundryMissionModel[]; reason: FoundryModelRouteReason } {
  if (options?.pinProvider) {
    return {
      models: models.filter(model => model.provider === options.pinProvider && (!options.pinModel || model.model === options.pinModel)),
      reason: 'PINNED',
    }
  }
  const unpinned = models.filter(model => model.provider !== 'wrim')
  const policy = options?.policy ?? applyFoundryRuntimeConfig().providerPolicy
  if (policy === 'LOCAL') {
    return { models: unpinned.filter(model => model.provider === 'ollama'), reason: 'POLICY_LOCAL' }
  }
  if (policy === 'REMOTE') {
    return { models: unpinned.filter(model => model.provider !== 'ollama'), reason: 'POLICY_REMOTE' }
  }
  if (options?.primaryUsageLimited) {
    const local = unpinned.filter(model => model.provider === 'ollama')
    const rest = unpinned.filter(model => model.provider !== 'cursor-agent' && model.provider !== 'ollama')
    return { models: [...local, ...rest], reason: local.length ? 'PRIMARY_USAGE_LIMIT' : 'FALLBACK' }
  }
  return { models: unpinned, reason: 'PRIMARY_AVAILABLE' }
}

export class FoundryModelRouter {
  constructor(private readonly suppliedModels?: FoundryMissionModel[]) {}

  async route(
    kind: FoundryModelRequestKind,
    request: FoundryModelRequest,
    options?: FoundryModelRouteOptions,
  ): Promise<FoundryModelRouteResult> {
    const catalog = this.suppliedModels ?? await configuredFoundryModels()
    const all = [...catalog]
    if (!this.suppliedModels && options?.pinProvider === 'wrim' && !all.some(model => model.provider === 'wrim')) {
      const wrim = await createWrimStep400ModelIfHealthy()
      if (wrim) all.push(wrim)
    }
    const selected = selectModels(all, options)
    const models = selected.models
    const attempts: FoundryModelRouteResult['attempts'] = []
    const requestedProvider = options?.requestedProvider ?? options?.pinProvider ?? null
    if (!models.length) {
      return {
        response: {
          ok: false,
          provider: (options?.pinProvider ?? 'ollama') as FoundryModelProviderId,
          model: null,
          error: options?.pinProvider
            ? `Pinned provider ${options.pinProvider} is unavailable. No silent provider switch.`
            : 'No Foundry reasoning model is configured (local or hosted).',
          failureClass: 'UNAVAILABLE',
          latencyMs: 0,
        },
        attempts,
        requestedProvider,
        selectedProvider: null,
        selectedModel: null,
        reason: selected.reason,
      }
    }
    let last: FoundryModelResponse | null = null
    for (const model of models) {
      const missionId = options?.missionId ?? request.context?.missionId
      if (missionId) {
        const gate = authorizeResourceAction({
          missionId,
          graphId: options?.graphId,
          taskId: options?.taskId,
          kind: 'model',
          provider: model.provider,
          model: model.model,
          estimatedTokens: Math.ceil(JSON.stringify(request.context ?? {}).length / 4),
          createIfMissing: true,
        })
        if (!gate.ok) {
          return {
            response: {
              ok: false,
              provider: model.provider,
              model: model.model,
              error: gate.reason,
              failureClass: 'PROVIDER',
              latencyMs: 0,
            },
            attempts,
            requestedProvider,
            selectedProvider: null,
            selectedModel: null,
            reason: selected.reason,
          }
        }
      }
      const actionId = `model-${randomUUID()}`
      if (missionId) beginResourceUsage({ missionId, kind: 'model', actionId, graphId: options?.graphId, taskId: options?.taskId, provider: model.provider, model: model.model })
      const response = await invoke(model, kind, request)
      if (missionId) {
        const outputTokens = response.ok ? Math.ceil((response.rawText || '').length / 4) : 0
        completeResourceUsage({
          actionId,
          missionId,
          ok: response.ok,
          provider: response.provider,
          model: response.model,
          kind: 'model',
          inputTokens: Math.ceil(JSON.stringify(request.context ?? {}).length / 4),
          outputTokens,
          totalTokens: Math.ceil(JSON.stringify(request.context ?? {}).length / 4) + outputTokens,
          tokenSource: 'ESTIMATED',
          wallClockMs: response.latencyMs,
        })
      }
      attempts.push({
        provider: model.provider,
        ok: response.ok,
        error: response.ok ? undefined : response.error,
      })
      if (response.ok) {
        return {
          response,
          attempts,
          requestedProvider,
          selectedProvider: response.provider,
          selectedModel: response.model,
          reason: selected.reason === 'PRIMARY_AVAILABLE' && requestedProvider && response.provider !== requestedProvider ? 'FALLBACK' : selected.reason,
        }
      }
      last = response
    }
    return {
      response: last ?? {
        ok: false,
        provider: models[0].provider,
        model: models[0].model,
        error: 'All configured Foundry models failed.',
        failureClass: 'UNAVAILABLE',
        latencyMs: 0,
      },
      attempts,
      requestedProvider,
      selectedProvider: last?.provider ?? models[0].provider,
      selectedModel: last?.model ?? models[0].model,
      reason: selected.reason,
    }
  }
}
