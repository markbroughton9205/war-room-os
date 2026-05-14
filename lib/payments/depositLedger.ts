import type { DepositRecord, DepositStatus, NotificationStatus, PaymentProviderId, ProofStatus, RiskStatus } from './types'

const DEPOSIT_LEDGER_KEY = '__warRoomDepositLedger'

type DepositLedgerGlobal = typeof globalThis & {
  [DEPOSIT_LEDGER_KEY]?: Map<string, DepositRecord>
}

function depositStore() {
  const g = globalThis as DepositLedgerGlobal
  if (!g[DEPOSIT_LEDGER_KEY]) {
    g[DEPOSIT_LEDGER_KEY] = new Map<string, DepositRecord>()
  }
  return g[DEPOSIT_LEDGER_KEY]
}

function now() {
  return new Date().toISOString()
}

function makeDepositId(seed: string) {
  const normalized = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
  return `deposit_${normalized || Date.now().toString(36)}`
}

function amountFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

export function listDeposits() {
  return [...depositStore().values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getDeposit(depositId: string) {
  return depositStore().get(depositId) ?? null
}

export function createExpectedDeposit(input: {
  opportunityId?: string | null
  incomeWorkerId?: string | null
  platformProvider?: PaymentProviderId | string
  payerPlatformName?: string
  expectedAmount?: number | string | null
  currency?: string | null
  expectedDate?: string | null
  proofRequired?: boolean
}) {
  const timestamp = now()
  const opportunityId = input.opportunityId ?? null
  const incomeWorkerId = input.incomeWorkerId ?? null
  const expectedAmount = amountFrom(input.expectedAmount)
  const depositId = makeDepositId(`${opportunityId ?? input.payerPlatformName ?? 'manual'}-${incomeWorkerId ?? 'worker'}-${expectedAmount ?? 'unknown'}`)
  const store = depositStore()
  const existing = store.get(depositId)
  if (existing) return existing

  const record: DepositRecord = {
    depositId,
    opportunityId,
    incomeWorkerId,
    platformProvider: input.platformProvider ?? 'manual_proof',
    payerPlatformName: input.payerPlatformName ?? 'Unknown platform',
    expectedAmount,
    confirmedAmount: null,
    currency: (input.currency ?? 'USD').toUpperCase(),
    expectedDate: input.expectedDate ?? null,
    confirmedDate: null,
    proofRequired: input.proofRequired ?? true,
    proofStatus: input.proofRequired === false ? 'not_required' : 'required',
    proofUrl: null,
    proofMetadata: null,
    depositStatus: input.proofRequired === false ? 'expected' : 'pending_proof',
    notificationStatus: 'not_sent',
    riskStatus: 'clear',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  store.set(record.depositId, record)
  return record
}

export function updateDeposit(
  depositId: string,
  updates: Partial<Pick<DepositRecord,
    | 'confirmedAmount'
    | 'confirmedDate'
    | 'proofUrl'
    | 'proofMetadata'
    | 'depositStatus'
    | 'notificationStatus'
    | 'proofStatus'
    | 'riskStatus'
  >>,
) {
  const store = depositStore()
  const existing = store.get(depositId)
  if (!existing) return null
  const next: DepositRecord = { ...existing, ...updates, updatedAt: now() }
  store.set(depositId, next)
  return next
}

export function setDepositNotificationStatus(depositId: string, notificationStatus: NotificationStatus) {
  return notificationStatus === 'sent'
    ? updateDeposit(depositId, { notificationStatus, depositStatus: 'notified' })
    : updateDeposit(depositId, { notificationStatus })
}

export function setDepositRiskStatus(depositId: string, riskStatus: RiskStatus) {
  return updateDeposit(depositId, { riskStatus })
}

export function submitDepositProof(depositId: string, proof: { proofUrl?: string | null; proofMetadata?: Record<string, unknown> | null }) {
  return updateDeposit(depositId, {
    proofUrl: proof.proofUrl ?? null,
    proofMetadata: proof.proofMetadata ?? null,
    proofStatus: 'submitted' as ProofStatus,
    depositStatus: 'proof_submitted' as DepositStatus,
  })
}
