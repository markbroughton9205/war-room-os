/**
 * WR-Engineer Phase 5 model router.
 *
 * DEFAULT: LOCAL. AUTO tries the local engine first, then a configured Council provider.
 * EXTERNAL uses only the Commander-selected hosted family. LOCAL never calls an external
 * provider. Attribution always reflects the adapter that actually answered.
 *
 * Does not change the Phase 4 inspect loop — chat still calls ModelAdapter.invoke().
 */
import {
  DEFAULT_CODER_FALLBACK_ORDER,
  isProviderFamilyConfigured,
  type DirectProviderFamily,
} from '@/lib/council/providerDirectCall'
import { CouncilProviderModelAdapter } from './modelAdapter'
import { LocalWrEngineerModelAdapter } from './localModelAdapter'
import { classifyProviderFailure, type ProviderFailureClass } from './providerFailure'
import { rememberExternalFailure } from './engineHealth'
import type { EngineMode, EngineSelection } from './engineTypes'
import { wrEngineerEngineSelectionStore } from './engineSelection'
import type { ModelAdapter, ModelAdapterRequest, ModelAdapterResult } from './types'

export type WrEngineerModelRouterOptions = {
  selection: EngineSelection
  local: ModelAdapter
  external: ModelAdapter
  allowFallback?: boolean
}

function withAttribution(result: ModelAdapterResult, answeredBy: 'local' | 'external'): ModelAdapterResult {
  const failureClass: ProviderFailureClass | undefined = result.ok
    ? undefined
    : result.failureClass ?? classifyProviderFailure(result.error)
  return { ...result, answeredBy, failureClass }
}

export class WrEngineerModelRouter implements ModelAdapter {
  private lastAnsweredId: string
  readonly mode: EngineMode
  private readonly local: ModelAdapter
  private readonly external: ModelAdapter
  private readonly allowFallback: boolean
  private readonly externalFamily: DirectProviderFamily

  constructor(options: WrEngineerModelRouterOptions) {
    this.mode = options.selection.mode
    this.local = options.local
    this.external = options.external
    this.allowFallback = options.allowFallback ?? options.selection.mode === 'AUTO'
    this.externalFamily = options.selection.externalFamily
    this.lastAnsweredId = `wr-engineer-router:${this.mode}`
  }

  get id(): string {
    return this.lastAnsweredId
  }

  async invoke(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    if (this.mode === 'EXTERNAL') {
      const result = withAttribution(await this.external.invoke(request), 'external')
      this.lastAnsweredId = result.adapterId
      rememberExternalFailure(this.externalFamily, result.ok ? undefined : result.failureClass)
      return result
    }

    const localResult = withAttribution(await this.local.invoke(request), 'local')
    if (localResult.ok) {
      this.lastAnsweredId = localResult.adapterId
      return localResult
    }

    if (this.mode === 'LOCAL' || !this.allowFallback) {
      this.lastAnsweredId = localResult.adapterId
      return localResult
    }

    const fallback = withAttribution(await this.external.invoke(request), 'external')
    this.lastAnsweredId = fallback.adapterId
    rememberExternalFailure(this.externalFamily, fallback.ok ? undefined : fallback.failureClass)
    if (fallback.ok) {
      return fallback
    }
    return {
      ...fallback,
      error: `Local engine failed (${localResult.error ?? 'unavailable'}); external fallback failed (${fallback.error ?? 'unavailable'}).`,
    }
  }
}

export async function createWrEngineerChatAdapter(
  selectionStore = wrEngineerEngineSelectionStore,
): Promise<WrEngineerModelRouter> {
  const selection = await selectionStore.load()
  const local = new LocalWrEngineerModelAdapter({ model: selection.localModel })
  const family: DirectProviderFamily = isProviderFamilyConfigured(selection.externalFamily)
    ? selection.externalFamily
    : (DEFAULT_CODER_FALLBACK_ORDER.find(isProviderFamilyConfigured) ?? selection.externalFamily)
  const external = new CouncilProviderModelAdapter(family)
  return new WrEngineerModelRouter({
    selection,
    local,
    external,
    allowFallback: selection.mode === 'AUTO',
  })
}
