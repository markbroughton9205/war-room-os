import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import type { ModeGovernor } from '@/lib/council/modeGovernor'
import { applyModeGovernorFilters } from '@/lib/council/modeGovernorFilters'
import { enforceAttendancePresenceShape, stripAttendanceDisplayNoise } from '@/lib/council/intentScope'
import {
  isSpeculativeInfrastructureLanguage,
  replaceWithRuntimeTruthLine,
  type VerifiedRuntimeContext,
} from '@/lib/council/runtimeTruth'

const FILLER_CLAUSE =
  /\b(in conclusion|to summarize|that said|it'?s worth noting|broadly speaking|at a high level|let me know if)\b[^.!?]*[.!?]\s*/gi

const RECURSIVE_CONTINUATION = new RegExp(
  String.raw`\b(?:let me continue|i(?:'ll|\s+will)\s+continue|shall i continue|keep going|more detail if you want|going deeper)\b[^.!?]*[.!?]?\s*`,
  'gi',
)

function splitSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = trimmed.split(/(?<=[.!?])\s+/)
  return parts.map(s => s.trim()).filter(Boolean)
}

function truncateAtSentenceBoundary(text: string, maxSentences: number): string {
  const sentences = splitSentences(text)
  if (sentences.length <= maxSentences) return text.trim()
  return sentences.slice(0, maxSentences).join(' ').trim()
}

const COUNCIL_SECTION_LINE =
  /^\s*(?:[-*•]\s+)?(?:primary\s+finding|recommended\s+action|risk)\s*[—:\-]/i

/** Keep labeled council sections when sentence clamp would erase substance. */
function truncateCouncilPreservingStructure(text: string, maxSentences: number): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed

  const truncated = truncateAtSentenceBoundary(trimmed, maxSentences)
  if (truncated.trim()) return truncated

  const sectionLines = trimmed.split('\n').filter(l => COUNCIL_SECTION_LINE.test(l.trim()))
  if (sectionLines.length) {
    return sectionLines.slice(0, Math.max(1, maxSentences)).join('\n').trim()
  }

  const sentences = splitSentences(trimmed)
  if (sentences.length) {
    return sentences.slice(0, Math.max(1, maxSentences)).join(' ').trim()
  }
  return trimmed.slice(0, 480).trim()
}

function rosterLabel(family: CouncilOrchestrationFamily): string {
  return COUNCIL_ROSTER.find(r => r.id === family)?.label ?? family
}

/** Attendance packet shaping — no emojis, no provider errors, presence-only voice. */
export function shapeAttendanceForModeGovernor(
  text: string,
  family: CouncilOrchestrationFamily,
): string {
  let t = stripAttendanceDisplayNoise(text)
  t = t.replace(/\[(?:error|timeout)\][^\n]*/gi, ' ').trim()
  const label = rosterLabel(family)
  const shaped = enforceAttendancePresenceShape(t)
  t = shaped.text

  if (family === 'red_team') {
    if (/\bmonitor/i.test(t)) return `${label}: Monitoring.`
    return `${label}: Monitoring.`
  }
  if (/\boperational\b/i.test(t) && /\bpresent\b/i.test(t)) {
    return `${label}: Present and operational.`
  }
  if (/\bpresent\b/i.test(t)) return `${label}: Present.`
  return `${label}: Present.`
}

export function compressForModeGovernor(
  text: string,
  governor: ModeGovernor,
  opts?: { family?: CouncilOrchestrationFamily; verifiedContext?: VerifiedRuntimeContext },
): string {
  let t = (text ?? '').trim()
  if (!t) return t

  const informative = governor.mode === 'council' || governor.mode === 'deep_analysis'

  if (!informative) {
    t = t.replace(FILLER_CLAUSE, '')
  }
  if (!governor.continuationAllowed) {
    t = t.replace(RECURSIVE_CONTINUATION, '')
  }

  t = applyModeGovernorFilters(t, governor)

  if (informative) {
    t = governor.mode === 'council'
      ? truncateCouncilPreservingStructure(t, governor.maxSentences)
      : truncateAtSentenceBoundary(t, governor.maxSentences)
  } else {
    t = truncateAtSentenceBoundary(t, governor.maxSentences)
  }

  if (governor.mode === 'attendance' && opts?.family) {
    t = shapeAttendanceForModeGovernor(t, opts.family)
  }

  if (governor.mode === 'recovery' && opts?.family) {
    const verified: VerifiedRuntimeContext = { family: opts.family, ...opts.verifiedContext }
    if (isSpeculativeInfrastructureLanguage(t, verified) || !t.trim()) {
      t = replaceWithRuntimeTruthLine(opts.family, verified)
    }
  }

  return t.trim()
}
