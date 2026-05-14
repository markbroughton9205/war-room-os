import type { PaymentGuardFinding } from './types'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export async function recordPaymentAudit(
  client: WarRoomSupabase | null,
  message: string,
  metadata: Record<string, unknown> = {},
) {
  await insertWarRoomAuditLog(client, {
    actor: 'system',
    category: 'payment',
    message,
    metadata,
  })
}

export async function recordPaymentGuardFindings(
  client: WarRoomSupabase | null,
  findings: PaymentGuardFinding[],
) {
  if (!client || findings.length === 0) return
  await client.from('war_room_payment_guard_findings').upsert(
    findings.map(finding => ({
      id: finding.id,
      deposit_id: finding.depositId ?? null,
      severity: finding.severity,
      kind: finding.kind,
      message: finding.message,
      blocks_confirmation: finding.blocksConfirmation,
    })),
    { onConflict: 'id' },
  )
}
