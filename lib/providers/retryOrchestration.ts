import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ProviderRuntimeId } from '@/lib/providers/health'
import { logProviderIntegrityAudit } from '@/lib/providers/integrityAudit'
import { getProviderIntegritySnapshot, recordProviderIntegrityOutcome } from '@/lib/providers/integrityRuntime'
import {
  operatorSafeIncompleteMessage,
  shortenPromptForRetry,
  validateProviderResponseIntegrity,
  type ResponseIntegrityExpectation,
  type ResponseIntegrityResult,
} from '@/lib/providers/responseIntegrity'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

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
}

const FAMILY_TO_PROVIDER: Record<CouncilOrchestrationFamily, ProviderRuntimeId> = {
  chatgpt: 'openai',
  claude: 'anthropic',
  grok: 'xai',
  gemini: 'google',
  red_team: 'anthropic',
  baby: 'openai',
  kimi: 'openai',
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
    default:
      return false
  }
}

function councilExpectation(family: CouncilOrchestrationFamily): ResponseIntegrityExpectation {
  return {
    minLength: family === 'red_team' ? 60 : 80,
    markdown: true,
    requiredSections:
      family === 'gemini' || family === 'chatgpt' ? undefined : undefined,
  }
}

export type InvokeProviderFn = (args: {
  family: CouncilOrchestrationFamily
  prompt: string
  shorter?: boolean
}) => Promise<string>

/**
 * Run integrity validation, optional single retry with shorter prompt, then optional fallback family.
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
  let text = args.rawText.trim()
  let retryCount = 0
  let fallbackUsed = false
  let fallbackProvider: ProviderRuntimeId | null = null
  let diagnosticFragment: string | undefined

  const assess = () =>
    validateProviderResponseIntegrity(text, {
      ...councilExpectation(args.family),
      ...(args.finishReason && /MAX_TOKENS|LENGTH/i.test(args.finishReason)
        ? { minLength: 40 }
        : {}),
    })

  let integrity = assess()

  recordProviderIntegrityOutcome({
    providerId,
    integrityStatus: integrity.integrity_status,
    reason: integrity.reason,
  })

  await logProviderIntegrityAudit(args.auditClient ?? null, {
    provider: providerId,
    integrityStatus: integrity.integrity_status,
    retryAttempt: 0,
    reason: integrity.reason,
    family: args.family,
  })

  if (integrity.integrity_status !== 'COMPLETE' && integrity.retry_recommended) {
    retryCount += 1
    const shorterPrompt = shortenPromptForRetry(args.prompt)
    try {
      const retryText = (await args.invoke({ family: args.family, prompt: shorterPrompt, shorter: true })).trim()
      if (retryText) {
        text = retryText
        integrity = assess()
        recordProviderIntegrityOutcome({
          providerId,
          integrityStatus: integrity.integrity_status,
          reason: integrity.reason,
          retryIncrement: 1,
        })
        await logProviderIntegrityAudit(args.auditClient ?? null, {
          provider: providerId,
          integrityStatus: integrity.integrity_status,
          retryAttempt: 1,
          reason: integrity.reason,
          family: args.family,
        })
      }
    } catch {
      /* keep first integrity result */
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
          text = fallbackText
          integrity = fbIntegrity
          recordProviderIntegrityOutcome({
            providerId,
            integrityStatus: 'INCOMPLETE',
            reason: `primary incomplete; fallback ${fallbackFamily} succeeded`,
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

  if (integrity.integrity_status !== 'COMPLETE') {
    recordProviderIntegrityOutcome({
      providerId,
      integrityStatus: integrity.integrity_status,
      reason: integrity.reason,
      retryIncrement: 0,
    })
    const snap = getProviderIntegritySnapshot(providerId)
    const degradedLabel =
      args.family === 'gemini' && snap.consecutive_integrity_failures >= 1
        ? 'Gemini response incomplete — retry/fallback used'
        : undefined
    return {
      text,
      displayText: fallbackUsed
        ? operatorSafeIncompleteMessage('fallback')
        : operatorSafeIncompleteMessage('unavailable'),
      integrity,
      providerId,
      family: args.family,
      retryCount,
      fallbackUsed,
      fallbackProvider,
      diagnosticFragment,
      degradedLabel,
    }
  }

  return {
    text,
    displayText: text,
    integrity,
    providerId,
    family: args.family,
    retryCount,
    fallbackUsed,
    fallbackProvider,
  }
}

export function mapFamilyToProviderId(family: CouncilOrchestrationFamily): ProviderRuntimeId {
  return FAMILY_TO_PROVIDER[family]
}
