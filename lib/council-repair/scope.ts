import { matchedRepairTriggers } from './classifier'
import type { RepairClassification } from './model'
import {
  detectGreetingOnlyResponse,
  isDegradedResponseQuality,
  validateProviderResponseIntegrity,
} from '@/lib/providers/responseIntegrity'
import { GEMINI_DEGRADED_COUNCIL_DISPLAY } from '@/lib/council/councilRenderGate'

const VAGUE_DECREE_ONLY =
  /^(?:please\s+)?(?:fix|repair|diagnose|create|send|prepare)(?:\s+(?:this|war room|it|panel))?(?:\s+please)?[.!?]*$/i

const CONCRETE_ISSUE_MARKERS =
  /\b(panel|route|api|endpoint|component|table|migration|schema|timeout|error|failed|broken|stale|missing|mismatch|inconsistent|unavailable|not connected|engine control|canonical|integrity|operator|council|packet|payload|render|build|eslint|typescript)\b/i

const CONCRETE_SYMPTOM_MARKERS =
  /\b(shows|displays|reports|returns|throws|500|404|hangs|slow|blank|empty|null|undefined|while|but|however|when)\b/i

export type RepairScopeAssessment = {
  scope: 'concrete' | 'needs_scope'
  clarification: string | null
  concreteIssue: string | null
  affectedPanelRoute: string | null
  evidenceHints: string[]
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function isGreetingOnlyRepairSource(content: string | null | undefined): boolean {
  const normalized = (content ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  if (normalized === GEMINI_DEGRADED_COUNCIL_DISPLAY) return true
  if (detectGreetingOnlyResponse(normalized)) return true
  const integrity = validateProviderResponseIntegrity(normalized, { councilMode: true })
  return isDegradedResponseQuality(integrity.integrity_status)
}

export function isVagueRepairLanguage(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return true
  if (normalized.length < 24 && !CONCRETE_ISSUE_MARKERS.test(normalized)) return true
  if (VAGUE_DECREE_ONLY.test(normalized)) return true

  const triggers = matchedRepairTriggers(normalized)
  const hasTriggerOnly = triggers.length > 0 && wordCount(normalized) <= 12 && !CONCRETE_ISSUE_MARKERS.test(normalized)
  if (hasTriggerOnly) return true

  if (wordCount(normalized) < 8 && !CONCRETE_ISSUE_MARKERS.test(normalized)) return true
  if (!CONCRETE_ISSUE_MARKERS.test(normalized) && !CONCRETE_SYMPTOM_MARKERS.test(normalized) && wordCount(normalized) < 18) {
    return true
  }

  return false
}

function inferAffectedSurface(text: string): string | null {
  const normalized = text.toLowerCase()
  if (/\boperator\b/.test(normalized)) return 'Operator View · /api/operator/deck'
  if (/\b(provider runtime|provider status|providers?)\b/.test(normalized)) return 'Provider Runtime · /api/runtime/canonical-status'
  if (/\b(engine control|engine status)\b/.test(normalized)) return 'Engine Control · /api/engine-control/status'
  if (/\b(runtime integrity|integrity)\b/.test(normalized)) return 'Runtime Integrity · /api/runtime/integrity'
  if (/\b(live council|council)\b/.test(normalized)) return 'Live Council · /api/chat'
  if (/\b(signal radar|signals?)\b/.test(normalized)) return 'Signal Radar · /api/signals'
  if (/\b(supabase|schema|migration|persistence)\b/.test(normalized)) return 'Persistence · Supabase migrations'
  return null
}

export function assessRepairScope(input: {
  decree: string
  sourceContent?: string | null
  classification: RepairClassification
}): RepairScopeAssessment {
  if (isGreetingOnlyRepairSource(input.sourceContent)) {
    return {
      scope: 'needs_scope',
      clarification:
        'The selected council response is a greeting-only or degraded placeholder. Describe the broken panel, visible symptom, and expected behavior before generating a repair packet.',
      concreteIssue: null,
      affectedPanelRoute: inferAffectedSurface(input.decree),
      evidenceHints: ['Greeting-only or degraded Gemini output cannot be used as repair evidence.'],
    }
  }

  const combined = [input.decree, input.sourceContent].filter(Boolean).join(' ')
  const vague = isVagueRepairLanguage(combined)
  const affectedPanelRoute = inferAffectedSurface(combined)
  const evidenceHints = [
    input.sourceContent ? 'Council response attached to repair request.' : 'No council response evidence attached.',
    affectedPanelRoute ? `Affected surface inferred: ${affectedPanelRoute}.` : 'Affected panel/route not specified in decree.',
  ]

  if (vague && (input.classification === 'provider_runtime_issue' || input.classification === 'bug' || input.classification === 'ui_issue')) {
    return {
      scope: 'needs_scope',
      clarification:
        'Specify the broken panel or route, the visible symptom, and what you expected instead (for example: "Provider Runtime shows connected but Live Council summary says provider health unavailable").',
      concreteIssue: null,
      affectedPanelRoute,
      evidenceHints,
    }
  }

  const concreteIssue = combined.replace(/\s+/g, ' ').trim().slice(0, 280) || null
  return {
    scope: 'concrete',
    clarification: null,
    concreteIssue,
    affectedPanelRoute,
    evidenceHints,
  }
}

export function isConcreteRepairPacketTitle(title: string): boolean {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (!clean || /^no active repair packet\.?$/i.test(clean)) return false
  if (/^repair packet:\s*(fix|repair|diagnose|create|send|prepare)\b/i.test(clean) && clean.length < 72) return false
  if (/^repair packet:\s*provider runtime issue$/i.test(clean)) return false
  if (/^repair packet:\s*bug$/i.test(clean)) return false
  if (isVagueRepairLanguage(clean.replace(/^repair packet:\s*/i, ''))) return false
  return true
}
