import 'server-only'

import { collapseDuplicateNarratives, detectContradictionGroups } from '../contradictions'
import { enrichSignalResult } from '../freshness'
import type { SignalResult, SignalSourceDefinition } from '../model'
import { classifySignal, withClassificationMetadata } from './classify'
import type { ClassificationPipelineDiagnostics, IntelligenceOperationalClass } from './types'

function contradictionContextFor(
  signalId: string,
  groups: Map<string, string[]>,
): { groupId: string | null; peerIds: string[] } {
  for (const [groupId, peerIds] of groups.entries()) {
    if (!peerIds.includes(signalId)) continue
    return {
      groupId,
      peerIds: peerIds.filter(id => id !== signalId),
    }
  }
  return { groupId: null, peerIds: [] }
}

export function applySignalClassificationPipeline(
  results: SignalResult[],
  options?: { sources?: SignalSourceDefinition[] },
): { results: SignalResult[]; diagnostics: ClassificationPipelineDiagnostics } {
  const enriched = results.map(result => enrichSignalResult(result))
  const inputs = enriched.map(result => ({
    id: result.id,
    title: typeof result.metadata.rawHeadline === 'string' ? result.metadata.rawHeadline : result.title,
    summary: typeof result.metadata.rawSummary === 'string' ? result.metadata.rawSummary : result.summary,
    source: result.source,
    provider: result.provider,
    url: result.url,
    category: result.category,
    scores: result.scores,
    metadata: result.metadata,
    approvalStatus: result.approvalStatus,
  }))

  const { groups: narrativeGroups, representativeById, duplicateCountById } = collapseDuplicateNarratives(inputs)
  const contradictionGroups = detectContradictionGroups(inputs)
  const reliabilityBySourceLabel = new Map(
    (options?.sources ?? []).map(source => [source.label, source.reliabilityScore]),
  )

  const failures: ClassificationPipelineDiagnostics['failures'] = []
  const classified: SignalResult[] = []

  for (const result of enriched) {
    const rawTitle = typeof result.metadata.rawHeadline === 'string' ? result.metadata.rawHeadline : result.title
    const rawSummary = typeof result.metadata.rawSummary === 'string' ? result.metadata.rawSummary : result.summary
    const representativeId = representativeById.get(result.id) ?? result.id
    const isCollapsedDuplicate = representativeId !== result.id
    const narrativeGroup = narrativeGroups.find(group => group.memberIds.includes(result.id))
    const contradiction = contradictionContextFor(result.id, contradictionGroups)

    try {
      const classification = classifySignal(
        {
          id: result.id,
          title: rawTitle,
          summary: rawSummary,
          source: result.source,
          provider: result.provider,
          url: result.url,
          category: result.category,
          scores: result.scores,
          metadata: result.metadata,
          approvalStatus: result.approvalStatus,
        },
        {
          narrativeGroupId: narrativeGroup?.id ?? null,
          contradictionGroupId: contradiction.groupId,
          contradictionPeerIds: contradiction.peerIds,
          collapsedDuplicateCount: duplicateCountById.get(result.id) ?? 0,
          isCollapsedDuplicate,
          reliabilityScore: reliabilityBySourceLabel.get(result.source),
        },
      )
      classified.push(withClassificationMetadata(result, classification))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ signalId: result.id, error: message })
      classified.push(result)
    }
  }

  const countByClass = (value: IntelligenceOperationalClass) => classified.filter(
    item => item.metadata.operationalClass === value,
  ).length

  return {
    results: classified.sort((a, b) => b.scores.highestLeverage - a.scores.highestLeverage),
    diagnostics: {
      processedCount: classified.length,
      actionableCount: countByClass('ACTIONABLE'),
      watchlistCount: countByClass('WATCHLIST'),
      archivalCount: countByClass('ARCHIVAL'),
      conflictedCount: countByClass('CONFLICTED'),
      collapsedNarrativeCount: narrativeGroups.filter(group => group.memberIds.length > 1).length,
      contradictionGroups: contradictionGroups.size,
      failures,
    },
  }
}

/** Radar "actionable" bucket — includes PROPOSED RSS for monitoring, not operator truth. */
export function isActionableClassifiedSignal(result: SignalResult): boolean {
  return result.metadata.operationalClass === 'ACTIONABLE'
}

/** Operator surfaces: ACTIONABLE class with verified or approval-required truth (never raw RSS PROPOSED). */
export function isOperatorActionableClassifiedSignal(result: SignalResult): boolean {
  if (result.metadata.operationalClass !== 'ACTIONABLE') return false
  if (result.provider === 'rss') return false
  const truth = result.metadata.intelligenceTruthLabel
  return truth === 'SOURCE_BACKED' || truth === 'APPROVAL_REQUIRED'
}

export function partitionClassifiedSignals(results: SignalResult[]): {
  actionable: SignalResult[]
  watchlist: SignalResult[]
  conflicted: SignalResult[]
  stale: SignalResult[]
} {
  const actionable: SignalResult[] = []
  const watchlist: SignalResult[] = []
  const conflicted: SignalResult[] = []
  const stale: SignalResult[] = []

  for (const result of results) {
    const operationalClass = result.metadata.operationalClass
    const freshnessStatus = result.metadata.freshnessStatus
    if (operationalClass === 'CONFLICTED') {
      conflicted.push(result)
      continue
    }
    if (
      freshnessStatus === 'STALE'
      || freshnessStatus === 'ARCHIVAL'
      || freshnessStatus === 'UNKNOWN_DATE'
      || operationalClass === 'ARCHIVAL'
    ) {
      stale.push(result)
      continue
    }
    if (operationalClass === 'ACTIONABLE') {
      actionable.push(result)
      continue
    }
    watchlist.push(result)
  }

  return { actionable, watchlist, conflicted, stale }
}
