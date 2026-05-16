import { NextResponse } from 'next/server'

import { assertDebugRouteAuthorized } from '@/lib/security/debugRouteGuard'
import { SUPABASE_SERVICE_ROLE_ENV } from '@/lib/security/sensitiveEnv'

export const dynamic = 'force-dynamic'

type JwtPayloadShape = { role?: unknown; ref?: unknown }

function trimEnv(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function parseProjectUrlHost(): { projectUrlHost: string; expectedProjectRef: string | null } {
  const raw =
    trimEnv('NEXT_PUBLIC_SUPABASE_URL')
    || trimEnv('SUPABASE_URL')
  if (!raw) return { projectUrlHost: '', expectedProjectRef: null }
  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const u = new URL(href)
    const host = u.hostname
    let expectedProjectRef: string | null = null
    if (host.toLowerCase().endsWith('.supabase.co')) {
      const sub = host.slice(0, -'.supabase.co'.length)
      expectedProjectRef = sub || null
    }
    return { projectUrlHost: host, expectedProjectRef }
  } catch {
    return { projectUrlHost: '', expectedProjectRef: null }
  }
}

function decodeJwtPayloadMiddle(middleB64: string): JwtPayloadShape | null {
  try {
    const json = Buffer.from(middleB64, 'base64url').toString('utf8')
    const o = JSON.parse(json) as unknown
    return o !== null && typeof o === 'object' ? (o as JwtPayloadShape) : null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const denied = assertDebugRouteAuthorized(req)
  if (denied) return denied

  const keyRaw = trimEnv(SUPABASE_SERVICE_ROLE_ENV)
  const keyPresent = keyRaw.length > 0

  const { projectUrlHost, expectedProjectRef } = parseProjectUrlHost()

  let jwtRole: string | null = null
  let keyProjectRef: string | null = null
  let isServiceRole = false

  if (keyPresent) {
    const parts = keyRaw.split('.')
    if (parts.length === 3 && parts[1]) {
      const payload = decodeJwtPayloadMiddle(parts[1])
      if (payload) {
        if (typeof payload.role === 'string') jwtRole = payload.role
        if (typeof payload.ref === 'string' && payload.ref.trim()) keyProjectRef = payload.ref.trim()
        isServiceRole = jwtRole === 'service_role'
      }
    }
  }

  return NextResponse.json({
    keyPresent,
    jwtRole,
    projectUrlHost,
    expectedProjectRef,
    keyProjectRef,
    isServiceRole,
  })
}
