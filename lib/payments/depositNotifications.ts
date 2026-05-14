import { setDepositNotificationStatus } from './depositLedger'

export function queueDepositNotification(depositId: string) {
  const updated = setDepositNotificationStatus(depositId, 'queued')
  return updated
}

export function markDepositNotificationSent(depositId: string) {
  return setDepositNotificationStatus(depositId, 'sent')
}
