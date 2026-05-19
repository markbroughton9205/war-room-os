import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { formatDisplayText, toDisplayText } from '@/lib/council/toDisplayText'
import type { ModeGovernor } from '@/lib/council/modeGovernor'
import { applyModeGovernorFilters } from '@/lib/council/modeGovernorFilters'
import {
  attendancePresenceLine,
  rosterLabelForAttendance,
  type AttendanceSlotStatus,
} from '@/lib/council/attendanceReadiness'
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

function truncateAtWordBoundary(text: string, maxLen: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  const cut = trimmed.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > 40 ? cut.slice(0, lastSpace) : cut
  return `${base.trim()}.`
}

/** Attendance packet shaping — single line: "{Family} present." / unavailable / confirming. */
export function shapeAttendanceForModeGovernor(
  text: unknown,
  family: CouncilOrchestrationFamily,
  slotStatus: AttendanceSlotStatus = 'PRESENT',
): string {
  if (slotStatus !== 'PRESENT') {
    return attendancePresenceLine(family, slotStatus)
  }

  let t = stripAttendanceDisplayNoise(toDisplayText(text))
  t = t.replace(/\[(?:error|timeout)\][^\n]*/gi, ' ').trim()
  const shaped = enforceAttendancePresenceShape(t)
  t = shaped.text
  t = truncateAtWordBoundary(t, 120)

  const label = rosterLabelForAttendance(family)
  if (family === 'red_team' && /\bmonitor/i.test(t)) {
    return `${label} monitoring.`
  }
  if (/\boperational\b/i.test(t) && /\bpresent\b/i.test(t)) {
    return `${label} present and operational.`
  }
  if (/\bpresent\b/i.test(t)) return `${label} present.`
  if (/\bunavailable\b/i.test(t)) return `${label} unavailable.`
  if (/\bconfirming\b/i.test(t)) return `${label} confirming.`
  return `${label} present.`
}

export function compressForModeGovernor(
  text: unknown,
  governor: ModeGovernor,
  opts?: { family?: CouncilOrchestrationFamily; verifiedContext?: VerifiedRuntimeContext },
): string {
  let t = formatDisplayText(text, value => value.trim())
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
