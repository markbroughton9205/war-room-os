import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ProviderRuntimeId } from '@/lib/providers/health'
import { logProviderIntegrityAudit } from '@/lib/providers/integrityAudit'
import { getProviderIntegritySnapshot, recordProviderIntegrityOutcome } from '@/lib/providers/integrityRuntime'
import {
  buildGeminiSimplifiedRetryPrompt,
  countMeaningfulTokens,
  detectGreetingOnlyResponse,
  isDegradedResponseQuality,
  operatorSafeIncompleteMessage,
  shortenPromptForRetry,
  stripCouncilCompressionForRetry,
  validateProviderResponseIntegrity,
  type ResponseIntegrityExpectation,
  type ResponseIntegrityResult,
} from '@/lib/providers/responseIntegrity'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { GeminiRenderDiagnostics } from '@/lib/council/councilRenderGate'
import { shouldPassthroughCouncilProviderText } from '@/lib/council/stabilityMode'

export type ProviderCallOutcome = {
  text: string
  /** Sanitized operator/council facing text */
  displayText: string
  integrity: ResponseIntegrityResult
  providerId: ProviderRuntimeId
  family: CouncilOrchestrationFamily
  retryCount: number
  fallbackUsed: boolean
  fallbackProvider: ProviderRuntimeId | null
  /** Original incomplete body — diagnostics only; never for Operator View */
  diagnosticFragment?: string
  degradedLabel?: string
  diagnostics?: {
    promptChars: number
    completionChars: number
    truncationDetected: boolean
    retryStrategies: string[]
    gemini?: GeminiRenderDiagnostics
  }
}

export type GeminiRetryStrategy = 'simplified' | 'no_compression' | 'short_context'

const FAMILY_TO_PROVIDER: Record<CouncilOrchestrationFamily, ProviderRuntimeId> = {
  chatgpt: 'openai',
  claude: 'anthropic',
  grok: 'xai',
  gemini: 'google',
  red_team: 'anthropic',
  baby: 'openai',
  kimi: 'moonshot',
  bridge_architect: 'openai',
}

const FALLBACK_CHAIN: Partial<Record<CouncilOrchestrationFamily, CouncilOrchestrationFamily[]>> = {
  gemini: ['chatgpt', 'claude'],
  grok: ['chatgpt', 'claude'],
  chatgpt: ['claude', 'gemini'],
  claude: ['chatgpt', 'gemini'],
  red_team: ['claude', 'chatgpt'],
  baby: ['chatgpt'],
}

const FAMILY_DISPLAY_LABEL: Record<CouncilOrchestrationFamily, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  grok: 'Grok',
  gemini: 'Gemini',
  red_team: 'Red Team',
  baby: 'Baby',
  kimi: 'Kimi',
  bridge_architect: 'Bridge Architect',
}

function familyDisplayLabel(family: CouncilOrchestrationFamily): string {
  return FAMILY_DISPLAY_LABEL[family] ?? family
}

function providerConfigured(id: ProviderRuntimeId): boolean {
  switch (id) {
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY?.trim())
    case 'anthropic':
      return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
    case 'google':
      return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim())
    case 'xai':
      return Boolean(process.env.XAI_API_KEY?.trim())
    case 'moonshot':
      return Boolean(process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim())
    default:
      return false
  }
}

function councilExpectation(family: CouncilOrchestrationFamily): ResponseIntegrityExpectation {
  return {
    minLength: family === 'red_team' ? 60 : 80,
    markdown: true,
    councilMode: true,
    minMeaningfulTokens: family === 'gemini' ? 20 : 24,
  }
}

function geminiRetryPrompts(originalPrompt: string, strategy: GeminiRetryStrategy): string {
  const decreeHint =
    originalPrompt.match(/Ra'el[\s\S]*?(?=\n\n###|\n\nCouncil|$)/)?.[0]
    ?? originalPrompt.slice(0, 400)

  switch (strategy) {
    case 'simplified':
      return buildGeminiSimplifiedRetryPrompt(decreeHint, 700)
    case 'no_compression':
      return stripCouncilCompressionForRetry(
        `${buildGeminiSimplifiedRetryPrompt(decreeHint, 500)}\n\n${stripCouncilCompressionForRetry(originalPrompt)}`,
      )
    case 'short_context':
      return shortenPromptForRetry(buildGeminiSimplifiedRetryPrompt(decreeHint, 400), 550)
    default:
      return shortenPromptForRetry(originalPrompt)
  }
}

export type InvokeProviderFn = (args: {
  family: CouncilOrchestrationFamily
  prompt: string
  shorter?: boolean
  retryStrategy?: GeminiRetryStrategy | 'default'
}) => Promise<string>

/**
 * Run integrity validation, optional Gemini-specific retries, then optional fallback family.
 */
export async function orchestrateProviderResponse(args: {
  family: CouncilOrchestrationFamily
  prompt: string
  rawText: string
  invoke: InvokeProviderFn
  auditClient?: WarRoomSupabase | null
  finishReason?: string | null
}): Promise<ProviderCallOutcome> {
  const providerId = FAMILY_TO_PROVIDER[args.family]
  const promptChars = args.prompt.trim().length
  let text = args.rawText.trim()

  if (shouldPassthroughCouncilProviderText()) {
    const integrity: ResponseIntegrityResult = text
      ? {
          integrity_status: 'COMPLETE',
          confidence: 92,
          reason: 'council stability mode — orchestration bypassed',
          retry_recommended: false,
          fallback_recommended: false,
        }
      : {
          integrity_status: 'EMPTY',
          confidence: 95,
          reason: 'empty provider response',
          retry_recommended: true,
          fallback_recommended: false,
        }
    return {
      text,
      displayText: text,
      integrity,
      providerId,
      family: args.family,
      retryCount: 0,
      fallbackUsed: false,
      fallbackProvider: null,
      diagnostics: {
        promptChars,
        completionChars: text.length,
        truncationDetected: false,
        retryStrategies: [],
      },
    }
  }
  let retryCount = 0
  let fallbackUsed = false
  let fallbackProvider: ProviderRuntimeId | null = null
  let fallbackFamilyUsed: CouncilOrchestrationFamily | null = null
  let diagnosticFragment: string | undefined
  const retryStrategies: string[] = []

  const baseExpectation = (): ResponseIntegrityExpectation => ({
    ...councilExpectation(args.family),
    ...(args.finishReason && /MAX_TOKENS|LENGTH/i.test(args.finishReason)
      ? { minLength: 40 }
      : {}),
  })

  const assess = () => validateProviderResponseIntegrity(text, baseExpectation())

  let integrity = assess()

  const recordOutcome = (
    integrityStatus: ResponseIntegrityResult['integrity_status'],
    reason: string,
    extra?: { retryIncrement?: number; fallbackProvider?: ProviderRuntimeId | null; strategy?: string },
  ) => {
    recordProviderIntegrityOutcome({
      providerId,
      integrityStatus,
      reason,
      retryIncrement: extra?.retryIncrement,
      fallbackProvider: extra?.fallbackProvider,
      diagnostics: {
        prompt_chars: promptChars,
        completion_chars: text.length,
        truncation_detected:
          integrityStatus === 'TRUNCATED'
          || /truncat|max_tokens|length/i.test(args.finishReason ?? ''),
        integrity_failures: integrityStatus === 'COMPLETE' ? undefined : 1,
        fallback_used: fallbackUsed,
        last_retry_strategy: extra?.strategy ?? null,
        finish_reason: args.finishReason ?? null,
      },
    })
  }

  recordOutcome(integrity.integrity_status, integrity.reason)

  await logProviderIntegrityAudit(args.auditClient ?? null, {
    provider: providerId,
    integrityStatus: integrity.integrity_status,
    retryAttempt: 0,
    reason: integrity.reason,
    family: args.family,
  })

  const needsRetry =
    integrity.integrity_status !== 'COMPLETE'
    && (integrity.retry_recommended || isDegradedResponseQuality(integrity.integrity_status))

  if (needsRetry) {
    const strategies: GeminiRetryStrategy[] =
      args.family === 'gemini'
        ? ['simplified', 'no_compression', 'short_context']
        : ['simplified']

    for (const strategy of strategies) {
      if (integrity.integrity_status === 'COMPLETE') break
      if (!integrity.retry_recommended && !isDegradedResponseQuality(integrity.integrity_status)) break

      retryCount += 1
      retryStrategies.push(strategy)
      const retryPrompt =
        args.family === 'gemini'
          ? geminiRetryPrompts(args.prompt, strategy)
          : shortenPromptForRetry(args.prompt)

      try {
        const retryText = (
          await args.invoke({
            family: args.family,
            prompt: retryPrompt,
            shorter: true,
            retryStrategy: strategy,
          })
        ).trim()
        if (retryText) {
          text = retryText
          integrity = assess()
          recordOutcome(integrity.integrity_status, integrity.reason, {
            retryIncrement: 1,
            strategy,
          })
          await logProviderIntegrityAudit(args.auditClient ?? null, {
            provider: providerId,
            integrityStatus: integrity.integrity_status,
            retryAttempt: retryCount,
            reason: `${integrity.reason} (strategy=${strategy})`,
            family: args.family,
          })
        }
      } catch {
        /* keep prior integrity */
      }

      if (args.family !== 'gemini') break
    }
  }

  if (integrity.integrity_status !== 'COMPLETE' && integrity.fallback_recommended) {
    diagnosticFragment = text.slice(0, 500)
    const chain = FALLBACK_CHAIN[args.family] ?? ['chatgpt', 'claude']
    for (const fallbackFamily of chain) {
      const fallbackId = FAMILY_TO_PROVIDER[fallbackFamily]
      if (!providerConfigured(fallbackId)) continue
      try {
        const fallbackText = (
          await args.invoke({
            family: fallbackFamily,
            prompt: shortenPromptForRetry(
              `${args.prompt}\n\nSummarize the prior incomplete ${args.family} response attempt in 3–5 sentences. Label gaps explicitly; do not invent root causes.`,
              900,
            ),
            shorter: true,
          })
        ).trim()
        const fbIntegrity = validateProviderResponseIntegrity(fallbackText, councilExpectation(fallbackFamily))
        if (fbIntegrity.integrity_status === 'COMPLETE') {
          fallbackUsed = true
          fallbackProvider = fallbackId
          fallbackFamilyUsed = fallbackFamily
          text = fallbackText
          integrity = fbIntegrity
          recordOutcome('INCOMPLETE', `primary incomplete; fallback ${fallbackFamily} succeeded`, {
            fallbackProvider: fallbackId,
          })
          await logProviderIntegrityAudit(args.auditClient ?? null, {
            provider: providerId,
            integrityStatus: 'INCOMPLETE',
            retryAttempt: retryCount,
            fallbackProvider: fallbackId,
            reason: 'fallback summary used after incomplete primary',
            family: args.family,
          })
          break
        }
      } catch {
        continue
      }
    }
  }

  const truncationDetected =
    integrity.integrity_status === 'TRUNCATED'
    || /MAX_TOKENS|LENGTH/i.test(args.finishReason ?? '')

  const geminiDiagnostics =
    args.family === 'gemini'
      ? {
          rawLength: text.length,
          meaningfulTokenCount: countMeaningfulTokens(text),
          matchedGreetingOnly: detectGreetingOnlyResponse(text),
          retryAttempted: retryCount > 0,
          fallbackUsed,
          finalIntegrityStatus: integrity.integrity_status,
        }
      : undefined

  const diagnostics = {
    promptChars,
    completionChars: text.length,
    truncationDetected,
    retryStrategies,
    ...(geminiDiagnostics ? { gemini: geminiDiagnostics } : {}),
  }

  if (integrity.integrity_status !== 'COMPLETE') {
    recordOutcome(integrity.integrity_status, integrity.reason)
    const snap = getProviderIntegritySnapshot(providerId)
    const degradedLabel =
      args.family === 'gemini'
        ? 'Gemini response incomplete — retry/fallback required.'
        : undefined
    const displayText =
      args.family === 'gemini' && (isDegradedResponseQuality(integrity.integrity_status) || snap.consecutive_integrity_failures >= 1)
        ? operatorSafeIncompleteMessage('gemini')
        : fallbackUsed
          ? operatorSafeIncompleteMessage('fallback')
          : operatorSafeIncompleteMessage('unavailable')

    return {
      text,
      displayText,
      integrity,
      providerId,
      family: args.family,
      retryCount,
      fallbackUsed,
      fallbackProvider,
      diagnosticFragment,
      degradedLabel,
      diagnostics,
    }
  }

  return {
    text,
    // Real content, but it did not come from this family's own model — say so. Otherwise a
    // fallback-family's summary renders under the original family's name as if it spoke it.
    displayText:
      fallbackUsed && fallbackFamilyUsed
        ? `[${familyDisplayLabel(fallbackFamilyUsed)} summarized ${familyDisplayLabel(args.family)}'s incomplete response]\n\n${text}`
        : text,
    integrity,
    providerId,
    family: args.family,
    retryCount,
    fallbackUsed,
    fallbackProvider,
    diagnostics,
  }
}

export function mapFamilyToProviderId(family: CouncilOrchestrationFamily): ProviderRuntimeId {
  return FAMILY_TO_PROVIDER[family]
}
