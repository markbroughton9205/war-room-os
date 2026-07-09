import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type {
  AutoModeSingleUseLedger,
  AutoModeSingleUseLedgerEntry,
  LedgerConsumeResult,
  LedgerWriteResult,
} from './types'
import { AUTO_MODE_SINGLE_USE_LEDGER_TABLE } from './types'

type SupabaseLedgerClient = Pick<SupabaseClient, 'from'>

type SupabaseLedgerError = {
  code?: string
  message?: string
  details?: string
  hint?: string
}

type LedgerRow = {
  ledger_id: string
  packet_id: string
  explicit_execution_approval_id: string
  receipt_id: string | null
  rollback_packet_id: string | null
  rollback_receipt_id: string | null
  nonce: string
  action_type: 'mark_apple_reminder_read'
  target_system: 'apple_reminders'
  target_id: string
  ledger_entry_kind: AutoModeSingleUseLedgerEntry['ledgerEntryKind']
  status: AutoModeSingleUseLedgerEntry['status']
  created_at: string
  expires_at: string
  consumed_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  verification_hash: string | null
  metadata: AutoModeSingleUseLedgerEntry['metadata']
}

type ConsumeLookupResult = {
  entry: AutoModeSingleUseLedgerEntry | null
  error: LedgerConsumeResult | null
}

export class SupabaseSingleUseLedger implements AutoModeSingleUseLedger {
  constructor(private readonly client: SupabaseLedgerClient) {}

  async issuePacket(entry: AutoModeSingleUseLedgerEntry): Promise<LedgerWriteResult> {
    return this.issue(entry, 'issued')
  }

  async issueRollbackPacket(entry: AutoModeSingleUseLedgerEntry): Promise<LedgerWriteResult> {
    return this.issue(entry, 'rollback_issued')
  }

  async consumePacket(input: {
    packetId: string
    nonce: string
    receiptId: string
    now: string
  }): Promise<LedgerConsumeResult> {
    const { data, error } = await this.client
      .from(AUTO_MODE_SINGLE_USE_LEDGER_TABLE)
      .update({
        status: 'consumed',
        consumed_at: input.now,
        receipt_id: input.receiptId,
      })
      .eq('packet_id', input.packetId)
      .eq('nonce', input.nonce)
      .eq('status', 'issued')
      .gt('expires_at', input.now)
      .select('*')
      .maybeSingle()

    if (error) return this.consumeError(error)
    if (data) return consume(true, 'consumed', rowToEntry(data as LedgerRow), null)

    const receiptReplay = await this.lookupForConsume('receipt_id', input.receiptId)
    if (receiptReplay.error) return receiptReplay.error
    if (receiptReplay.entry) return consume(false, 'receipt_replay', receiptReplay.entry, 'Receipt replay.')

    const existing = await this.lookupForConsume('packet_id', input.packetId)
    if (existing.error) return existing.error
    if (!existing.entry) return consume(false, 'packet_not_found', null, 'Packet not found.')
    if (existing.entry.nonce !== input.nonce) return consume(false, 'nonce_mismatch', existing.entry, 'Nonce mismatch.')
    if (new Date(existing.entry.expiresAt).getTime() <= new Date(input.now).getTime()) {
      await this.markExpired(existing.entry, input.now)
      return consume(false, 'expired', existing.entry, 'Packet expired.')
    }
    return consume(
      false,
      existing.entry.status === 'consumed' ? 'already_consumed' : 'ledger_write_conflict',
      existing.entry,
      'Packet is not consumable.'
    )
  }

  async consumeRollbackPacket(input: {
    rollbackPacketId: string
    nonce: string
    rollbackReceiptId: string
    now: string
  }): Promise<LedgerConsumeResult> {
    const { data, error } = await this.client
      .from(AUTO_MODE_SINGLE_USE_LEDGER_TABLE)
      .update({
        status: 'rollback_consumed',
        consumed_at: input.now,
        rollback_receipt_id: input.rollbackReceiptId,
      })
      .eq('rollback_packet_id', input.rollbackPacketId)
      .eq('nonce', input.nonce)
      .eq('status', 'rollback_issued')
      .gt('expires_at', input.now)
      .select('*')
      .maybeSingle()

    if (error) return this.consumeError(error)
    if (data) return consume(true, 'consumed', rowToEntry(data as LedgerRow), null)

    const receiptReplay = await this.lookupForConsume('rollback_receipt_id', input.rollbackReceiptId)
    if (receiptReplay.error) return receiptReplay.error
    if (receiptReplay.entry) return consume(false, 'receipt_replay', receiptReplay.entry, 'Rollback receipt replay.')

    const existing = await this.lookupForConsume('rollback_packet_id', input.rollbackPacketId)
    if (existing.error) return existing.error
    if (!existing.entry) return consume(false, 'packet_not_found', null, 'Rollback packet not found.')
    if (existing.entry.nonce !== input.nonce) return consume(false, 'nonce_mismatch', existing.entry, 'Nonce mismatch.')
    if (new Date(existing.entry.expiresAt).getTime() <= new Date(input.now).getTime()) {
      await this.markExpired(existing.entry, input.now)
      return consume(false, 'expired', existing.entry, 'Rollback packet expired.')
    }
    return consume(
      false,
      existing.entry.status === 'rollback_consumed' ? 'already_consumed' : 'ledger_write_conflict',
      existing.entry,
      'Rollback packet is not consumable.'
    )
  }

  async getByPacketId(packetId: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    return this.maybeSingle('packet_id', packetId)
  }

  async getByNonce(nonce: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    return this.maybeSingle('nonce', nonce)
  }

  async getByReceiptId(receiptId: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    const receipt = await this.maybeSingle('receipt_id', receiptId)
    if (receipt) return receipt
    return this.maybeSingle('rollback_receipt_id', receiptId)
  }

  private async issue(
    entry: AutoModeSingleUseLedgerEntry,
    status: 'issued' | 'rollback_issued'
  ): Promise<LedgerWriteResult> {
    if (new Date(entry.expiresAt).getTime() <= new Date(entry.createdAt).getTime()) {
      return write(false, 'expired_before_issue', null, 'Entry expired before issue.')
    }

    const { data, error } = await this.client
      .from(AUTO_MODE_SINGLE_USE_LEDGER_TABLE)
      .insert(entryToRow({ ...entry, status }))
      .select('*')
      .single()

    if (error) return this.writeError(error)
    return write(true, 'issued', rowToEntry(data as LedgerRow), null)
  }

  private async markExpired(
    entry: AutoModeSingleUseLedgerEntry,
    now: string
  ): Promise<void> {
    await this.client
      .from(AUTO_MODE_SINGLE_USE_LEDGER_TABLE)
      .update({
        status: 'expired',
        rejected_at: now,
        rejection_reason: 'expired',
      })
      .eq('ledger_id', entry.ledgerId)
      .in('status', ['issued', 'rollback_issued'])
  }

  private async maybeSingle(
    column: string,
    value: string
  ): Promise<AutoModeSingleUseLedgerEntry | null> {
    const { data, error } = await this.client
      .from(AUTO_MODE_SINGLE_USE_LEDGER_TABLE)
      .select('*')
      .eq(column, value)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data ? rowToEntry(data as LedgerRow) : null
  }

  private async lookupForConsume(
    column: string,
    value: string
  ): Promise<ConsumeLookupResult> {
    try {
      return { entry: await this.maybeSingle(column, value), error: null }
    } catch (error) {
      return {
        entry: null,
        error: consume(false, 'consume_failed', null, error instanceof Error ? error.message : 'Lookup failed.'),
      }
    }
  }

  private writeError(error: SupabaseLedgerError): LedgerWriteResult {
    if (isUniqueViolation(error)) {
      const text = `${error.message ?? ''} ${error.details ?? ''}`
      if (text.includes('packet')) return write(false, 'duplicate_packet', null, error.message ?? 'Duplicate packetId.')
      if (text.includes('nonce')) return write(false, 'duplicate_nonce', null, error.message ?? 'Duplicate nonce.')
    }
    return write(false, 'write_failed', null, error.message ?? 'Write failed.')
  }

  private consumeError(error: SupabaseLedgerError): LedgerConsumeResult {
    if (isUniqueViolation(error)) {
      return consume(false, 'receipt_replay', null, error.message ?? 'Receipt replay.')
    }
    return consume(false, 'consume_failed', null, error.message ?? 'Consume failed.')
  }
}

export function createSupabaseSingleUseLedger(): SupabaseSingleUseLedger {
  return new SupabaseSingleUseLedger(createSupabaseAdminClient())
}

function entryToRow(entry: AutoModeSingleUseLedgerEntry): LedgerRow {
  return {
    ledger_id: entry.ledgerId,
    packet_id: entry.packetId,
    explicit_execution_approval_id: entry.explicitExecutionApprovalId,
    receipt_id: entry.receiptId,
    rollback_packet_id: entry.rollbackPacketId,
    rollback_receipt_id: entry.rollbackReceiptId,
    nonce: entry.nonce,
    action_type: entry.actionType,
    target_system: entry.targetSystem,
    target_id: entry.targetId,
    ledger_entry_kind: entry.ledgerEntryKind,
    status: entry.status,
    created_at: entry.createdAt,
    expires_at: entry.expiresAt,
    consumed_at: entry.consumedAt,
    rejected_at: entry.rejectedAt,
    rejection_reason: entry.rejectionReason,
    verification_hash: entry.verificationHash,
    metadata: entry.metadata,
  }
}

function rowToEntry(row: LedgerRow): AutoModeSingleUseLedgerEntry {
  return {
    ledgerId: row.ledger_id,
    packetId: row.packet_id,
    explicitExecutionApprovalId: row.explicit_execution_approval_id,
    receiptId: row.receipt_id,
    rollbackPacketId: row.rollback_packet_id,
    rollbackReceiptId: row.rollback_receipt_id,
    nonce: row.nonce,
    actionType: row.action_type,
    targetSystem: row.target_system,
    targetId: row.target_id,
    ledgerEntryKind: row.ledger_entry_kind,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    verificationHash: row.verification_hash,
    metadata: row.metadata,
  }
}

function isUniqueViolation(error: SupabaseLedgerError): boolean {
  return error.code === '23505'
}

function write(
  ok: boolean,
  status: LedgerWriteResult['status'],
  ledgerEntry: AutoModeSingleUseLedgerEntry | null,
  errorMessage: string | null
): LedgerWriteResult {
  return { ok, status, ledgerEntry, errorMessage }
}

function consume(
  ok: boolean,
  status: LedgerConsumeResult['status'],
  ledgerEntry: AutoModeSingleUseLedgerEntry | null,
  errorMessage: string | null
): LedgerConsumeResult {
  return { ok, status, ledgerEntry, errorMessage }
}
