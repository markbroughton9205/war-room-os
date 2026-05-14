import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { getResourceSnapshot } from '@/lib/system/resourceMonitor'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { fetchWarRoomPermissionsState, recordLastStandingAutoAction } from '@/lib/war-room/permissionsState'
import {
  releaseScanSlot,
  shouldPauseWorkersDueToResources,
  tryAcquireScanSlot,
  tryReserveRedSentinelInterval,
} from '@/lib/workers/limits'
import { runRedSentinelScan } from '@/lib/red-sentinel/runScan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTION_KIND = 'red_sentinel_scan'

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    body = {}
  }

  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)
  const gate = assertAutoOrApproval({
    mode: state.mode,
    safetyLock: state.safetyLock,
    actionKind: ACTION_KIND,
    body,
  })

  if (!gate.ok) {
    return jsonWithPersistence({ error: gate.error }, sup.ok, { status: gate.status })
  }

  const snapshot = getResourceSnapshot()
  if (shouldPauseWorkersDueToResources(snapshot)) {
    return jsonWithPersistence(
      { error: 'Server memory pressure high; try again shortly.', retryAfterMs: 5000 },
      sup.ok,
      { status: 429, headers: { 'Retry-After': '5' } },
    )
  }

  const slot = tryAcquireScanSlot()
  if (!slot.ok) {
    return jsonWithPersistence(
      { error: slot.error, retryAfterMs: slot.retryAfterMs },
      sup.ok,
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(slot.retryAfterMs / 1000))) } },
    )
  }

  const interval = tryReserveRedSentinelInterval()
  if (!interval.ok) {
    releaseScanSlot()
    const s = Math.max(1, Math.ceil(interval.retryAfterMs / 1000))
    return jsonWithPersistence(
      { error: 'Red Sentinel scan rate limited.', retryAfterMs: interval.retryAfterMs },
      sup.ok,
      { status: 429, headers: { 'Retry-After': String(s) } },
    )
  }

  const categories = Array.isArray(body.categories)
    ? (body.categories as unknown[]).filter((c): c is string => typeof c === 'string')
    : undefined

  const cwd = process.cwd()
  try {
    const { findings, scannedAt, chatIntegrity } = await runRedSentinelScan(cwd, { categories })

    if (sup.ok) {
      const warnCount = findings.filter(f => f.severity === 'warn').length
      const errorCount = findings.filter(f => f.severity === 'error').length
      await sup.client.from('war_room_sentinel_scans').insert({
        findings_count: findings.length,
        metadata: {
          scannedAt,
          warnCount,
          errorCount,
          kinds: [...new Set(findings.map(f => f.kind))].slice(0, 40),
        },
      })
      await insertWarRoomAuditLog(sup.client, {
        actor: 'system',
        category: 'sentinel',
        message: `Red Sentinel scan completed (${findings.length} findings).`,
        metadata: {
          scannedAt,
          findings_count: findings.length,
          warnCount,
          errorCount,
        },
      })
      if (gate.viaAutoPolicy) {
        await recordLastStandingAutoAction(sup.client, {
          kind: ACTION_KIND,
          detail: { findings: findings.length, scannedAt },
        })
        await insertWarRoomAuditLog(sup.client, {
          actor: 'system',
          category: 'permissions',
          message: `Standing auto-run: ${ACTION_KIND}`,
          metadata: { auto: true, actionKind: ACTION_KIND, mode: state.mode },
        })
      }
    }

    return jsonWithPersistence({ findings, scannedAt, chatIntegrity }, sup.ok)
  } finally {
    releaseScanSlot()
  }
}
