import type { PersistenceRollup, ToolsLayerRollup } from '@/lib/runtime/runtimeIntegrityTypes'
import type { RuntimeIntegrityPartial } from '@/lib/runtime/finalizeRuntimeIntegrityResponse'

export const RUNTIME_INTEGRITY_SNAPSHOT_MAX_AGE_MS = 30_000

export function parseRuntimeIntegrityGeneratedAt(snapshotJson: string): string | null {
  if (!snapshotJson.trim()) return null
  try {
    const j = JSON.parse(snapshotJson) as { generatedAt?: unknown }
    return typeof j.generatedAt === 'string' ? j.generatedAt : null
  } catch {
    return null
  }
}

export function isRuntimeIntegritySnapshotStale(
  snapshotJson: string,
  maxAgeMs = RUNTIME_INTEGRITY_SNAPSHOT_MAX_AGE_MS,
): boolean {
  const iso = parseRuntimeIntegrityGeneratedAt(snapshotJson)
  if (!iso) return true
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return true
  return Date.now() - t > maxAgeMs
}

export function tryParseRuntimeIntegrityPartial(snapshotJson: string): RuntimeIntegrityPartial | null {
  if (!snapshotJson.trim()) return null
  try {
    const o = JSON.parse(snapshotJson) as Record<string, unknown>
    if (typeof o.generatedAt !== 'string') return null
    if (!Array.isArray(o.subsystems)) return null
    if (!Array.isArray(o.providers)) return null
    if (!o.persistence || typeof o.persistence !== 'object') return null
    if (!o.toolsLayer || typeof o.toolsLayer !== 'object') return null
    if (!o.deployment || typeof o.deployment !== 'object') return null
    return {
      generatedAt: o.generatedAt,
      subsystems: o.subsystems as RuntimeIntegrityPartial['subsystems'],
      attendanceParticipation: 'UNKNOWN',
      providers: o.providers as RuntimeIntegrityPartial['providers'],
      internetRollup: (o.internetRollup ?? null) as RuntimeIntegrityPartial['internetRollup'],
      persistence: o.persistence as PersistenceRollup,
      toolsLayer: o.toolsLayer as ToolsLayerRollup,
      deployment: o.deployment as RuntimeIntegrityPartial['deployment'],
      councilMode: null,
    }
  } catch {
    return null
  }
}
