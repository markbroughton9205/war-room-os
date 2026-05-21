import type { CouncilFlowMode } from '@/lib/council/councilMode'

/** Hard ceiling for stable-group prompt token estimate (system + user). */
export const STABLE_GROUP_PROMPT_TOKEN_CEILING = 3200

export type ProviderTokenDiagnosticsInput = {
  mode: CouncilFlowMode
  family?: string
  promptText: string
  responseText?: string
  ceiling?: number
  trimmed?: boolean
}

export type ProviderTokenDiagnostics = {
  mode: CouncilFlowMode
  family?: string
  promptTokens: number
  responseTokens: number
  totalTokens: number
  ceiling: number
  exceededCeiling: boolean
  trimmed?: boolean
}

/** Rough token estimate (chars / 4) — matches rolling compression convention. */
export function estimateTextTokens(text: string): number {
  const chars = text.trim().length
  if (!chars) return 0
  return Math.ceil(chars / 4)
}

export function buildProviderTokenDiagnostics(
  input: ProviderTokenDiagnosticsInput,
): ProviderTokenDiagnostics {
  const promptTokens = estimateTextTokens(input.promptText)
  const responseTokens = estimateTextTokens(input.responseText ?? '')
  const ceiling = input.ceiling ?? STABLE_GROUP_PROMPT_TOKEN_CEILING
  const totalTokens = promptTokens + responseTokens
  return {
    mode: input.mode,
    family: input.family,
    promptTokens,
    responseTokens,
    totalTokens,
    ceiling,
    exceededCeiling: promptTokens > ceiling,
    ...(input.trimmed ? { trimmed: true } : {}),
  }
}

/** Console diagnostics for stable group / stability mode (no secrets). */
export function logProviderTokenDiagnostics(metrics: ProviderTokenDiagnostics): void {
  const payload = {
    kind: 'provider_token_diagnostics',
    mode: metrics.mode,
    family: metrics.family ?? null,
    promptTokens: metrics.promptTokens,
    responseTokens: metrics.responseTokens,
    totalTokens: metrics.totalTokens,
    ceiling: metrics.ceiling,
    exceededCeiling: metrics.exceededCeiling,
    trimmed: metrics.trimmed ?? false,
  }

  console.info('[council-token-diagnostics]', JSON.stringify(payload))

  if (metrics.mode === 'stable_group' && metrics.exceededCeiling) {
    console.warn(
      '[council-token-diagnostics] Stable Group prompt exceeded ceiling',
      JSON.stringify({
        promptTokens: metrics.promptTokens,
        ceiling: metrics.ceiling,
        family: metrics.family ?? null,
        trimmed: metrics.trimmed ?? false,
      }),
    )
  }
}
