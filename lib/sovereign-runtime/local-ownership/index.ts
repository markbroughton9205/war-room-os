/**
 * #22 Phase 11C — Local ownership / offline Commander exports.
 */
export * from './types'
export * from './paths'
export * from './crypto'
export * from './gate'
export * from './store'
export * from './chat'

export function getLocalOwnershipRuntimeTruth() {
  return {
    LOCAL_COMMANDER_IDENTITY: 'IMPLEMENTED' as const,
    LOCAL_COMMANDER_AUTH: 'IMPLEMENTED' as const,
    LOCAL_SESSION: 'IMPLEMENTED' as const,
    LOCAL_OWNERSHIP: 'IMPLEMENTED' as const,
    LOCAL_CONVERSATIONS: 'IMPLEMENTED' as const,
    LOCAL_MESSAGE_PERSISTENCE: 'IMPLEMENTED' as const,
    OFFLINE_LOCAL_CHAT: 'IMPLEMENTED' as const,
    PRIVILEGED_OFFLINE_OWNERSHIP: 'IMPLEMENTED' as const,
    LOCAL_CONVERSATIONS_OFFLINE: 'IMPLEMENTED' as const,
    SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS: false as const,
    SUPABASE_REQUIRED_FOR_REMOTE_DATA: true as const,
    REMOTE_IDENTITY: 'PRESERVED' as const,
    LOCAL_REMOTE_IDENTITY_LINK: 'IMPLEMENTED_FOUNDATION' as const,
    AUTOMATIC_SYNC: 'NOT_IMPLEMENTED' as const,
    LOCAL_COMMANDER_RECOVERY: 'NOT_IMPLEMENTED' as const,
    LOCAL_IMPORT: 'NOT_IMPLEMENTED' as const,
    CREDENTIAL_KDF: 'scrypt' as const,
    OS_SECURE_STORAGE: 'NOT_USED_HASHED_SCRYPT_IN_APPDATA' as const,
    ELECTRON_SAFESTORAGE: 'EVALUATED_NOT_REQUIRED_FOR_CORE' as const,
  }
}
