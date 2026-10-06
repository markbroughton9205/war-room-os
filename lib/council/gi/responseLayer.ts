import type { CommanderFacingResponse, OutputEnvelopeV1 } from './types'
import { naturalFailureProse } from './failureRecovery'

const INTERNAL_JARGON =
  /\b(claim_id|evidence_id|tool_id|routingId|decisionPath|SHORT_PATH|AGENT_PATH|HANDOFF|DEEP_RESEARCH|CURRENT_LIVE|TOOL_BLOCKED|ebc\.|wr\.[a-z0-9.]+|e-\d[\w-]*)\b/gi

const SEAT_SAYS = /\b(ORION|LUMEN|PULSAR|NOVA|PHOENIX|AURORA)\s+says\b/gi

const CONFIDENCE_DUMP = /\bconfidence\s+0\.\d+\b/gi

function stripInternalJargon(text: string): string {
  return naturalFailureProse(
    text
      .replace(INTERNAL_JARGON, '')
      .replace(SEAT_SAYS, '')
      .replace(CONFIDENCE_DUMP, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  )
}

export function isPoeticReady(completion: string, body: string): boolean {
  if (completion === 'VERIFIED' && /READY/i.test(body) && /UNKNOWN/i.test(body)) return true
  return completion === 'VERIFIED' && /\bREADY\b/.test(body) && !/\bverified\b/i.test(body)
}

export function auroraAnswersFirst(text: string, question: string): boolean {
  const lead = text.slice(0, 180).toLowerCase()
  if (!question.trim()) return lead.length > 0 && !/^research brief|^war room status|^verified$/i.test(text)
  const tokens = question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(word => word.length > 3)
  return tokens.slice(0, 3).some(token => lead.includes(token)) || !/^(ORION|LUMEN|PULSAR)\b/.test(text)
}

/**
 * Maps structured OutputEnvelope to Commander-facing language.
 * Internal IDs stay in inspector only.
 */
export function toCommanderFacing(envelope: OutputEnvelopeV1): CommanderFacingResponse {
  const text = stripInternalJargon(envelope.body.summary)
  return {
    text,
    path: envelope.path_used,
    completion_state: envelope.completion_state,
    capture_truth: envelope.capture_truth,
    placement: envelope.placement,
    next_actions: envelope.next_actions,
    inspector: {
      seats_used: envelope.seats_used,
      tool_trace_public: envelope.tool_trace_public,
      authority_decisions: envelope.authority_decisions,
      classifier_reason: envelope.telemetry?.classifier_reason ?? '',
      escalation: envelope.escalation,
      handoff: envelope.handoff,
    },
  }
}

export function publicBodyHasInternalIds(text: string): boolean {
  return /\b(claim_id|evidence_id|tool_id|TOOL_BLOCKED|CURRENT_LIVE)\b/i.test(text)
}

export function hasDuplicatedUnknownBlocks(text: string): boolean {
  const unknownHits = text.match(/what i could not confirm/gi) ?? []
  return unknownHits.length > 1
}
