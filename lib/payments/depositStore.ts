import {
  createExpectedDeposit,
  getDeposit,
  listDeposits,
  setDepositNotificationStatus,
  submitDepositProof,
  updateDeposit,
} from './depositLedger'
import type { DepositRecord, PaymentProviderId } from './types'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export type DepositPersistence = 'supabase' | 'session-only'

export type DepositStoreResult<T> = {
  data: T
  persistence: DepositPersistence
  message?: string
}

type DepositRow = {
  deposit_id: string
  opportunity_id: string | null
  income_worker_id: string | null
  provider: string
  payer_name: string
  expected_amount: number | null
  confirmed_amount: number | null
  currency: string
  expected_date: string | null
  confirmed_date: string | null
  proof_required: boolean
  proof_status: DepositRecord['proofStatus']
  deposit_status: DepositRecord['depositStatus']
  notification_status: DepositRecord['notificationStatus']
  risk_status: DepositRecord['riskStatus']
  created_at: string
  updated_at: string
}

type ProofRow = {
  proof_url: string | null
  proof_metadata: Record<string, unknown> | null
  proof_status: string
  created_at: string
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

function rowToDeposit(row: DepositRow, proof?: ProofRow | null): DepositRecord {
  return {
    depositId: row.deposit_id,
    opportunityId: row.opportunity_id,
    incomeWorkerId: row.income_worker_id,
    platformProvider: row.provider,
    payerPlatformName: row.payer_name,
    expectedAmount: row.expected_amount,
    confirmedAmount: row.confirmed_amount,
    currency: row.currency,
    expectedDate: row.expected_date,
    confirmedDate: row.confirmed_date,
    proofRequired: row.proof_required,
    proofStatus: row.proof_status,
    proofUrl: proof?.proof_url ?? null,
    proofMetadata: proof?.proof_metadata ?? null,
    depositStatus: row.deposit_status,
    notificationStatus: row.notification_status,
    riskStatus: row.risk_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function latestProofs(client: WarRoomSupabase, depositIds: string[]) {
  if (depositIds.length === 0) return new Map<string, ProofRow>()
  const { data } = await client
    .from('war_room_deposit_proofs')
    .select('deposit_id,proof_url,proof_metadata,proof_status,created_at')
    .in('deposit_id', depositIds)
    .order('created_at', { ascending: false })
  const map = new Map<string, ProofRow>()
  for (const row of data ?? []) {
    const depositId = String(row.deposit_id)
    if (!map.has(depositId)) {
      map.set(depositId, {
        proof_url: row.proof_url ?? null,
        proof_metadata: row.proof_metadata ?? null,
        proof_status: String(row.proof_status),
        created_at: String(row.created_at),
      })
    }
  }
  return map
}

function fallback<T>(data: T, message?: string): DepositStoreResult<T> {
  return { data, persistence: 'session-only', message }
}

function getClient() {
  const sup = tryWarRoomSupabase()
  return sup.ok ? sup.client : null
}

export async function listDepositRecords(): Promise<DepositStoreResult<DepositRecord[]>> {
  const client = getClient()
  if (!client) return fallback(listDeposits(), 'Supabase unavailable. Using session-only fallback.')

  const { data, error } = await client
    .from('war_room_deposits')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) return fallback(listDeposits(), error.message)
  const rows = (data ?? []) as DepositRow[]
  const proofs = await latestProofs(client, rows.map(row => row.deposit_id))
  return { data: rows.map(row => rowToDeposit(row, proofs.get(row.deposit_id))), persistence: 'supabase' }
}

export async function getDepositRecord(depositId: string): Promise<DepositStoreResult<DepositRecord | null>> {
  const client = getClient()
  if (!client) return fallback(getDeposit(depositId), 'Supabase unavailable. Using session-only fallback.')

  const { data, error } = await client
    .from('war_room_deposits')
    .select('*')
    .eq('deposit_id', depositId)
    .maybeSingle()

  if (error) return fallback(getDeposit(depositId), error.message)
  if (!data) return { data: null, persistence: 'supabase' }
  const proofs = await latestProofs(client, [depositId])
  return { data: rowToDeposit(data as DepositRow, proofs.get(depositId)), persistence: 'supabase' }
}

export async function createExpectedDepositRecord(input: {
  opportunityId?: string | null
  incomeWorkerId?: string | null
  platformProvider?: PaymentProviderId | string
  payerPlatformName?: string
  expectedAmount?: number | string | null
  currency?: string | null
  expectedDate?: string | null
  proofRequired?: boolean
}): Promise<DepositStoreResult<DepositRecord>> {
  const client = getClient()
  const fallbackDeposit = () => createExpectedDeposit(input)
  if (!client) return fallback(fallbackDeposit(), 'Supabase unavailable. Using session-only fallback.')

  const opportunityId = input.opportunityId ?? null
  const incomeWorkerId = input.incomeWorkerId ?? null
  const expectedAmount = amountFrom(input.expectedAmount)
  const depositId = makeDepositId(`${opportunityId ?? input.payerPlatformName ?? 'manual'}-${incomeWorkerId ?? 'worker'}-${expectedAmount ?? 'unknown'}`)
  const proofRequired = input.proofRequired ?? true
  const row = {
    deposit_id: depositId,
    opportunity_id: opportunityId,
    income_worker_id: incomeWorkerId,
    provider: input.platformProvider ?? 'manual_proof',
    payer_name: input.payerPlatformName ?? 'Unknown platform',
    expected_amount: expectedAmount,
    confirmed_amount: null,
    currency: (input.currency ?? 'USD').toUpperCase(),
    expected_date: input.expectedDate ?? null,
    confirmed_date: null,
    proof_required: proofRequired,
    proof_status: proofRequired ? 'required' : 'not_required',
    deposit_status: proofRequired ? 'pending_proof' : 'expected',
    notification_status: 'not_sent',
    risk_status: 'clear',
  }

  const { data, error } = await client
    .from('war_room_deposits')
    .upsert(row, { onConflict: 'deposit_id' })
    .select('*')
    .single()

  if (error) return fallback(fallbackDeposit(), error.message)
  return { data: rowToDeposit(data as DepositRow), persistence: 'supabase' }
}

export async function updateDepositRecord(
  depositId: string,
  updates: Partial<Pick<DepositRecord, 'confirmedAmount' | 'confirmedDate' | 'depositStatus' | 'notificationStatus' | 'proofStatus' | 'riskStatus'>>,
): Promise<DepositStoreResult<DepositRecord | null>> {
  const client = getClient()
  if (!client) return fallback(updateDeposit(depositId, updates), 'Supabase unavailable. Using session-only fallback.')

  const row: Record<string, unknown> = {}
  if (updates.confirmedAmount !== undefined) row.confirmed_amount = updates.confirmedAmount
  if (updates.confirmedDate !== undefined) row.confirmed_date = updates.confirmedDate
  if (updates.depositStatus !== undefined) row.deposit_status = updates.depositStatus
  if (updates.notificationStatus !== undefined) row.notification_status = updates.notificationStatus
  if (updates.proofStatus !== undefined) row.proof_status = updates.proofStatus
  if (updates.riskStatus !== undefined) row.risk_status = updates.riskStatus

  const { data, error } = await client
    .from('war_room_deposits')
    .update(row)
    .eq('deposit_id', depositId)
    .select('*')
    .maybeSingle()

  if (error) return fallback(updateDeposit(depositId, updates), error.message)
  if (!data) return { data: null, persistence: 'supabase' }
  const proofs = await latestProofs(client, [depositId])
  return { data: rowToDeposit(data as DepositRow, proofs.get(depositId)), persistence: 'supabase' }
}

export async function submitDepositProofRecord(
  depositId: string,
  proof: { proofUrl?: string | null; proofMetadata?: Record<string, unknown> | null },
): Promise<DepositStoreResult<DepositRecord | null>> {
  const client = getClient()
  if (!client) return fallback(submitDepositProof(depositId, proof), 'Supabase unavailable. Using session-only fallback.')

  const { error: proofError } = await client.from('war_room_deposit_proofs').insert({
    deposit_id: depositId,
    proof_url: proof.proofUrl ?? null,
    proof_metadata: proof.proofMetadata ?? {},
    proof_status: 'submitted',
  })
  if (proofError) return fallback(submitDepositProof(depositId, proof), proofError.message)

  return updateDepositRecord(depositId, {
    proofStatus: 'submitted',
    depositStatus: 'proof_submitted',
  })
}

export async function recordDepositNotification(
  depositId: string,
  notificationStatus: 'queued' | 'sent' | 'failed',
  message?: string,
): Promise<DepositStoreResult<DepositRecord | null>> {
  const client = getClient()
  if (!client) return fallback(setDepositNotificationStatus(depositId, notificationStatus), 'Supabase unavailable. Using session-only fallback.')

  const { error } = await client.from('war_room_deposit_notifications').insert({
    deposit_id: depositId,
    notification_status: notificationStatus,
    message: message ?? null,
  })
  if (error) return fallback(setDepositNotificationStatus(depositId, notificationStatus), error.message)

  return updateDepositRecord(depositId, notificationStatus === 'sent'
    ? { notificationStatus, depositStatus: 'notified' }
    : { notificationStatus })
}
