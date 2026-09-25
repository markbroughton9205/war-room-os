/**
 * Mission 04 stronger-model selection.
 * Picks one already-configured non-local route and proves it answers.
 * A failed probe does not fall back to ollama.
 */
import { configuredFoundryModels } from './foundryModelProviders'
import { FoundryModelRouter } from './foundryModelRouter'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import type { FoundryMissionModel, FoundryModelProviderId } from './foundryModelTypes'

export const STRONGER_FAST_IDS = ['REASON-M2-PARTS', 'REASON-M2-INVOICE', 'REASON-M2-EVENTS'] as const

export const STRONGER_FULL_IDS = [
  'REASON-M2-HOLDS',
  'REASON-M2-INVOICE',
  'REASON-M2-PARTS',
  'REASON-M2-ACTOR',
  'REASON-M2-EVENTS',
  'REASON-M2-CENTS',
  'REASON-M2-BIN',
  'REASON-M2-TAG',
  'REASON-M2-SKU',
  'REASON-M2-SUM',
] as const

const PROVIDER_RANK: FoundryModelProviderId[] = [
  'cursor-agent',
  'anthropic',
  'openai',
  'xai',
  'gemini',
  'openai-compatible',
  'deepseek',
  'kimi',
]

export type QwenBaselineRow = {
  result: 'PASS' | 'FAIL' | 'BLOCKED'
  calls: number
  fidelityContradictions: number
  corrections: number
  verifierDefects: number
  replans: number
}

/** Frozen Mission 03 qwen2.5-coder:14b results. Do not refresh by rerunning qwen. */
export const QWEN_MISSION03_BASELINE: Record<string, QwenBaselineRow> = {
  'REASON-M2-HOLDS': { result: 'FAIL', calls: 6, fidelityContradictions: 1, corrections: 1, verifierDefects: 2, replans: 1 },
  'REASON-M2-INVOICE': { result: 'FAIL', calls: 6, fidelityContradictions: 3, corrections: 2, verifierDefects: 1, replans: 2 },
  'REASON-M2-PARTS': { result: 'FAIL', calls: 6, fidelityContradictions: 2, corrections: 2, verifierDefects: 0, replans: 0 },
  'REASON-M2-ACTOR': { result: 'BLOCKED', calls: 6, fidelityContradictions: 2, corrections: 2, verifierDefects: 0, replans: 0 },
  'REASON-M2-EVENTS': { result: 'FAIL', calls: 6, fidelityContradictions: 1, corrections: 1, verifierDefects: 1, replans: 0 },
  'REASON-M2-CENTS': { result: 'FAIL', calls: 6, fidelityContradictions: 3, corrections: 2, verifierDefects: 1, replans: 0 },
  'REASON-M2-BIN': { result: 'PASS', calls: 2, fidelityContradictions: 0, corrections: 0, verifierDefects: 0, replans: 0 },
  'REASON-M2-TAG': { result: 'PASS', calls: 3, fidelityContradictions: 0, corrections: 0, verifierDefects: 1, replans: 0 },
  'REASON-M2-SKU': { result: 'PASS', calls: 2, fidelityContradictions: 0, corrections: 0, verifierDefects: 0, replans: 0 },
  'REASON-M2-SUM': { result: 'PASS', calls: 2, fidelityContradictions: 0, corrections: 0, verifierDefects: 0, replans: 0 },
}

export type StrongerModelSelection = {
  ok: boolean
  provider: FoundryModelProviderId | null
  model: string | null
  reason: string
  proof: string
  failureClass: 'PROVIDER' | 'UNAVAILABLE' | null
  configured: string[]
}

function rank(provider: string): number {
  const index = PROVIDER_RANK.indexOf(provider as FoundryModelProviderId)
  return index === -1 ? PROVIDER_RANK.length : index
}

export function publicProviderError(error: string): string {
  if (/usage limit/i.test(error)) {
    const reset = error.match(/ends on ([0-9/]+)/)
    return `Cursor Agent exited 1: ActionRequiredError: usage limit.${reset ? ` Limits reset on ${reset[1]}.` : ''}`
  }
  return error.replace(/\$[0-9.,]+/g, '').replace(/\s+/g, ' ').slice(0, 280)
}

export async function selectStrongerReasoningModel(): Promise<StrongerModelSelection & { routeModel: FoundryMissionModel | null }> {
  const configured = await configuredFoundryModels()
  const names = configured.map(model => `${model.provider}:${model.model ?? 'none'}`)
  const candidates = configured
    .filter(model => model.provider !== 'ollama' && model.provider !== 'wrim' && model.model)
    .sort((left, right) => rank(left.provider) - rank(right.provider))
  if (!candidates.length) {
    return {
      ok: false,
      provider: null,
      model: null,
      reason: 'No stronger provider is configured. The only available route is local qwen.',
      proof: `configuredFoundryModels: ${names.join(', ') || 'none'}`,
      failureClass: 'UNAVAILABLE',
      configured: names,
      routeModel: null,
    }
  }
  const chosen = candidates[0]
  const router = new FoundryModelRouter([chosen])
  const routed = await router.route('chooseNextAction', {
    kind: 'chooseNextAction',
    context: {
      missionId: 'm04-availability',
      missionKind: 'application',
      userRequest: 'Availability probe. Return TOOL file.read path=README.md reason=probe. Do not write files.',
      goal: 'Prove the pinned route answers.',
      successCriteria: ['A decision returns.'],
      constraints: [],
      permissions: {
        filesystem: true,
        terminal: false,
        browser: false,
        computerUse: false,
        tests: true,
        lint: false,
        typecheck: false,
        build: false,
        package: false,
        installProduction: false,
        activateInstall: false,
        installedRuntimeControl: false,
        process: false,
        commit: false,
        push: false,
        liveDeploy: false,
        internetResearch: false,
      },
      phase: 'EXECUTING',
      plan: [],
      hypotheses: [],
      changedFiles: [],
      importantFindings: [],
      relevantExcerpts: [],
      visualEvidence: [],
      recentToolResults: [],
      recentErrors: [],
      unresolvedQuestions: [],
      completionGate: { complete: false, missing: ['INDEPENDENT_VERIFIER'], detail: 'probe' },
      tools: FOUNDRY_MODEL_TOOL_CATALOG.filter(tool => tool.name === 'file.read' || tool.name === 'workspace.inspect'),
    },
  }, { missionId: 'm04-availability', pinProvider: chosen.provider })
  const response = routed.response
  if (!response.ok || routed.selectedProvider !== chosen.provider) {
    const error = response.ok ? 'Pinned provider did not stay selected.' : response.error
    return {
      ok: false,
      provider: chosen.provider,
      model: chosen.model,
      reason: `${chosen.provider}:${chosen.model} is the strongest configured non-local route. The pinned probe did not return a decision. Qwen is not a substitute.`,
      proof: publicProviderError(error),
      failureClass: response.ok ? 'PROVIDER' : response.failureClass === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'PROVIDER',
      configured: names,
      routeModel: null,
    }
  }
  return {
    ok: true,
    provider: routed.selectedProvider,
    model: routed.selectedModel ?? chosen.model,
    reason: `${chosen.provider}:${routed.selectedModel ?? chosen.model} is the strongest configured non-local route and returned a pinned decision.`,
    proof: `PINNED decision ${response.decision.decision}`,
    failureClass: null,
    configured: names,
    routeModel: chosen,
  }
}
