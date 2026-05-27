/**
 * Council transcript formatting helpers (client-safe).
 */

export { copyTextToClipboard, type CopyToClipboardResult } from './copyToClipboard'

export type CouncilMessageLike = {
  id: string
  familyName: string
  content: string
  timestamp: string
  messageType: string
  provider?: string
  degraded?: boolean
}

export type CouncilExchange = {
  decree: CouncilMessageLike | null
  replies: CouncilMessageLike[]
}

export type CopyMessageOptions = {
  includeMeta?: boolean
}

export function formatMessageForCopy(
  message: CouncilMessageLike,
  options?: CopyMessageOptions,
): string {
  const body = stripUiNoise(message.content)
  if (!options?.includeMeta) return body
  const parts = [message.familyName, message.timestamp, message.messageType]
    .filter(Boolean)
    .join(' · ')
  return `${parts}\n\n${body}`
}

function stripUiNoise(content: string): string {
  return content.replace(/\r\n/g, '\n').trim()
}

function isDecreeMessage(message: CouncilMessageLike): boolean {
  const family = message.familyName.toUpperCase()
  return message.messageType === 'decree' || family.includes("RA'EL") || family === 'RAEL'
}

function isTranscriptMessage(message: CouncilMessageLike): boolean {
  if (message.messageType === 'system') return false
  if (/memory_recall|project_orchestration|analyst_operations|engineering_task|repair_packet/.test(message.messageType)) {
    return false
  }
  return Boolean(stripUiNoise(message.content))
}

export function extractLatestExchange(messages: CouncilMessageLike[]): CouncilExchange {
  const transcript = messages.filter(isTranscriptMessage)
  let decreeIdx = -1
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    if (isDecreeMessage(transcript[i]!)) {
      decreeIdx = i
      break
    }
  }
  if (decreeIdx < 0) {
    const replies = transcript.filter(m => m.messageType === 'response')
    return { decree: null, replies: replies.slice(-6) }
  }
  const decree = transcript[decreeIdx]!
  const replies = transcript.slice(decreeIdx + 1).filter(m => m.messageType === 'response' || !isDecreeMessage(m))
  return { decree, replies }
}

export function formatVisibleLog(messages: CouncilMessageLike[]): string {
  const lines: string[] = ['=== Live Council — Visible Log ===', '']
  for (const message of messages.filter(isTranscriptMessage)) {
    lines.push(`[${message.timestamp}] ${message.familyName} (${message.messageType})`)
    lines.push(stripUiNoise(message.content))
    lines.push('')
  }
  return lines.join('\n').trim()
}

export type SessionTranscriptMeta = {
  sessionId?: string | null
  conversationId?: string | null
  councilFlowMode?: string
  exportedAt?: string
}

export function formatSessionTranscript(
  messages: CouncilMessageLike[],
  meta?: SessionTranscriptMeta,
): string {
  const exportedAt = meta?.exportedAt ?? new Date().toISOString()
  const header = [
    '=== War Room Council Session ===',
    `Exported: ${exportedAt}`,
    meta?.sessionId ? `Session: ${meta.sessionId}` : null,
    meta?.conversationId ? `Conversation: ${meta.conversationId}` : null,
    meta?.councilFlowMode ? `Mode: ${meta.councilFlowMode}` : null,
    '',
  ].filter((line): line is string => Boolean(line))

  const body = messages
    .filter(isTranscriptMessage)
    .map(message => formatMessageForCopy(message, { includeMeta: true }))
    .join('\n\n---\n\n')

  return [...header, body].join('\n').trim()
}

export function formatLatestExchange(messages: CouncilMessageLike[]): string {
  const { decree, replies } = extractLatestExchange(messages)
  const lines: string[] = ['=== Latest Council Exchange ===', '']
  if (decree) {
    lines.push(`DECREE · ${decree.familyName} · ${decree.timestamp}`)
    lines.push(stripUiNoise(decree.content))
    lines.push('')
  } else {
    lines.push('(No decree in visible window — showing latest family replies)')
    lines.push('')
  }
  if (!replies.length) {
    lines.push('(No family replies yet in this exchange.)')
  } else {
    for (const reply of replies) {
      lines.push(`${reply.familyName} · ${reply.timestamp}${reply.degraded ? ' · degraded' : ''}`)
      lines.push(stripUiNoise(reply.content))
      lines.push('')
    }
  }
  return lines.join('\n').trim()
}

export type CursorBriefInput = {
  exchange: CouncilExchange
  sessionId?: string | null
  observedFiles?: string[]
  validationCommands?: string[]
}

export function formatCursorBrief(input: CursorBriefInput): string {
  const { decree, replies } = input.exchange
  const problem = decree ? stripUiNoise(decree.content) : 'Council exchange without a visible decree in the live window.'
  const observed = replies.length
    ? replies.map(r => `${r.familyName}: ${stripUiNoise(r.content).slice(0, 400)}`).join('\n\n')
    : 'No family replies captured in the latest exchange.'
  const expected = decree
    ? 'Families respond on-decree with complete, non-degraded answers aligned to the decree intent.'
    : 'Awaiting decree and coordinated family responses.'

  return [
    '# Cursor Brief — War Room Council',
    '',
    '## Context',
    `Session: ${input.sessionId ?? 'local'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Problem',
    problem,
    '',
    '## Observed',
    observed,
    '',
    '## Expected',
    expected,
    '',
    '## Files',
    ...(input.observedFiles?.length ? input.observedFiles.map(f => `- ${f}`) : ['- app/page.tsx', '- components/war-room/live-room/', '- lib/council/']),
    '',
    '## Validation',
    ...(input.validationCommands?.length
      ? input.validationCommands.map(c => `- ${c}`)
      : ['- pnpm exec tsc --noEmit', '- pnpm exec eslint', '- pnpm run build']),
    '',
    '## Constraints',
    '- UI-focused change unless explicitly approved',
    '- No provider routing, Supabase, or council orchestration changes without approval',
    '- End with NEXT STEPS FOR OPERATOR per project standard',
  ].join('\n')
}
