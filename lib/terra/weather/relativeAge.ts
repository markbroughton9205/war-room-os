import { relativeAgeLabel } from '@/lib/terra/worldTime'

export function weatherRelativeAge(iso: string | null, nowIso: string): string {
  if (!iso) return 'UNKNOWN'
  const relative = relativeAgeLabel(iso, nowIso)
  if (relative) return relative
  const then = Date.parse(iso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(then) || !Number.isFinite(now)) return 'UNKNOWN'
  const days = Math.round(Math.abs(now - then) / 86_400_000)
  if (days <= 1) return '1 day ago'
  return `${days} days ago`
}
