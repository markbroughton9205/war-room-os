import { collectEngineStatuses } from '@/lib/engine-control/status'
import { buildToolRoutingSnapshotFromOrigin, requestOriginFromHeaders } from '@/lib/engine-control/tool-snapshot'
import type { EngineStatus } from '@/lib/engine-control/types'
import { RUNTIME_STATE_KEYS, WAR_ROOM_RUNTIME_STATE_SCOPE } from '@/lib/runtime/runtimeContinuityConstants'
import type {
  DiagnosticHistoryEvent,
  DiagnosticModeSummary,
  RedTeamHoldUnresolvedPayload,
  RuntimeAttendanceSummary,
} from '@/lib/runtime/runtimeContinuityTypes'
import { tryParseRuntimeIntegrityPartial } from '@/lib/runtime/runtimeIntegritySnapshot'
import { mapIntegrityRowsToRepairs } from '@/lib/runtime/runtimeRepairMap'
import type { RuntimeIntegrityResponse } from '@/lib/runtime/runtimeIntegrityTypes'
import { deleteRuntimeState, getRuntimeState, isRuntimeStatePersistenceConfigured, setRuntimeState } from '@/lib/runtime/runtimeStateStore'
import {
  auditRuntimePersistenceEvent,
  probeWarRoomRuntimeStateReachable,
} from '@/lib/runtime/runtimeStatePersistenceGuards'

const MAX_PATCH_BYTES = 96_000
const MAX_DIAGNOSTIC_EVENTS = 200

const ALLOWED_KEYS = new Set<string>(Object.values(RUNTIME_STATE_KEYS))

function jsonByteLength(v: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(v)).length
  } catch {
    return MAX_PATCH_BYTES + 1
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v))
}

function parseIntegrityForStorage(raw: unknown): RuntimeIntegrityResponse | null {
  if (typeof raw === 'string') {
    const p = tryParseRuntimeIntegrityPartial(raw)
    return p as unknown as RuntimeIntegrityResponse | null
  }
  if (!isRecord(raw)) return null
  const partial = tryParseRuntimeIntegrityPartial(JSON.stringify(raw))
  return partial as unknown as RuntimeIntegrityResponse | null
}

function filterInflightFromOutcomes(
  outcomes: { family: string; runtime: string }[] | undefined,
): { family: string; runtime: string }[] {
  if (!Array.isArray(outcomes)) return []
  return outcomes.filter(o => o && o.runtime !== 'IN_FLIGHT')
}

function mergeDiagnosticHistory(existing: unknown, append: DiagnosticHistoryEvent[]): DiagnosticHistoryEvent[] {
  const prev = isRecord(existing) && Array.isArray((existing as { events?: unknown }).events)
    ? ((existing as { events: DiagnosticHistoryEvent[] }).events.filter(Boolean) as DiagnosticHistoryEvent[])
    : Array.isArray(existing)
      ? (existing as DiagnosticHistoryEvent[]).filter(Boolean)
      : []
  const next = [...prev, ...append].slice(-MAX_DIAGNOSTIC_EVENTS)
  return next
}

function eventsFromIntegritySnapshot(snap: RuntimeIntegrityResponse, at: string): DiagnosticHistoryEvent[] {
  const out: DiagnosticHistoryEvent[] = []
  for (const w of snap.historicalWarnings ?? []) {
    out.push({
      kind: 'runtime_warning',
      at,
      subsystemId: w.subsystemId,
      label: w.label,
      message: w.message,
      severity: w.severity,
    })
  }
  for (const r of mapIntegrityRowsToRepairs(snap.subsystems ?? [])) {
    out.push({
      kind: 'repair_recommendation',
      at,
      subsystemId: r.subsystemId,
      label: r.title,
      recommendation: r.summary,
    })
  }
  return out.slice(0, 40)
}

async function loadFallbackEngineStatusesForRuntimeApi(): Promise<EngineStatus[]> {
  try {
    const origin = await requestOriginFromHeaders()
    const tools = await buildToolRoutingSnapshotFromOrigin(origin)
    return await collectEngineStatuses(tools)
  } catch {
    return []
  }
}

export type RuntimeContinuityReadResult = {
  persistenceConfigured: boolean
  bundle: {
    recoveredFromStorageAt: string
    integrityPartial: ReturnType<typeof tryParseRuntimeIntegrityPartial>
    providerSlots: unknown
    attendanceSummary: RuntimeAttendanceSummary | null
    diagnosticHistory: DiagnosticHistoryEvent[]
    diagnosticModeSummary: DiagnosticModeSummary | null
    redTeamHoldUnresolved: RedTeamHoldUnresolvedPayload | null
  } | null
  runtimeStateTableMissing?: boolean
  runtimeStateReadFailed?: boolean
  fallbackEngines?: EngineStatus[]
  fallbackProviderRegistryUsed?: boolean
}

export async function readRuntimeContinuityBundle(): Promise<RuntimeContinuityReadResult> {
  if (!isRuntimeStatePersistenceConfigured()) {
    return { persistenceConfigured: false, bundle: null }
  }
  const persistenceConfigured = true
  const probe = await probeWarRoomRuntimeStateReachable()
  if (!probe.ok) {
    if (probe.reason === 'no_admin_client') {
      auditRuntimePersistenceEvent('runtimeStateReadFailed', { phase: 'read_bundle', reason: 'admin_client_throw' })
      const fallbackEngines = await loadFallbackEngineStatusesForRuntimeApi()
      if (fallbackEngines.length) {
        auditRuntimePersistenceEvent('fallbackProviderRegistryUsed', { phase: 'read_bundle', engines: fallbackEngines.map(e => e.id) })
      }
      return {
        persistenceConfigured,
        bundle: null,
        runtimeStateReadFailed: true,
        fallbackEngines,
        fallbackProviderRegistryUsed: fallbackEngines.length > 0,
      }
    }
    const tableMissing = Boolean(probe.tableMissing)
    if (tableMissing) {
      auditRuntimePersistenceEvent('runtimeStateTableMissing', { phase: 'read_bundle', code: probe.code })
    } else {
      auditRuntimePersistenceEvent('runtimeStateReadFailed', { phase: 'read_bundle', code: probe.code, message: probe.message })
    }
    const fallbackEngines = await loadFallbackEngineStatusesForRuntimeApi()
    if (fallbackEngines.length) {
      auditRuntimePersistenceEvent('fallbackProviderRegistryUsed', { phase: 'read_bundle', engines: fallbackEngines.map(e => e.id) })
    }
    return {
      persistenceConfigured,
      bundle: null,
      runtimeStateTableMissing: tableMissing,
      runtimeStateReadFailed: !tableMissing,
      fallbackEngines,
      fallbackProviderRegistryUsed: fallbackEngines.length > 0,
    }
  }
  const scope = WAR_ROOM_RUNTIME_STATE_SCOPE
  const [
    rawIntegrity,
    rawProviders,
    rawAttendance,
    rawHistory,
    rawModeSummary,
    rawHold,
  ] = await Promise.all([
    getRuntimeState<unknown>(RUNTIME_STATE_KEYS.integritySnapshot, scope),
    getRuntimeState<unknown>(RUNTIME_STATE_KEYS.providerSlots, scope),
    getRuntimeState<RuntimeAttendanceSummary | null>(RUNTIME_STATE_KEYS.attendanceSummary, scope),
    getRuntimeState<unknown>(RUNTIME_STATE_KEYS.diagnosticHistory, scope),
    getRuntimeState<DiagnosticModeSummary | null>(RUNTIME_STATE_KEYS.diagnosticModeSummary, scope),
    getRuntimeState<RedTeamHoldUnresolvedPayload | null>(RUNTIME_STATE_KEYS.redTeamHoldUnresolved, scope),
  ])

  const hasAny =
    rawIntegrity != null
    || rawProviders != null
    || rawAttendance != null
    || rawHistory != null
    || rawModeSummary != null
    || rawHold != null

  if (!hasAny) {
    return { persistenceConfigured, bundle: null }
  }

  let integrityPartial: ReturnType<typeof tryParseRuntimeIntegrityPartial> = null
  if (typeof rawIntegrity === 'string') {
    integrityPartial = tryParseRuntimeIntegrityPartial(rawIntegrity)
  } else if (rawIntegrity != null) {
    try {
      integrityPartial = tryParseRuntimeIntegrityPartial(JSON.stringify(rawIntegrity))
    } catch {
      integrityPartial = null
    }
  }

  const providerSlots = Array.isArray(rawProviders) ? rawProviders : null

  const diagnosticHistory = mergeDiagnosticHistory(rawHistory, [])

  const recoveredFromStorageAt = new Date().toISOString()

  return {
    persistenceConfigured,
    bundle: {
      recoveredFromStorageAt,
      integrityPartial,
      providerSlots,
      attendanceSummary: rawAttendance && typeof rawAttendance === 'object' ? rawAttendance : null,
      diagnosticHistory,
      diagnosticModeSummary: rawModeSummary && typeof rawModeSummary === 'object' ? rawModeSummary : null,
      redTeamHoldUnresolved: rawHold && typeof rawHold === 'object' ? rawHold : null,
    },
  }
}

export type RuntimeStatePostBody = {
  set?: Partial<Record<(typeof RUNTIME_STATE_KEYS)[keyof typeof RUNTIME_STATE_KEYS], unknown>>
  appendDiagnosticEvents?: DiagnosticHistoryEvent[]
}

export async function applyRuntimeStatePost(
  body: RuntimeStatePostBody,
): Promise<{ ok: boolean; error?: string; persistenceUnavailable?: boolean }> {
  if (!isRuntimeStatePersistenceConfigured()) return { ok: false, error: 'Persistence not configured' }
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' }

  if (body.set) {
    for (const [k, v] of Object.entries(body.set)) {
      if (!ALLOWED_KEYS.has(k)) return { ok: false, error: `Key not allowed: ${k}` }
      if (jsonByteLength(v) > MAX_PATCH_BYTES) return { ok: false, error: 'Payload too large' }
    }
  }

  if (body.appendDiagnosticEvents) {
    if (!Array.isArray(body.appendDiagnosticEvents)) return { ok: false, error: 'appendDiagnosticEvents must be an array' }
    if (jsonByteLength(body.appendDiagnosticEvents) > MAX_PATCH_BYTES) return { ok: false, error: 'Diagnostic append too large' }
  }

  const scope = WAR_ROOM_RUNTIME_STATE_SCOPE

  if (body.set?.[RUNTIME_STATE_KEYS.integritySnapshot] !== undefined) {
    const raw = body.set[RUNTIME_STATE_KEYS.integritySnapshot]
    const snap = parseIntegrityForStorage(raw)
    if (!snap) return { ok: false, error: 'integrity_snapshot invalid' }
  }

  const probe = await probeWarRoomRuntimeStateReachable()
  if (!probe.ok) {
    if (probe.reason === 'no_admin_client') {
      auditRuntimePersistenceEvent('runtimeStateReadFailed', { phase: 'post', reason: 'admin_client_throw' })
    } else if (probe.tableMissing) {
      auditRuntimePersistenceEvent('runtimeStateTableMissing', { phase: 'post', code: probe.code })
    } else {
      auditRuntimePersistenceEvent('runtimeStateReadFailed', { phase: 'post', code: probe.code, message: probe.message })
    }
    return { ok: true, persistenceUnavailable: true }
  }

  const softUnavailableOnPersist = (): { ok: true; persistenceUnavailable: true } => ({ ok: true, persistenceUnavailable: true })

  if (body.set?.[RUNTIME_STATE_KEYS.integritySnapshot] !== undefined) {
    const raw = body.set[RUNTIME_STATE_KEYS.integritySnapshot]
    const snap = parseIntegrityForStorage(raw)!
    const pr = await setRuntimeState(RUNTIME_STATE_KEYS.integritySnapshot, raw, { scope })
    if (!pr.ok) {
      if (pr.tableMissing) {
        auditRuntimePersistenceEvent('runtimeStateTableMissing', { phase: 'post_write', key: RUNTIME_STATE_KEYS.integritySnapshot })
        return softUnavailableOnPersist()
      }
      return { ok: false, error: 'Failed to persist integrity_snapshot' }
    }

    const derived = eventsFromIntegritySnapshot(snap, new Date().toISOString())
    if (derived.length) {
      const hist = await getRuntimeState(RUNTIME_STATE_KEYS.diagnosticHistory, scope)
      const merged = mergeDiagnosticHistory(hist, derived)
      const dh = await setRuntimeState(RUNTIME_STATE_KEYS.diagnosticHistory, { events: merged }, { scope })
      if (!dh.ok) {
        if (dh.tableMissing) {
          auditRuntimePersistenceEvent('runtimeStateTableMissing', { phase: 'post_write', key: RUNTIME_STATE_KEYS.diagnosticHistory })
          return softUnavailableOnPersist()
        }
        return { ok: false, error: 'Failed to persist diagnostic history' }
      }
    }
  }

  if (body.set) {
    for (const [key, value] of Object.entries(body.set)) {
      if (key === RUNTIME_STATE_KEYS.integritySnapshot) continue
      if (!ALLOWED_KEYS.has(key)) continue
      if (value === null) {
        const dr = await deleteRuntimeState(key, scope)
        if (!dr.ok) {
          if (dr.tableMissing) {
            auditRuntimePersistenceEvent('runtimeStateTableMissing', { phase: 'post_delete', key })
            return softUnavailableOnPersist()
          }
          return { ok: false, error: `Failed to delete ${key}` }
        }
        continue
      }
      const sr = await setRuntimeState(key, value, { scope })
      if (!sr.ok) {
        if (sr.tableMissing) {
          auditRuntimePersistenceEvent('runtimeStateTableMissing', { phase: 'post_write', key })
          return softUnavailableOnPersist()
        }
        return { ok: false, error: `Failed to persist ${key}` }
      }
    }
  }

  if (body.appendDiagnosticEvents?.length) {
    const sanitized: DiagnosticHistoryEvent[] = []
    for (const ev of body.appendDiagnosticEvents) {
      if (!ev || typeof ev !== 'object' || !('kind' in ev)) continue
      if (ev.kind === 'diagnostic_session_complete') {
        const e = ev as Extract<DiagnosticHistoryEvent, { kind: 'diagnostic_session_complete' }>
        const order = Array.isArray(e.order) ? e.order : []
        const outcomes = filterInflightFromOutcomes(e.outcomes) as Extract<
          DiagnosticHistoryEvent,
          { kind: 'diagnostic_session_complete' }
        >['outcomes']
        if (!order.length || !outcomes.length) continue
        sanitized.push({ kind: 'diagnostic_session_complete', at: e.at, intentMode: e.intentMode, order, outcomes })
      } else if (ev.kind === 'red_team_hold') {
        sanitized.push(ev)
      } else if (ev.kind === 'runtime_warning' || ev.kind === 'repair_recommendation') {
        sanitized.push(ev)
      }
    }
    if (sanitized.length) {
      const hist = await getRuntimeState(RUNTIME_STATE_KEYS.diagnosticHistory, scope)
      const merged = mergeDiagnosticHistory(hist, sanitized)
      const ar = await setRuntimeState(RUNTIME_STATE_KEYS.diagnosticHistory, { events: merged }, { scope })
      if (!ar.ok) {
        if (ar.tableMissing) {
          auditRuntimePersistenceEvent('runtimeStateTableMissing', { phase: 'post_append_diag', key: RUNTIME_STATE_KEYS.diagnosticHistory })
          return softUnavailableOnPersist()
        }
        return { ok: false, error: 'Failed to persist diagnostic append' }
      }
    }
  }

  return { ok: true }
}
