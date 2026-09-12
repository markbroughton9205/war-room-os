/**
 * #22 Phase 11C — Local ownership types + runtime-truth contracts.
 * LOCAL_COMMANDER != Supabase UUID. Service-role != Commander.
 */
export const LOCAL_OWNERSHIP_SCHEMA_VERSION = 1 as const
export const LOCAL_SESSION_COOKIE = 'wr_local_session' as const
export const LOCAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12h
export const LOCAL_LOGIN_MAX_FAILURES = 5 as const
export const LOCAL_LOGIN_WINDOW_MS = 15 * 60 * 1000
export const LOCAL_LOGIN_LOCK_MS = 5 * 60 * 1000

export const LOCAL_IDENTITY_ROLE = 'LOCAL_COMMANDER' as const

export const LOCAL_REMOTE_AUTH_STATES = [
  'LOCAL_ONLY',
  'REMOTE_ONLY',
  'LOCAL_AND_REMOTE_UNLINKED',
  'LINKED_REMOTE',
  'REMOTE_UNAVAILABLE',
  'LINK_CONFLICT',
] as const
export type LocalRemoteAuthState = (typeof LOCAL_REMOTE_AUTH_STATES)[number]

export const LOCAL_DATA_MODES = [
  'LOCAL_ONLY',
  'REMOTE_ONLY',
  'HYBRID_LINKED',
  'SYNC_PENDING',
  'SYNC_CONFLICT',
  'REMOTE_UNAVAILABLE',
  'OFFLINE_LOCAL',
] as const
export type LocalDataMode = (typeof LOCAL_DATA_MODES)[number]

export const LOCAL_RESOURCE_ORIGIN = ['LOCAL', 'REMOTE', 'HYBRID'] as const
export type LocalResourceOrigin = (typeof LOCAL_RESOURCE_ORIGIN)[number]

export type LocalCommanderIdentity = {
  id: string
  installation_id: string
  role: typeof LOCAL_IDENTITY_ROLE
  display_name: string
  remote_link_state: LocalRemoteAuthState
  linked_remote_user_id: string | null
  created_at: string
  updated_at: string
  schema_version: number
  /** Never includes password material */
  credential_meta: {
    kdf: 'scrypt'
    has_password: true
  }
}

export type LocalSessionRecord = {
  session_id: string
  owner_local_identity_id: string
  installation_id: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  last_seen_at: string
}

export type LocalConversationRecord = {
  id: string
  owner_local_identity_id: string
  title: string
  origin: LocalResourceOrigin
  data_mode: LocalDataMode
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type LocalMessageRecord = {
  id: string
  conversation_id: string
  owner_local_identity_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  actual_provider: string | null
  actual_model: string | null
  local_or_remote: 'LOCAL' | 'REMOTE' | null
  fallback_used: boolean | null
  intelligence_class: string | null
}

export type LocalAuditRecord = {
  id: string
  actor_local_identity_id: string | null
  action: string
  resource: string | null
  result: string
  source: 'LOCAL'
  created_at: string
}

export type LocalOwnershipRuntimeTruth = {
  LOCAL_COMMANDER_IDENTITY: 'IMPLEMENTED'
  LOCAL_COMMANDER_AUTH: 'IMPLEMENTED'
  LOCAL_SESSION: 'IMPLEMENTED'
  LOCAL_OWNERSHIP: 'IMPLEMENTED'
  LOCAL_CONVERSATIONS: 'IMPLEMENTED'
  LOCAL_MESSAGE_PERSISTENCE: 'IMPLEMENTED'
  OFFLINE_LOCAL_CHAT: 'IMPLEMENTED'
  PRIVILEGED_OFFLINE_OWNERSHIP: 'IMPLEMENTED'
  LOCAL_CONVERSATIONS_OFFLINE: 'IMPLEMENTED'
  SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS: false
  SUPABASE_REQUIRED_FOR_REMOTE_DATA: true
  REMOTE_IDENTITY: 'PRESERVED'
  LOCAL_REMOTE_IDENTITY_LINK: 'IMPLEMENTED_FOUNDATION'
  AUTOMATIC_SYNC: 'NOT_IMPLEMENTED'
  LOCAL_COMMANDER_RECOVERY: 'NOT_IMPLEMENTED'
  LOCAL_IMPORT: 'NOT_IMPLEMENTED'
  CREDENTIAL_KDF: 'scrypt'
  OS_SECURE_STORAGE: 'NOT_USED_HASHED_SCRYPT_IN_APPDATA'
  ELECTRON_SAFESTORAGE: 'EVALUATED_NOT_REQUIRED_FOR_CORE'
}

export const SEARCH_CORPUS_OWNERSHIP_CLASS = {
  sovereign_search_corpus: 'SYSTEM_LOCAL',
  local_conversations: 'COMMANDER_LOCAL',
  local_sessions: 'COMMANDER_LOCAL',
  baby_chat: 'SESSION_LOCAL',
  supabase_conversations: 'REMOTE_USER',
} as const
