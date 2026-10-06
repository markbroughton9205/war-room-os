export const LIVE_INTEL_SOURCES = [
  'war-room',
  'terra',
  'foundry',
  'research',
  'council',
  'wrim',
  'sentinel',
  'rael',
  'system',
  'ai-news',
  'world',
] as const

export type LiveIntelSource = (typeof LIVE_INTEL_SOURCES)[number]

export type LiveIntelSeverity = 'info' | 'operational' | 'warning' | 'critical'

export type LiveIntelAction = {
  label: string
  href?: string
}

export type LiveIntelItem = {
  id: string
  source: LiveIntelSource
  severity: LiveIntelSeverity
  title: string
  message: string
  timestamp: string
  read: boolean
  toastEligible?: boolean
  action?: LiveIntelAction
  metadata?: Record<string, unknown>
}

export type LiveIntelSourceBadge = {
  source: LiveIntelSource
  label: string
  count: number
  tone: LiveIntelSeverity
  connected: boolean
}

export type LiveIntelSnapshot = {
  items: LiveIntelItem[]
  highlighted: LiveIntelItem | null
  badges: LiveIntelSourceBadge[]
  unreadCount: number
  groups: Partial<Record<LiveIntelSource, LiveIntelItem[]>>
}
