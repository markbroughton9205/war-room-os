/**
 * ENGINE-09 Watch conditions + change detection.
 * Persistent watches require Commander approval. Detection is not authority.
 */
import { createHash } from 'node:crypto'
import { ENGINE_09_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { saveFinalJson, loadFinalJson } from './store'
import type { AlertMateriality, ChangeAlert, WatchCondition, WorldStateSnapshot } from './types'

export function createWatch(input: Omit<WatchCondition, 'status' | 'commander_approved' | 'secret'>): WatchCondition {
  return { ...input, status: 'DRAFT', commander_approved: false, secret: false }
}

export function approveWatch(watch: WatchCondition, commander: boolean): WatchCondition {
  if (!commander) return { ...watch, status: 'WAITING_COMMANDER', commander_approved: false }
  return { ...watch, status: 'APPROVED', commander_approved: true, secret: false }
}

export function activateWatch(watch: WatchCondition): WatchCondition {
  if (!watch.commander_approved) return { ...watch, status: 'WAITING_COMMANDER' }
  return { ...watch, status: 'ACTIVE' }
}

function materiality(watch: WatchCondition, kind: string): AlertMateriality {
  if (/urgent|outage|security/i.test(`${watch.severity_policy} ${kind}`)) return 'URGENT'
  if (/deadline|conflict|fail/i.test(kind)) return 'IMPORTANT'
  if (/stale|refresh/i.test(kind)) return 'NOTICE'
  return 'INFO'
}

export function detectChanges(input: {
  watch: WatchCondition
  previous: WorldStateSnapshot | null
  current: WorldStateSnapshot
  prior_alert_hash?: string | null
}): ChangeAlert[] {
  if (input.watch.status !== 'ACTIVE' || !input.watch.commander_approved) return []
  const prevIds = new Set((input.previous?.current_verified_facts ?? []).concat(input.previous?.entities.map(e => e.entity_id) ?? []))
  const alerts: ChangeAlert[] = []
  for (const fact of input.current.current_verified_facts) {
    if (!prevIds.has(fact)) {
      const body = `new:${fact}`
      const hash = createHash('sha256').update(body).digest('hex').slice(0, 16)
      alerts.push({
        alert_id: `al-${hash}`,
        watch_id: input.watch.watch_id,
        what_changed: body,
        when: input.current.at,
        evidence: input.current.entities.flatMap(e => e.source_refs).slice(0, 4),
        freshness: input.current.at,
        why_it_matters: input.watch.objective,
        uncertainty: input.current.unknowns.join('; ') || 'none stated',
        materiality: materiality(input.watch, 'new'),
        duplicate_of: input.prior_alert_hash === hash ? hash : null,
        authorizes_action: false,
      })
    }
  }
  if (input.previous) {
    for (const ent of input.previous.entities) {
      const now = input.current.entities.find(e => e.entity_id === ent.entity_id)
      if (now && now.current_state !== ent.current_state) {
        alerts.push({
          alert_id: `al-chg-${ent.entity_id}`,
          watch_id: input.watch.watch_id,
          what_changed: `${ent.canonical_name} ${ent.current_state} -> ${now.current_state}`,
          when: input.current.at,
          evidence: now.source_refs,
          freshness: now.last_seen,
          why_it_matters: input.watch.objective,
          uncertainty: 'state change observed',
          materiality: materiality(input.watch, 'changed'),
          duplicate_of: null,
          authorizes_action: false,
        })
      }
    }
  }
  return alerts.filter(a => !a.duplicate_of)
}

export function staleRefreshNotice(watch: WatchCondition, freshness: string): ChangeAlert {
  return {
    alert_id: `al-stale-${watch.watch_id}`,
    watch_id: watch.watch_id,
    what_changed: 'state is stale relative to freshness requirement',
    when: new Date().toISOString(),
    evidence: [],
    freshness,
    why_it_matters: 'refresh required before treating as current',
    uncertainty: 'STALE',
    materiality: 'NOTICE',
    duplicate_of: null,
    authorizes_action: false,
  }
}

export function proactiveBrief(alerts: readonly ChangeAlert[]): string {
  if (!alerts.length) return 'No material approved-scope changes.'
  return alerts.map(a => `${a.materiality}: ${a.what_changed} (${a.uncertainty})`).join('\n')
}

export async function persistWatch(watch: WatchCondition): Promise<void> {
  await saveFinalJson('watches', watch.watch_id, watch)
}

export async function loadWatch(id: string): Promise<WatchCondition | null> {
  return loadFinalJson<WatchCondition>('watches', id)
}

export function watchReceipt(mission_id: string, n: number) {
  return createEngineReceipt({
    engine: 'watch-condition',
    mission_id,
    started_at: Date.now(),
    decision_count: n,
    decision: ENGINE_09_VERSION,
  })
}
