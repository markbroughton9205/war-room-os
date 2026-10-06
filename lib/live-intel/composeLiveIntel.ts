import type { CommanderPresencePhase } from '@/lib/council/live-orchestration/rosterHealth'
import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'

import type {
  LiveIntelItem,
  LiveIntelSeverity,
  LiveIntelSnapshot,
  LiveIntelSource,
  LiveIntelSourceBadge,
} from './types'

export const PRESENCE_LABEL: Record<CommanderPresencePhase, string> = {
  idle: 'Idle',
  understanding: 'Understanding',
  researching: 'Researching',
  verifying: 'Verifying',
  synthesizing: 'Synthesizing',
}

export const SOURCE_LABEL: Record<LiveIntelSource, string> = {
  'war-room': 'WAR ROOM',
  terra: 'TERRA',
  foundry: 'FOUNDRY',
  research: 'RESEARCH',
  council: 'COUNCIL',
  wrim: 'WRIM',
  sentinel: 'SENTINEL',
  rael: "RA'EL",
  system: 'SYSTEM',
  'ai-news': 'AI NEWS',
  world: 'WORLD',
}

export const DRAWER_SECTION_ORDER: LiveIntelSource[] = [
  'war-room',
  'terra',
  'foundry',
  'research',
  'council',
  'ai-news',
  'world',
]

const RAIL_BADGE_ORDER: LiveIntelSource[] = [
  'war-room',
  'terra',
  'foundry',
  'research',
  'council',
  'ai-news',
  'world',
]

export type LiveIntelComposeInput = {
  presencePhase: CommanderPresencePhase
  liveResearchHud?: LiveResearchClientUi | null
  terraNote?: string | null
  sourcesPreview?: string | null
  extraItems?: LiveIntelItem[]
  now?: string
}

function isOperationalIdle(item: LiveIntelItem): boolean {
  return item.id === 'war-room:status' && item.read
}

export function groupLiveIntelItems(items: LiveIntelItem[]): LiveIntelSnapshot['groups'] {
  const groups: LiveIntelSnapshot['groups'] = {}
  for (const item of items) {
    const bucket = groups[item.source] ?? []
    bucket.push(item)
    groups[item.source] = bucket
  }
  return groups
}

export function unreadLiveIntelCount(items: LiveIntelItem[]): number {
  return items.filter(item => !item.read && !isOperationalIdle(item)).length
}

function badgeTone(items: LiveIntelItem[]): LiveIntelSeverity {
  if (items.some(item => item.severity === 'critical')) return 'critical'
  if (items.some(item => item.severity === 'warning')) return 'warning'
  if (items.some(item => !item.read && item.severity === 'info')) return 'info'
  return 'operational'
}

export function composeLiveIntel(input: LiveIntelComposeInput): LiveIntelSnapshot {
  const timestamp = input.now ?? ''
  const items: LiveIntelItem[] = []
  const presence = input.presencePhase
  const idle = presence === 'idle'

  items.push({
    id: 'war-room:status',
    source: 'war-room',
    severity: idle ? 'operational' : 'info',
    title: PRESENCE_LABEL[presence],
    message: idle
      ? 'Voice capture is idle.'
      : `War Room is ${PRESENCE_LABEL[presence].toLowerCase()}.`,
    timestamp,
    read: idle,
    toastEligible: false,
  })

  const hud = input.liveResearchHud
  if (hud && hud.mode !== 'inactive') {
    items.push({
      id: 'research:hud',
      source: 'research',
      severity: hud.mode === 'failed' ? 'warning' : 'info',
      title: hud.label,
      message: hud.label,
      timestamp,
      read: false,
      toastEligible: hud.mode === 'failed' || hud.mode === 'verified',
      metadata: { mode: hud.mode, sourcesCount: hud.sourcesCount },
    })
  }

  const sources = (input.sourcesPreview || hud?.intelligence?.sourcesPreview || '').trim()
  if (sources) {
    items.push({
      id: 'research:sources',
      source: 'research',
      severity: 'info',
      title: hud?.sourcesCount ? `${hud.sourcesCount} source${hud.sourcesCount === 1 ? '' : 's'}` : 'Sources',
      message: sources,
      timestamp,
      read: false,
      toastEligible: false,
    })
  }

  const terraNote = input.terraNote?.trim()
  if (terraNote) {
    items.push({
      id: 'terra:note',
      source: 'terra',
      severity: 'info',
      title: 'Terra context',
      message: terraNote,
      timestamp,
      read: false,
      toastEligible: false,
    })
  }

  const extras = input.extraItems ?? []
  items.push(...extras)

  const unreadItems = items.filter(item => !item.read && !isOperationalIdle(item))
  const highlighted =
    unreadItems.find(item => item.toastEligible)
    ?? unreadItems.find(item => item.id !== 'war-room:status')
    ?? null

  const groups = groupLiveIntelItems(items)
  const badges: LiveIntelSourceBadge[] = RAIL_BADGE_ORDER.map(source => {
    const sourceItems = groups[source] ?? []
    const connected = sourceItems.length > 0
    const count = sourceItems.filter(item => !item.read && !isOperationalIdle(item)).length
    return {
      source,
      label: SOURCE_LABEL[source],
      count,
      tone: connected ? badgeTone(sourceItems) : 'operational',
      connected,
    }
  })

  return {
    items,
    highlighted,
    badges,
    unreadCount: unreadLiveIntelCount(items),
    groups,
  }
}
