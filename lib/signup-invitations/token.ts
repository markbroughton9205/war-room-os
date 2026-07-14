import 'server-only'

import { createHmac, randomBytes } from 'crypto'

export const SIGNUP_INVITATION_SECRET_ENV = 'WAR_ROOM_SIGNUP_INVITATION_SECRET'

export type InvitationSecretResult =
  | { ok: true; secret: string }
  | { ok: false; reason: 'missing'; message: string }

export function readInvitationSecret(env: NodeJS.ProcessEnv = process.env): InvitationSecretResult {
  const secret = env[SIGNUP_INVITATION_SECRET_ENV]?.trim()
  if (!secret) {
    return {
      ok: false,
      reason: 'missing',
      message: `${SIGNUP_INVITATION_SECRET_ENV} is not configured.`,
    }
  }
  return { ok: true, secret }
}

export function generateRawInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashInvitationToken(rawToken: string, secret: string): string {
  return createHmac('sha256', secret).update(rawToken, 'utf8').digest('base64url')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isPlausibleEmail(email: string): boolean {
  const normalized = normalizeEmail(email)
  return normalized.length >= 3 && normalized.includes('@') && !/\s/.test(normalized)
}

export function buildInviteUrl(rawToken: string, baseUrl = readBaseUrl()): string {
  const root = baseUrl.replace(/\/+$/, '')
  return `${root}/signup?invite=${encodeURIComponent(rawToken)}`
}

export function readBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit
  const vercelUrl = env.VERCEL_URL?.trim()
  if (vercelUrl) return vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`
  return 'http://localhost:3000'
}
