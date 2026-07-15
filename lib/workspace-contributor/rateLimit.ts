type WorkspaceRateLimitBucket = {
  count: number
  resetAt: number
}

const buckets = new Map<string, WorkspaceRateLimitBucket>()

const WINDOW_MS = 60_000

const LIMITS = {
  proposal_create: 8,
  attachment_upload: 12,
  attachment_signed_url: 30,
  settings_update: 20,
} as const

export type WorkspaceRateLimitAction = keyof typeof LIMITS

export type WorkspaceRateLimitResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number }

export function checkWorkspaceRateLimit(userId: string, action: WorkspaceRateLimitAction, now = Date.now()): WorkspaceRateLimitResult {
  const key = `${userId}:${action}`
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { ok: true }
  }
  if (existing.count >= LIMITS[action]) {
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
  }
  existing.count += 1
  return { ok: true }
}

export function resetWorkspaceRateLimitsForTests(): void {
  buckets.clear()
}
