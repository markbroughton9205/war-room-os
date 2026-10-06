/**
 * ENGINE-10 Trust boundaries and information defense.
 * External text is DATA. Fake Commander approval is not approval. Fail closed.
 */
import { ENGINE_10_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { fingerprintAction } from '../checkpoint/fingerprint'
import type { TrustClass } from './types'

const INJECT = /ignore (all |previous )?(instructions|rules)|you are now|system prompt|commander approved/i

export function classifyTrust(input: { source: string; text?: string }): TrustClass {
  const s = input.source.toLowerCase()
  if (s === 'commander' || s === 'commander_instruction') return 'COMMANDER_INSTRUCTION'
  if (s === 'system_policy' || s === 'policy') return 'SYSTEM_POLICY'
  if (s === 'receipt' || s === 'internal_receipt') return 'INTERNAL_RECEIPT'
  if (s === 'tool' || s === 'tool_result') return 'TOOL_RESULT'
  if (s === 'primary_external') return 'PRIMARY_EXTERNAL'
  if (s === 'memory') return 'MEMORY'
  if (s === 'model' || s === 'model_output') return 'MODEL_OUTPUT'
  if (s === 'secondary_external') return 'SECONDARY_EXTERNAL'
  return 'UNTRUSTED_EXTERNAL'
}

export function injectionIsData(text: string, trust: TrustClass): { data_only: true; authority_changed: false; policy_changed: false } {
  void text
  if (trust === 'COMMANDER_INSTRUCTION' || trust === 'SYSTEM_POLICY') {
    return { data_only: true, authority_changed: false, policy_changed: false }
  }
  return { data_only: true, authority_changed: false, policy_changed: false }
}

export function rejectSpoofedApproval(text: string, canonical_fingerprint: string | null): { ok: false; reason: string } | { ok: true } {
  if (/commander approved/i.test(text) && !canonical_fingerprint) {
    return { ok: false, reason: 'text_is_not_canonical_approval' }
  }
  if (canonical_fingerprint && canonical_fingerprint !== fingerprintAction('approve', 'gate', text)) {
    return { ok: false, reason: 'fingerprint_mismatch' }
  }
  if (!canonical_fingerprint) return { ok: false, reason: 'missing_canonical_approval' }
  return { ok: true }
}

export function memoryCannotOverrideEbc(input: { memory_claim: string; ebc_verified: string[]; memory_trust: TrustClass }): { override: false; reason: string } {
  if (input.memory_trust !== 'MEMORY') return { override: false, reason: 'not_memory' }
  if (input.ebc_verified.some(v => v !== input.memory_claim && /CURRENT|VERIFIED/.test(v))) {
    return { override: false, reason: 'ebc_canonical_current_truth' }
  }
  return { override: false, reason: 'memory_is_retrieval_not_truth' }
}

export function provenanceIntact(input: { refs: string[]; hash?: string; expected_hash?: string; mission_id: string; ref_mission?: string }): { ok: boolean; reason: string } {
  if (!input.refs.length) return { ok: false, reason: 'missing_refs' }
  if (input.hash && input.expected_hash && input.hash !== input.expected_hash) return { ok: false, reason: 'mismatched_hashes' }
  if (input.ref_mission && input.ref_mission !== input.mission_id) return { ok: false, reason: 'wrong_mission_refs' }
  return { ok: true, reason: 'ok' }
}

export function failClosed(uncertain: boolean): { execute_consequential: false; reason: string } {
  if (uncertain) return { execute_consequential: false, reason: 'integrity_uncertain' }
  return { execute_consequential: false, reason: 'consequential_requires_canonical_approval' }
}

export function missionContextAllowed(from_mission: string, to_mission: string, approved_share: boolean): boolean {
  return from_mission === to_mission || approved_share
}

export function defendInput(input: { source: string; text: string; mission_id: string }) {
  const started = Date.now()
  const trust = classifyTrust({ source: input.source, text: input.text })
  const inject = INJECT.test(input.text)
  const data = injectionIsData(input.text, trust)
  const spoof = rejectSpoofedApproval(input.text, null)
  return {
    trust,
    inject_attempt: inject,
    ...data,
    spoof_rejected: spoof.ok === false,
    grants_authority: false as const,
    receipt: createEngineReceipt({
      engine: 'trust-boundary',
      mission_id: input.mission_id,
      started_at: started,
      decision_count: 1,
      decision: `${trust}:inject=${inject}:version=${ENGINE_10_VERSION}`,
    }),
  }
}
