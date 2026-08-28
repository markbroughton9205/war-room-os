import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'

const SECRET_VALUE = /((?:api[_-]?key|token|secret|password|authorization|cookie)\s*[=:]\s*)([^\s,;]+)/gi
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+/gi

function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '$1[REDACTED]').replace(BEARER, 'Bearer [REDACTED]')
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /secret|token|password|key|cookie|authorization/i.test(key) ? '[REDACTED]' : redact(item)]))
  }
  return value
}

async function appendTamperEvidentAudit(message: string, metadata: Record<string, unknown>): Promise<void> {
  const file = path.join(resolveBaseRepoRoot(), '.war-room', 'audit', 'code-operator.jsonl')
  await mkdir(path.dirname(file), { recursive: true })
  let previousHash = 'GENESIS'
  try {
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    const previous = JSON.parse(lines.at(-1) ?? '{}') as { hash?: string }
    previousHash = previous.hash ?? previousHash
  } catch { /* first event */ }
  const event = { at: new Date().toISOString(), actor: 'system', category: 'repo', message: redact(message), metadata: redact(metadata), previousHash }
  const hash = createHash('sha256').update(JSON.stringify(event)).digest('hex')
  await appendFile(file, `${JSON.stringify({ ...event, hash })}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function logWarRoomRepoAudit(message: string, metadata: Record<string, unknown> = {}) {
  await appendTamperEvidentAudit(message, metadata)
  const sup = tryWarRoomSupabase()
  await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
    actor: 'system',
    category: 'repo',
    message: redact(message) as string,
    metadata: redact(metadata) as Record<string, unknown>,
  })
}
