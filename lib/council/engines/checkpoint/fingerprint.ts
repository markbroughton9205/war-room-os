import { createHash } from 'node:crypto'

export function fingerprintAction(action: string, taskId: string, payload = ''): string {
  return createHash('sha256').update(`${taskId}|${action}|${payload}`).digest('hex').slice(0, 24)
}
