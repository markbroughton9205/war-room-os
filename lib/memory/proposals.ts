import type { MemoryFamilyPartition } from '@/lib/memory/types'
import { isMemoryFamilyPartition } from '@/lib/memory/types'

/** Conservative redaction: drop whole lines that look like secrets or PII carriers. */
export function redactProposalContent(text: string): string {
  if (!text || typeof text !== 'string') return ''
  const lines = text.split(/\r?\n/)
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      out.push(line)
      continue
    }
    const lower = t.toLowerCase()
    if (
      /\bsk-[a-z0-9]{10,}/i.test(t) ||
      /\bAIza[a-z0-9_-]{10,}/i.test(t) ||
      /\bbearer\s+[a-z0-9._+/=-]{8,}/i.test(t) ||
      /api[_-]?key\s*[:=]/i.test(t) ||
      /(secret|token|password)\s*[:=]\s*\S{4,}/i.test(t) ||
      /x-api-key\s*[:=]/i.test(t) ||
      lower.includes('authorization:') ||
      lower.includes('supabase_service_role') ||
      emailRe.test(t)
    ) {
      out.push('[REDACTED LINE]')
      continue
    }
    out.push(line)
  }
  return out.join('\n').trim()
}

export type MemoryProposalCreatePayload = {
  family_partition: string
  title: string
  content: string
  conversation_id?: string | null
  proposed_by?: string | null
  metadata?: Record<string, unknown>
}

export type ValidateProposalResult =
  | { ok: true; value: { family_partition: MemoryFamilyPartition; title: string; content: string; conversation_id: string | null; proposed_by: string; metadata: Record<string, unknown> } }
  | { ok: false; error: string }

const MAX_TITLE = 500
const MAX_CONTENT = 120_000

export function validateProposal(payload: unknown): ValidateProposalResult {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Body must be a JSON object.' }
  }
  const o = payload as Record<string, unknown>
  const fp = o.family_partition
  const title = o.title
  const content = o.content
  if (typeof fp !== 'string' || !isMemoryFamilyPartition(fp.trim())) {
    return { ok: false, error: 'Invalid or missing family_partition.' }
  }
  if (typeof title !== 'string' || !title.trim()) {
    return { ok: false, error: 'Invalid or missing title.' }
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'Invalid or missing content.' }
  }
  const t = title.trim().slice(0, MAX_TITLE)
  const c = content.slice(0, MAX_CONTENT)
  const conversation_id =
    o.conversation_id === null || o.conversation_id === undefined
      ? null
      : typeof o.conversation_id === 'string' && /^[0-9a-f-]{36}$/i.test(o.conversation_id)
        ? o.conversation_id
        : null
  if (o.conversation_id !== undefined && o.conversation_id !== null && conversation_id === null) {
    return { ok: false, error: 'conversation_id must be a UUID string when provided.' }
  }
  const proposed_by =
    typeof o.proposed_by === 'string' && o.proposed_by.trim() ? o.proposed_by.trim().slice(0, 200) : 'user'
  const metadata =
    o.metadata && typeof o.metadata === 'object' && !Array.isArray(o.metadata)
      ? (o.metadata as Record<string, unknown>)
      : {}
  return {
    ok: true,
    value: {
      family_partition: fp.trim() as MemoryFamilyPartition,
      title: t,
      content: c,
      conversation_id,
      proposed_by,
      metadata,
    },
  }
}

/** Parse a single `MEMORY_PROPOSAL: {...}` line from model output; conservative, returns null on doubt. */
export function tryParseMemoryProposalLine(fullText: string): MemoryProposalCreatePayload | null {
  if (!fullText || typeof fullText !== 'string') return null
  const lines = fullText.split(/\r?\n/)
  for (const line of lines) {
    const idx = line.indexOf('MEMORY_PROPOSAL:')
    if (idx === -1) continue
    const jsonPart = line.slice(idx + 'MEMORY_PROPOSAL:'.length).trim()
    if (!jsonPart.startsWith('{') || !jsonPart.endsWith('}')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonPart) as unknown
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const p = parsed as Record<string, unknown>
    const title = p.title
    const content = p.content
    const fpRaw = p.family_partition
    if (typeof title !== 'string' || !title.trim()) continue
    if (typeof content !== 'string' || !content.trim()) continue
    const family_partition =
      typeof fpRaw === 'string' && isMemoryFamilyPartition(fpRaw.trim()) ? fpRaw.trim() : ''
    const conversation_id =
      p.conversation_id === null || p.conversation_id === undefined
        ? undefined
        : typeof p.conversation_id === 'string'
          ? p.conversation_id
          : undefined
    return {
      family_partition,
      title: title.trim(),
      content: content.trim(),
      conversation_id,
      proposed_by: 'model:memory_line',
      metadata: { source: 'MEMORY_PROPOSAL_line' },
    }
  }
  return null
}
