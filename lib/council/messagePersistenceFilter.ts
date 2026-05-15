import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

const BLOCKED_MESSAGE_TYPES = new Set(['system', 'integrity_flag', 'error'])

const BLOCKED_SENDER_RE = /^(system|internal|sentinel|debug)$/i

const CORE_PERSISTABLE_FAMILY_IDS = new Set<CouncilOrchestrationFamily>([
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
])

const PERSISTABLE_FAMILY_LABELS = new Set(
  COUNCIL_ROSTER.filter(r => CORE_PERSISTABLE_FAMILY_IDS.has(r.id)).map(r => r.label.toUpperCase()),
)

const NON_SUCCESS_PROVIDER_RUNTIME = new Set<ProviderFamilyOutcomeStatus>([
  'FAILED',
  'TIMED_OUT',
  'SKIPPED',
  'IN_FLIGHT',
])

const ATTENDANCE_PLACEHOLDER_RE =
  /\bconfirming\.?$|\bunavailable\.?$|\battendance_soft_cap\b/i

export type CouncilPersistableMessage = {
  content?: string
  messageType?: string
  role?: string
  sender?: string
  familyName?: string
  family?: string | null
  responseSuccessful?: boolean
  providerRuntime?: ProviderFamilyOutcomeStatus
  providerState?: ProviderFamilyOutcomeStatus | string
  metadata?: Record<string, unknown>
}

export type CouncilMessagePersistenceContext = {
  localAgentsFunctional?: Partial<Record<CouncilOrchestrationFamily, boolean>>
}

function resolveMessageType(message: CouncilPersistableMessage): string {
  if (typeof message.messageType === 'string' && message.messageType.trim()) {
    return message.messageType.trim().toLowerCase()
  }
  if (message.role === 'user') return 'decree'
  if (message.role === 'system') return 'system'
  if (message.role === 'assistant') return 'response'
  return typeof message.role === 'string' ? message.role.trim().toLowerCase() : ''
}

function resolveSender(message: CouncilPersistableMessage): string {
  const raw = message.sender ?? message.familyName ?? message.family ?? ''
  return typeof raw === 'string' ? raw.trim() : ''
}

function isRaelSender(sender: string): boolean {
  const u = sender.toUpperCase()
  return u.includes("RA'EL") || u === 'RAEL'
}

function isBlockedSender(sender: string): boolean {
  if (!sender) return true
  if (BLOCKED_SENDER_RE.test(sender)) return true
  if (sender.toUpperCase() === 'SYSTEM') return true
  return false
}

function rosterIdForSender(sender: string): CouncilOrchestrationFamily | null {
  const u = sender.toUpperCase()
  for (const entry of COUNCIL_ROSTER) {
    if (entry.label.toUpperCase() === u || u.includes(entry.label.toUpperCase())) {
      return entry.id
    }
  }
  return null
}

function isPersistableFamilySender(
  sender: string,
  ctx?: CouncilMessagePersistenceContext,
): boolean {
  const u = sender.toUpperCase()
  if (PERSISTABLE_FAMILY_LABELS.has(u)) return true
  const id = rosterIdForSender(sender)
  if (!id) return false
  if (id === 'kimi') return Boolean(ctx?.localAgentsFunctional?.kimi)
  if (id === 'bridge_architect' || id === 'baby') return false
  return CORE_PERSISTABLE_FAMILY_IDS.has(id)
}

function providerRuntimeFailed(message: CouncilPersistableMessage): boolean {
  const rt = (message.providerRuntime ?? message.providerState) as ProviderFamilyOutcomeStatus | string | undefined
  if (!rt || typeof rt !== 'string') return false
  if (NON_SUCCESS_PROVIDER_RUNTIME.has(rt as ProviderFamilyOutcomeStatus)) return true
  if (rt === 'DEGRADED') return message.responseSuccessful !== true
  return false
}

function isAttendanceNonPersistablePlaceholder(message: CouncilPersistableMessage): boolean {
  const rt = message.providerRuntime ?? message.providerState
  if (rt === 'IN_FLIGHT') return true
  const content = message.content?.trim() ?? ''
  if (!content) return false
  if (ATTENDANCE_PLACEHOLDER_RE.test(content)) return true
  const detail =
    message.metadata && typeof message.metadata.runtimeDetail === 'string'
      ? message.metadata.runtimeDetail
      : ''
  return detail === 'attendance_soft_cap'
}

function isSuccessfulVisibleMessage(message: CouncilPersistableMessage): boolean {
  if (message.responseSuccessful === false) return false
  if (isAttendanceNonPersistablePlaceholder(message)) return false
  if (message.responseSuccessful === true) return Boolean(message.content?.trim())
  if (providerRuntimeFailed(message)) return false
  return Boolean(message.content?.trim())
}

/**
 * Returns true only for Ra'el decrees and successful visible council family responses
 * intended for durable conversation history.
 */
export function shouldPersistCouncilMessage(
  message: CouncilPersistableMessage,
  ctx?: CouncilMessagePersistenceContext,
): boolean {
  const messageType = resolveMessageType(message)
  if (BLOCKED_MESSAGE_TYPES.has(messageType)) return false

  const sender = resolveSender(message)
  if (isBlockedSender(sender)) return false

  if (messageType === 'decree' || isRaelSender(sender)) {
    return isSuccessfulVisibleMessage(message)
  }

  if (messageType !== 'response') return false
  if (!isPersistableFamilySender(sender, ctx)) return false
  return isSuccessfulVisibleMessage(message)
}

export function councilMessageFromLivePost(
  input: { role: 'user' | 'assistant' | 'system'; content: string; family?: string | null },
  extras?: {
    responseSuccessful?: boolean
    providerRuntime?: ProviderFamilyOutcomeStatus
  },
): CouncilPersistableMessage {
  return {
    role: input.role,
    content: input.content,
    family: input.family ?? null,
    familyName: input.family ?? undefined,
    responseSuccessful: extras?.responseSuccessful,
    providerRuntime: extras?.providerRuntime,
  }
}

export function councilMessageFromPersisted(message: {
  familyName: string
  content: string
  messageType: string
  provider?: string
}): CouncilPersistableMessage {
  return {
    familyName: message.familyName,
    content: message.content,
    messageType: message.messageType,
    sender: message.familyName,
  }
}

export function councilMessageFromWarRoomRow(row: {
  role: string
  content: string
  family?: string | null
  metadata?: Record<string, unknown>
}): CouncilPersistableMessage {
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  return {
    role: row.role,
    content: row.content,
    family: row.family ?? null,
    familyName: row.family ?? undefined,
    messageType: typeof meta.messageType === 'string' ? meta.messageType : undefined,
    responseSuccessful: meta.responseSuccessful === true ? true : meta.responseSuccessful === false ? false : undefined,
    providerRuntime:
      typeof meta.providerRuntime === 'string'
        ? (meta.providerRuntime as ProviderFamilyOutcomeStatus)
        : undefined,
    metadata: meta,
  }
}

export function buildCouncilPersistenceContext(input: {
  localFamilyAgents?: { familyAgents: { id: string; functional: boolean }[] }
  orchestrationFamilyToLocalAgentId: (f: CouncilOrchestrationFamily) => string | null
}): CouncilMessagePersistenceContext {
  const functional: Partial<Record<CouncilOrchestrationFamily, boolean>> = {}
  for (const id of ['kimi', 'bridge_architect'] as const) {
    const agentId = input.orchestrationFamilyToLocalAgentId(id)
    if (!agentId) continue
    functional[id] = Boolean(
      input.localFamilyAgents?.familyAgents.find(a => a.id === agentId)?.functional,
    )
  }
  return { localAgentsFunctional: functional }
}
