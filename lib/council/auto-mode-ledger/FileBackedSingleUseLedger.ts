import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type {
  AutoModeSingleUseLedger,
  AutoModeSingleUseLedgerEntry,
  LedgerConsumeResult,
  LedgerWriteResult,
} from './types'

type LedgerFileState = {
  version: 1
  entries: AutoModeSingleUseLedgerEntry[]
}

const LOCK_STALE_AFTER_MS = 30_000
const LOCK_RETRY_DELAY_MS = 5

export class FileBackedSingleUseLedger implements AutoModeSingleUseLedger {
  private operationQueue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async issuePacket(entry: AutoModeSingleUseLedgerEntry): Promise<LedgerWriteResult> {
    return this.withLock(async () => this.withFileLock(async () => this.issue(entry, 'issued')))
  }

  async issueRollbackPacket(entry: AutoModeSingleUseLedgerEntry): Promise<LedgerWriteResult> {
    return this.withLock(async () => this.withFileLock(async () => this.issue(entry, 'rollback_issued')))
  }

  async consumePacket(input: {
    packetId: string
    nonce: string
    receiptId: string
    now: string
  }): Promise<LedgerConsumeResult> {
    return this.withLock(async () => this.withFileLock(async () => {
      const state = await this.readState()
      const receiptEntry = findByReceiptId(state.entries, input.receiptId)
      if (receiptEntry) return consume(false, 'receipt_replay', receiptEntry, 'Receipt replay.')

      const entry = findByPacketId(state.entries, input.packetId)
      if (!entry) return consume(false, 'packet_not_found', null, 'Packet not found.')
      if (entry.nonce !== input.nonce) return consume(false, 'nonce_mismatch', entry, 'Nonce mismatch.')
      if (new Date(entry.expiresAt).getTime() <= new Date(input.now).getTime()) {
        const expired = {
          ...entry,
          status: 'expired' as const,
          rejectedAt: input.now,
          rejectionReason: 'expired',
        }
        await this.replaceEntry(state, expired)
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
      await this.replaceEntry(state, consumed)
      return consume(true, 'consumed', consumed, null)
    }))
  }

  async consumeRollbackPacket(input: {
    rollbackPacketId: string
    nonce: string
    rollbackReceiptId: string
    now: string
  }): Promise<LedgerConsumeResult> {
    return this.withLock(async () => this.withFileLock(async () => {
      const state = await this.readState()
      const receiptEntry = findByReceiptId(state.entries, input.rollbackReceiptId)
      if (receiptEntry) return consume(false, 'receipt_replay', receiptEntry, 'Rollback receipt replay.')

      const entry = state.entries.find(candidate => candidate.rollbackPacketId === input.rollbackPacketId) ?? null
      if (!entry) return consume(false, 'packet_not_found', null, 'Rollback packet not found.')
      if (entry.nonce !== input.nonce) return consume(false, 'nonce_mismatch', entry, 'Nonce mismatch.')
      if (new Date(entry.expiresAt).getTime() <= new Date(input.now).getTime()) {
        const expired = {
          ...entry,
          status: 'expired' as const,
          rejectedAt: input.now,
          rejectionReason: 'expired',
        }
        await this.replaceEntry(state, expired)
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
      await this.replaceEntry(state, consumed)
      return consume(true, 'consumed', consumed, null)
    }))
  }

  async getByPacketId(packetId: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    const state = await this.readState()
    return findByPacketId(state.entries, packetId)
  }

  async getByNonce(nonce: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    const state = await this.readState()
    return state.entries.find(entry => entry.nonce === nonce) ?? null
  }

  async getByReceiptId(receiptId: string): Promise<AutoModeSingleUseLedgerEntry | null> {
    const state = await this.readState()
    return findByReceiptId(state.entries, receiptId)
  }

  private async issue(
    entry: AutoModeSingleUseLedgerEntry,
    issuedStatus: 'issued' | 'rollback_issued'
  ): Promise<LedgerWriteResult> {
    const state = await this.readState()
    const now = new Date(entry.createdAt).getTime()
    if (new Date(entry.expiresAt).getTime() <= now) {
      return write(false, 'expired_before_issue', null, 'Entry expired before issue.')
    }
    if (findByPacketId(state.entries, entry.packetId)) {
      return write(false, 'duplicate_packet', null, 'Duplicate packetId.')
    }
    if (state.entries.find(candidate => candidate.nonce === entry.nonce)) {
      return write(false, 'duplicate_nonce', null, 'Duplicate nonce.')
    }

    const issued = { ...entry, status: issuedStatus }
    await this.writeState({ ...state, entries: [...state.entries, issued] })
    return write(true, 'issued', issued, null)
  }

  private async replaceEntry(
    state: LedgerFileState,
    entry: AutoModeSingleUseLedgerEntry
  ): Promise<void> {
    await this.writeState({
      ...state,
      entries: state.entries.map(candidate =>
        candidate.ledgerId === entry.ledgerId ? entry : candidate
      ),
    })
  }

  private async readState(): Promise<LedgerFileState> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<LedgerFileState>
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        return { version: 1, entries: [] }
      }
      return { version: 1, entries: parsed.entries }
    } catch (error) {
      if (isMissingFileError(error)) return { version: 1, entries: [] }
      throw error
    }
  }

  private async writeState(state: LedgerFileState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation)
    this.operationQueue = run.catch(() => undefined)
    return run
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockDir = `${this.filePath}.lock`
    await this.acquireFileLock(lockDir)
    try {
      return await operation()
    } finally {
      await rm(lockDir, { recursive: true, force: true })
    }
  }

  private async acquireFileLock(lockDir: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })

    for (;;) {
      try {
        await mkdir(lockDir)
        await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }), 'utf8')
        return
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error
      }

      if (await this.tryReclaimStaleLock(lockDir)) continue
      await delay(LOCK_RETRY_DELAY_MS)
    }
  }

  private async tryReclaimStaleLock(lockDir: string): Promise<boolean> {
    const lockStats = await stat(lockDir).catch(error => {
      if (isMissingFileError(error)) return null
      throw error
    })
    if (!lockStats) return true

    const ageMs = Date.now() - lockStats.mtimeMs
    if (ageMs < LOCK_STALE_AFTER_MS) return false

    const staleDir = `${lockDir}.stale.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
    try {
      await rename(lockDir, staleDir)
      await rm(staleDir, { recursive: true, force: true })
      return true
    } catch (error) {
      if (isMissingFileError(error) || isAlreadyExistsError(error)) return true
      throw error
    }
  }
}

function findByPacketId(
  entries: AutoModeSingleUseLedgerEntry[],
  packetId: string
): AutoModeSingleUseLedgerEntry | null {
  return entries.find(entry => entry.packetId === packetId) ?? null
}

function findByReceiptId(
  entries: AutoModeSingleUseLedgerEntry[],
  receiptId: string
): AutoModeSingleUseLedgerEntry | null {
  return entries.find(entry =>
    entry.receiptId === receiptId || entry.rollbackReceiptId === receiptId
  ) ?? null
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ENOENT'
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'EEXIST'
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
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
