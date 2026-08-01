import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  integrityDebugTail,
  logIntegrityDebug,
} from '@/lib/council/integrityDebug'
import {
  buildIntegrityExpectationForPrompt,
  detectPromptIntent,
  detectsExplicitBrevityRequest,
  isRelaxedPromptIntent,
  RELAXED_MIN_LENGTH,
  RELAXED_MIN_MEANINGFUL_TOKENS,
  type PromptIntent,
} from '@/lib/council/promptIntent'
import {
  isCouncilStabilityMode,
  logCouncilStabilityRender,
  shouldPassthroughCouncilProviderText,
} from '@/lib/council/stabilityMode'
import type { CouncilFlowMode } from '@/lib/council/councilMode'
import { toDisplayText } from '@/lib/council/toDisplayText'
import {
  countMeaningfulTokens,
  detectGreetingOnlyResponse,
  isDegradedResponseQuality,
  isHardRenderIntegrityFailure,
  validateProviderResponseIntegrity,
  type ResponseIntegrityStatus,
} from '@/lib/providers/responseIntegrity'

export const GEMINI_DEGRADED_COUNCIL_DISPLAY =
  'Gemini response incomplete — retry/fallback required.'

export const PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY =
  'Provider response incomplete; fallback summary used'

export const PROVIDER_RESPONSE_UNAVAILABLE_DISPLAY =
  'Provider response unavailable'

/**
 * This gate's own generated fallback/degraded display strings — if raw text ever exactly matches
 * one of these (e.g. a persisted message whose content already IS a prior degraded placeholder,
 * fed back through the gate a second time), it must never be re-judged as ordinary COMPLETE
 * content. Without this, synthetic boilerplate can pass integrity checks on its own merits (it
 * reads as a short, grammatically complete sentence) and leak into synthesis findings.
 */
const KNOWN_FALLBACK_DISPLAY_TEXTS: ReadonlySet<string> = new Set([
  GEMINI_DEGRADED_COUNCIL_DISPLAY,
  PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY,
  PROVIDER_RESPONSE_UNAVAILABLE_DISPLAY,
])

export type GeminiRenderDiagnostics = {
  rawLength: number
  meaningfulTokenCount: number
  matchedGreetingOnly: boolean
  retryAttempted?: boolean
  fallbackUsed?: boolean
  finalIntegrityStatus: ResponseIntegrityStatus
  promptIntent?: PromptIntent
}

export type CouncilRenderGateResult = {
  displayText: string
  rawText: string
  renderable: boolean
  integrityStatus: ResponseIntegrityStatus
  degraded: boolean
  diagnostics?: GeminiRenderDiagnostics
  promptIntent?: PromptIntent
}

export function parseCouncilMessageFamily(familyName: unknown): CouncilOrchestrationFamily | null {
  const raw = toDisplayText(familyName).replace(/\s+family$/i, '').trim().toLowerCase()
  if (/red\s*team/.test(raw)) return 'red_team'
  const key = raw.replace(/\s+/g, '_')
  const map: Record<string, CouncilOrchestrationFamily> = {
    chatgpt: 'chatgpt',
    claude: 'claude',
    grok: 'grok',
    gemini: 'gemini',
    red_team: 'red_team',
    baby: 'baby',
    kimi: 'kimi',
    bridge_architect: 'bridge_architect',
  }
  return map[key] ?? null
}

function buildGeminiDiagnostics(
  rawText: string,
  integrityStatus: ResponseIntegrityStatus,
  opts?: { retryAttempted?: boolean; fallbackUsed?: boolean; promptIntent?: PromptIntent },
): GeminiRenderDiagnostics {
  return {
    rawLength: rawText.length,
    meaningfulTokenCount: countMeaningfulTokens(rawText),
    matchedGreetingOnly: detectGreetingOnlyResponse(rawText),
    retryAttempted: opts?.retryAttempted ?? false,
    fallbackUsed: opts?.fallbackUsed ?? false,
    finalIntegrityStatus: integrityStatus,
    promptIntent: opts?.promptIntent,
  }
}

function resolveRenderDegraded(
  rawText: string,
  integrityStatus: ResponseIntegrityStatus,
  relaxedCasual: boolean,
): boolean {
  if (!rawText.trim()) return false
  if (relaxedCasual) {
    return isHardRenderIntegrityFailure(integrityStatus, { relaxedCasual: true })
  }
  const matchedGreetingOnly = detectGreetingOnlyResponse(rawText)
  return (
    matchedGreetingOnly
    || isDegradedResponseQuality(integrityStatus)
    || integrityStatus !== 'COMPLETE'
  )
}

/**
 * Final render boundary for Live Council and downstream council consumers.
 * Greeting-only Gemini (and other degraded council stubs) must not render as valid responses
 * unless the decree intent is greeting/casual (short friendly replies are valid).
 */
export function applyCouncilRenderGate(
  family: CouncilOrchestrationFamily | null,
  raw: unknown,
  opts?: {
    councilMode?: boolean
    retryAttempted?: boolean
    fallbackUsed?: boolean
    /** Operator decree text — drives relaxed integrity for greetings/casual chat. */
    decreeText?: string
    promptIntent?: PromptIntent
    /** Client echo of stability mode (server reads env when omitted). */
    stabilityMode?: boolean
    /** Live Council flow — stable group enables passthrough when env stability is off. */
    councilFlowMode?: CouncilFlowMode | null
  },
): CouncilRenderGateResult {
  const rawText = toDisplayText(raw).trim()
  const councilMode = opts?.councilMode ?? true
  const promptIntent = opts?.promptIntent ?? (opts?.decreeText ? detectPromptIntent(opts.decreeText) : undefined)
  const relaxedCasual = promptIntent ? isRelaxedPromptIntent(promptIntent) : false
  const brevityRequested = opts?.decreeText ? detectsExplicitBrevityRequest(opts.decreeText) : false
  const passthroughMode = opts?.stabilityMode ?? shouldPassthroughCouncilProviderText()

  if (passthroughMode && family) {
    const displayText = rawText
    logCouncilStabilityRender({
      provider: family,
      rawLength: rawText.length,
      renderedLength: displayText.length,
      fallbackSkipped: true,
    })
    logIntegrityDebug({
      phase: 'applyCouncilRenderGate',
      provider: family,
      rawLength: rawText.length,
      normalizedLength: rawText.length,
      renderedLength: displayText.length,
      last30: integrityDebugTail(rawText),
      ruleTriggered: 'stability_mode_minimal_path',
      gateResult: 'stability_mode_pass',
      integrityStatus: 'COMPLETE',
      renderable: true,
      degraded: false,
      stabilityMode: passthroughMode,
      fallbackSkipped: true,
      relaxedCasual,
      promptIntent,
    })
    return {
      displayText,
      rawText,
      renderable: Boolean(rawText),
      integrityStatus: rawText ? 'COMPLETE' : 'EMPTY',
      degraded: false,
      promptIntent,
    }
  }

  if (!family || !rawText) {
    return {
      displayText: rawText,
      rawText,
      renderable: Boolean(rawText),
      integrityStatus: rawText ? 'UNKNOWN' : 'EMPTY',
      degraded: false,
      promptIntent,
    }
  }

  if (KNOWN_FALLBACK_DISPLAY_TEXTS.has(rawText)) {
    return {
      displayText: rawText,
      rawText,
      renderable: false,
      integrityStatus: 'DEGRADED_RESPONSE_QUALITY',
      degraded: true,
      promptIntent,
    }
  }

  const integrityExpectation = promptIntent
    ? buildIntegrityExpectationForPrompt(
        promptIntent,
        {
          minLength: family === 'red_team' ? 60 : 80,
          councilMode,
        },
        { brevityRequested },
      )
    : brevityRequested
      ? {
          minLength: RELAXED_MIN_LENGTH,
          minMeaningfulTokens: RELAXED_MIN_MEANINGFUL_TOKENS,
          councilMode,
          brevityRequested: true,
        }
      : {
          minLength: family === 'red_team' ? 60 : 80,
          councilMode,
        }

  const integrity = validateProviderResponseIntegrity(rawText, integrityExpectation)
  const matchedGreetingOnly = !relaxedCasual && detectGreetingOnlyResponse(rawText)
  const degraded = resolveRenderDegraded(rawText, integrity.integrity_status, relaxedCasual)

  const logGate = (gateResult: string, renderable: boolean, displayText: string) => {
    logIntegrityDebug({
      phase: 'applyCouncilRenderGate',
      rawLength: rawText.length,
      normalizedLength: rawText.trim().length,
      renderedLength: displayText.length,
      last30: integrityDebugTail(rawText),
      ruleTriggered: integrity.reason,
      gateResult,
      integrityStatus: integrity.integrity_status,
      renderable,
      degraded,
      stabilityMode: passthroughMode,
      relaxedCasual,
      promptIntent,
    })
  }

  const relaxedStabilityPass =
    relaxedCasual
    && passthroughMode
    && integrity.integrity_status !== 'EMPTY'
    && integrity.integrity_status !== 'MALFORMED'

  if (relaxedStabilityPass) {
    const out: CouncilRenderGateResult = {
      displayText: rawText,
      rawText,
      renderable: true,
      integrityStatus: integrity.integrity_status,
      degraded: false,
      promptIntent,
      ...(family === 'gemini'
        ? {
            diagnostics: buildGeminiDiagnostics(rawText, integrity.integrity_status, {
              retryAttempted: opts?.retryAttempted,
              fallbackUsed: opts?.fallbackUsed,
              promptIntent,
            }),
          }
        : {}),
    }
    logGate('relaxed_stability_pass', true, rawText)
    return out
  }

  if (family === 'gemini' && degraded && !relaxedCasual) {
    const integrityStatus: ResponseIntegrityStatus = matchedGreetingOnly
      ? 'DEGRADED_RESPONSE_QUALITY'
      : integrity.integrity_status
    const blocked: CouncilRenderGateResult = {
      displayText: GEMINI_DEGRADED_COUNCIL_DISPLAY,
      rawText,
      renderable: false,
      integrityStatus,
      degraded: true,
      promptIntent,
      diagnostics: buildGeminiDiagnostics(rawText, integrityStatus, {
        retryAttempted: opts?.retryAttempted,
        fallbackUsed: opts?.fallbackUsed,
        promptIntent,
      }),
    }
    logGate('gemini_degraded_block', false, blocked.displayText)
    return blocked
  }

  if (relaxedCasual && (passthroughMode || integrity.integrity_status === 'COMPLETE')) {
    const out: CouncilRenderGateResult = {
      displayText: rawText,
      rawText,
      renderable: true,
      integrityStatus: integrity.integrity_status === 'INCOMPLETE' ? 'COMPLETE' : integrity.integrity_status,
      degraded: false,
      promptIntent,
      ...(family === 'gemini'
        ? {
            diagnostics: buildGeminiDiagnostics(rawText, integrity.integrity_status, {
              retryAttempted: opts?.retryAttempted,
              fallbackUsed: opts?.fallbackUsed,
              promptIntent,
            }),
          }
        : {}),
    }
    logGate('relaxed_casual_pass', true, rawText)
    return out
  }

  if (degraded) {
    const shouldBlock =
      !relaxedCasual
      || integrity.integrity_status === 'EMPTY'
      || integrity.integrity_status === 'MALFORMED'
    if (!shouldBlock) {
      const out: CouncilRenderGateResult = {
        displayText: rawText,
        rawText,
        renderable: true,
        integrityStatus: integrity.integrity_status,
        degraded: false,
        promptIntent,
      }
      logGate('relaxed_non_hard_pass', true, rawText)
      return out
    }
    const blocked: CouncilRenderGateResult = {
      displayText:
        integrity.fallback_recommended
          ? PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY
          : PROVIDER_RESPONSE_UNAVAILABLE_DISPLAY,
      rawText,
      renderable: false,
      integrityStatus: matchedGreetingOnly ? 'DEGRADED_RESPONSE_QUALITY' : integrity.integrity_status,
      degraded: true,
      promptIntent,
    }
    logGate('degraded_fallback', false, blocked.displayText)
    return blocked
  }

  const out: CouncilRenderGateResult = {
    displayText: rawText,
    rawText,
    renderable: true,
    integrityStatus: integrity.integrity_status,
    degraded: false,
    promptIntent,
    ...(family === 'gemini'
      ? {
          diagnostics: buildGeminiDiagnostics(rawText, integrity.integrity_status, {
            retryAttempted: opts?.retryAttempted,
            fallbackUsed: opts?.fallbackUsed,
            promptIntent,
          }),
        }
      : {}),
  }
  logGate('complete_pass', true, rawText)
  return out
}

export function isCouncilMessageRepairPacketEligible(message: {
  degraded?: boolean
  integrityStatus?: string
  content?: unknown
  messageType?: string
  decreeText?: string
  promptIntent?: PromptIntent
}): boolean {
  if (isCouncilStabilityMode()) return false
  if (message.messageType !== 'response') return false
  if (message.degraded) return false
  if (message.integrityStatus === 'DEGRADED_RESPONSE_QUALITY') return false
  const text = toDisplayText(message.content).trim()
  if (!text) return false
  if (text === GEMINI_DEGRADED_COUNCIL_DISPLAY) return false

  const intent = message.promptIntent ?? (message.decreeText ? detectPromptIntent(message.decreeText) : undefined)
  if (intent && isRelaxedPromptIntent(intent)) return false

  if (detectGreetingOnlyResponse(text)) return false
  const integrity = validateProviderResponseIntegrity(text, { councilMode: true })
  return integrity.integrity_status === 'COMPLETE' && !isDegradedResponseQuality(integrity.integrity_status)
}
