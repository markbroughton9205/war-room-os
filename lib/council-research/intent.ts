import { detectResearchIntent, type ResearchIntentContext } from '@/lib/research/researchIntent'
import { detectOsSweepIntent } from '@/lib/war-room-sweep/councilIntent'
import { isEconomicOpsCommand } from '@/lib/economic/routing'

export type CouncilResearchIntentContext = ResearchIntentContext & {
  /** News Intel / explicit team research handoff */
  forceTeamResearch?: boolean
}

export type CouncilResearchIntentResult = {
  triggered: boolean
  shouldResearch: boolean
  reasons: string[]
  confidence: number
}

const COUNCIL_TEAM_TRIGGERS: RegExp[] = [
  /\bwhat(?:'s| is)\s+going\s+on\b/i,
  /\bresearch\s+this\b/i,
  /\binvestigate\b/i,
  /\bscout\s+(?:for\s+)?opportunit/i,
  /\bwhat\s+should\s+i\s+do\b/i,
  /\b(?:market|markets|news|intel|intelligence)\b/i,
  /\bask\s+(?:the\s+)?council\b/i,
  /\bsend\s+analysts\b/i,
  /\bsource[-\s]?backed\b/i,
  /\bverified,?\s+emerging,?\s+contradictions\b/i,
  /\bcouncil,?\s+review\s+this\b/i,
]

function councilPhraseHits(text: string): string[] {
  const reasons: string[] = []
  for (const p of COUNCIL_TEAM_TRIGGERS) {
    if (p.test(text)) reasons.push(`council_team:${p.source.slice(0, 40)}`)
  }
  return reasons
}

/**
 * Detect when Live Council should run coordinated **Council Research Team** mode
 * (multi-family, source-backed). Distinct from OS sweep and generic attendance.
 */
export function detectCouncilResearchIntent(
  text: string,
  ctx?: CouncilResearchIntentContext,
): CouncilResearchIntentResult {
  const raw = typeof text === 'string' ? text : ''
  const t = raw.trim()
  if (!t) {
    return { triggered: false, shouldResearch: false, reasons: ['empty_text'], confidence: 0 }
  }

  if (detectOsSweepIntent(t)) {
    return { triggered: false, shouldResearch: false, reasons: ['excluded_os_sweep'], confidence: 0 }
  }

  if (isEconomicOpsCommand(t)) {
    return { triggered: false, shouldResearch: false, reasons: ['excluded_economic_ops'], confidence: 0 }
  }

  if (ctx?.attendanceFlow && !ctx?.forceTeamResearch) {
    return { triggered: false, shouldResearch: false, reasons: ['excluded_attendance_flow'], confidence: 0 }
  }

  if (ctx?.sequentialDiagnostic) {
    return { triggered: false, shouldResearch: false, reasons: ['excluded_sequential_diagnostic'], confidence: 0 }
  }

  const base = detectResearchIntent(t, ctx)
  const councilReasons = councilPhraseHits(t)
  const allReasons = [...new Set([...base.reasons, ...councilReasons])]

  const triggered =
    ctx?.forceTeamResearch === true
    || (base.shouldResearch && councilReasons.length > 0)
    || (base.shouldResearch && /\bcouncil\b/i.test(t))
    || (councilReasons.length >= 2)
    || (councilReasons.length > 0 && base.shouldResearch)

  const confidence = triggered
    ? Math.min(1, Math.max(base.confidence, 0.4 + councilReasons.length * 0.12))
    : base.confidence

  return {
    triggered,
    shouldResearch: base.shouldResearch || triggered,
    reasons: triggered ? allReasons : base.reasons,
    confidence,
  }
}
