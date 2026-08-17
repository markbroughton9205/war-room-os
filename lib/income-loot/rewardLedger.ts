import { REWARD_LEDGER_CONFIRMATION_TYPES, type RewardLedgerConfirmation, type RewardLedgerEntry, type RewardLedgerOwnerSummary, type RewardLedgerProvenance, type RewardLedgerReceipt, type ValueBasis } from './types'
import { getIncomeLootOpportunityForOwner } from './store'

export const INCOME_LOOT_REWARD_LEDGER_PERSISTENCE = 'session_only' as const
export const INCOME_LOOT_REWARD_LEDGER_STORE_CAP = 500

const entries: RewardLedgerEntry[] = []
let nextId = 1

type LedgerEventInput = { ownerUserId: string; opportunityId: string; amount: number; currency: string; provenance: RewardLedgerProvenance; externalEventId?: string | null; notes?: string | null }
export type RecordEstimatedRewardInput = LedgerEventInput
export type RecordConfirmedRewardInput = LedgerEventInput & { confirmation: RewardLedgerConfirmation }
export type RecordCashReceivedInput = LedgerEventInput & { receipt: RewardLedgerReceipt }
export type RewardLedgerRecordResult = { entry: RewardLedgerEntry | null; code: 'RECORDED' | 'OPPORTUNITY_NOT_FOUND' | 'INVALID_AMOUNT' | 'INVALID_CURRENCY' | 'INVALID_PROVENANCE' | 'CONFIRMATION_REQUIRED' | 'INVALID_CONFIRMATION' | 'RECEIPT_REQUIRED' | 'DUPLICATE_EXTERNAL_EVENT' }

function validTimestamp(value: string | null | undefined): value is string { return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value)) }
function validCurrency(value: string): boolean { return /^[A-Z]{3}$/.test(value.trim()) }
function validConfirmation(value: RewardLedgerConfirmation, provenance: RewardLedgerProvenance): boolean {
  if (!REWARD_LEDGER_CONFIRMATION_TYPES.includes(value.type)) return false
  // A manually-sourced event cannot claim provider attribution, and a provider-attributed
  // confirmation type cannot be backed by a manually-sourced event.
  if (value.type === 'commander_manual' && provenance.sourceType !== 'commander_manual') return false
  if (value.type !== 'commander_manual' && provenance.sourceType === 'commander_manual') return false
  return true
}
function validProvenance(value: RewardLedgerProvenance): boolean {
  if (!value || !['web_search', 'provider_api', 'commander_manual', 'historical_fallback'].includes(value.sourceType)) return false
  return value.sourceType !== 'commander_manual' || Boolean(value.actorId?.trim())
}
function baseFailure(input: LedgerEventInput): RewardLedgerRecordResult['code'] | null {
  if (!getIncomeLootOpportunityForOwner(input.ownerUserId, input.opportunityId)) return 'OPPORTUNITY_NOT_FOUND'
  if (!Number.isFinite(input.amount) || input.amount < 0) return 'INVALID_AMOUNT'
  if (!validCurrency(input.currency)) return 'INVALID_CURRENCY'
  if (!validProvenance(input.provenance)) return 'INVALID_PROVENANCE'
  const opportunity = getIncomeLootOpportunityForOwner(input.ownerUserId, input.opportunityId)
  const sourceKey = input.provenance.sourceAdapterId?.trim() || opportunity?.provider || ''
  const externalEventId = input.externalEventId?.trim() || null
  if (externalEventId && entries.some(entry => entry.ownerUserId === input.ownerUserId && (entry.provenance.sourceAdapterId?.trim() || getIncomeLootOpportunityForOwner(entry.ownerUserId, entry.opportunityId)?.provider || '') === sourceKey && entry.externalEventId === externalEventId)) return 'DUPLICATE_EXTERNAL_EVENT'
  return null
}
function record(valueBasis: ValueBasis, input: LedgerEventInput, confirmation: RewardLedgerConfirmation | null, receipt: RewardLedgerReceipt | null, now: () => string = () => new Date().toISOString()): RewardLedgerRecordResult {
  const failure = baseFailure(input)
  if (failure) return { entry: null, code: failure }
  if (valueBasis === 'CONFIRMED') {
    if (!confirmation || !validTimestamp(confirmation.confirmedAt)) return { entry: null, code: 'CONFIRMATION_REQUIRED' }
    if (!validConfirmation(confirmation, input.provenance)) return { entry: null, code: 'INVALID_CONFIRMATION' }
  }
  if (valueBasis === 'CASH_RECEIVED' && (!receipt || !validTimestamp(receipt.receivedAt))) return { entry: null, code: 'RECEIPT_REQUIRED' }
  const opportunity = getIncomeLootOpportunityForOwner(input.ownerUserId, input.opportunityId)!
  const entry: RewardLedgerEntry = { id: `loot_ledger_session_${nextId++}`, ownerUserId: input.ownerUserId, opportunityId: input.opportunityId, providerId: opportunity.provider, category: opportunity.category, currency: input.currency.trim(), amount: input.amount, valueBasis, recordedAt: now(), provenance: { ...input.provenance }, confirmation: confirmation ? { ...confirmation } : null, receipt: receipt ? { ...receipt } : null, externalEventId: input.externalEventId?.trim() || null, notes: input.notes ?? null }
  entries.unshift(entry)
  if (entries.length > INCOME_LOOT_REWARD_LEDGER_STORE_CAP) entries.splice(INCOME_LOOT_REWARD_LEDGER_STORE_CAP)
  return { entry, code: 'RECORDED' }
}

export function recordEstimatedReward(input: RecordEstimatedRewardInput, now?: () => string): RewardLedgerRecordResult { return record('ESTIMATED', input, null, null, now) }
export function recordConfirmedReward(input: RecordConfirmedRewardInput, now?: () => string): RewardLedgerRecordResult { return record('CONFIRMED', input, input.confirmation, null, now) }
export function recordCashReceivedReward(input: RecordCashReceivedInput, now?: () => string): RewardLedgerRecordResult { return record('CASH_RECEIVED', input, null, input.receipt, now) }
export function listRewardLedgerEntriesForOwner(ownerUserId: string): RewardLedgerEntry[] { return entries.filter(entry => entry.ownerUserId === ownerUserId).map(entry => ({ ...entry, provenance: { ...entry.provenance }, confirmation: entry.confirmation ? { ...entry.confirmation } : null, receipt: entry.receipt ? { ...entry.receipt } : null })) }
export function listRewardLedgerEntriesForOpportunity(ownerUserId: string, opportunityId: string): RewardLedgerEntry[] { return listRewardLedgerEntriesForOwner(ownerUserId).filter(entry => entry.opportunityId === opportunityId) }
export function summarizeRewardLedgerForOwner(ownerUserId: string): RewardLedgerOwnerSummary {
  const byCurrency: RewardLedgerOwnerSummary['byCurrency'] = {}
  const byOpportunity = new Map<string, RewardLedgerEntry[]>()
  for (const entry of entries.filter(item => item.ownerUserId === ownerUserId)) { const key = `${entry.opportunityId}:${entry.currency}`; const group = byOpportunity.get(key) ?? []; group.push(entry); byOpportunity.set(key, group) }
  for (const group of byOpportunity.values()) {
    const currency = group[0].currency; const bucket = byCurrency[currency] ?? { estimated: 0, confirmed: 0, cashReceived: 0, confirmedOutstanding: 0 }; byCurrency[currency] = bucket
    const latest = (basis: ValueBasis) => group.find(entry => entry.valueBasis === basis)?.amount ?? null
    const estimated = latest('ESTIMATED'); const confirmed = latest('CONFIRMED'); const cashReceived = group.filter(entry => entry.valueBasis === 'CASH_RECEIVED').reduce((sum, entry) => sum + entry.amount, 0)
    if (estimated !== null) bucket.estimated += estimated
    if (confirmed !== null) bucket.confirmed += confirmed
    bucket.cashReceived += cashReceived
    if (confirmed !== null) bucket.confirmedOutstanding += Math.max(confirmed - cashReceived, 0)
  }
  return { ownerUserId, byCurrency }
}
export function __resetIncomeLootRewardLedger(): void { entries.splice(0); nextId = 1 }
