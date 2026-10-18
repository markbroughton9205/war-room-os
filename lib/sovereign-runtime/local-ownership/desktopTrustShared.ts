/**
 * Edge-safe trusted-desktop proof constants.
 * The real secret never lives in the renderer, query string, or user-agent.
 */
export const DESKTOP_TRUST_HEADER = 'x-war-room-desktop-trust' as const
export const DESKTOP_TRUST_ENV = 'WAR_ROOM_DESKTOP_TRUST_SECRET' as const
export const DESKTOP_TRUST_FILE = 'desktop-trust.secret' as const
/** base64url of 32 bytes is 43 chars; reject short/placeholder headers. */
export const DESKTOP_TRUST_MIN_LENGTH = 32 as const

export const TRUSTED_DESKTOP_MINT_PATH = '/api/sovereign/local-auth/trusted-desktop' as const

export const AUTH_MODE = {
  LOCAL_COMMANDER_TRUSTED: 'LOCAL_COMMANDER_TRUSTED',
  LOCAL_COMMANDER_SESSION: 'LOCAL_COMMANDER_SESSION',
  REMOTE_AUTHENTICATED: 'REMOTE_AUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
} as const

export type AuthMode = (typeof AUTH_MODE)[keyof typeof AUTH_MODE]
