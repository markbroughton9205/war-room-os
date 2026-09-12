/**
 * #22 Phase 14 — One canonical agent-to-agent handoff envelope.
 * No hidden CoT. No credentials. No arbitrary private conversation bodies.
 */
import { randomUUID } from 'node:crypto'
import type { PolicyAuthorityLevel, TechnicalReachLevel } from '@/lib/agent-capability-matrix/types'
import {
  COMMANDER_AUTHORIZED_SCOPE,
  DEFAULT_SOURCE_AUTHORITY,
  DEFAULT_SOURCE_REACH,
  DEFAULT_TARGET_AUTHORITY,
  DEFAULT_TARGET_REACH,
  assertTargetAuthorityNotIncreased,
} from './authority'
import { assertSameOwner, requireOwnerUserId } from './ownership'
import { integrationFailure, type IntegrationFailure } from './failures'
import type { CanonicalHandoffEnvelope, HandoffTaskType, IntegrationActor } from './types'

const FORBIDDEN_KEYS = [
  'chain_of_thought',
  'hidden_cot',
  'cot',
  'private_conversation',
  'api_key',
  'password',
  'credential',
  'service_role',
  'model_weights',
]

export type CreateHandoffInput = {
  missionId?: string | null
  sourceActor: IntegrationActor
  targetActor: IntegrationActor
  ownerUserId: string
  targetOwnerUserId?: string | null
  sessionId?: string | null
  conversationId?: string | null
  taskType: HandoffTaskType
  inputReference?: string | null
  evidenceIds?: string[]
  sourceUrls?: string[]
  sourceAgents?: IntegrationActor[]
  parentHandoffId?: string | null
  runtimeTruth?: Record<string, string | boolean | number | null>
  sourceAuthority?: PolicyAuthorityLevel
  targetAuthority?: PolicyAuthorityLevel
  commanderAuthorizedScope?: PolicyAuthorityLevel
  sourceReach?: TechnicalReachLevel
  targetReach?: TechnicalReachLevel
  approvalState?: CanonicalHandoffEnvelope['approval_state']
  createdAt?: string
  expiresAt?: string | null
  ttlMs?: number
  extraPayload?: Record<string, unknown>
}

export type CreateHandoffResult =
  | { ok: true; envelope: CanonicalHandoffEnvelope }
  | { ok: false; failure: IntegrationFailure }

export function createCanonicalHandoff(input: CreateHandoffInput): CreateHandoffResult {
  const ownerFail = requireOwnerUserId(input.ownerUserId)
  if (ownerFail) return { ok: false, failure: ownerFail }
  const ownerMatch = assertSameOwner(input.ownerUserId, input.targetOwnerUserId ?? input.ownerUserId)
  if (ownerMatch) return { ok: false, failure: ownerMatch }

  const extra = input.extraPayload ?? {}
  for (const key of Object.keys(extra)) {
    if (FORBIDDEN_KEYS.some(f => key.toLowerCase().includes(f))) {
      return {
        ok: false,
        failure: integrationFailure('FORBIDDEN_ACTION', 'Handoff must not carry hidden CoT, credentials, or private bodies.'),
      }
    }
  }

  const sourceAuthority = input.sourceAuthority ?? DEFAULT_SOURCE_AUTHORITY
  const targetAuthority = input.targetAuthority ?? DEFAULT_TARGET_AUTHORITY
  const commanderScope = input.commanderAuthorizedScope ?? COMMANDER_AUTHORIZED_SCOPE
  const authFail = assertTargetAuthorityNotIncreased({
    sourceAuthority,
    targetAuthority,
    commanderAuthorizedScope: commanderScope,
    sourceReach: input.sourceReach ?? DEFAULT_SOURCE_REACH,
    targetReach: input.targetReach ?? DEFAULT_TARGET_REACH,
  })
  if (authFail) return { ok: false, failure: authFail }

  const createdAt = input.createdAt ?? new Date().toISOString()
  const expiresAt =
    input.expiresAt !== undefined
      ? input.expiresAt
      : new Date(Date.parse(createdAt) + (input.ttlMs ?? 3_600_000)).toISOString()

  return {
    ok: true,
    envelope: {
      handoff_id: `handoff-${randomUUID()}`,
      mission_id: input.missionId ?? null,
      source_actor: input.sourceActor,
      target_actor: input.targetActor,
      owner_user_id: input.ownerUserId,
      session_id: input.sessionId ?? null,
      conversation_id: input.conversationId ?? null,
      task_type: input.taskType,
      input_reference: input.inputReference ?? null,
      evidence_ids: [...(input.evidenceIds ?? [])].slice(0, 40),
      provenance: {
        source_urls: [...(input.sourceUrls ?? [])].slice(0, 20),
        source_agents: input.sourceAgents ?? [input.sourceActor],
        parent_handoff_id: input.parentHandoffId ?? null,
      },
      runtime_truth: {
        astra_phase58a: 'NOT_APPLIED',
        production_corpus_persistence: false,
        approval_is_not_implied: true,
        ...(input.runtimeTruth ?? {}),
      },
      authority_scope: {
        source_authority: sourceAuthority,
        target_authority: targetAuthority,
        commander_authorized_scope: commanderScope,
        source_reach: input.sourceReach ?? DEFAULT_SOURCE_REACH,
        target_reach: input.targetReach ?? DEFAULT_TARGET_REACH,
      },
      approval_state: input.approvalState ?? 'ADVISORY',
      created_at: createdAt,
      expires_at: expiresAt,
    },
  }
}

export function assertHandoffNotExpired(
  envelope: CanonicalHandoffEnvelope,
  nowIso = new Date().toISOString(),
): IntegrationFailure | null {
  if (!envelope.expires_at) return null
  if (Date.parse(nowIso) > Date.parse(envelope.expires_at)) {
    return integrationFailure('HANDOFF_EXPIRED', 'Handoff expired; downstream work is denied.')
  }
  return null
}
