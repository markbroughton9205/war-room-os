import { emitEvent } from '@/lib/events/bus'
import type { WarRoomEventSource } from '@/lib/events/types'
import { getDeploymentStatus } from '@/lib/deploy/status'
import { buildWarRoomInternetLayerStatus } from '@/lib/internet/warRoomInternetStatus'
import { getEffectivePolicy } from '@/lib/permissions/policy'
import { runRedSentinelScan } from '@/lib/red-sentinel/runScan'
import { getRepoStatus } from '@/lib/repo/status'
import { getResourceSnapshot } from '@/lib/system/resourceMonitor'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import {
  canRunInternetPoll,
  recordInternetPoll,
  releaseScanSlot,
  releaseWorkerSlot,
  tryAcquireScanSlot,
  tryAcquireWorkerSlot,
  tryReserveRedSentinelInterval,
} from '@/lib/workers/limits'
import type { WorkerId, WorkerRunResult } from '@/lib/workers/types'

const ACTION_QUEUE_BATCH = 10

export type WorkerRunContext = {
  supabase: WarRoomSupabase | null
  cwd: string
  correlationId?: string
  /** Event source for emitted worker events */
  eventSource?: WarRoomEventSource
}

function finish(
  workerId: WorkerId,
  startedAt: string,
  patch: Partial<Omit<WorkerRunResult, 'workerId' | 'startedAt' | 'finishedAt'>> & { ok: boolean },
): WorkerRunResult {
  return {
    workerId,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: patch.ok,
    detail: patch.detail,
    error: patch.error,
    skippedReason: patch.skippedReason,
  }
}

async function emitSafe(
  sup: WarRoomSupabase | null,
  type: Parameters<typeof emitEvent>[0]['type'],
  payload: Record<string, unknown>,
  source: WarRoomEventSource,
  correlationId?: string,
) {
  await emitEvent({ supabase: sup, type, payload, source, correlationId })
}

export async function runWorker(workerId: WorkerId, ctx: WorkerRunContext): Promise<WorkerRunResult> {
  const startedAt = new Date().toISOString()
  const source: WarRoomEventSource = ctx.eventSource ?? 'worker'
  const corr = ctx.correlationId

  const slot = tryAcquireWorkerSlot('background')
  if (!slot.ok) {
    return finish(workerId, startedAt, {
      ok: false,
      error: slot.error,
      detail: { retryAfterMs: slot.retryAfterMs },
      skippedReason: 'limits',
    })
  }

  try {
    switch (workerId) {
      case 'internet_monitor':
        return await runInternetMonitor(ctx, startedAt, source, corr)
      case 'red_sentinel':
        return await runRedSentinel(ctx, startedAt, source, corr)
      case 'repo_health':
        return await runRepoHealth(ctx, startedAt, source, corr)
      case 'deployment_status':
        return await runDeploymentStatus(ctx, startedAt, source, corr)
      case 'action_queue':
        return await runActionQueue(ctx, startedAt, source, corr)
      case 'memory_proposals':
        return await runMemoryProposals(ctx, startedAt, source, corr)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'worker_failed'
    await emitSafe(ctx.supabase, 'action.failed', { workerId, error: msg }, source, corr)
    return finish(workerId, startedAt, { ok: false, error: msg })
  } finally {
    releaseWorkerSlot()
  }
}

async function runInternetMonitor(
  ctx: WorkerRunContext,
  startedAt: string,
  source: WarRoomEventSource,
  corr?: string,
): Promise<WorkerRunResult> {
  if (!canRunInternetPoll()) {
    return finish('internet_monitor', startedAt, {
      ok: false,
      skippedReason: 'internet_poll_rate_limited',
      error: 'Internet poll rate limit exceeded.',
    })
  }
  await emitSafe(ctx.supabase, 'internet.query.started', { workerId: 'internet_monitor' }, source, corr)
  recordInternetPoll()
  try {
    const status = await buildWarRoomInternetLayerStatus()
    await emitSafe(ctx.supabase, 'internet.query.completed', { workerId: 'internet_monitor', lastChecked: status.lastChecked }, source, corr)
    return finish('internet_monitor', startedAt, { ok: true, detail: { lastChecked: status.lastChecked } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'internet_monitor_failed'
    await emitSafe(ctx.supabase, 'action.failed', { workerId: 'internet_monitor', error: msg }, source, corr)
    return finish('internet_monitor', startedAt, { ok: false, error: msg })
  }
}

async function runRedSentinel(
  ctx: WorkerRunContext,
  startedAt: string,
  source: WarRoomEventSource,
  corr?: string,
): Promise<WorkerRunResult> {
  const scan = tryAcquireScanSlot()
  if (!scan.ok) {
    return finish('red_sentinel', startedAt, {
      ok: false,
      error: scan.error,
      detail: { retryAfterMs: scan.retryAfterMs },
      skippedReason: 'limits',
    })
  }
  const interval = tryReserveRedSentinelInterval()
  if (!interval.ok) {
    releaseScanSlot()
    return finish('red_sentinel', startedAt, {
      ok: false,
      error: 'Red Sentinel scan rate limited.',
      detail: { retryAfterMs: interval.retryAfterMs },
      skippedReason: 'red_sentinel_interval',
    })
  }
  await emitSafe(ctx.supabase, 'red_sentinel.scan.started', { cwd: ctx.cwd }, source, corr)
  try {
    const { findings, scannedAt } = await runRedSentinelScan(ctx.cwd)
    await emitSafe(ctx.supabase, 'red_sentinel.scan.completed', { findings: findings.length, scannedAt }, source, corr)
    return finish('red_sentinel', startedAt, {
      ok: true,
      detail: { findingsCount: findings.length, scannedAt },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'red_sentinel_failed'
    await emitSafe(ctx.supabase, 'action.failed', { workerId: 'red_sentinel', error: msg }, source, corr)
    return finish('red_sentinel', startedAt, { ok: false, error: msg })
  } finally {
    releaseScanSlot()
  }
}

async function runRepoHealth(
  ctx: WorkerRunContext,
  startedAt: string,
  source: WarRoomEventSource,
  corr?: string,
): Promise<WorkerRunResult> {
  const snapshot = getResourceSnapshot()
  const repo = await getRepoStatus()
  await emitSafe(
    ctx.supabase,
    'repo.status.checked',
    {
      memoryUsageRatio: snapshot.memoryUsageRatio,
      branch: repo.currentBranch,
      workingTreeStatus: repo.workingTreeStatus,
      checkedAt: repo.checkedAt,
    },
    source,
    corr,
  )
  return finish('repo_health', startedAt, {
    ok: true,
    detail: { branch: repo.currentBranch, workingTreeStatus: repo.workingTreeStatus },
  })
}

async function runDeploymentStatus(
  ctx: WorkerRunContext,
  startedAt: string,
  source: WarRoomEventSource,
  corr?: string,
): Promise<WorkerRunResult> {
  const dep = await getDeploymentStatus()
  await emitSafe(
    ctx.supabase,
    'deployment.status.checked',
    { checkedAt: dep.checkedAt, awarenessOnly: dep.awarenessOnly, supabase: dep.supabase.status },
    source,
    corr,
  )
  return finish('deployment_status', startedAt, { ok: true, detail: { checkedAt: dep.checkedAt } })
}

async function runActionQueue(
  ctx: WorkerRunContext,
  startedAt: string,
  source: WarRoomEventSource,
  corr?: string,
): Promise<WorkerRunResult> {
  if (!ctx.supabase) {
    return finish('action_queue', startedAt, { ok: false, skippedReason: 'no_supabase', error: 'Supabase not configured.' })
  }

  const perm = await fetchWarRoomPermissionsState(ctx.supabase)
  const { data: rows, error } = await ctx.supabase
    .from('war_room_actions')
    .select('id,type,status,approval_granted,created_at')
    .eq('status', 'requested')
    .order('created_at', { ascending: true })
    .limit(ACTION_QUEUE_BATCH)

  if (error) {
    return finish('action_queue', startedAt, { ok: false, error: error.message })
  }

  const list = rows ?? []
  let transitioned = 0

  for (const row of list) {
    const actionId = row.id as string
    const actionType = typeof row.type === 'string' ? row.type : 'unknown'
    const policy = getEffectivePolicy(perm.mode, actionType)
    const canAuto = policy.autoAllowed && !perm.safetyLock

    if (canAuto) {
      await emitSafe(ctx.supabase, 'action.auto_approved', { actionId, actionType, reason: policy.reason }, source, corr)
      const { error: upErr } = await ctx.supabase
        .from('war_room_actions')
        .update({ status: 'planned', updated_at: new Date().toISOString() })
        .eq('id', actionId)
        .eq('status', 'requested')
      if (!upErr) transitioned += 1
    } else {
      await emitSafe(ctx.supabase, 'action.approval_required', { actionId, actionType, reason: policy.reason }, source, corr)
      const { error: upErr } = await ctx.supabase
        .from('war_room_actions')
        .update({ status: 'waiting_approval', updated_at: new Date().toISOString() })
        .eq('id', actionId)
        .eq('status', 'requested')
      if (!upErr) transitioned += 1
    }
  }

  return finish('action_queue', startedAt, {
    ok: true,
    detail: { examined: list.length, transitioned },
  })
}

async function runMemoryProposals(
  ctx: WorkerRunContext,
  startedAt: string,
  source: WarRoomEventSource,
  corr?: string,
): Promise<WorkerRunResult> {
  const hook = process.env.WAR_ROOM_MEMORY_PROPOSALS_ENABLED?.trim() === '1'
    || process.env.WAR_ROOM_MEMORY_PROPOSALS_ENABLED?.toLowerCase() === 'true'
  if (!hook) {
    return finish('memory_proposals', startedAt, { ok: false, skippedReason: 'not_configured' })
  }
  await emitSafe(ctx.supabase, 'memory.proposal.created', { note: 'scan pending' }, source, corr)
  return finish('memory_proposals', startedAt, { ok: true, detail: { emitted: true } })
}
