/**
 * Canonical operator issue keys — dedupe legacy gap/inbox ids and reconcile status.
 */

import type { OperatorGap, GapStatus } from './gapFinder'
import { KNOWN_GAP_IDS } from './gapVerification'
import type { OperatorInboxItem, OperatorInboxSnapshot, OperatorInboxStatus } from './inbox'
import { OPERATOR_INBOX_STORAGE_KEY } from './inbox'
import { loadSelfRepairSnapshot, saveSelfRepairSnapshot } from './selfRepair/storage'
import { loadUpgradeQueue, type UpgradeQueueSnapshot } from './upgradeQueue'

export const CANONICAL_ISSUE_IDS = {
  ARCHIVE_RECALL_NOT_WIRED: 'archive-recall-not-wired',
  COUNCIL_TRIGGER_BURST: 'council-trigger-burst',
  OLD_DIAGNOSTICS_HIDDEN: 'old-diagnostics-hidden',
  OLDER_MESSAGES_ARCHIVED: 'older-messages-archived',
  NO_INCOME_OPPORTUNITIES: 'no-income-opportunities',
  OPPORTUNITY_SCOUT_IDLE: 'opportunity-scout-idle',
  OPPORTUNITY_SCOUT_ERROR: 'opportunity-scout-error',
  REVENUE_NO_PAID: 'revenue-no-paid',
} as const

export type CanonicalIssueId = (typeof CANONICAL_ISSUE_IDS)[keyof typeof CANONICAL_ISSUE_IDS]

const LEGACY_TO_CANONICAL: Record<string, CanonicalIssueId | string> = {
  [KNOWN_GAP_IDS.OLD_DIAGNOSTICS_UX]: CANONICAL_ISSUE_IDS.OLD_DIAGNOSTICS_HIDDEN,
  'self-audit-old-diagnostics-hidden-count': CANONICAL_ISSUE_IDS.OLD_DIAGNOSTICS_HIDDEN,
  'self-audit-diagnostics-language-in-thread': CANONICAL_ISSUE_IDS.OLD_DIAGNOSTICS_HIDDEN,
  [KNOWN_GAP_IDS.ARCHIVE_COPY_CLARITY]: CANONICAL_ISSUE_IDS.OLDER_MESSAGES_ARCHIVED,
  'operator-inbox-archive-recall': CANONICAL_ISSUE_IDS.ARCHIVE_RECALL_NOT_WIRED,
  'self-audit-archive-recall-silent': CANONICAL_ISSUE_IDS.ARCHIVE_RECALL_NOT_WIRED,
  'operator-inbox-council-trigger-burst': CANONICAL_ISSUE_IDS.COUNCIL_TRIGGER_BURST,
  'self-audit-orchestration-trigger-burst': CANONICAL_ISSUE_IDS.COUNCIL_TRIGGER_BURST,
  'self-audit-revenue-no-opportunities': CANONICAL_ISSUE_IDS.NO_INCOME_OPPORTUNITIES,
  'self-audit-revenue-scout-never-run': CANONICAL_ISSUE_IDS.OPPORTUNITY_SCOUT_IDLE,
  'self-audit-revenue-scout-error': CANONICAL_ISSUE_IDS.OPPORTUNITY_SCOUT_ERROR,
  'self-audit-revenue-no-paid': CANONICAL_ISSUE_IDS.REVENUE_NO_PAID,
}

const CANONICAL_TITLES: Partial<Record<CanonicalIssueId, string>> = {
  [CANONICAL_ISSUE_IDS.ARCHIVE_RECALL_NOT_WIRED]: 'Archive recall not connected',
  [CANONICAL_ISSUE_IDS.COUNCIL_TRIGGER_BURST]: 'High council activity recently',
  [CANONICAL_ISSUE_IDS.OLD_DIAGNOSTICS_HIDDEN]: 'Old diagnostics hidden from live view',
  [CANONICAL_ISSUE_IDS.OLDER_MESSAGES_ARCHIVED]: 'Older messages hidden from live view',
  [CANONICAL_ISSUE_IDS.NO_INCOME_OPPORTUNITIES]: 'No income opportunities tracked',
  [CANONICAL_ISSUE_IDS.OPPORTUNITY_SCOUT_IDLE]: 'Opportunity Scout idle this session',
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const

const STATUS_RANK: Record<GapStatus, number> = {
  open: 1,
  needs_review: 2,
  fixed: 3,
}

export function canonicalizeIssueId(id: string): string {
  return LEGACY_TO_CANONICAL[id] ?? id
}

function mergeSources(a: string | undefined, b: string | undefined): string[] {
  const set = new Set<string>()
  for (const value of [a, b]) {
    if (!value?.trim()) continue
    for (const part of value.split(/[,;]+/)) {
      const trimmed = part.trim()
      if (trimmed) set.add(trimmed)
    }
  }
  return [...set]
}

function pickStatus(current: GapStatus, incoming: GapStatus): GapStatus {
  return STATUS_RANK[incoming] >= STATUS_RANK[current] ? incoming : current
}

function pickSeverity(
  a: OperatorGap['severity'],
  b: OperatorGap['severity'],
): OperatorGap['severity'] {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b
}

export function mergeCanonicalGaps(gaps: OperatorGap[]): OperatorGap[] {
  const byCanonical = new Map<string, OperatorGap>()

  for (const item of gaps) {
    const canonicalId = canonicalizeIssueId(item.id)
    const existing = byCanonical.get(canonicalId)
    const mergedSources = mergeSources(existing?.area, item.area)

    if (!existing) {
      const title =
        (CANONICAL_TITLES[canonicalId as CanonicalIssueId] as string | undefined) ?? item.title
      byCanonical.set(canonicalId, {
        ...item,
        id: canonicalId,
        title,
        area: mergedSources.length ? mergedSources.join(', ') : item.area,
        mergedSources: mergedSources.length ? mergedSources : undefined,
      })
      continue
    }

    const status = pickStatus(existing.status, item.status)
    const verificationEvidence = [
      ...new Set([...(existing.verificationEvidence ?? []), ...(item.verificationEvidence ?? [])]),
    ]
    const sources = mergeSources(existing.area, item.area)

    byCanonical.set(canonicalId, {
      ...existing,
      ...item,
      id: canonicalId,
      title: CANONICAL_TITLES[canonicalId as CanonicalIssueId] ?? existing.title,
      status,
      severity: pickSeverity(existing.severity, item.severity),
      plainLanguage: existing.plainLanguage || item.plainLanguage,
      meaning: existing.meaning.length >= item.meaning.length ? existing.meaning : item.meaning,
      recommendedFix: existing.recommendedFix || item.recommendedFix,
      cursorCommand: existing.cursorCommand || item.cursorCommand,
      verificationEvidence: verificationEvidence.length ? verificationEvidence : undefined,
      fixedAt: existing.fixedAt ?? item.fixedAt,
      lastCheckedAt: item.lastCheckedAt ?? existing.lastCheckedAt,
      area: sources.join(', '),
      mergedSources: sources.length ? sources : undefined,
    })
  }

  return [...byCanonical.values()].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  )
}

export function remapCommanderIdMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, at] of Object.entries(map)) {
    const canonical = canonicalizeIssueId(id)
    const prev = out[canonical]
    if (!prev || at > prev) out[canonical] = at
  }
  return out
}

export function normalizeOperatorInboxSnapshot(snapshot: OperatorInboxSnapshot): OperatorInboxSnapshot {
  const byCanonical = new Map<string, OperatorInboxItem>()

  for (const item of snapshot.items) {
    const canonicalId = canonicalizeIssueId(item.id)
    const existing = byCanonical.get(canonicalId)
    const sources = mergeSources(existing?.source, item.source)

    if (!existing) {
      byCanonical.set(canonicalId, {
        ...item,
        id: canonicalId,
        title: CANONICAL_TITLES[canonicalId as CanonicalIssueId] ?? item.title,
        source: sources.length ? sources.join(', ') : item.source,
        mergedSources: sources.length ? sources : undefined,
      })
      continue
    }

    byCanonical.set(canonicalId, {
      ...existing,
      ...item,
      id: canonicalId,
      title: CANONICAL_TITLES[canonicalId as CanonicalIssueId] ?? existing.title,
      status: reconcileInboxStatus(existing.status, item.status),
      severity:
        SEVERITY_RANK[item.severity] < SEVERITY_RANK[existing.severity] ? item.severity : existing.severity,
      source: sources.join(', '),
      mergedSources: sources.length ? sources : undefined,
      createdAt: existing.createdAt,
      fixedAt: existing.fixedAt ?? item.fixedAt,
    })
  }

  return {
    ...snapshot,
    items: [...byCanonical.values()],
    commanderManualFixedAt: remapCommanderIdMap(snapshot.commanderManualFixedAt),
    commanderDismissedIds: remapCommanderIdMap(snapshot.commanderDismissedIds),
  }
}

function reconcileInboxStatus(a: OperatorInboxStatus, b: OperatorInboxStatus): OperatorInboxStatus {
  const rank: Record<OperatorInboxStatus, number> = {
    open: 4,
    in_progress: 3,
    fixed: 2,
    dismissed: 1,
  }
  return rank[a] >= rank[b] ? a : b
}

export function approvedUpgradeGapIds(queue: UpgradeQueueSnapshot = loadUpgradeQueue()): Set<string> {
  const ids = new Set<string>()
  for (const entry of queue.entries) {
    if (entry.status !== 'queued' && entry.status !== 'in_progress') continue
    ids.add(canonicalizeIssueId(entry.repairId))
    ids.add(canonicalizeIssueId(entry.repairId.replace(/^self-repair-/, '')))
  }
  return ids
}

export function inboxStatusNoteForItem(
  item: OperatorInboxItem,
  approvedGapIds: Set<string>,
): string | undefined {
  const canonical = canonicalizeIssueId(item.id)
  if (approvedGapIds.has(canonical) || approvedGapIds.has(item.id)) {
    return 'Approved upgrade queued'
  }
  return undefined
}

export function applyInboxUpgradeQueueReconciliation(
  items: OperatorInboxItem[],
  approvedGapIds: Set<string> = approvedUpgradeGapIds(),
): OperatorInboxItem[] {
  return items.map(item => {
    const note = inboxStatusNoteForItem(item, approvedGapIds)
    if (!note) return item
    if (item.status === 'fixed' || item.status === 'dismissed') return item
    return {
      ...item,
      status: 'in_progress',
      statusNote: note,
      plainMeaning: item.plainMeaning,
      recommendedAction: note,
    }
  })
}

export function normalizeSelfRepairGapIds(): void {
  const snapshot = loadSelfRepairSnapshot()
  let changed = false
  const records = snapshot.records.map(record => {
    const gapId = canonicalizeIssueId(record.gapId)
    if (gapId === record.gapId) return record
    changed = true
    return { ...record, gapId }
  })
  if (!changed) return
  saveSelfRepairSnapshot({ ...snapshot, records })
}

export function normalizeOperatorSessionStorage(): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return
  try {
    const raw = sessionStorage.getItem(OPERATOR_INBOX_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as OperatorInboxSnapshot
      if (parsed.version === 1 && Array.isArray(parsed.items)) {
        const normalized = normalizeOperatorInboxSnapshot(parsed)
        sessionStorage.setItem(OPERATOR_INBOX_STORAGE_KEY, JSON.stringify(normalized))
      }
    }
  } catch {
    /* private mode */
  }
  try {
    normalizeSelfRepairGapIds()
  } catch {
    /* ignore */
  }
}

export function formatMergedSourcesLine(gap: OperatorGap): string | null {
  const sources = gap.mergedSources?.length ? gap.mergedSources : gap.area ? [gap.area] : []
  if (sources.length < 2) return null
  return `Merged sources: ${sources.join(' · ')}`
}
