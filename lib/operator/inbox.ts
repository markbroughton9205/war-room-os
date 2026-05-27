/**
 * Operator Inbox — session-local queue for self-audit, setup, revenue, and related actions.
 * Persists in sessionStorage (no Supabase).
 */

import type { GapFinderContext, GapSeverity, OperatorGap } from './gapFinder'

export type OperatorInboxCategory =
  | 'self_audit'
  | 'repair'
  | 'setup'
  | 'revenue'
  | 'approvals'
  | 'verification'

export type OperatorInboxStatus = 'open' | 'in_progress' | 'fixed' | 'dismissed'

export type OperatorInboxItem = {
  id: string
  title: string
  category: OperatorInboxCategory
  severity: GapSeverity
  plainMeaning: string
  recommendedAction: string
  source: string
  status: OperatorInboxStatus
  createdAt: string
  lastCheckedAt: string
  copyCursorCommand: string
  fixedAt?: string | null
}

export type OperatorInboxSnapshot = {
  version: 1
  items: OperatorInboxItem[]
  commanderManualFixedAt: Record<string, string>
  commanderDismissedIds: Record<string, string>
  councilBurstNoteDismissed?: boolean
  lastSyncAt?: string
}

export const OPERATOR_INBOX_STORAGE_KEY = 'war-room-operator-inbox'

export const ARCHIVE_RECALL_INBOX_ID = 'operator-inbox-archive-recall'
export const COUNCIL_BURST_INBOX_ID = 'operator-inbox-council-trigger-burst'

const EMPTY_SNAPSHOT: OperatorInboxSnapshot = {
  version: 1,
  items: [],
  commanderManualFixedAt: {},
  commanderDismissedIds: {},
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined'
}

export function loadOperatorInboxSnapshot(): OperatorInboxSnapshot {
  if (!isBrowser()) return { ...EMPTY_SNAPSHOT, items: [] }
  try {
    const raw = sessionStorage.getItem(OPERATOR_INBOX_STORAGE_KEY)
    if (!raw) return { ...EMPTY_SNAPSHOT, items: [] }
    const parsed = JSON.parse(raw) as Partial<OperatorInboxSnapshot>
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return { ...EMPTY_SNAPSHOT, items: [] }
    }
    return {
      version: 1,
      items: parsed.items.filter(isValidInboxItem),
      commanderManualFixedAt: { ...(parsed.commanderManualFixedAt ?? {}) },
      commanderDismissedIds: { ...(parsed.commanderDismissedIds ?? {}) },
      councilBurstNoteDismissed: parsed.councilBurstNoteDismissed === true,
      lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : undefined,
    }
  } catch {
    return { ...EMPTY_SNAPSHOT, items: [] }
  }
}

export function saveOperatorInboxSnapshot(snapshot: OperatorInboxSnapshot): void {
  if (!isBrowser()) return
  try {
    sessionStorage.setItem(OPERATOR_INBOX_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* private mode */
  }
}

function isValidInboxItem(value: unknown): value is OperatorInboxItem {
  if (!value || typeof value !== 'object') return false
  const row = value as OperatorInboxItem
  return (
    typeof row.id === 'string' &&
    typeof row.title === 'string' &&
    typeof row.plainMeaning === 'string' &&
    typeof row.copyCursorCommand === 'string'
  )
}

export function categoryFromGap(gap: OperatorGap): OperatorInboxCategory {
  const category = gap.category
  if (category === 'Revenue Readiness' || gap.kind === 'revenue') return 'revenue'
  if (
    category === 'Old Diagnostics' ||
    /repair/i.test(gap.area) ||
    /repair/i.test(gap.id) ||
    /evolution/i.test(gap.area)
  ) {
    return 'repair'
  }
  if (
    category === 'Broken/Silent UI' ||
    gap.area === 'Settings' ||
    /setup|settings|configure/i.test(gap.recommendedFix)
  ) {
    return 'setup'
  }
  if (/approval/i.test(gap.title) || /approval/i.test(gap.area)) return 'approvals'
  if (gap.verificationEvidence?.length) return 'verification'
  return 'self_audit'
}

export function inboxStatusFromGap(gap: OperatorGap): OperatorInboxStatus {
  if (gap.verificationEvidence?.some(line => line.includes('not important'))) return 'dismissed'
  if (gap.status === 'fixed') return 'fixed'
  if (gap.status === 'needs_review') return 'fixed'
  return 'open'
}

export function gapToInboxItem(gap: OperatorGap, checkedAt: string): OperatorInboxItem {
  return {
    id: gap.id,
    title: gap.title,
    category: categoryFromGap(gap),
    severity: gap.severity,
    plainMeaning: gap.plainLanguage || gap.meaning,
    recommendedAction: gap.recommendedFix,
    source: gap.area || 'Self-audit',
    status: inboxStatusFromGap(gap),
    createdAt: checkedAt,
    lastCheckedAt: gap.lastCheckedAt ?? checkedAt,
    copyCursorCommand: gap.cursorCommand,
    fixedAt: gap.fixedAt ?? null,
  }
}

export type InboxContextExtras = {
  archiveRecallNotConnected?: boolean
  recentCouncilTriggers?: number
  councilStabilityMode?: boolean
}

function archiveRecallItem(checkedAt: string): OperatorInboxItem {
  return {
    id: ARCHIVE_RECALL_INBOX_ID,
    title: 'Archive recall not wired yet',
    category: 'setup',
    severity: 'medium',
    plainMeaning: 'The View Archive button does not load hidden transcript rows yet.',
    recommendedAction: 'Use Copy Session for the full transcript until recall is connected.',
    source: 'Live Council',
    status: 'open',
    createdAt: checkedAt,
    lastCheckedAt: checkedAt,
    copyCursorCommand:
      'Wire archive recall in app/page.tsx or hide the control until session recall API exists.',
  }
}

function councilBurstItem(checkedAt: string, triggerCount: number): OperatorInboxItem {
  return {
    id: COUNCIL_BURST_INBOX_ID,
    title: 'High council activity recently',
    category: 'self_audit',
    severity: 'medium',
    plainMeaning: `${triggerCount} council responses recently — overlapping waves are more likely.`,
    recommendedAction: 'Pause if needed; use Stable Group Chat for daily work before the next decree.',
    source: 'Session orchestration',
    status: 'open',
    createdAt: checkedAt,
    lastCheckedAt: checkedAt,
    copyCursorCommand:
      'Show trigger-rate hint in operator session indicators (UI-only; no pipeline changes).',
  }
}

function contextExtrasToItems(extras: InboxContextExtras | undefined, checkedAt: string): OperatorInboxItem[] {
  const items: OperatorInboxItem[] = []
  if (extras?.archiveRecallNotConnected) items.push(archiveRecallItem(checkedAt))
  if ((extras?.recentCouncilTriggers ?? 0) > 8) {
    items.push(councilBurstItem(checkedAt, extras!.recentCouncilTriggers!))
  }
  return items
}

export function shouldShowCouncilBurstNote(
  snapshot: OperatorInboxSnapshot,
  extras: InboxContextExtras | undefined,
): boolean {
  if (snapshot.councilBurstNoteDismissed) return false
  return (extras?.recentCouncilTriggers ?? 0) > 8
}

export function syncOperatorInboxFromGaps(
  gaps: OperatorGap[],
  options?: {
    extras?: InboxContextExtras
    commanderManualFixedAt?: Record<string, string>
    commanderDismissedIds?: Record<string, string>
    existing?: OperatorInboxSnapshot
  },
): OperatorInboxSnapshot {
  const checkedAt = new Date().toISOString()
  const base = options?.existing ?? loadOperatorInboxSnapshot()
  const manual = options?.commanderManualFixedAt ?? base.commanderManualFixedAt
  const dismissed = options?.commanderDismissedIds ?? base.commanderDismissedIds
  const byId = new Map(base.items.map(item => [item.id, item]))

  const incoming = [
    ...gaps.map(g => gapToInboxItem(g, checkedAt)),
    ...contextExtrasToItems(options?.extras, checkedAt),
  ]

  for (const row of incoming) {
    const prev = byId.get(row.id)
    let status = row.status

    if (dismissed[row.id]) status = 'dismissed'
    else if (manual[row.id] && status === 'open') status = 'fixed'
    else if (prev?.status === 'in_progress' && status === 'open') status = 'in_progress'
    else if (prev?.status === 'dismissed' && status !== 'fixed') status = 'dismissed'

    byId.set(row.id, {
      ...row,
      status,
      createdAt: prev?.createdAt ?? row.createdAt,
      fixedAt: status === 'fixed' ? manual[row.id] ?? prev?.fixedAt ?? row.fixedAt : row.fixedAt,
    })
  }

  const activeIds = new Set(incoming.map(r => r.id))
  for (const [id, item] of byId) {
    if (!activeIds.has(id) && item.status !== 'dismissed' && item.status !== 'in_progress') {
      byId.delete(id)
    }
  }

  const snapshot: OperatorInboxSnapshot = {
    version: 1,
    items: [...byId.values()].sort((a, b) => rankSeverity(b.severity) - rankSeverity(a.severity)),
    commanderManualFixedAt: manual,
    commanderDismissedIds: dismissed,
    councilBurstNoteDismissed: base.councilBurstNoteDismissed,
    lastSyncAt: checkedAt,
  }

  saveOperatorInboxSnapshot(snapshot)
  return snapshot
}

function rankSeverity(severity: GapSeverity): number {
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}

export function inboxExtrasFromGapContext(ctx: GapFinderContext): InboxContextExtras {
  return {
    archiveRecallNotConnected: ctx.silentUi?.archiveRecallNotConnected,
    recentCouncilTriggers: ctx.orchestration?.recentCouncilTriggers,
    councilStabilityMode: ctx.orchestration?.councilStabilityMode,
  }
}

export function updateOperatorInboxItemStatus(
  id: string,
  status: OperatorInboxStatus,
): OperatorInboxSnapshot {
  const snapshot = loadOperatorInboxSnapshot()
  const checkedAt = new Date().toISOString()
  const items = snapshot.items.map(item => {
    if (item.id !== id) return item
    return {
      ...item,
      status,
      lastCheckedAt: checkedAt,
      fixedAt: status === 'fixed' ? checkedAt : item.fixedAt,
    }
  })
  const next: OperatorInboxSnapshot = { ...snapshot, items, lastSyncAt: checkedAt }
  if (status === 'dismissed') {
    next.commanderDismissedIds = { ...next.commanderDismissedIds, [id]: checkedAt }
  }
  if (status === 'fixed') {
    next.commanderManualFixedAt = { ...next.commanderManualFixedAt, [id]: checkedAt }
  }
  saveOperatorInboxSnapshot(next)
  return next
}

export function dismissCouncilBurstNote(): OperatorInboxSnapshot {
  const snapshot = loadOperatorInboxSnapshot()
  const next = { ...snapshot, councilBurstNoteDismissed: true }
  saveOperatorInboxSnapshot(next)
  return next
}

export function countOpenOperatorInboxItems(
  items: OperatorInboxItem[],
  options?: { includeInProgress?: boolean },
): number {
  return items.filter(item => {
    if (item.status === 'dismissed' || item.status === 'fixed') return false
    if (item.status === 'in_progress') return options?.includeInProgress === true
    return true
  }).length
}

export type InboxListFilter = {
  showDismissed?: boolean
  showFixedRecently?: boolean
}

export function listOperatorInboxItems(
  items: OperatorInboxItem[],
  filter: InboxListFilter = {},
): { open: OperatorInboxItem[]; inProgress: OperatorInboxItem[]; fixedRecently: OperatorInboxItem[]; dismissed: OperatorInboxItem[] } {
  const showDismissed = filter.showDismissed === true
  const showFixed = filter.showFixedRecently !== false

  const open: OperatorInboxItem[] = []
  const inProgress: OperatorInboxItem[] = []
  const fixedRecently: OperatorInboxItem[] = []
  const dismissed: OperatorInboxItem[] = []

  for (const item of items) {
    if (item.status === 'dismissed') {
      if (showDismissed) dismissed.push(item)
      continue
    }
    if (item.status === 'fixed') {
      if (showFixed) fixedRecently.push(item)
      continue
    }
    if (item.status === 'in_progress') {
      inProgress.push(item)
      continue
    }
    open.push(item)
  }

  return { open, inProgress, fixedRecently, dismissed }
}

export function categoryLabel(category: OperatorInboxCategory): string {
  const labels: Record<OperatorInboxCategory, string> = {
    self_audit: 'Self-audit',
    repair: 'Repair',
    setup: 'Setup',
    revenue: 'Revenue',
    approvals: 'Approvals',
    verification: 'Verification',
  }
  return labels[category]
}
