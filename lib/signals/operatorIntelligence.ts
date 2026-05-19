import 'server-only'

import type { Mission, MissionId } from '@/lib/missions/types'
import type { OperatorAction } from '@/lib/operator/deckTypes'
import type { QueueItem, QueueTruthLabel } from '@/lib/queues/types'
import { isOperatorActionableClassifiedSignal } from './classification'
import type { SignalResult } from './model'
import { listPersistedSignalSnapshot } from './persistence'

function compact(value: string, limit = 140): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

function missionForSignal(result: SignalResult, missions: Mission[]): MissionId {
  const category = String(result.metadata.intelligenceCategory ?? result.category)
  const text = `${category} ${result.summary}`
  const matched = missions.find(mission => text.toLowerCase().includes(mission.title.toLowerCase()))
  if (matched) return matched.id
  if (/debt|layoff|warning|risk/.test(text)) return 'debt-freedom-trigger'
  if (/akron|ohio|local/.test(text)) return 'real-estate-monitor'
  if (/automation|smb|customer/.test(text)) return 'automation-services'
  if (/content|media/.test(text)) return 'content-automation'
  return 'phase-0-cashflow-base'
}

function queueTruthLabel(result: SignalResult): QueueTruthLabel {
  const label = result.metadata.intelligenceTruthLabel
  if (label === 'SOURCE_BACKED') return 'SOURCE_BACKED'
  if (label === 'APPROVAL_REQUIRED') return 'APPROVAL_REQUIRED'
  return 'PROPOSED'
}

export function signalToOperatorAction(result: SignalResult, missions: Mission[]): OperatorAction {
  const missionId = missionForSignal(result, missions)
  const classificationConfidence = typeof result.metadata.classificationConfidence === 'number'
    ? Math.round(result.metadata.classificationConfidence)
    : Math.round(result.scores.confidence)
  const canonical = typeof result.metadata.canonicalSummary === 'string'
    ? result.metadata.canonicalSummary
    : result.summary

  return {
    id: `signal-intel:${result.id}`,
    title: compact(canonical, 120),
    linkedMission: missionId,
    linkedMissionTitle: compact(canonical, 200),
    estimatedPay: null,
    estimatedPayLabel: 'Intelligence review — no income claimed',
    estimatedTimeMinutes: 15,
    estimatedTimeLabel: '15 min',
    source: 'signal',
    sourceId: result.id,
    confidence: classificationConfidence,
    approvalState: 'approval_required',
    status: 'proposed',
    optionalLink: result.url.startsWith('https://') ? result.url : null,
    createdAt: result.capturedAt,
    truthLabel: queueTruthLabel(result) === 'SOURCE_BACKED' ? 'SOURCE_BACKED' : 'APPROVAL_REQUIRED',
    evidence: [
      `operational_class=${String(result.metadata.operationalClass)}`,
      `intelligence_category=${String(result.metadata.intelligenceCategory)}`,
      `severity=${String(result.metadata.intelligenceSeverity)}`,
      `raw_headline=${String(result.metadata.rawHeadline ?? result.title)}`,
      `classification_confidence=${classificationConfidence}`,
    ],
  }
}

export async function listOperatorClassifiedSignalActions(missions: Mission[]): Promise<OperatorAction[]> {
  const snapshot = await listPersistedSignalSnapshot(80)
  return snapshot.results
    .filter(isOperatorActionableClassifiedSignal)
    .slice(0, 4)
    .map(result => signalToOperatorAction(result, missions))
}

export function isOperatorClassifiedSignalItem(item: QueueItem): boolean {
  return item.id.startsWith('signal-intel:')
}

export function filterOperatorClassifiedQueueItems(items: QueueItem[]): QueueItem[] {
  return items.filter(item => !isOperatorClassifiedSignalItem(item) || item.truthLabel !== 'PROPOSED')
}
