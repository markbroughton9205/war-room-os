import 'server-only'

import { listMissionSnapshot } from '@/lib/missions/persistence'
import { PERSISTENT_MISSION_IDS } from '@/lib/missions/definitions'
import type { Mission, MissionId } from '@/lib/missions/types'
import { createOutcomeEntry, listOutcomeSnapshot } from '@/lib/outcomes'
import { collectQueueSnapshot } from '@/lib/queues'
import { listOperatorClassifiedSignalActions } from '@/lib/signals/operatorIntelligence'
import { collectRuntimeGraph } from '@/lib/runtime-graph/collect'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import type {
  OperatorAction,
  OperatorActionCommand,
  OperatorActivity,
  OperatorDeckSnapshot,
  OperatorFinancialMetric,
  OperatorLogEarningsInput,
  OperatorMissionStatus,
  OperatorPacketSummary,
  OperatorTruthLabel,
  OperatorWriteResult,
} from './deckTypes'

type Row = Record<string, unknown>

const NOT_LOGGED = 'Not logged yet'
const DEBT_FREEDOM_TARGET = 100000
const CASHFLOW_TRIGGER = 600

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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function isMissionId(value: string): value is MissionId {
  return (PERSISTENT_MISSION_IDS as readonly string[]).includes(value)
}

function boundedScore(value: unknown, fallback = 0): number {
  const parsed = num(value)
  if (parsed == null) return fallback
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function money(value: number | null): string {
  if (value == null) return NOT_LOGGED
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function timeLabel(minutes: number | null, fallback: string): string {
  if (minutes == null) return fallback
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`
}

function missionTitleMap(missions: Mission[]): Map<MissionId, string> {
  return new Map(missions.map(mission => [mission.id, mission.title]))
}

function actionFromRow(row: Row, missions: Map<MissionId, string>): OperatorAction | null {
  const missionRaw = text(row.linked_mission)
  if (!isMissionId(missionRaw)) return null
  const status = text(row.status, 'proposed')
  const source = text(row.source, 'operator')
  return {
    id: text(row.id),
    title: text(row.title, 'Source-backed operator action'),
    linkedMission: missionRaw,
    linkedMissionTitle: missions.get(missionRaw) ?? missionRaw.replace(/-/g, ' '),
    estimatedPay: num(row.estimated_pay),
    estimatedPayLabel: money(num(row.estimated_pay)),
    estimatedTimeMinutes: num(row.estimated_time_minutes),
    estimatedTimeLabel: timeLabel(num(row.estimated_time_minutes), NOT_LOGGED),
    source: source === 'approval' || source === 'signal' || source === 'revenue' || source === 'outcome' || source === 'runtime_graph'
      ? source
      : 'operator',
    sourceId: nullableText(row.source_id),
    confidence: boundedScore(row.confidence),
    approvalState: text(row.approval_state) === 'not_required' ? 'not_required' : text(row.approval_state) === 'pending_approval' ? 'pending_approval' : 'approval_required',
    status: status === 'approved' || status === 'completed' || status === 'skipped' ? status : 'proposed',
    optionalLink: nullableText(row.optional_link),
    createdAt: text(row.created_at, new Date().toISOString()),
    truthLabel: text(row.truth_label) as OperatorTruthLabel || 'PROPOSED',
    evidence: stringArray(row.evidence),
  }
}

function missionStatus(mission: Mission): OperatorMissionStatus {
  const progress = Math.max(0, Math.min(100, Math.round((mission.priority_score + mission.momentum_score + mission.compounding_score - mission.blocker_score) / 3)))
  const triggers: Record<MissionId, string> = {
    'phase-0-cashflow-base': '$600 verified weekly cashflow trigger',
    'content-automation': 'source-backed content workflow ready',
    'automation-services': 'approved service packet ready',
    'real-estate-monitor': 'verified property/debt signal emerges',
    'debt-freedom-trigger': 'verified debt payoff path reaches trigger',
  }
  return {
    id: mission.id,
    title: mission.title,
    status: mission.status,
    keyMetric: `revenue ${mission.revenue_score} / blocker ${mission.blocker_score}`,
    progress,
    momentum: mission.momentum_score,
    lastUpdated: mission.updated_at,
    triggerCondition: triggers[mission.id],
    approvalState: mission.approval_state,
    truthLabel: mission.approval_state === 'pending' ? 'APPROVAL_REQUIRED' : 'SOURCE_BACKED',
  }
}

async function listOperatorRows(client: WarRoomSupabase) {
  const [actions, earnings, packets, activity] = await Promise.all([
    client.from('war_room_operator_actions').select('*').neq('status', 'completed').neq('status', 'skipped').order('confidence', { ascending: false }).order('created_at', { ascending: false }).limit(4),
    client.from('war_room_operator_earnings').select('*').order('created_at', { ascending: false }).limit(80),
    client.from('war_room_operator_packets').select('*').order('created_at', { ascending: false }).limit(1),
    client.from('war_room_operator_activity').select('*').order('created_at', { ascending: false }).limit(8),
  ])
  const firstError = [actions.error, earnings.error, packets.error, activity.error].find(Boolean)
  if (firstError) return null
  return {
    actions: (actions.data ?? []) as Row[],
    earnings: (earnings.data ?? []) as Row[],
    packets: (packets.data ?? []) as Row[],
    activity: (activity.data ?? []) as Row[],
  }
}

function activityFromRows(rows: Row[]): OperatorActivity[] {
  return rows.map(row => ({
    id: text(row.id),
    type: text(row.activity_type, 'operator'),
    summary: text(row.summary, 'Operator activity recorded.'),
    createdAt: text(row.created_at, new Date().toISOString()),
    truthLabel: text(row.truth_label) as OperatorTruthLabel || 'MANUAL_LOGGED',
  }))
}

function packetFromRow(row: Row | undefined): OperatorPacketSummary | null {
  if (!row) return null
  const status = text(row.status, 'pending')
  return {
    id: text(row.id),
    title: text(row.title, 'Operator approval packet'),
    status: status === 'approved' || status === 'drafted' || status === 'completed' ? status : 'pending',
    createdAt: text(row.created_at, new Date().toISOString()),
    truthLabel: text(row.truth_label) as OperatorTruthLabel || 'APPROVAL_REQUIRED',
  }
}

function financialTelemetry(earningsRows: Row[], outcomesActualRevenue: number, outcomeLast: string | null): OperatorFinancialMetric[] {
  const now = Date.now()
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const earnings = earningsRows.map(row => ({
    amount: num(row.amount_earned) ?? 0,
    createdAt: Date.parse(text(row.created_at)),
    sourceBacked: Boolean(row.source_uri),
  }))
  const weeklyManual = earnings
    .filter(row => Number.isFinite(row.createdAt) && row.createdAt >= weekAgo)
    .reduce((sum, row) => sum + row.amount, 0)
  const weeklyTotal = weeklyManual + outcomesActualRevenue
  const last = earningsRows[0]
  const projected = weeklyTotal > 0 ? (weeklyTotal / 7) * 30 : null
  const triggerProgress = weeklyTotal > 0 ? Math.max(0, Math.min(100, Math.round((weeklyTotal / CASHFLOW_TRIGGER) * 100))) : null
  const debtDistance = weeklyTotal > 0 ? Math.max(0, DEBT_FREEDOM_TARGET - weeklyTotal) : null
  const truth: OperatorTruthLabel = weeklyTotal > 0 ? 'MANUAL_LOGGED' : 'UNAVAILABLE'

  return [
    { key: 'liquid_balance', label: 'Liquid Balance', value: NOT_LOGGED, numericValue: null, progress: null, truthLabel: 'UNAVAILABLE', source: null },
    { key: 'weekly_earnings', label: 'Weekly Earnings', value: weeklyTotal > 0 ? money(weeklyTotal) : NOT_LOGGED, numericValue: weeklyTotal || null, progress: triggerProgress, truthLabel: truth, source: weeklyTotal > 0 ? 'operator earnings + outcome ledger' : null },
    { key: 'projected_30_day_income', label: 'Projected 30-Day Income', value: projected == null ? NOT_LOGGED : money(projected), numericValue: projected, progress: null, truthLabel: projected == null ? 'UNAVAILABLE' : 'MANUAL_LOGGED', source: projected == null ? null : 'manual/source-backed weekly earnings run-rate' },
    { key: 'six_hundred_trigger', label: 'Progress To $600 Trigger', value: triggerProgress == null ? NOT_LOGGED : `${triggerProgress}%`, numericValue: weeklyTotal || null, progress: triggerProgress, truthLabel: triggerProgress == null ? 'UNAVAILABLE' : 'MANUAL_LOGGED', source: triggerProgress == null ? null : 'manual/source-backed weekly earnings' },
    { key: 'debt_freedom_distance', label: 'Distance To Debt Freedom', value: debtDistance == null ? NOT_LOGGED : money(debtDistance), numericValue: debtDistance, progress: null, truthLabel: debtDistance == null ? 'UNAVAILABLE' : 'MANUAL_LOGGED', source: debtDistance == null ? null : 'operator debt freedom target minus logged earnings' },
    { key: 'last_logged_earning', label: 'Last Logged Earning', value: last ? money(num(last.amount_earned)) : outcomeLast ?? NOT_LOGGED, numericValue: last ? num(last.amount_earned) : null, progress: null, truthLabel: last || outcomeLast ? 'MANUAL_LOGGED' : 'UNAVAILABLE', source: last ? text(last.source_uri, 'manual operator log') : outcomeLast ? 'Outcome Ledger' : null },
  ]
}

export async function collectOperatorDeck(req: Request): Promise<OperatorDeckSnapshot> {
  const [operatorQueue, graph, missionSnapshot, outcomeSnapshot] = await Promise.all([
    collectQueueSnapshot(req, 'operator_priority_queue'),
    collectRuntimeGraph(req),
    listMissionSnapshot(),
    listOutcomeSnapshot(80),
  ])
  const missions = missionSnapshot.missions
  const missionTitles = missionTitleMap(missions)
  const supabase = tryWarRoomSupabase()
  const operatorRows = supabase.ok ? await listOperatorRows(supabase.client) : null
  const persistedActions = operatorRows?.actions.map(row => actionFromRow(row, missionTitles)).filter(Boolean) as OperatorAction[] | undefined
  const classifiedSignalActions = await listOperatorClassifiedSignalActions(missions)
  const proposedActions = (operatorQueue.actions ?? []).filter(action => {
    if (action.source !== 'signal') return true
    return classifiedSignalActions.some(candidate => candidate.id === action.id)
  })
  const mergedActions = [
    ...classifiedSignalActions,
    ...(proposedActions.length ? proposedActions : persistedActions ?? []),
  ]
  const seen = new Set<string>()
  const actionQueue = mergedActions.filter(action => {
    if (seen.has(action.id)) return false
    seen.add(action.id)
    if (action.source === 'signal') return classifiedSignalActions.some(candidate => candidate.id === action.id)
    return true
  }).slice(0, 4)
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const weeklyOutcomeActual = outcomeSnapshot.outcomes
    .filter(outcome => outcome.actualRevenue != null && Date.parse(outcome.createdAt) >= oneWeekAgo)
    .reduce((sum, outcome) => sum + (outcome.actualRevenue ?? 0), 0)
  const lastOutcome = outcomeSnapshot.outcomes.find(outcome => outcome.actualRevenue != null)
  const persistenceAvailable = Boolean(supabase.ok && operatorRows)

  return {
    generatedAt: new Date().toISOString(),
    persistenceAvailable,
    realtimeAvailable: false,
    stateLabel: actionQueue.length ? 'PROPOSED' : 'UNAVAILABLE',
    actionQueue,
    financialTelemetry: financialTelemetry(operatorRows?.earnings ?? [], weeklyOutcomeActual, lastOutcome ? money(lastOutcome.actualRevenue) : null),
    missions: missions.map(missionStatus),
    lastPacket: packetFromRow(operatorRows?.packets[0]),
    recentActivity: activityFromRows(operatorRows?.activity ?? []),
    integrations: {
      liveCouncil: 'PROPOSED',
      babyAiObserver: 'PROPOSED',
      revenueEngine: graph.nodes.some(node => node.kind === 'revenue') ? 'SOURCE_BACKED' : 'UNAVAILABLE',
      signalRadar: graph.nodes.some(node => node.kind === 'signal') ? 'SOURCE_BACKED' : 'UNAVAILABLE',
      growthCalendar: 'PROPOSED',
      outcomeLedger: outcomeSnapshot.outcomes.length ? 'MANUAL_LOGGED' : 'UNAVAILABLE',
      commanderOs: 'PROPOSED',
      approvalQueue: graph.nodes.some(node => node.kind === 'approval') ? 'APPROVAL_REQUIRED' : 'UNAVAILABLE',
    },
    guardrails: {
      noFakeEarnings: true,
      noFakeBalances: true,
      noHiddenActions: true,
      noAutonomousSpending: true,
      noAutomaticEmailSending: true,
      commanderApprovalRequired: true,
    },
  }
}

async function insertActivity(client: WarRoomSupabase, activityType: string, summary: string, truthLabel: OperatorTruthLabel) {
  await client.from('war_room_operator_activity').insert({
    activity_type: activityType,
    summary,
    truth_label: truthLabel,
    external_action_performed: false,
    autonomous_execution_performed: false,
    hidden_action_performed: false,
  })
}

async function upsertCandidates(client: WarRoomSupabase, candidates: OperatorAction[]) {
  if (!candidates.length) return
  await client.from('war_room_operator_actions').upsert(candidates.map(action => ({
    id: action.id,
    title: action.title,
    linked_mission: action.linkedMission,
    estimated_pay: action.estimatedPay,
    estimated_time_minutes: action.estimatedTimeMinutes,
    source: action.source,
    source_id: action.sourceId,
    confidence: action.confidence,
    approval_state: action.approvalState,
    status: 'proposed',
    optional_link: action.optionalLink,
    evidence: action.evidence,
    truth_label: action.truthLabel,
    human_approval_required: true,
    external_action_performed: false,
    autonomous_execution_performed: false,
    hidden_action_performed: false,
    income_claimed: false,
  })), { onConflict: 'id' })
}

export async function handleOperatorAction(req: Request, command: OperatorActionCommand): Promise<OperatorWriteResult> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return { ok: false, persistenceAvailable: false, message: 'Operator persistence unavailable. No action was changed.' }
  }

  if (command.command === 'request_better_queue') {
    const snapshot = await collectOperatorDeck(req)
    await upsertCandidates(supabase.client, snapshot.actionQueue)
    await insertActivity(supabase.client, 'queue_requested', snapshot.actionQueue.length ? 'Proposed queue refreshed from source-backed candidates.' : 'No source-backed actions available for a refreshed queue.', snapshot.actionQueue.length ? 'PROPOSED' : 'UNAVAILABLE')
    return { ok: true, persistenceAvailable: true, message: snapshot.actionQueue.length ? 'Proposed queue refreshed for Commander review.' : 'No source-backed actions yet.', snapshot: await collectOperatorDeck(req) }
  }

  if (command.command === 'skip') {
    await supabase.client.from('war_room_operator_actions').update({
      status: 'skipped',
      skip_reason: command.reason ?? null,
      completed_at: new Date().toISOString(),
    }).eq('id', command.actionId)
    await insertActivity(supabase.client, 'action_skipped', `Skipped action ${command.actionId}.`, 'MANUAL_LOGGED')
    return { ok: true, persistenceAvailable: true, message: 'Action skipped. It was retained for learning.', snapshot: await collectOperatorDeck(req) }
  }

  if (command.command === 'approve_last_packet') {
    if (!command.confirmed) return { ok: false, persistenceAvailable: true, message: 'Explicit Commander confirmation required.' }
    const { data } = await supabase.client.from('war_room_operator_packets').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle()
    const id = text((data as Row | null)?.id)
    if (!id) return { ok: false, persistenceAvailable: true, message: 'No packet is waiting for approval.' }
    await supabase.client.from('war_room_operator_packets').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', id)
    await insertActivity(supabase.client, 'packet_approved', 'Last operator packet approved by Commander confirmation.', 'APPROVAL_REQUIRED')
    return { ok: true, persistenceAvailable: true, message: 'Last packet approved by Commander confirmation.', snapshot: await collectOperatorDeck(req) }
  }

  if (command.command === 'manual_email_alert') {
    if (!command.confirmed) return { ok: false, persistenceAvailable: true, message: 'Email draft confirmation required. No message was sent.' }
    await supabase.client.from('war_room_operator_packets').insert({
      title: text(command.subject, 'Manual email alert draft'),
      packet_type: 'email_draft',
      status: 'drafted',
      body: text(command.body, 'Commander requested a manual email alert draft.'),
      recipient: nullableText(command.recipient),
      truth_label: 'APPROVAL_REQUIRED',
      external_action_performed: false,
      autonomous_execution_performed: false,
      email_sent: false,
    })
    await insertActivity(supabase.client, 'email_draft_created', 'Manual email alert draft created. No email was sent.', 'APPROVAL_REQUIRED')
    return { ok: true, persistenceAvailable: true, message: 'Email draft created for manual review. No email was sent.', snapshot: await collectOperatorDeck(req) }
  }

  return { ok: false, persistenceAvailable: true, message: 'Unsupported operator command.' }
}

export async function logOperatorEarnings(req: Request, input: OperatorLogEarningsInput): Promise<OperatorWriteResult> {
  if (!input.confirmed) return { ok: false, persistenceAvailable: false, message: 'Explicit confirmation required before logging earnings.' }
  if (!isMissionId(input.missionId)) return { ok: false, persistenceAvailable: false, message: 'Valid mission is required.' }
  if (!Number.isFinite(input.amountEarned) || input.amountEarned < 0) return { ok: false, persistenceAvailable: false, message: 'Amount earned is required.' }
  if (!Number.isFinite(input.timeSpentMinutes) || input.timeSpentMinutes <= 0) return { ok: false, persistenceAvailable: false, message: 'Time spent is required.' }

  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) return { ok: false, persistenceAvailable: false, message: 'Operator persistence unavailable. Earnings were not logged.' }

  const evidence = input.sourceUri ? { sourceUri: input.sourceUri } : { explicitCommanderLog: true }
  await supabase.client.from('war_room_operator_earnings').insert({
    action_id: input.actionId ?? null,
    title: input.title,
    mission_id: input.missionId,
    amount_earned: input.amountEarned,
    time_spent_minutes: input.timeSpentMinutes,
    notes: input.notes ?? '',
    source_uri: input.sourceUri ?? null,
    truth_label: input.sourceUri ? 'SOURCE_BACKED' : 'MANUAL_LOGGED',
    commander_confirmed: true,
    external_action_performed: false,
    autonomous_execution_performed: false,
    hidden_action_performed: false,
    fake_revenue_claimed: false,
  })
  if (input.actionId) {
    await supabase.client.from('war_room_operator_actions').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      actual_earnings: input.amountEarned,
      actual_time_minutes: input.timeSpentMinutes,
    }).eq('id', input.actionId)
  }
  await insertActivity(supabase.client, 'earning_logged', `Logged ${money(input.amountEarned)} from ${input.title}.`, input.sourceUri ? 'SOURCE_BACKED' : 'MANUAL_LOGGED')
  await createOutcomeEntry({
    title: input.title,
    category: input.missionId === 'automation-services' ? 'SMB_automation' : input.missionId === 'content-automation' ? 'AI_service' : 'learning',
    relatedOpportunity: input.actionId ?? null,
    estimatedRevenue: null,
    actualRevenue: input.amountEarned,
    timeInvestedHours: input.timeSpentMinutes / 60,
    resultStatus: input.amountEarned > 0 ? 'profitable' : 'needs_review',
    whatWorked: input.notes ?? 'Operator earnings were manually confirmed.',
    whatFailed: '',
    lessonsLearned: 'Completion data is available for Baby AI Observer and Commander OS scoring.',
    recommendedRepeatAvoid: input.amountEarned > 0 ? 'repeat' : 'monitor',
    approvalStatus: 'completed',
    sourceUri: input.sourceUri ?? null,
    evidence,
    metadata: {
      operatorDeck: true,
      actionId: input.actionId ?? null,
      missionId: input.missionId,
    },
  })

  return { ok: true, persistenceAvailable: true, message: 'Earnings logged after Commander confirmation.', snapshot: await collectOperatorDeck(req) }
}

export function sanitizeOperatorCommand(body: unknown): OperatorActionCommand | null {
  const input = objectValue(body)
  const command = text(input.command)
  if (command === 'skip') return { command, actionId: text(input.actionId), reason: nullableText(input.reason) }
  if (command === 'request_better_queue') return { command }
  if (command === 'approve_last_packet') return { command, confirmed: input.confirmed === true }
  if (command === 'manual_email_alert') {
    return {
      command,
      recipient: nullableText(input.recipient),
      subject: nullableText(input.subject),
      body: nullableText(input.body),
      confirmed: input.confirmed === true,
    }
  }
  return null
}

export function sanitizeLogEarnings(body: unknown): OperatorLogEarningsInput | null {
  const input = objectValue(body)
  const missionId = text(input.missionId)
  const amountEarned = num(input.amountEarned)
  const timeSpentMinutes = num(input.timeSpentMinutes)
  if (!isMissionId(missionId) || amountEarned == null || timeSpentMinutes == null) return null
  return {
    actionId: nullableText(input.actionId),
    title: text(input.title, 'Manual operator earnings log'),
    missionId,
    amountEarned,
    timeSpentMinutes,
    notes: nullableText(input.notes),
    sourceUri: nullableText(input.sourceUri),
    confirmed: input.confirmed === true,
  }
}
