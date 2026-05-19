import type { MissionId } from '@/lib/missions/types'
import type { RuntimeGraphNode, RuntimeGraphSnapshot } from '@/lib/runtime-graph/types'
import type { PriorityActionCandidate, PriorityEngineSnapshot } from './types'

const GENERIC_ACTION_TEXT = /^(review approval queue|prepare repair packet|run signal scan|log outcome|open engineering diagnostics|no urgent action|request better queue|loading|pending|not available)$/i
const REPAIR_BUTTON_LABEL = /^(repair|approve|reject|modify|archive|invoke provider|request packet|investigate|mark complete|skip)$/i

function isSpecificActionTitle(title: string): boolean {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (clean.length < 12) return false
  if (GENERIC_ACTION_TEXT.test(clean)) return false
  if (REPAIR_BUTTON_LABEL.test(clean)) return false
  return /[a-z0-9]/i.test(clean)
}

function missionForNode(node: RuntimeGraphNode): MissionId {
  const text = `${node.label} ${node.evidence.join(' ')}`.toLowerCase()
  if (/\b(content|calendar|media)\b/.test(text)) return 'content-automation'
  if (/\b(automation|smb|service|intake|customer)\b/.test(text)) return 'automation-services'
  if (/\b(real estate|property|akron|ohio)\b/.test(text)) return 'real-estate-monitor'
  if (/\b(debt|freedom)\b/.test(text)) return 'debt-freedom-trigger'
  return 'phase-0-cashflow-base'
}

function qualitativeValue(score: number): string {
  if (score >= 85) return 'High leverage'
  if (score >= 70) return 'Medium-high leverage'
  if (score >= 50) return 'Medium leverage'
  return 'Low confidence value'
}

function candidateFromNode(node: RuntimeGraphNode, graph: RuntimeGraphSnapshot): PriorityActionCandidate | null {
  const linkedMission = missionForNode(node)
  const pressureBoost = Math.round((graph.derived.operationalPressure + graph.derived.missionDecay) / 8)
  if (node.kind === 'approval' && (node.status === 'requested' || node.status === 'pending')) {
    const title = `Decide approval request: ${node.label}`
    if (!isSpecificActionTitle(title)) return null
    return {
      id: `priority:${node.id}`,
      title,
      estimatedValue: 'Unlocks or rejects a real pending loop',
      estimatedTime: '5-10 min',
      linkedMission,
      confidence: Math.max(60, Math.min(95, node.score)),
      approvalState: 'pending_approval',
      source: 'approval',
      sourceId: node.id,
      evidence: node.evidence,
      score: node.score + pressureBoost + 18,
      canExecute: false,
    }
  }

  if (node.kind === 'signal' && node.health === 'healthy') {
    const title = `Evaluate source-backed signal: ${node.label}`
    if (!isSpecificActionTitle(title)) return null
    return {
      id: `priority:${node.id}`,
      title,
      estimatedValue: qualitativeValue(node.score),
      estimatedTime: '10-20 min',
      linkedMission,
      confidence: Math.max(45, Math.min(92, node.score)),
      approvalState: 'approval_required',
      source: 'signal',
      sourceId: node.id,
      evidence: node.evidence,
      score: node.score + 12,
      canExecute: false,
    }
  }

  if (node.kind === 'revenue') {
    const title = `Review revenue candidate: ${node.label}`
    if (!isSpecificActionTitle(title)) return null
    return {
      id: `priority:${node.id}`,
      title,
      estimatedValue: qualitativeValue(node.score),
      estimatedTime: '15-25 min',
      linkedMission,
      confidence: Math.max(40, Math.min(90, node.score)),
      approvalState: 'approval_required',
      source: 'revenue',
      sourceId: node.id,
      evidence: node.evidence,
      score: node.score + 8,
      canExecute: false,
    }
  }

  if (node.kind === 'subsystem' && (node.health === 'degraded' || node.health === 'unavailable')) {
    const title = `Unblock runtime system: ${node.label}`
    if (!isSpecificActionTitle(title)) return null
    return {
      id: `priority:${node.id}`,
      title,
      estimatedValue: 'Reduces operational pressure',
      estimatedTime: '10-15 min',
      linkedMission: 'phase-0-cashflow-base',
      confidence: Math.max(40, Math.min(90, node.score)),
      approvalState: 'not_required',
      source: 'runtime_graph',
      sourceId: node.id,
      evidence: node.evidence,
      score: pressureBoost + Math.max(0, 100 - node.score),
      canExecute: false,
    }
  }

  return null
}

export function buildPriorityEngineSnapshot(graph: RuntimeGraphSnapshot): PriorityEngineSnapshot {
  const rawCandidates = graph.nodes
    .map(node => candidateFromNode(node, graph))
    .filter(Boolean) as PriorityActionCandidate[]
  const byTitle = new Map<string, PriorityActionCandidate>()
  rawCandidates.forEach(candidate => {
    const existing = byTitle.get(candidate.title)
    if (!existing || candidate.score > existing.score) byTitle.set(candidate.title, candidate)
  })
  const ranked = [...byTitle.values()].sort((a, b) => b.score - a.score)
  const actionQueue = ranked.slice(0, 4)

  return {
    generatedAt: new Date().toISOString(),
    highestLeverageAction: actionQueue[0] ?? null,
    actionQueue,
    graph,
    diagnostics: {
      candidateCount: rawCandidates.length,
      rejectedGenericCount: Math.max(0, graph.nodes.length - rawCandidates.length),
      overloadRisk: graph.derived.overloadRisk,
      focusFragmentation: graph.derived.focusFragmentation,
    },
    guardrails: {
      noGenericPlaceholders: true,
      noRepairButtonLabels: true,
      noAutonomousExecution: true,
      humanApprovalAuthorityPreserved: true,
    },
  }
}
