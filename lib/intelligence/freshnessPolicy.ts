import type { EvidenceFreshness, EvidenceOriginType } from '@/lib/intelligence/intelligencePacket'

const HOUR_MS = 60 * 60 * 1000

/**
 * Deterministic freshness policy (Build #4B).
 *
 * Origins stay orthogonal to freshness: a STORED_RESEARCH item retrieved minutes ago may be
 * `live`/`recent` by age while remaining STORED_RESEARCH (never silently becoming LIVE_WEB).
 * Kimi Wave artifacts never become `live`/`recent`/`aging` just because they were parsed today —
 * they are preserved historical intelligence unless independently revalidated.
 */
export function classifyEvidenceFreshness(args: {
  originType: EvidenceOriginType
  nowIso: string
  retrievedAt?: string
  publishedAt?: string
  artifactAt?: string
}): EvidenceFreshness {
  const origin = args.originType

  if (origin === 'KIMI_WAVE') {
    const dated = parseTime(args.artifactAt) ?? parseTime(args.publishedAt)
    return dated == null ? 'unknown' : 'stale'
  }

  if (origin === 'MODEL_INFERENCE' || origin === 'COMMANDER_MEMORY') {
    return 'unknown'
  }

  if (origin === 'STORED_RESEARCH') {
    return bucketAge(parseTime(args.retrievedAt) ?? parseTime(args.publishedAt), parseTime(args.nowIso), {
      allowLive: false,
    })
  }

  const contentTime = parseTime(args.publishedAt) ?? parseTime(args.retrievedAt)
  return bucketAge(contentTime, parseTime(args.nowIso), { allowLive: true })
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function bucketAge(
  thenMs: number | null,
  nowMs: number | null,
  opts: { allowLive: boolean },
): EvidenceFreshness {
  if (thenMs == null || nowMs == null) return 'unknown'
  const ageMs = Math.max(0, nowMs - thenMs)
  if (ageMs <= HOUR_MS) return opts.allowLive ? 'live' : 'recent'
  if (ageMs <= 48 * HOUR_MS) return 'recent'
  if (ageMs <= 30 * 24 * HOUR_MS) return 'aging'
  return 'stale'
}
