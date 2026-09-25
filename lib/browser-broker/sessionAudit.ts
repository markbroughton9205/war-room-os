/**
 * Redacted browser session audit. Never logs passwords, cookies, tokens, or typed secrets.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { redactSecretsFromOutput } from '@/lib/native-builder/outputRedaction'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { tightenFileMode } from '@/lib/sovereign-runtime/local-ownership/paths'
import { browserBrokerDataDirs } from './paths'
import type { BrowserAuditEntry } from './profileTypes'
import type { BrowserOwner } from './types'

function auditFile(): string {
  const file = path.join(browserBrokerDataDirs().root, 'session-audit.jsonl')
  mkdirSync(path.dirname(file), { recursive: true })
  return file
}

function actorOf(owner: BrowserOwner): BrowserAuditEntry['actor'] {
  if (owner === 'commander') return 'COMMANDER'
  if (owner === 'foundry') return 'FOUNDRY'
  if (owner === 'council') return 'COUNCIL'
  return 'BROKER'
}

function redactHostname(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(redactSecretsFromOutput(url)).hostname
  } catch {
    return null
  }
}

export async function recordBrowserAudit(input: {
  owner: BrowserOwner
  action_type: string
  result: string
  session_id?: string | null
  profile_id?: string | null
  mission_id?: string | null
  url?: string | null
  approval_state?: string | null
}): Promise<void> {
  const entry: BrowserAuditEntry = {
    timestamp: new Date().toISOString(),
    mission_id: input.mission_id ?? null,
    session_id: input.session_id ?? null,
    profile_id: input.profile_id ?? null,
    actor: actorOf(input.owner),
    action_type: input.action_type,
    hostname: redactHostname(input.url),
    result: String(input.result).slice(0, 120),
    approval_state: input.approval_state ?? null,
  }
  const line = `${JSON.stringify(entry)}\n`
  const file = auditFile()
  appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 })
  tightenFileMode(file)
  await logWarRoomRepoAudit(`browser-broker: ${input.action_type}`, {
    actor: entry.actor,
    result: entry.result,
    hostname: entry.hostname,
    session_id: entry.session_id,
    profile_id: entry.profile_id,
  })
}

export function readBrowserAuditTail(limit = 80): BrowserAuditEntry[] {
  const file = auditFile()
  if (!existsSync(file)) return []
  const raw = readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split('\n').slice(-limit).map(line => {
    try { return JSON.parse(line) as BrowserAuditEntry } catch { return null }
  }).filter((item): item is BrowserAuditEntry => Boolean(item))
}

export function auditContainsForbiddenSecrets(text: string): boolean {
  return /password\s*[=:]|cookie\s*=|set-cookie|authorization:\s*(?!\[REDACTED])|Bearer\s+[A-Za-z0-9._-]{8,}/i.test(text)
}
