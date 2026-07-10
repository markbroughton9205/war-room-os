import { randomUUID } from 'crypto'
import { AppleReminderActionPacketFactory } from '../apple-reminders-bridge'
import { createValidPacketInput } from '../apple-reminders-bridge/appleReminderFixtures'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { InMemoryDurableSingleUseLedger } from './InMemoryDurableSingleUseLedger'
import { AUTO_MODE_SINGLE_USE_LEDGER_TABLE } from './types'
import type { LedgerValidationResult } from './types'
import { ledgerEntryFromApplePacket } from './ledgerEntryFactory'
import { SupabaseSingleUseLedger } from './SupabaseSingleUseLedger'

const PREFIX = 'gate46oh-uuid-'

export async function runLedgerUuidRegressionValidation(): Promise<LedgerValidationResult[]> {
  return [
    await defaultLedgerIdIsUuid(),
    await explicitValidUuidOverrideWorks(),
    await malformedOverrideFailsAtSupabaseBoundary(),
    await legacyStringLedgerRowsStillReadInLegacyLedger(),
    await packetNonceApprovalRemainUnchanged(),
  ]
}

async function defaultLedgerIdIsUuid(): Promise<LedgerValidationResult> {
  const packet = createPacket('default')
  const entry = ledgerEntryFromApplePacket(packet)
  return validation(
    'gate46oh_uuid_default',
    'ledgerEntryFactory generates a valid UUID ledgerId by default.',
    'valid_uuid',
    isUuid(entry.ledgerId) ? 'valid_uuid' : `not_uuid:${entry.ledgerId}`,
    []
  )
}

async function explicitValidUuidOverrideWorks(): Promise<LedgerValidationResult> {
  const packet = createPacket('override')
  const override = randomUUID()
  const entry = ledgerEntryFromApplePacket(packet, { ledgerId: override })
  return validation(
    'gate46oh_uuid_valid_override',
    'Explicit valid UUID ledgerId override is preserved.',
    override,
    entry.ledgerId,
    []
  )
}

async function malformedOverrideFailsAtSupabaseBoundary(): Promise<LedgerValidationResult> {
  const client = createSupabaseAdminClient()
  await cleanup(client)
  try {
    const packet = createPacket('malformed')
    const entry = ledgerEntryFromApplePacket(packet, { ledgerId: `${PREFIX}not-a-uuid` })
    const result = await new SupabaseSingleUseLedger(client).issuePacket(entry)
    const observed = result.ok === false && result.status === 'write_failed'
      ? 'supabase_boundary_rejected_malformed_uuid'
      : `unexpected:${result.status}`
    return validation(
      'gate46oh_uuid_malformed_override',
      'Malformed ledgerId override fails at the Supabase UUID boundary; factory preserves caller override.',
      'supabase_boundary_rejected_malformed_uuid',
      observed,
      ['Validation intentionally lives at the Supabase UUID column boundary for explicit overrides.']
    )
  } finally {
    await cleanup(client)
  }
}

async function legacyStringLedgerRowsStillReadInLegacyLedger(): Promise<LedgerValidationResult> {
  const packet = createPacket('legacy')
  const legacyLedgerId = `ledger_${packet.packetId}`
  const entry = ledgerEntryFromApplePacket(packet, { ledgerId: legacyLedgerId })
  const ledger = new InMemoryDurableSingleUseLedger()
  await ledger.issuePacket(entry)
  const read = await ledger.getByPacketId(packet.packetId)
  return validation(
    'gate46oh_uuid_legacy_read',
    'Legacy string ledger IDs from pre-UUID factory still read correctly in the legacy/in-memory ledger path.',
    legacyLedgerId,
    read?.ledgerId ?? 'missing',
    ['Supabase production rows use UUID ledger_id; this backwards compatibility case applies to legacy non-Supabase ledger entries.']
  )
}

async function packetNonceApprovalRemainUnchanged(): Promise<LedgerValidationResult> {
  const packet = createPacket('identity')
  const entry = ledgerEntryFromApplePacket(packet)
  const observed = entry.packetId === packet.packetId &&
    entry.nonce === packet.constraints.nonce &&
    entry.explicitExecutionApprovalId === packet.explicitExecutionApprovalId
    ? 'packet_nonce_approval_unchanged'
    : `packet=${entry.packetId};nonce=${entry.nonce};approval=${entry.explicitExecutionApprovalId}`
  return validation(
    'gate46oh_uuid_identity_fields',
    'packetId, nonce, and approvalId remain unchanged through ledgerEntryFactory.',
    'packet_nonce_approval_unchanged',
    observed,
    []
  )
}

function createPacket(label: string) {
  const result = new AppleReminderActionPacketFactory().create(createValidPacketInput({
    packetId: `${PREFIX}packet-${label}`,
  }))
  if (!result.packet) throw new Error(result.blockedReason ?? 'Packet fixture creation failed.')
  return result.packet
}

async function cleanup(client: ReturnType<typeof createSupabaseAdminClient>): Promise<void> {
  const { error } = await client
    .from(AUTO_MODE_SINGLE_USE_LEDGER_TABLE)
    .delete()
    .or([
      `packet_id.like.${PREFIX}%`,
      `explicit_execution_approval_id.like.${PREFIX}%`,
      `nonce.like.${PREFIX}%`,
      `target_id.like.${PREFIX}%`,
    ].join(','))

  if (error) throw new Error(`UUID regression cleanup failed: ${error.message}`)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validation(
  caseId: string,
  description: string,
  expected: string,
  observed: string,
  notes: string[]
): LedgerValidationResult {
  return {
    caseId,
    description,
    expected,
    observed,
    result: expected === observed ? 'PASS' : 'FAIL',
    notes,
  }
}
