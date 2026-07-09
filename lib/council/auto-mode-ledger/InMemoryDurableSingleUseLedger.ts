import type {
  AutoModeSingleUseLedger,
  AutoModeSingleUseLedgerEntry,
  LedgerConsumeResult,
  LedgerWriteResult,
} from './types'

export type InMemoryLedgerState = {
  entries: Map<string, AutoModeSingleUseLedgerEntry>
}

export function createInMemoryLedgerState(): InMemoryLedgerState {
  return { entries: new Map() }
}

export class InMemoryDurableSingleUseLedger implements AutoModeSingleUseLedger {
  constructor(private readonly state: InMemoryLedgerState = createInMemoryLedgerState()) {}

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
    const entry = this.findByPacketId(input.packetId)
    if (!entry) return consume(false, 'packet_not_found', null, 'Packet not found.')
    if (entry.nonce !== input.nonce) return consume(false, 'nonce_mismatch', entry, 'Nonce mismatch.')
    if (this.findByReceiptId(input.receiptId)) {
      return consume(false, 'receipt_replay', entry, 'Receipt replay.')
    }
    if (new Date(entry.expiresAt).getTime() <= new Date(input.now).getTime()) {
      const expired = { ...entry, status: 'expired' as const, rejectedAt: input.now, rejectionReason: 'expired' }
      this.state.entries.set(entry.ledgerId, expired)
      return consume(false, 'expired', expired, 'Packet expired.')
    }
    if (entry.status !== 'issued') {
      return consume(false, entry.status === 'consumed' ? 'already_consumed' : 'ledger_write_conflict', entry, 'Packet is not consumable.')
    }
    const consumed: AutoModeSingleUseLedgerEntry = {
      ...entry,
      receiptId: input.receiptId,
      status: 'consumed',
      consumedAt: input.now,
    }
    this.state.entries.set(entry.ledgerId, consumed)
    return consume(true, 'consumed', consumed, null)
  }

  async consumeRollbackPacket(input: {
    rollbackPacketId: string
    nonce: string
    rollbackReceiptId: string
    now: string
  }): Promise<LedgerConsumeResult> {
    const entry = [...this.state.entries.values()].find(
      candidate => candidate.rollbackPacketId === input.rollbackPacketId
    ) ?? null
    if (!entry) return consume(false, 'packet_not_found', null, 'Rollback packet not found.')
    if (entry.nonce !== input.nonce) return consume(false, 'nonce_mismatch', entry, 'Nonce mismatch.')
    if ([...this.state.entries.values()].some(candidate => candidate.rollbackReceiptId === input.rollbackReceiptId)) {
      return consume(false, 'receipt_replay', entry, 'Rollback receipt replay.')
    }
    if (new Date(entry.expiresAt).getTime() <= new Date(input.now).getTime()) {
      const expired = { ...entry, status: 'expired' as const, rejectedAt: input.now, rejectionReason: 'expired' }
      this.state.entries.set(entry.ledgerId, expired)
      return consume(false, 'expired', expired, 'Rollback packet expired.')
    }
    if (entry.status !== 'rollback_issued') {
      return consume(false, entry.status === 'rollback_consumed' ? 'already_consumed' : 'ledger_write_conflict', entry, 'Rollback packet is not consumable.')
    }
    const consumed: AutoModeSingleUseLedgerEntry = {
      ...entry,
      rollbackReceiptId: input.rollbackReceiptId,
      status: 'rollback_consumed',
      consumedAt: input.now,
    }
    this.state.entries.set(entry.ledgerId, consumed)
    return consume(true, 'consumed', consumed, null)
  }

  async getByPacketId(packetId: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    return this.findByPacketId(packetId)
  }

  async getByNonce(nonce: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    return [...this.state.entries.values()].find(entry => entry.nonce === nonce) ?? null
  }

  async getByReceiptId(receiptId: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    return this.findByReceiptId(receiptId)
  }

  private async issue(
    entry: AutoModeSingleUseLedgerEntry,
    issuedStatus: 'issued' | 'rollback_issued'
  ): Promise<LedgerWriteResult> {
    const now = new Date(entry.createdAt).getTime()
    if (new Date(entry.expiresAt).getTime() <= now) {
      return write(false, 'expired_before_issue', null, 'Entry expired before issue.')
    }
    if (this.findByPacketId(entry.packetId)) {
      return write(false, 'duplicate_packet', null, 'Duplicate packetId.')
    }
    if ([...this.state.entries.values()].find(candidate => candidate.nonce === entry.nonce)) {
      return write(false, 'duplicate_nonce', null, 'Duplicate nonce.')
    }
    const issued = { ...entry, status: issuedStatus }
    this.state.entries.set(issued.ledgerId, issued)
    return write(true, 'issued', issued, null)
  }

  private findByPacketId(packetId: string): AutoModeSingleUseLedgerEntry | null {
    return [...this.state.entries.values()].find(entry => entry.packetId === packetId) ?? null
  }

  private findByReceiptId(receiptId: string): AutoModeSingleUseLedgerEntry | null {
    return [...this.state.entries.values()].find(entry =>
      entry.receiptId === receiptId || entry.rollbackReceiptId === receiptId
    ) ?? null
  }
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
