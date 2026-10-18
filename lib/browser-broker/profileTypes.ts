/**
 * Phase-2 trusted browser profile types.
 * Metadata never holds cookies, tokens, or passwords.
 * storage_security is independent of auth_state.
 */

export const TRUSTED_PROFILE_STATES = ['ACTIVE', 'LOCKED', 'CORRUPT', 'NEEDS_REAUTH', 'DISABLED'] as const
export type TrustedProfileState = (typeof TRUSTED_PROFILE_STATES)[number]

export const PROFILE_AUTH_STATES = ['AUTHENTICATED', 'NEEDS_REAUTH', 'UNKNOWN_AUTH', 'LOCKED', 'CORRUPT'] as const
export type ProfileAuthState = (typeof PROFILE_AUTH_STATES)[number]

export const STORAGE_SECURITY_STATES = [
  'SECURE_STORAGE_READY',
  'ENCRYPTED_AT_REST',
  'SECURE_STORAGE_UNAVAILABLE',
  'KEY_UNAVAILABLE',
  'MIGRATION_REQUIRED',
  'CORRUPT',
  'NEEDS_SECURE_STORAGE',
] as const
export type StorageSecurityState = (typeof STORAGE_SECURITY_STATES)[number]

export const PROFILE_ACTION_POLICIES = ['READ_ONLY', 'RESEARCH', 'INTERACTIVE_WITH_APPROVAL'] as const
export type ProfileActionPolicy = (typeof PROFILE_ACTION_POLICIES)[number]

export const SESSION_MODES = ['EPHEMERAL', 'TRUSTED_PROFILE'] as const
export type SessionMode = (typeof SESSION_MODES)[number]

export const CONTROL_STATES = ['AGENT_CONTROL', 'COMMANDER_CONTROL', 'PAUSED', 'HANDOFF_PENDING', 'CLOSED'] as const
export type ControlState = (typeof CONTROL_STATES)[number]

export const PROFILE_FAILURE_CODES = [
  'PROFILE_NOT_FOUND',
  'PROFILE_LOCKED',
  'PROFILE_DISABLED',
  'PROFILE_CORRUPT',
  'PROFILE_NEEDS_REAUTH',
  'PROFILE_ACCESS_DENIED',
  'PROFILE_ORIGIN_NOT_ALLOWED',
  'PROFILE_UNAVAILABLE',
  'PROFILE_ACCESS_REQUIRED',
  'PROFILE_KEY_UNAVAILABLE',
  'SECURE_STORAGE_UNAVAILABLE',
  'COMMANDER_CONTROL_ACTIVE',
  'BROWSER_OFFLINE',
  'SESSION_NOT_FOUND',
  'TAB_NOT_FOUND',
  'HUMAN_INTERACTION_REQUIRED',
  'ACTION_REQUIRES_APPROVAL',
  'COMMANDER_ONLY',
] as const
export type ProfileFailureCode = (typeof PROFILE_FAILURE_CODES)[number]

export type ProfileEncryption = {
  enabled: boolean
  scheme: 'aes-256-gcm' | 'none'
  key_reference: string
  last_verified_at: string
  blocker: 'SECRET_SERVICE_UNAVAILABLE' | 'KEY_UNAVAILABLE' | 'MIGRATION_REQUIRED' | 'PROFILE_CORRUPT' | null
  storage_security: StorageSecurityState
  key_backend: 'SECRET_SERVICE' | 'NONE'
  key_state: 'AVAILABLE' | 'UNAVAILABLE'
  migration_version: number | null
}

export type TrustedBrowserProfileV1 = {
  profile_id: string
  display_name: string
  created_at: string
  updated_at: string
  owner: 'COMMANDER'
  state: TrustedProfileState
  allowed_origins: string[]
  denied_origins: string[]
  allow_council: boolean
  allow_foundry: boolean
  default_action_policy: ProfileActionPolicy
  persistent_storage_path: string
  encryption: ProfileEncryption
  last_used_at: string | null
  last_auth_refresh_at: string | null
  auth_state: ProfileAuthState
  metadata: Record<string, never>
}

export type ProfileCreateInput = {
  display_name: string
  allowed_origins?: string[]
  denied_origins?: string[]
  allow_council?: boolean
  allow_foundry?: boolean
  default_action_policy?: ProfileActionPolicy
}

export type ProfilePublicView = Omit<TrustedBrowserProfileV1, 'persistent_storage_path'> & {
  storage_present: boolean
}

export type BrowserAuditEntry = {
  timestamp: string
  mission_id: string | null
  session_id: string | null
  profile_id: string | null
  actor: 'COUNCIL' | 'FOUNDRY' | 'COMMANDER' | 'BROKER'
  action_type: string
  hostname: string | null
  result: string
  approval_state: string | null
}

export function safeProfileIdHash(profileId: string | null | undefined): string | null {
  if (!profileId) return null
  return `prf_${profileId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12)}`
}
