import type { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export const RECOVERY_MARKER_COOKIE = 'war_room_recovery'
export const AUTH_CLEANUP_MARKER_COOKIE = 'war_room_auth_cleanup'
export const RECOVERY_MARKER_SECRET_ENV = 'WAR_ROOM_SIGNUP_INVITATION_SECRET'
const RECOVERY_MARKER_HMAC_CONTEXT = 'war-room-password-recovery-v1'
const AUTH_CLEANUP_HMAC_CONTEXT = 'war-room-auth-cleanup-v1'

const RECOVERY_MARKER_VERSION = 1
const RECOVERY_MARKER_MAX_AGE_SECONDS = 15 * 60
const AUTH_CLEANUP_MAX_AGE_SECONDS = 5 * 60

export type RecoveryMarkerPayload = {
  v: typeof RECOVERY_MARKER_VERSION
  userId: string
  nonce: string
  exp: number
}

export type AuthCleanupMarkerPayload = {
  v: typeof RECOVERY_MARKER_VERSION
  userId: string | null
  nonce: string
  exp: number
  destination: string
}

export type RecoveryMarkerVerification =
  | { ok: true; payload: RecoveryMarkerPayload }
  | { ok: false; reason: 'missing' | 'malformed' | 'missing_secret' | 'bad_signature' | 'expired' | 'user_mismatch' }

export type AuthCleanupMarkerVerification =
  | { ok: true; payload: AuthCleanupMarkerPayload }
  | { ok: false; reason: 'missing' | 'malformed' | 'missing_secret' | 'bad_signature' | 'expired' | 'user_mismatch' }

export async function createRecoveryMarkerValue(userId: string, nowMs = Date.now()): Promise<string | null> {
  const secret = readRecoveryMarkerSecret()
  if (!secret) return null
  const payload: RecoveryMarkerPayload = {
    v: RECOVERY_MARKER_VERSION,
    userId,
    nonce: createNonce(),
    exp: nowMs + RECOVERY_MARKER_MAX_AGE_SECONDS * 1000,
  }
  const encodedPayload = base64urlEncode(JSON.stringify(payload))
  return `${encodedPayload}.${await signRecoveryPayload(encodedPayload, secret)}`
}

export async function createAuthCleanupMarkerValue(input: { userId?: string | null; destination: string }, nowMs = Date.now()): Promise<string | null> {
  const secret = readRecoveryMarkerSecret()
  if (!secret) return null
  const payload: AuthCleanupMarkerPayload = {
    v: RECOVERY_MARKER_VERSION,
    userId: input.userId ?? null,
    nonce: createNonce(),
    exp: nowMs + AUTH_CLEANUP_MAX_AGE_SECONDS * 1000,
    destination: sanitizeCleanupDestination(input.destination),
  }
  const encodedPayload = base64urlEncode(JSON.stringify(payload))
  return `${encodedPayload}.${await signMarkerPayload(encodedPayload, secret, AUTH_CLEANUP_HMAC_CONTEXT)}`
}

export async function verifyRecoveryMarkerValue(value: string | undefined | null, expectedUserId: string, nowMs = Date.now()): Promise<RecoveryMarkerVerification> {
  if (!value) return { ok: false, reason: 'missing' }
  const secret = readRecoveryMarkerSecret()
  if (!secret) return { ok: false, reason: 'missing_secret' }

  const [encodedPayload, signature, extra] = value.split('.')
  if (!encodedPayload || !signature || extra !== undefined) return { ok: false, reason: 'malformed' }
  const expectedSignature = await signRecoveryPayload(encodedPayload, secret)
  if (!constantTimeEqual(signature, expectedSignature)) return { ok: false, reason: 'bad_signature' }

  let payload: RecoveryMarkerPayload
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload)) as RecoveryMarkerPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (payload.v !== RECOVERY_MARKER_VERSION || !payload.userId || !payload.nonce || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.exp <= nowMs) return { ok: false, reason: 'expired' }
  if (payload.userId !== expectedUserId) return { ok: false, reason: 'user_mismatch' }
  return { ok: true, payload }
}

export async function verifyAuthCleanupMarkerValue(value: string | undefined | null, expectedUserId?: string | null, nowMs = Date.now()): Promise<AuthCleanupMarkerVerification> {
  if (!value) return { ok: false, reason: 'missing' }
  const secret = readRecoveryMarkerSecret()
  if (!secret) return { ok: false, reason: 'missing_secret' }

  const [encodedPayload, signature, extra] = value.split('.')
  if (!encodedPayload || !signature || extra !== undefined) return { ok: false, reason: 'malformed' }
  const expectedSignature = await signMarkerPayload(encodedPayload, secret, AUTH_CLEANUP_HMAC_CONTEXT)
  if (!constantTimeEqual(signature, expectedSignature)) return { ok: false, reason: 'bad_signature' }

  let payload: AuthCleanupMarkerPayload
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload)) as AuthCleanupMarkerPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (payload.v !== RECOVERY_MARKER_VERSION || !payload.nonce || typeof payload.exp !== 'number' || !isSafeCleanupDestination(payload.destination)) {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.exp <= nowMs) return { ok: false, reason: 'expired' }
  if (payload.userId && expectedUserId && payload.userId !== expectedUserId) return { ok: false, reason: 'user_mismatch' }
  return { ok: true, payload }
}

export async function setRecoveryMarker(response: NextResponse, userId: string): Promise<boolean> {
  const marker = await createRecoveryMarkerValue(userId)
  if (!marker) return false
  response.cookies.set(RECOVERY_MARKER_COOKIE, marker, recoveryCookieOptions())
  return true
}

export async function setAuthCleanupMarker(response: NextResponse, input: { userId?: string | null; destination: string }): Promise<boolean> {
  const marker = await createAuthCleanupMarkerValue(input)
  if (!marker) return false
  response.cookies.set(AUTH_CLEANUP_MARKER_COOKIE, marker, cleanupCookieOptions())
  return true
}

export function clearRecoveryMarker(response: NextResponse): void {
  response.cookies.set(RECOVERY_MARKER_COOKIE, '', { ...recoveryCookieOptions(), maxAge: 0 })
}

export function clearAuthCleanupMarker(response: NextResponse): void {
  response.cookies.set(AUTH_CLEANUP_MARKER_COOKIE, '', { ...cleanupCookieOptions(), maxAge: 0 })
}

export async function clearRecoveryMarkerFromCookieStore(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(RECOVERY_MARKER_COOKIE, '', { ...recoveryCookieOptions(), maxAge: 0 })
}

export async function verifyRecoveryMarkerFromCookieStore(expectedUserId: string): Promise<RecoveryMarkerVerification> {
  const cookieStore = await cookies()
  return verifyRecoveryMarkerValue(cookieStore.get(RECOVERY_MARKER_COOKIE)?.value, expectedUserId)
}

export function verifyRecoveryMarkerFromRequest(request: NextRequest, expectedUserId: string): Promise<RecoveryMarkerVerification> {
  return verifyRecoveryMarkerValue(request.cookies.get(RECOVERY_MARKER_COOKIE)?.value, expectedUserId)
}

export function verifyAuthCleanupMarkerFromRequest(request: NextRequest, expectedUserId?: string | null): Promise<AuthCleanupMarkerVerification> {
  return verifyAuthCleanupMarkerValue(request.cookies.get(AUTH_CLEANUP_MARKER_COOKIE)?.value, expectedUserId)
}

function readRecoveryMarkerSecret(): string | null {
  const secret = process.env[RECOVERY_MARKER_SECRET_ENV]?.trim()
  return secret || null
}

async function signRecoveryPayload(encodedPayload: string, secret: string): Promise<string> {
  return signMarkerPayload(encodedPayload, secret, RECOVERY_MARKER_HMAC_CONTEXT)
}

async function signMarkerPayload(encodedPayload: string, secret: string, context: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${context}\0${encodedPayload}`))
  return bytesToBase64url(new Uint8Array(signature))
}

function createNonce(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return bytesToBase64url(bytes)
}

function base64urlEncode(value: string): string {
  return bytesToBase64url(new TextEncoder().encode(value))
}

function base64urlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return new TextDecoder().decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0)))
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return diff === 0
}

function recoveryCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: RECOVERY_MARKER_MAX_AGE_SECONDS,
  }
}

function cleanupCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: AUTH_CLEANUP_MAX_AGE_SECONDS,
  }
}

function sanitizeCleanupDestination(destination: string): string {
  if (isSafeCleanupDestination(destination)) return destination
  try {
    const parsed = new URL(destination)
    const candidate = `${parsed.pathname}${parsed.search}`
    return isSafeCleanupDestination(candidate) ? candidate : '/login?auth=cleanup_required'
  } catch {
    return '/login?auth=cleanup_required'
  }
}

function isSafeCleanupDestination(destination: string): boolean {
  return destination.startsWith('/login?') && !destination.startsWith('//')
}
