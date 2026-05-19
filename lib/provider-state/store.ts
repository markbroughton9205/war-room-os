import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { buildStructuredProviderPacket } from '@/lib/cognitive-bus/packet'
import type { StructuredProviderPacket } from '@/lib/cognitive-bus/types'
import { toDisplayText } from '@/lib/council/toDisplayText'
import type { ProviderFamilyConversationState } from '@/lib/provider-state/types'

const CORE_FAMILIES: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
  'baby',
  'kimi',
  'bridge_architect',
]

function emptyState(family: CouncilOrchestrationFamily): ProviderFamilyConversationState {
  return {
    family,
    recentContext: '',
    topicFocus: 'Awaiting input',
    unresolvedQuestions: [],
    contradictions: [],
    pendingInvestigations: [],
    lastUpdatedAt: new Date().toISOString(),
    focusLabel: 'idle',
  }
}

export function createInitialProviderStates(): Partial<Record<CouncilOrchestrationFamily, ProviderFamilyConversationState>> {
  const out: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyConversationState>> = {}
  for (const family of CORE_FAMILIES) out[family] = emptyState(family)
  return out
}

function extractQuestions(text: string): string[] {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.endsWith('?') && line.length > 12)
    .slice(0, 6)
}

function extractInvestigations(text: string): string[] {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => /\b(verify|investigate|confirm|check|need evidence)\b/i.test(line))
    .slice(0, 6)
}

export function updateProviderStateFromPacket(
  current: ProviderFamilyConversationState | undefined,
  packet: StructuredProviderPacket,
): ProviderFamilyConversationState {
  const base = current ?? emptyState(packet.family)
  const observation = packet.observations[0] ?? ''
  const recentContext = observation ? observation.slice(0, 400) : base.recentContext
  const topicFocus = packet.recommendations[0]?.slice(0, 160) ?? base.topicFocus
  const unresolvedQuestions = [
    ...new Set([...base.unresolvedQuestions, ...extractQuestions(packet.observations.join('\n'))]),
  ].slice(0, 8)
  const pendingInvestigations = [
    ...new Set([...base.pendingInvestigations, ...extractInvestigations(packet.observations.join('\n'))]),
  ].slice(0, 8)
  const contradictions = [...new Set([...base.contradictions, ...packet.contradictions])].slice(0, 8)
  const focusLabel: ProviderFamilyConversationState['focusLabel'] =
    packet.escalation_requests.length > 0 ? 'active' : packet.contradictions.length ? 'watching' : 'active'

  return {
    ...base,
    recentContext,
    topicFocus,
    unresolvedQuestions,
    contradictions,
    pendingInvestigations,
    lastUpdatedAt: packet.timestamp,
    focusLabel,
  }
}

export function updateProviderStateFromDisplayText(
  current: ProviderFamilyConversationState | undefined,
  family: CouncilOrchestrationFamily,
  displayText: string,
): ProviderFamilyConversationState {
  const packet = buildStructuredProviderPacket({ family, displayText })
  return updateProviderStateFromPacket(current, packet)
}

export function mergeProviderStatesFromMessages(
  states: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyConversationState>>,
  messages: { familyName: string; content: unknown; messageType: string }[],
): Partial<Record<CouncilOrchestrationFamily, ProviderFamilyConversationState>> {
  const out = { ...createInitialProviderStates(), ...states }
  const familyMap: Record<string, CouncilOrchestrationFamily> = {
    chatgpt: 'chatgpt',
    claude: 'claude',
    grok: 'grok',
    gemini: 'gemini',
    red_team: 'red_team',
    baby: 'baby',
    kimi: 'kimi',
    bridge_architect: 'bridge_architect',
  }

  for (const message of messages) {
    if (message.messageType !== 'response' && message.messageType !== 'repair_packet') continue
    const raw = toDisplayText(message.familyName).replace(/\s+family$/i, '').trim().toLowerCase()
    const key = raw.replace(/\s+/g, '_')
    const family = familyMap[key] ?? (/red\s*team/.test(raw) ? 'red_team' : null)
    if (!family) continue
    const text = toDisplayText(message.content).trim()
    if (!text) continue
    out[family] = updateProviderStateFromDisplayText(out[family], family, text)
  }
  return out
}
