import { mkdir, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { foundryDataHierarchy } from '../foundryPaths'
import type { ExternalAuditRecord } from './types'

const SECRET = /password|token|secret|cookie|authorization|clipboard|private[_-]?key/i

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    if (SECRET.test(value)) return '[REDACTED]'
    return value.slice(0, 400)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET.test(key) ? '[REDACTED]' : redact(item)
    }
    return out
  }
  return value
}

export async function auditExternalAction(record: ExternalAuditRecord): Promise<void> {
  const safe = redact(record) as ExternalAuditRecord
  const dirs = foundryDataHierarchy()
  const dir = path.join(dirs.operations, 'external-app')
  await mkdir(dir, { recursive: true })
  await appendFile(path.join(dir, 'audit.jsonl'), `${JSON.stringify(safe)}\n`, 'utf8')
  await logWarRoomRepoAudit('engineer: external_app', safe)
}
