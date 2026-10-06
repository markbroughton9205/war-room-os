import {
  AGENT_ENVELOPE_SCHEMA,
  EBC_AGENT_IDS,
  EBC_MISSION_CLASSES,
  CLAIM_STATUSES,
  CLAIM_LABELS,
  EVIDENCE_KINDS,
  MAX_CLAIM_CHARS_WITHOUT_EVIDENCE,
  POETIC_STATUS_LEXICON,
  TEMPORAL_LAYERS,
  type AgentEnvelopeV1,
  type EbcClaim,
  type EbcEvidence,
} from './types'

export type EnvelopeReject = { ok: false; reason: string }
export type EnvelopeAccept = { ok: true; envelope: AgentEnvelopeV1 }

const ID = /^[A-Za-z0-9_.:-]{1,80}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function poetic(text: string): boolean {
  const lower = text.toLowerCase()
  return POETIC_STATUS_LEXICON.some(token => lower.includes(token))
}

export function validateEnvelope(raw: unknown): EnvelopeAccept | EnvelopeReject {
  if (!isRecord(raw)) return { ok: false, reason: 'envelope_not_object' }
  if (raw.schema !== AGENT_ENVELOPE_SCHEMA) return { ok: false, reason: 'schema_mismatch' }
  if (!EBC_AGENT_IDS.includes(raw.agent_id as AgentEnvelopeV1['agent_id'])) return { ok: false, reason: 'invalid_agent_id' }
  if (typeof raw.mission_id !== 'string' || !raw.mission_id.trim()) return { ok: false, reason: 'missing_mission_id' }
  if (!EBC_MISSION_CLASSES.includes(raw.mission_class as AgentEnvelopeV1['mission_class'])) return { ok: false, reason: 'invalid_mission_class' }
  if (typeof raw.round !== 'number' || raw.round < 1) return { ok: false, reason: 'invalid_round' }

  const claims = Array.isArray(raw.claims) ? raw.claims : null
  const evidence = Array.isArray(raw.evidence) ? raw.evidence : null
  const contradictions = Array.isArray(raw.contradictions) ? raw.contradictions : null
  const risks = Array.isArray(raw.risks) ? raw.risks : null
  const tests = Array.isArray(raw.tests_recommended) ? raw.tests_recommended : null
  const unknowns = Array.isArray(raw.unknowns) ? raw.unknowns : null
  if (!claims || !evidence || !contradictions || !risks || !tests || !unknowns) {
    return { ok: false, reason: 'missing_required_arrays' }
  }

  const omit = raw.omit_reason == null || typeof raw.omit_reason === 'string' ? (raw.omit_reason as string | null) : null
  if (raw.omit_reason != null && typeof raw.omit_reason !== 'string') return { ok: false, reason: 'invalid_omit_reason' }

  const prose = typeof raw.prose === 'string' ? raw.prose : ''
  if (!omit && claims.length === 0 && evidence.length === 0 && contradictions.length === 0 && risks.length === 0 && tests.length === 0 && unknowns.length === 0) {
    if (prose.trim()) return { ok: false, reason: 'prose_only_rejected' }
    return { ok: false, reason: 'empty_envelope_without_omit_reason' }
  }

  const evidenceIds = new Set<string>()
  for (const row of evidence) {
    if (!isRecord(row) || typeof row.evidence_id !== 'string' || !ID.test(row.evidence_id)) return { ok: false, reason: 'invalid_evidence_id' }
    if (!EVIDENCE_KINDS.includes(row.kind as EbcEvidence['kind'])) return { ok: false, reason: 'invalid_evidence_kind' }
    if (typeof row.summary !== 'string' || !row.summary.trim()) return { ok: false, reason: 'evidence_missing_summary' }
    if (typeof row.retrieved_at !== 'string' || !row.retrieved_at) return { ok: false, reason: 'evidence_missing_retrieved_at' }
    if (typeof row.tool_name !== 'string') return { ok: false, reason: 'evidence_missing_tool_name' }
    if (!TEMPORAL_LAYERS.includes(row.temporal_layer as EbcEvidence['temporal_layer'])) return { ok: false, reason: 'invalid_temporal_layer' }
    evidenceIds.add(row.evidence_id)
  }

  for (const claim of claims) {
    if (!isRecord(claim) || typeof claim.claim_id !== 'string' || !ID.test(claim.claim_id)) return { ok: false, reason: 'invalid_claim_id' }
    if (typeof claim.text !== 'string' || !claim.text.trim()) return { ok: false, reason: 'claim_missing_text' }
    if (!CLAIM_STATUSES.includes(claim.status as EbcClaim['status'])) return { ok: false, reason: 'invalid_claim_status' }
    if (claim.status === 'READY' as string) return { ok: false, reason: 'ready_is_not_a_claim_status' }
    if (!Array.isArray(claim.evidence_ids)) return { ok: false, reason: 'claim_missing_evidence_ids' }
    if (!CLAIM_LABELS.includes(claim.label as EbcClaim['label'])) return { ok: false, reason: 'invalid_claim_label' }
    if (!TEMPORAL_LAYERS.includes(claim.temporal_layer as EbcClaim['temporal_layer'])) return { ok: false, reason: 'invalid_claim_temporal_layer' }
    const ids = claim.evidence_ids.filter((id): id is string => typeof id === 'string')
    if (claim.text.length > MAX_CLAIM_CHARS_WITHOUT_EVIDENCE && ids.length === 0) {
      return { ok: false, reason: 'essay_claim_without_evidence' }
    }
    if (poetic(claim.text) && ids.length === 0) return { ok: false, reason: 'poetic_claim_without_evidence' }
    for (const id of ids) {
      if (!evidenceIds.has(id)) return { ok: false, reason: `fabricated_evidence_id:${id}` }
    }
  }

  if (poetic(prose) && claims.length === 0 && evidence.length === 0 && !omit) {
    return { ok: false, reason: 'poetic_prose_only' }
  }

  const novelty = isRecord(raw.novelty) ? raw.novelty : null
  if (!novelty || !Array.isArray(novelty.adds) || typeof novelty.suppressed !== 'boolean') {
    return { ok: false, reason: 'missing_novelty' }
  }

  return {
    ok: true,
    envelope: {
      schema: AGENT_ENVELOPE_SCHEMA,
      agent_id: raw.agent_id as AgentEnvelopeV1['agent_id'],
      mission_id: raw.mission_id as string,
      mission_class: raw.mission_class as AgentEnvelopeV1['mission_class'],
      round: raw.round as number,
      claims: claims as EbcClaim[],
      evidence: evidence as EbcEvidence[],
      contradictions: contradictions as AgentEnvelopeV1['contradictions'],
      risks: risks as AgentEnvelopeV1['risks'],
      tests_recommended: tests as AgentEnvelopeV1['tests_recommended'],
      unknowns: unknowns as AgentEnvelopeV1['unknowns'],
      novelty: {
        adds: novelty.adds as AgentEnvelopeV1['novelty']['adds'],
        suppressed: novelty.suppressed,
        reason: typeof novelty.reason === 'string' ? novelty.reason : null,
        similarity: typeof novelty.similarity === 'number' ? novelty.similarity : null,
      },
      omit_reason: omit,
      tools_used: Array.isArray(raw.tools_used) ? raw.tools_used.filter((item): item is string => typeof item === 'string') : [],
      tokens_used: typeof raw.tokens_used === 'number' ? raw.tokens_used : 0,
      latency_ms: typeof raw.latency_ms === 'number' ? raw.latency_ms : 0,
      peer_visibility: raw.peer_visibility === 'HIDDEN' || raw.peer_visibility === 'SEALED' || raw.peer_visibility === 'BOARD'
        ? raw.peer_visibility
        : 'HIDDEN',
      sibling_draft_tokens_seen: typeof raw.sibling_draft_tokens_seen === 'number' ? raw.sibling_draft_tokens_seen : 0,
      prose: typeof raw.prose === 'string' ? raw.prose : null,
    },
  }
}

export function makeEnvelope(partial: Omit<AgentEnvelopeV1, 'schema'>): AgentEnvelopeV1 {
  return { schema: AGENT_ENVELOPE_SCHEMA, ...partial }
}
