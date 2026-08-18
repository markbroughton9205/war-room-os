import { listRewardLedgerEntriesForOpportunity } from '@/lib/income-loot/rewardLedger'
import { applyMissionAction } from './bridgeEngine'
import type { MissionRecord, ReportBackInput, ReportBackRecord } from './types'

/**
 * Session-only, bounded mission-record store — same shape of guarantee as
 * lib/income-loot/operationsStore.ts (module-level array, owner-scoped,
 * capped with eviction of the oldest entry, upsert-by-key duplicate
 * protection). Holds only opportunity identifiers, readiness-state labels,
 * and Commander-entered report-back text — no secrets, no expanded PII.
 *
 * "Session-only" describes persistence lifetime (wiped on process restart,
 * never written to Supabase/durable storage) — it is NOT per-HTTP-session or
 * per-browser-tab isolation. The store itself is a single process-global
 * array; every record is scoped by an `ownerUserId` string-equality check
 * (every getter/mutator below takes `ownerUserId` as its first argument and
 * only ever matches records for that exact owner). Today that is safe
 * because `requireCommanderSession` (lib/security/commanderSession.ts)
 * hard-allowlists exactly one Commander identity server-side, and no
 * client-supplied identity value is ever accepted — see
 * app/api/opportunity-mission-bridge/route.ts. A future multi-Commander
 * deployment would rely entirely on that same ownerUserId equality check as
 * its only isolation mechanism, with no additional per-record ACL.
 */

export const MISSION_BRIDGE_PERSISTENCE = 'session_only' as const
export const MISSION_BRIDGE_STORE_CAP = 500

const records: MissionRecord[] = []

function key(ownerUserId: string, opportunityId: string): string {
  return `${ownerUserId}::${opportunityId}`
}

function clone(record: MissionRecord): MissionRecord {
  return {
    ...record,
    reportBack: record.reportBack ? { ...record.reportBack, evidenceRefs: [...record.reportBack.evidenceRefs] } : null,
  }
}

export function getMissionRecord(ownerUserId: string, opportunityId: string): MissionRecord | null {
  const found = records.find(r => key(r.ownerUserId, r.opportunityId) === key(ownerUserId, opportunityId))
  return found ? clone(found) : null
}

export function listMissionRecordsForOwner(ownerUserId: string): MissionRecord[] {
  return records.filter(r => r.ownerUserId === ownerUserId).map(clone)
}

function upsert(record: MissionRecord): MissionRecord {
  const index = records.findIndex(r => key(r.ownerUserId, r.opportunityId) === key(record.ownerUserId, record.opportunityId))
  if (index >= 0) records[index] = record
  else records.unshift(record)
  if (records.length > MISSION_BRIDGE_STORE_CAP) records.splice(MISSION_BRIDGE_STORE_CAP)
  return clone(record)
}

/** Creates the record on first touch (always NOT_ASSESSED) — never assumes
 * readiness. Idempotent: calling twice for the same opportunity returns the
 * existing record unchanged. */
export function ensureMissionRecord(ownerUserId: string, opportunityId: string, now: () => string = () => new Date().toISOString()): MissionRecord {
  const existing = getMissionRecord(ownerUserId, opportunityId)
  if (existing) return existing
  const timestamp = now()
  return upsert({
    ownerUserId,
    opportunityId,
    missionStatus: 'NOT_ASSESSED',
    readinessState: null,
    lastReadinessSnapshotAt: null,
    reportBack: null,
    ledgerVerifiedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    persistence: 'session_only',
    externalActionsExecuted: false,
    durableMemoryWritten: false,
  })
}

export type MissionActionOutcome = { ok: true; record: MissionRecord } | { ok: false; reason: string }

export function syncMissionAssessment(ownerUserId: string, opportunityId: string, readinessState: MissionRecord['readinessState'], hasPreparationPath: boolean, now: () => string = () => new Date().toISOString()): MissionActionOutcome {
  const record = ensureMissionRecord(ownerUserId, opportunityId, now)
  if (!readinessState) return { ok: false, reason: 'readinessState is required to sync an assessment.' }
  const transition = applyMissionAction(record.missionStatus, { type: 'SYNC_ASSESSMENT', readinessState, hasPreparationPath })
  if (!transition.ok) return { ok: false, reason: transition.reason }
  const timestamp = now()
  const updated: MissionRecord = { ...record, missionStatus: transition.status, readinessState, lastReadinessSnapshotAt: timestamp, updatedAt: timestamp }
  return { ok: true, record: upsert(updated) }
}

export function markMissionCommanderActive(ownerUserId: string, opportunityId: string, now: () => string = () => new Date().toISOString()): MissionActionOutcome {
  const record = getMissionRecord(ownerUserId, opportunityId)
  if (!record) return { ok: false, reason: 'No mission record exists for this opportunity yet — run an assessment first.' }
  const transition = applyMissionAction(record.missionStatus, { type: 'COMMANDER_MARK_ACTIVE' })
  if (!transition.ok) return { ok: false, reason: transition.reason }
  const updated: MissionRecord = { ...record, missionStatus: transition.status, updatedAt: now() }
  return { ok: true, record: upsert(updated) }
}

export function submitMissionReportBack(ownerUserId: string, input: ReportBackInput, now: () => string = () => new Date().toISOString()): MissionActionOutcome {
  const record = getMissionRecord(ownerUserId, input.opportunityId)
  if (!record) return { ok: false, reason: 'No mission record exists for this opportunity yet — run an assessment first.' }
  const transition = applyMissionAction(record.missionStatus, { type: 'COMMANDER_REPORT_BACK' })
  if (!transition.ok) return { ok: false, reason: transition.reason }
  const timestamp = now()
  const reportBack: ReportBackRecord = {
    ...input,
    ownerUserId,
    missionStatusAtReport: record.missionStatus,
    reportedAt: timestamp,
    externalActionsExecuted: false,
    durableMemoryWritten: false,
  }
  // Commander-claimed "received" payment status yields OUTCOME_REPORTED, not
  // PAYMENT_VERIFIED — it can only be self-reported as unverified. See
  // checkLedgerVerifiedPayment for the one legitimate path to verified.
  const missionStatus = input.paymentStatus === 'PROMISED' || input.paymentStatus === 'COMMANDER_REPORTED_RECEIVED_UNVERIFIED' ? 'PAYMENT_PENDING' : transition.status
  const updated: MissionRecord = { ...record, missionStatus, reportBack, updatedAt: timestamp }
  return { ok: true, record: upsert(updated) }
}

/**
 * Amount comparisons below use a sub-cent epsilon purely to absorb IEEE-754
 * floating-point summation error (e.g. 0.1 + 0.2 !== 0.3), not to treat
 * materially different amounts as equal. Any real discrepancy (a cent or
 * more) is a mismatch.
 */
const AMOUNT_MATCH_EPSILON = 0.005

/**
 * Read-only linkage into the existing Phase 49-H reward ledger. Never writes
 * to the ledger, never initiates a PayPal action, never mutates Income Loot
 * state.
 *
 * A ledger entry sharing this opportunity's id is NOT by itself sufficient
 * evidence — that would let an unrelated or partial deposit verify a claim
 * it doesn't actually support. Verification requires:
 *  1. at least one CASH_RECEIVED entry for this (ownerUserId, opportunityId), AND
 *  2. the Commander to have reported a specific compensationReceivedClaim
 *     (amount + currency) in their report-back — a generic "some cash was
 *     received" entry with no claim to correlate against is deliberately
 *     NOT auto-verified; that would be guessing, not verifying, and
 *  3. the sum of CASH_RECEIVED entries in the claimed currency to match the
 *     claimed amount. Multiple CASH_RECEIVED entries for the same
 *     (opportunity, currency) are summed — this mirrors the existing
 *     behavior of lib/income-loot/rewardLedger.ts `summarizeRewardLedgerForOwner`,
 *     which already treats repeated CASH_RECEIVED entries for one
 *     opportunity/currency pair as summable split payments, so this is not
 *     new aggregation logic, just reuse of an existing, evidenced model.
 *     Entries in a different currency are never summed into the total.
 *
 * If correlation cannot be established, the mission stays at its current
 * status (PAYMENT_PENDING/OUTCOME_REPORTED) rather than guessing into
 * PAYMENT_VERIFIED. This is the sole path to PAYMENT_VERIFIED.
 */
export function checkLedgerVerifiedPayment(ownerUserId: string, opportunityId: string, now: () => string = () => new Date().toISOString()): MissionActionOutcome {
  const record = getMissionRecord(ownerUserId, opportunityId)
  if (!record) return { ok: false, reason: 'No mission record exists for this opportunity yet.' }

  const entries = listRewardLedgerEntriesForOpportunity(ownerUserId, opportunityId)
  const cashEntries = entries.filter(entry => entry.valueBasis === 'CASH_RECEIVED')
  if (cashEntries.length === 0) return { ok: false, reason: 'No verified CASH_RECEIVED reward-ledger entry exists yet for this opportunity.' }

  const claim = record.reportBack?.compensationReceivedClaim ?? null
  if (!claim || claim.amount === null) {
    return { ok: false, reason: 'A Commander-reported received amount is required to correlate against ledger evidence before payment can be verified. Submit a report-back with compensationReceivedClaim first.' }
  }

  const matchingCurrencyEntries = cashEntries.filter(entry => entry.currency === claim.currency)
  if (matchingCurrencyEntries.length === 0) {
    return { ok: false, reason: `No CASH_RECEIVED reward-ledger entry exists in the claimed currency (${claim.currency}) for this opportunity.` }
  }

  const verifiedTotal = matchingCurrencyEntries.reduce((sum, entry) => sum + entry.amount, 0)
  if (Math.abs(verifiedTotal - claim.amount) > AMOUNT_MATCH_EPSILON) {
    return { ok: false, reason: `Verified reward-ledger total (${verifiedTotal} ${claim.currency}) does not match the Commander-reported received amount (${claim.amount} ${claim.currency}). Payment cannot be verified on a mismatched amount.` }
  }

  const transition = applyMissionAction(record.missionStatus, { type: 'LEDGER_PAYMENT_VERIFIED' })
  if (!transition.ok) return { ok: false, reason: transition.reason }
  const timestamp = now()
  const updated: MissionRecord = { ...record, missionStatus: transition.status, ledgerVerifiedAt: timestamp, updatedAt: timestamp }
  return { ok: true, record: upsert(updated) }
}

export function closeMission(ownerUserId: string, opportunityId: string, now: () => string = () => new Date().toISOString()): MissionActionOutcome {
  const record = getMissionRecord(ownerUserId, opportunityId)
  if (!record) return { ok: false, reason: 'No mission record exists for this opportunity yet.' }
  const transition = applyMissionAction(record.missionStatus, { type: 'COMMANDER_CLOSE' })
  if (!transition.ok) return { ok: false, reason: transition.reason }
  const updated: MissionRecord = { ...record, missionStatus: transition.status, updatedAt: now() }
  return { ok: true, record: upsert(updated) }
}

export function __resetMissionBridgeStore(): void {
  records.splice(0)
}
