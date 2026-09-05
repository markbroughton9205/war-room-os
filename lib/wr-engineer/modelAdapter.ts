/**
 * WR-Engineer model adapter layer.
 *
 * WR-Engineer Agent -> Engineering Runtime -> Model Adapter -> current local/external coding model.
 *
 * This module is the ONLY place WR-Engineer's runtime is allowed to know which provider is
 * currently answering. Nothing in identity/, agentState.ts, missionContext.ts, memory/, or
 * readSurface.ts/validation.ts/codeEditProposals.ts may import a provider directly — they only ever
 * see the ModelAdapter interface (lib/wr-engineer/types.ts). This is what makes the later
 * migrations (-> local model -> native WR-Engineer model, see IDENTITY.md "Long-term sovereign
 * mission") additive: a new adapter implementation, zero changes anywhere else.
 *
 * Phase 1 does not select a permanent adapter. CouncilProviderModelAdapter below is a thin
 * delegation to the repo's existing hosted-provider dispatch (lib/council/providerDirectCall.ts) —
 * the same function lib/native-builder's repairPlanner.ts and lib/mission-runtime's
 * engineeringStrategy.ts already inject as `councilInvoke` — so WR-Engineer introduces zero new
 * provider dispatch code. It is offered as a default wiring option, not a permanent binding: swap
 * the adapter passed into WREngineerRuntime (runtime.ts) to change what answers, without touching
 * this file's interface or any caller of it.
 */
import {
  invokeDirectCouncilProvider,
  isProviderFamilyConfigured,
  type DirectProviderFamily,
} from '@/lib/council/providerDirectCall'
import type { ModelAdapter, ModelAdapterRequest, ModelAdapterResult } from './types'

/**
 * Delegates to an existing, already-governed Council provider call. `adapterId` is the honest
 * label for "which backend answered" — WR-Engineer's own identity (IDENTITY.md) is never derived
 * from this value, and this adapter never claims WR-Engineer IS the named provider.
 */
export class CouncilProviderModelAdapter implements ModelAdapter {
  readonly id: string

  constructor(private readonly family: DirectProviderFamily) {
    this.id = `council_provider:${family}`
  }

  async invoke(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    if (!isProviderFamilyConfigured(this.family)) {
      return {
        ok: false,
        text: '',
        adapterId: this.id,
        epistemicStatus: 'NOT_VERIFIED',
        error: `Provider family "${this.family}" is not configured in this environment (missing API key).`,
      }
    }

    const result = await invokeDirectCouncilProvider(this.family, request.userPrompt, {
      timeoutMs: request.timeoutMs,
      maxTokens: request.maxTokens,
      system: request.systemPrompt,
    })

    return {
      ok: result.ok,
      text: result.text,
      adapterId: this.id,
      // A real network round trip happened — the answer (or honest failure) is OBSERVED, not
      // guessed. Never upgraded to a stronger claim than "this call actually happened and this is
      // what came back."
      epistemicStatus: 'OBSERVED',
      error: result.error,
    }
  }
}

/**
 * Honest placeholder for the eventual local/native model (IDENTITY.md's "-> local coding model ->
 * ... -> native WR-Engineer model" path). Phase 1 does not train or install a model, so this
 * adapter always returns UNKNOWN rather than fabricating a response — SOUL.md §5/§6 forbid
 * pretending a capability exists before it does.
 */
export class UnavailableLocalModelAdapter implements ModelAdapter {
  readonly id = 'local_model:unavailable'

  async invoke(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    return {
      ok: false,
      text: '',
      adapterId: this.id,
      epistemicStatus: 'UNKNOWN',
      error: `No local/native WR-Engineer model exists yet — Phase 1 builds the shell only (request had ${request.userPrompt.length} chars of user prompt).`,
    }
  }
}
