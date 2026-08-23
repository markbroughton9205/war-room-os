import { createHash } from 'node:crypto'
import type { CorroboratedSettlement } from './corroborationTypes'

const emitted = new Set<string>()
export function generateSettlementNotification(record: CorroboratedSettlement) {
  const verified = Object.values(record.fields).filter(field => field.status === 'VERIFIED').map(field => field.field).sort()
  const fingerprint = createHash('sha256').update(JSON.stringify({ key: record.key, corroboration: record.corroboration, verified, deadlines: record.discoveries.map(x => x.deadline) })).digest('hex')
  if (emitted.has(fingerprint)) return null
  emitted.add(fingerprint)
  return { id: fingerprint.slice(0, 20), persistence: 'SESSION_ONLY' as const, externalDelivery: 'NOT_ATTEMPTED' as const, body: `DISCOVERY ONLY — ${record.discoveries[0]?.title ?? record.key}. ${record.corroboration}. Officially verified fields: ${verified.join(', ') || 'none'}. Confirm every claim detail on the official source.` }
}
export const __resetSettlementNotificationsForTests = () => emitted.clear()
