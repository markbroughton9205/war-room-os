import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { toDisplayText } from '@/lib/council/toDisplayText'
import {
  countMeaningfulTokens,
  detectGreetingOnlyResponse,
  isDegradedResponseQuality,
  validateProviderResponseIntegrity,
  type ResponseIntegrityStatus,
} from '@/lib/providers/responseIntegrity'

export const GEMINI_DEGRADED_COUNCIL_DISPLAY =
  'Gemini response incomplete — retry/fallback required.'

export type GeminiRenderDiagnostics = {
  rawLength: number
  meaningfulTokenCount: number
  matchedGreetingOnly: boolean
  retryAttempted?: boolean
  fallbackUsed?: boolean
  finalIntegrityStatus: ResponseIntegrityStatus
}

export type CouncilRenderGateResult = {
  displayText: string
  rawText: string
  renderable: boolean
  integrityStatus: ResponseIntegrityStatus
  degraded: boolean
  diagnostics?: GeminiRenderDiagnostics
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
  opts?: { retryAttempted?: boolean; fallbackUsed?: boolean },
): GeminiRenderDiagnostics {
  return {
    rawLength: rawText.length,
    meaningfulTokenCount: countMeaningfulTokens(rawText),
    matchedGreetingOnly: detectGreetingOnlyResponse(rawText),
    retryAttempted: opts?.retryAttempted ?? false,
    fallbackUsed: opts?.fallbackUsed ?? false,
    finalIntegrityStatus: integrityStatus,
  }
}

/**
 * Final render boundary for Live Council and downstream council consumers.
 * Greeting-only Gemini (and other degraded council stubs) must not render as valid responses.
 */
export function applyCouncilRenderGate(
  family: CouncilOrchestrationFamily | null,
  raw: unknown,
  opts?: {
    councilMode?: boolean
    retryAttempted?: boolean
    fallbackUsed?: boolean
  },
): CouncilRenderGateResult {
  const rawText = toDisplayText(raw).trim()
  const councilMode = opts?.councilMode ?? true

  if (!family || !rawText) {
    return {
      displayText: rawText,
      rawText,
      renderable: Boolean(rawText),
      integrityStatus: rawText ? 'UNKNOWN' : 'EMPTY',
      degraded: false,
    }
  }

  const integrity = validateProviderResponseIntegrity(rawText, {
    minLength: family === 'red_team' ? 60 : 80,
    councilMode,
  })
  const matchedGreetingOnly = detectGreetingOnlyResponse(rawText)
  const degraded =
    matchedGreetingOnly
    || isDegradedResponseQuality(integrity.integrity_status)
    || integrity.integrity_status !== 'COMPLETE'

  if (family === 'gemini' && degraded) {
    const integrityStatus: ResponseIntegrityStatus = matchedGreetingOnly
      ? 'DEGRADED_RESPONSE_QUALITY'
      : integrity.integrity_status
    return {
      displayText: GEMINI_DEGRADED_COUNCIL_DISPLAY,
      rawText,
      renderable: false,
      integrityStatus,
      degraded: true,
      diagnostics: buildGeminiDiagnostics(rawText, integrityStatus, {
        retryAttempted: opts?.retryAttempted,
        fallbackUsed: opts?.fallbackUsed,
      }),
    }
  }

  if (degraded) {
    return {
      displayText:
        integrity.fallback_recommended
          ? 'Provider response incomplete; fallback summary used'
          : 'Provider response unavailable',
      rawText,
      renderable: false,
      integrityStatus: matchedGreetingOnly ? 'DEGRADED_RESPONSE_QUALITY' : integrity.integrity_status,
      degraded: true,
    }
  }

  return {
    displayText: rawText,
    rawText,
    renderable: true,
    integrityStatus: integrity.integrity_status,
    degraded: false,
    ...(family === 'gemini'
      ? {
          diagnostics: buildGeminiDiagnostics(rawText, integrity.integrity_status, {
            retryAttempted: opts?.retryAttempted,
            fallbackUsed: opts?.fallbackUsed,
          }),
        }
      : {}),
  }
}

export function isCouncilMessageRepairPacketEligible(message: {
  degraded?: boolean
  integrityStatus?: string
  content?: unknown
  messageType?: string
}): boolean {
  if (message.messageType !== 'response') return false
  if (message.degraded) return false
  if (message.integrityStatus === 'DEGRADED_RESPONSE_QUALITY') return false
  const text = toDisplayText(message.content).trim()
  if (!text) return false
  if (text === GEMINI_DEGRADED_COUNCIL_DISPLAY) return false
  if (detectGreetingOnlyResponse(text)) return false
  const integrity = validateProviderResponseIntegrity(text, { councilMode: true })
  return integrity.integrity_status === 'COMPLETE' && !isDegradedResponseQuality(integrity.integrity_status)
}
