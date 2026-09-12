/**
 * #22 Phase 8 — DATA_CORPUS_AGENT identity.
 */
export const DATA_CORPUS_AGENT_ROLE = 'DATA_CORPUS_AGENT' as const
export type DataCorpusAgentRole = typeof DATA_CORPUS_AGENT_ROLE

export const DATA_CORPUS_AGENT_RUNTIME_VERSION = 'ascension-phase8-v1' as const

export const DATA_CORPUS_AGENT_POLICY_PROFILE = 'BOUNDED_CORPUS_CURATION' as const

export const DATA_CORPUS_AGENT_AUTONOMOUS_EXECUTION_ENABLED = false as const

/** #23 remains NOT STARTED — curation ≠ training. */
export const ROADMAP_23_STATUS = 'NOT_STARTED' as const

export function isDataCorpusAgentRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_DATA_CORPUS_AGENT_ENABLED !== 'false'
}

export type DataCorpusAgentIdentity = {
  agent_id: string
  agent_role: DataCorpusAgentRole
  runtime_version: typeof DATA_CORPUS_AGENT_RUNTIME_VERSION
  request_id: string
  mission_id: string | null
  owner_user_id: string
  conversation_id: string | null
  requested_by: string
  scope: string
  dataset_scope: string
  source_scope: string[] | null
  allowed_operations: string[]
  created_at: string
  expires_at: string | null
  policy_profile: typeof DATA_CORPUS_AGENT_POLICY_PROFILE
}

export function createDataCorpusAgentIdentity(input: {
  requestId: string
  ownerUserId: string
  requestedBy: string
  allowedOperations: string[]
  datasetScope: string
  sourceScope?: string[] | null
  missionId?: string | null
  conversationId?: string | null
  expiresAt?: string | null
  nowIso?: string
}): DataCorpusAgentIdentity {
  return {
    agent_id: `data_corpus_agent:${input.requestId}`,
    agent_role: DATA_CORPUS_AGENT_ROLE,
    runtime_version: DATA_CORPUS_AGENT_RUNTIME_VERSION,
    request_id: input.requestId,
    mission_id: input.missionId ?? null,
    owner_user_id: input.ownerUserId,
    conversation_id: input.conversationId ?? null,
    requested_by: input.requestedBy,
    scope: DATA_CORPUS_AGENT_POLICY_PROFILE,
    dataset_scope: input.datasetScope,
    source_scope: input.sourceScope ? [...input.sourceScope] : null,
    allowed_operations: [...input.allowedOperations],
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    policy_profile: DATA_CORPUS_AGENT_POLICY_PROFILE,
  }
}
