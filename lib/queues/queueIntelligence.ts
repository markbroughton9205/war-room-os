import 'server-only'

import { getRepairSnapshot } from '@/lib/council-repair'
import { listMissionSnapshot } from '@/lib/missions/persistence'
import type { Mission, MissionId } from '@/lib/missions/types'
import type { OperatorAction } from '@/lib/operator/deckTypes'
import { listRevenueEngineSnapshot } from '@/lib/revenue-engine/persistence'
import { collectRuntimeGraph } from '@/lib/runtime-graph/collect'
import type { RuntimeGraphNode, RuntimeGraphSnapshot } from '@/lib/runtime-graph/types'
import { listOperatorClassifiedSignalActions } from '@/lib/signals/operatorIntelligence'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import type { QueueDomain, QueueItem, QueueSeverity, QueueSnapshot, QueueSourceType, QueueTruthLabel, QueueWeights } from './types'

type Row = Record<string, unknown>

const OPERATOR_ALLOWED_TYPES: ReadonlySet<QueueSourceType> = new Set([
  'revenue_opportunity',
  'approval_request',
  'mission_action',
  'debt_progress',
  'operator_review',
  'income_task',
  'strategic_recommendation',
])

const OPERATOR_BLOCKED_TYPES: ReadonlySet<QueueSourceType> = new Set([
  'runtime_repair',
  'provider_repair',
  'schema_repair',
  'diagnostics',
  'infra_alert',
])

const TABLE_BY_DOMAIN: Record<QueueDomain, string> = {
  operator_priority_queue: 'operator_priority_queue',
  engineering_queue: 'engineering_queue',
  runtime_queue: 'runtime_queue',
  revenue_queue: 'revenue_queue',
  council_queue: 'council_queue',
}

const DOMAIN_CAP: Record<QueueDomain, number | null> = {
  operator_priority_queue: 4,
  engineering_queue: 20,
  runtime_queue: 20,
  revenue_queue: 20,
  council_queue: 20,
}

const INTERNAL_LANGUAGE = /\b(runtime|schema|provider|diagnostic|infra|telemetry|generatecontent|red_team_coder|runtime_graph|supabase|gemini|api health|repair packet)\b|[_/][a-z0-9]/i

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function bool(value: unknown): boolean {
  return value === true
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function money(value: number | null): string {
  if (value == null) return 'Estimated reward not logged'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function timeLabel(minutes: number | null): string {
  if (minutes == null) return 'Time not logged'
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`
}

function severityFromWeights(urgency: number, dependency: number): QueueSeverity {
  const score = Math.max(urgency, dependency)
  if (score >= 85) return 'critical'
  if (score >= 70) return 'important'
  if (score >= 45) return 'watch'
  return 'info'
}

export function calculatePriorityScore(weights: Pick<QueueWeights, 'revenue' | 'mission' | 'urgency' | 'dependency' | 'confidence'>): number {
  return Math.round(
    (clamp(weights.revenue) * 0.35)
    + (clamp(weights.mission) * 0.25)
    + (clamp(weights.urgency) * 0.15)
    + (clamp(weights.dependency) * 0.15)
    + (clamp(weights.confidence) * 0.10),
  )
}

function translateTechnicalTitle(title: string, sourceType: QueueSourceType): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  const lower = clean.toLowerCase()
  if (/gemini|generatecontent/.test(lower)) return 'Restore Research Intelligence Lane'
  if (/red[_ -]?team[_ -]?coder/.test(lower)) return 'Restore Defensive Monitoring Layer'
  if (/runtime[_ -]?graph[_ -]?degraded|operational visibility|telemetry/.test(lower)) return 'Operational Visibility Reduced'
  if (/schema|supabase/.test(lower)) return 'Restore Data Reliability Layer'
  if (/provider/.test(lower)) return 'Restore Intelligence Provider Lane'
  if (/latency/.test(lower)) return 'Improve Decision Speed'
  if (/outage|unavailable|degraded/.test(lower)) return 'Restore Critical War Room Visibility'
  if (sourceType === 'operator_review') return clean.replace(/^unblock runtime system:\s*/i, 'Protect business visibility: ')
  return clean
}

function businessDescription(title: string, description: string, sourceType: QueueSourceType): string {
  const translated = translateTechnicalTitle(title, sourceType)
  if (sourceType === 'operator_review') {
    return `${translated} is affecting confidence in business decisions. Review the impact and decide whether to route it to Engineering.`
  }
  return description
}

function isOperatorSafe(item: QueueItem): boolean {
  if (!item.operatorVisible) return false
  if (!OPERATOR_ALLOWED_TYPES.has(item.sourceType)) return false
  if (OPERATOR_BLOCKED_TYPES.has(item.sourceType)) return false
  if (INTERNAL_LANGUAGE.test(item.translatedTitle)) return false
  if (INTERNAL_LANGUAGE.test(item.description) && item.sourceType !== 'operator_review') return false
  return true
}

function missionForText(value: string, missions: Mission[]): MissionId {
  const lower = value.toLowerCase()
  const matched = missions.find(mission => lower.includes(mission.title.toLowerCase()))
  if (matched) return matched.id
  if (/\b(content|media|calendar)\b/.test(lower)) return 'content-automation'
  if (/\b(automation|smb|customer|service)\b/.test(lower)) return 'automation-services'
  if (/\b(real estate|property|akron|ohio)\b/.test(lower)) return 'real-estate-monitor'
  if (/\b(debt|freedom)\b/.test(lower)) return 'debt-freedom-trigger'
  return 'phase-0-cashflow-base'
}

function buildItem(input: {
  id: string
  queueType: QueueDomain
  title: string
  description: string
  sourceType: QueueSourceType
  confidence: number
  revenueImpact: number
  missionImpact: number
  urgency: number
  dependency: number
  debtFreedom?: number
  operatorTime?: number
  estimatedMinutes?: number | null
  approvalRequired?: boolean
  operatorVisible?: boolean
  engineeringVisible?: boolean
  createdAt?: string
  resolvedAt?: string | null
  truthLabel?: QueueTruthLabel
  severity?: QueueSeverity
}): QueueItem {
  const weights: QueueWeights = {
    revenue: clamp(input.revenueImpact),
    mission: clamp(input.missionImpact),
    urgency: clamp(input.urgency),
    dependency: clamp(input.dependency),
    confidence: clamp(input.confidence),
    debtFreedom: clamp(input.debtFreedom ?? 0),
    operatorTime: clamp(input.operatorTime ?? 0),
  }
  const translatedTitle = input.queueType === 'operator_priority_queue'
    ? translateTechnicalTitle(input.title, input.sourceType)
    : input.title

  return {
    id: input.id,
    queueType: input.queueType,
    title: input.title,
    translatedTitle,
    description: input.queueType === 'operator_priority_queue'
      ? businessDescription(input.title, input.description, input.sourceType)
      : input.description,
    sourceType: input.sourceType,
    severity: input.severity ?? severityFromWeights(weights.urgency, weights.dependency),
    confidence: weights.confidence,
    revenueImpact: weights.revenue,
    missionImpact: weights.mission,
    estimatedMinutes: input.estimatedMinutes ?? null,
    approvalRequired: input.approvalRequired ?? true,
    operatorVisible: input.operatorVisible ?? input.queueType === 'operator_priority_queue',
    engineeringVisible: input.engineeringVisible ?? input.queueType !== 'operator_priority_queue',
    createdAt: input.createdAt ?? new Date().toISOString(),
    resolvedAt: input.resolvedAt ?? null,
    priorityScore: calculatePriorityScore(weights),
    truthLabel: input.truthLabel ?? (input.approvalRequired === false ? 'PROPOSED' : 'APPROVAL_REQUIRED'),
    weights,
    canExecute: false,
  }
}

function itemFromRow(row: Row, queueType: QueueDomain): QueueItem | null {
  const sourceType = text(row.source_type) as QueueSourceType
  if (!sourceType) return null
  const confidence = clamp(num(row.confidence) ?? 0)
  const revenueImpact = clamp(num(row.revenue_impact) ?? 0)
  const missionImpact = clamp(num(row.mission_impact) ?? 0)
  const priorityScore = calculatePriorityScore({
    revenue: revenueImpact,
    mission: missionImpact,
    urgency: clamp(num(row.urgency_impact) ?? num(row.severity_score) ?? 50),
    dependency: clamp(num(row.dependency_blocking) ?? 0),
    confidence,
  })
  const item = buildItem({
    id: text(row.id),
    queueType,
    title: text(row.title),
    description: text(row.description),
    sourceType,
    confidence,
    revenueImpact,
    missionImpact,
    urgency: clamp(num(row.urgency_impact) ?? num(row.severity_score) ?? 50),
    dependency: clamp(num(row.dependency_blocking) ?? 0),
    estimatedMinutes: num(row.estimated_minutes),
    approvalRequired: bool(row.approval_required),
    operatorVisible: bool(row.operator_visible),
    engineeringVisible: bool(row.engineering_visible),
    createdAt: text(row.created_at, new Date().toISOString()),
    resolvedAt: nullableText(row.resolved_at),
    truthLabel: text(row.truth_label, 'SOURCE_BACKED') as QueueTruthLabel,
    severity: text(row.severity, 'watch') as QueueSeverity,
  })
  return { ...item, priorityScore }
}

async function listPersistedItems(client: WarRoomSupabase, queueType: QueueDomain): Promise<QueueItem[] | null> {
  const { data, error } = await client
    .from(TABLE_BY_DOMAIN[queueType])
    .select('*')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return null
  return ((data ?? []) as Row[]).map(row => itemFromRow(row, queueType)).filter(Boolean) as QueueItem[]
}

async function operatorSignalIntelligenceItems(missions: Mission[]): Promise<QueueItem[]> {
  const actions = await listOperatorClassifiedSignalActions(missions)
  return actions.map(action => buildItem({
    id: action.id,
    queueType: 'operator_priority_queue',
    title: action.title,
    description: action.linkedMissionTitle,
    sourceType: 'strategic_recommendation',
    confidence: action.confidence,
    revenueImpact: 35,
    missionImpact: 70,
    urgency: action.confidence >= 75 ? 78 : 58,
    dependency: 40,
    estimatedMinutes: action.estimatedTimeMinutes,
    approvalRequired: true,
    truthLabel: action.truthLabel === 'SOURCE_BACKED'
      ? 'SOURCE_BACKED'
      : action.truthLabel === 'APPROVAL_REQUIRED'
        ? 'APPROVAL_REQUIRED'
        : 'PROPOSED',
    severity: action.confidence >= 80 ? 'important' : 'watch',
  }))
}

function operatorItemsFromSources(graph: RuntimeGraphSnapshot, missions: Mission[]): QueueItem[] {
  const revenue = graph.nodes
    .filter(node => node.kind === 'revenue')
    .map(node => buildItem({
      id: `operator:revenue:${node.id}`,
      queueType: 'operator_priority_queue',
      title: `Review revenue opportunity: ${node.label}`,
      description: `Revenue-backed candidate from current War Room sources. Decide whether it deserves manual approval or focused research.`,
      sourceType: 'revenue_opportunity',
      confidence: node.score,
      revenueImpact: node.score,
      missionImpact: 75,
      urgency: 65,
      dependency: 35,
      debtFreedom: node.score,
      estimatedMinutes: 15,
      approvalRequired: true,
      truthLabel: 'SOURCE_BACKED',
    }))

  const approvals = graph.nodes
    .filter(node => node.kind === 'approval' && (node.status === 'requested' || node.status === 'pending'))
    .map(node => buildItem({
      id: `operator:approval:${node.id}`,
      queueType: 'operator_priority_queue',
      title: `Decide approval request: ${node.label}`,
      description: `A pending decision is blocking a real War Room loop. Approve, reject, or ask for more evidence manually.`,
      sourceType: 'approval_request',
      confidence: node.score,
      revenueImpact: /revenue|income|cash|client|lead/i.test(node.label) ? 80 : 45,
      missionImpact: 80,
      urgency: 82,
      dependency: 86,
      estimatedMinutes: 5,
      approvalRequired: true,
      truthLabel: 'APPROVAL_REQUIRED',
    }))

  const missionActions = missions
    .filter(mission => mission.status === 'ACTIVE' || mission.status === 'AT_TRIGGER' || mission.status === 'BLOCKED')
    .map(mission => buildItem({
      id: `operator:mission:${mission.id}`,
      queueType: 'operator_priority_queue',
      title: mission.id === 'debt-freedom-trigger' ? 'Move debt freedom trigger forward' : `Advance ${mission.title}`,
      description: `${mission.current_stage}. Choose the next manual move that improves mission momentum without hidden execution.`,
      sourceType: mission.id === 'debt-freedom-trigger' ? 'debt_progress' : 'mission_action',
      confidence: mission.approval_state === 'pending' ? 82 : 65,
      revenueImpact: mission.revenue_score,
      missionImpact: mission.priority_score,
      urgency: mission.status === 'AT_TRIGGER' ? 85 : 55,
      dependency: mission.blocker_score,
      debtFreedom: mission.id === 'debt-freedom-trigger' ? mission.priority_score : mission.revenue_score,
      estimatedMinutes: 20,
      approvalRequired: mission.approval_state === 'pending',
      truthLabel: mission.approval_state === 'pending' ? 'APPROVAL_REQUIRED' : 'SOURCE_BACKED',
    }))

  const criticalRuntime = graph.derived.overloadRisk >= 85
    ? graph.nodes
      .filter(node => node.kind === 'subsystem' && (node.health === 'degraded' || node.health === 'unavailable'))
      .slice(0, 2)
      .map(node => buildItem({
        id: `operator:impact:${node.id}`,
        queueType: 'operator_priority_queue',
        title: node.id.includes('runtime_graph') ? 'runtime_graph_degraded' : `Operational visibility reduced: ${node.label}`,
        description: `A critical system condition may reduce decision confidence. Route to Engineering if this blocks revenue or approval work.`,
        sourceType: 'operator_review',
        confidence: node.score,
        revenueImpact: 20,
        missionImpact: 62,
        urgency: 88,
        dependency: 92,
        estimatedMinutes: 10,
        approvalRequired: false,
        truthLabel: 'SOURCE_BACKED',
        severity: 'critical',
      }))
    : []

  return [...revenue, ...approvals, ...missionActions, ...criticalRuntime]
}

function engineeringItemsFromGraph(graph: RuntimeGraphSnapshot): QueueItem[] {
  const providerRepairs = graph.nodes
    .filter(node => node.kind === 'provider' && node.health !== 'healthy')
    .map(node => buildEngineeringNode(node, 'provider_repair', 'engineering_queue'))
  const runtimeRepairs = graph.nodes
    .filter(node => node.kind === 'subsystem' && node.health !== 'healthy')
    .map(node => buildEngineeringNode(node, 'runtime_repair', 'engineering_queue'))
  const diagnostics = graph.derived.blockedSystems.concat(graph.derived.degradedProviders).map((label, index) => buildItem({
    id: `engineering:diagnostics:${index}:${label}`,
    queueType: 'engineering_queue',
    title: `Diagnostics: ${label}`,
    description: `Raw diagnostics source from runtime graph: ${label}`,
    sourceType: 'diagnostics',
    confidence: 70,
    revenueImpact: 0,
    missionImpact: 45,
    urgency: 70,
    dependency: 70,
    estimatedMinutes: 20,
    approvalRequired: false,
    operatorVisible: false,
    engineeringVisible: true,
    truthLabel: 'SOURCE_BACKED',
  }))
  return [...providerRepairs, ...runtimeRepairs, ...diagnostics]
}

function runtimeItemsFromGraph(graph: RuntimeGraphSnapshot): QueueItem[] {
  return graph.nodes
    .filter(node => (node.kind === 'provider' || node.kind === 'subsystem') && node.health !== 'healthy')
    .map(node => buildEngineeringNode(node, node.kind === 'provider' ? 'provider_repair' : 'infra_alert', 'runtime_queue'))
}

function buildEngineeringNode(node: RuntimeGraphNode, sourceType: QueueSourceType, queueType: QueueDomain): QueueItem {
  const urgency = node.health === 'unavailable' ? 90 : node.health === 'degraded' ? 74 : 45
  return buildItem({
    id: `${queueType}:${sourceType}:${node.id}`,
    queueType,
    title: `${sourceType}: ${node.id}`,
    description: `${node.label} status=${node.status}; health=${node.health}; evidence=${node.evidence.join(' | ')}`,
    sourceType,
    confidence: node.score,
    revenueImpact: 0,
    missionImpact: 45,
    urgency,
    dependency: urgency,
    estimatedMinutes: 30,
    approvalRequired: false,
    operatorVisible: false,
    engineeringVisible: true,
    truthLabel: 'SOURCE_BACKED',
    severity: urgency >= 85 ? 'critical' : 'important',
  })
}

async function revenueItemsFromSources(): Promise<QueueItem[]> {
  const snapshot = await listRevenueEngineSnapshot(30)
  const opportunities = snapshot.opportunities.map(opportunity => buildItem({
    id: `revenue:opportunity:${opportunity.id}`,
    queueType: 'revenue_queue',
    title: opportunity.title,
    description: opportunity.nextReviewAction,
    sourceType: opportunity.category === 'smb_automation' ? 'automation_income' : 'revenue_opportunity',
    confidence: opportunity.score.confidence,
    revenueImpact: opportunity.score.leverageScore,
    missionImpact: opportunity.score.strategicAlignment,
    urgency: opportunity.score.urgency,
    dependency: opportunity.score.automationPotential,
    debtFreedom: opportunity.score.leverageScore,
    estimatedMinutes: opportunity.estimatedTimeHours == null ? null : Math.round(opportunity.estimatedTimeHours * 60),
    approvalRequired: opportunity.guardrails.approvalRequired,
    operatorVisible: false,
    engineeringVisible: false,
    truthLabel: 'SOURCE_BACKED',
  }))
  const alerts = snapshot.strategicAlerts.map(alert => buildItem({
    id: `revenue:alert:${alert.id}`,
    queueType: 'revenue_queue',
    title: alert.title,
    description: alert.summary,
    sourceType: alert.kind === 'compounding_opportunity' ? 'recurring_revenue_action' : 'lead_generation',
    confidence: 70,
    revenueImpact: alert.severity === 'critical' ? 90 : alert.severity === 'important' ? 75 : 50,
    missionImpact: 65,
    urgency: alert.severity === 'critical' ? 90 : 65,
    dependency: 35,
    estimatedMinutes: 15,
    approvalRequired: alert.approvalRequired,
    operatorVisible: false,
    engineeringVisible: false,
    truthLabel: 'SOURCE_BACKED',
    severity: alert.severity,
  }))
  return [...opportunities, ...alerts]
}

function councilItemsFromSources(): QueueItem[] {
  const snapshot = getRepairSnapshot()
  const packetItems = snapshot.packets.map(packet => buildItem({
    id: `council:packet:${packet.id}`,
    queueType: 'council_queue',
    title: packet.title,
    description: packet.source.decree,
    sourceType: packet.classification.includes('security') ? 'contradiction_analysis' : 'research_packet',
    confidence: 75,
    revenueImpact: 0,
    missionImpact: 65,
    urgency: packet.classification.includes('provider') || packet.classification.includes('schema') ? 80 : 55,
    dependency: 70,
    estimatedMinutes: 20,
    approvalRequired: true,
    operatorVisible: false,
    engineeringVisible: false,
    truthLabel: 'APPROVAL_REQUIRED',
  }))
  const requestItems = snapshot.requests.map(request => buildItem({
    id: `council:proposal:${request.id}`,
    queueType: 'council_queue',
    title: request.decree,
    description: request.sourceContent ?? 'Council proposal awaiting review.',
    sourceType: 'council_proposal',
    confidence: 65,
    revenueImpact: 0,
    missionImpact: 55,
    urgency: 55,
    dependency: 40,
    estimatedMinutes: 10,
    approvalRequired: true,
    operatorVisible: false,
    engineeringVisible: false,
    truthLabel: 'PROPOSED',
  }))
  return [...packetItems, ...requestItems]
}

function rankAndFilter(queueType: QueueDomain, items: QueueItem[]): { items: QueueItem[]; rejectedOperatorItemCount: number } {
  const byId = new Map<string, QueueItem>()
  items.forEach(item => {
    const current = byId.get(item.id)
    if (!current || item.priorityScore > current.priorityScore) byId.set(item.id, item)
  })
  let rejectedOperatorItemCount = 0
  let filtered = [...byId.values()].filter(item => !item.resolvedAt)
  if (queueType === 'operator_priority_queue') {
    const before = filtered.length
    filtered = filtered.filter(isOperatorSafe)
    rejectedOperatorItemCount = before - filtered.length
  }
  const ranked = filtered.sort((a, b) => b.priorityScore - a.priorityScore || b.confidence - a.confidence)
  const cap = DOMAIN_CAP[queueType]
  return { items: cap == null ? ranked : ranked.slice(0, cap), rejectedOperatorItemCount }
}

export function queueItemToOperatorAction(item: QueueItem, missions: Mission[]): OperatorAction {
  const missionId = missionForText(`${item.translatedTitle} ${item.description}`, missions)
  const mission = missions.find(candidate => candidate.id === missionId)
  return {
    id: item.id,
    title: item.translatedTitle,
    linkedMission: missionId,
    linkedMissionTitle: item.description,
    estimatedPay: item.revenueImpact > 0 ? Math.round(item.revenueImpact * 10) : null,
    estimatedPayLabel: item.revenueImpact > 0 ? `${money(Math.round(item.revenueImpact * 10))} impact estimate` : 'Business impact review',
    estimatedTimeMinutes: item.estimatedMinutes,
    estimatedTimeLabel: timeLabel(item.estimatedMinutes),
    source: item.sourceType === 'revenue_opportunity' || item.sourceType === 'income_task' ? 'revenue' : item.sourceType === 'approval_request' ? 'approval' : 'operator',
    sourceId: item.id,
    confidence: item.confidence,
    approvalState: item.approvalRequired ? 'approval_required' : 'not_required',
    status: 'proposed',
    optionalLink: null,
    createdAt: item.createdAt,
    truthLabel: item.truthLabel === 'SOURCE_BACKED' ? 'SOURCE_BACKED' : item.approvalRequired ? 'APPROVAL_REQUIRED' : 'PROPOSED',
    evidence: [
      `priority_score=${item.priorityScore}`,
      `queue_type=${item.queueType}`,
      `business_impact=${mission?.title ?? missionId}`,
    ],
  }
}

async function derivedItems(queueType: QueueDomain, req: Request): Promise<QueueItem[]> {
  if (queueType === 'revenue_queue') return revenueItemsFromSources()
  if (queueType === 'council_queue') return councilItemsFromSources()

  const [graph, missionSnapshot] = await Promise.all([
    collectRuntimeGraph(req),
    listMissionSnapshot(),
  ])
  if (queueType === 'operator_priority_queue') {
    const base = operatorItemsFromSources(graph, missionSnapshot.missions)
    const signals = await operatorSignalIntelligenceItems(missionSnapshot.missions)
    return [...signals, ...base]
  }
  if (queueType === 'engineering_queue') return engineeringItemsFromGraph(graph)
  return runtimeItemsFromGraph(graph)
}

export async function collectQueueSnapshot(req: Request, queueType: QueueDomain): Promise<QueueSnapshot> {
  const [sourceItems, missionSnapshot] = await Promise.all([
    derivedItems(queueType, req),
    listMissionSnapshot(),
  ])
  const supabase = tryWarRoomSupabase()
  const persisted = supabase.ok ? await listPersistedItems(supabase.client, queueType) : null
  const merged = [...(persisted ?? []), ...sourceItems]
  const ranked = rankAndFilter(queueType, merged)
  const operatorQueue = queueType === 'operator_priority_queue'

  return {
    generatedAt: new Date().toISOString(),
    queueType,
    items: ranked.items,
    actions: operatorQueue ? ranked.items.map(item => queueItemToOperatorAction(item, missionSnapshot.missions)) : undefined,
    diagnostics: {
      sourceItemCount: sourceItems.length,
      persistedItemCount: persisted?.length ?? 0,
      rejectedOperatorItemCount: ranked.rejectedOperatorItemCount,
      cappedAt: DOMAIN_CAP[queueType],
      sortedBy: 'priority_score',
    },
    guardrails: {
      noAutonomousExecution: true,
      approvalGatesPreserved: true,
      operatorJargonFiltered: operatorQueue,
      engineeringInternalsIsolated: operatorQueue || queueType === 'engineering_queue',
    },
  }
}
