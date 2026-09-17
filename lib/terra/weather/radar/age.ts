import { relativeAgeLabel } from '@/lib/terra/worldTime'

export function radarFrameAgeLabel(iso: string | null, nowIso: string): string {
  if (!iso) return 'UNKNOWN'
  const then = Date.parse(iso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(then) || !Number.isFinite(now)) return 'UNKNOWN'
  if (then > now) return 'just now'
  const relative = relativeAgeLabel(iso, nowIso)
  if (relative) return relative
  const hours = Math.round((now - then) / 3_600_000)
  if (hours < 48) return `${Math.max(1, hours)} hours ago`
  const days = Math.round((now - then) / 86_400_000)
  return `${days} days ago`
}
