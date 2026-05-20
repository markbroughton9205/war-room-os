'use client'

import { useState, useRef, useEffect, useCallback, useMemo, memo, startTransition, useDeferredValue } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { MatrixCodeRain } from '@/components/MatrixCodeRain'
import { APPROVAL_RISK_GATES, SECURE_APPROVAL_RISKS } from '@/lib/kernel/approvals'
import { KERNEL_EVENT_SCHEMA, KERNEL_EVENT_TYPES } from '@/lib/kernel/events'
import { MEMORY_POLICY } from '@/lib/kernel/memoryPolicy'
import { AGENT_FAMILY_CAPABILITIES, CAPABILITY_ROUTES } from '@/lib/kernel/routing'
import { INCOME_WORKERS, INCOME_WORKER_WORKFLOW } from '@/lib/income-workers/registry'
import type {
  IncomeWorkerCandidate,
  IncomeWorkerScoutExecutionState,
  IncomeWorkerScoutResult,
} from '@/lib/income-workers/types'
import type { IncomeCouncilReview } from '@/lib/income-workers/councilReview'
import type { DeployStatusResponse } from '@/lib/deploy/types'
import type { DiffPreviewResponse, RepoStatus, RollbackStatus } from '@/lib/repo/types'
import { TOOL_REGISTRY, type ToolId } from '@/lib/tools/toolRegistry'
import type { InternetStatusResponse } from '@/lib/tools/internet/types'
import type { DepositRecord, PaymentGuardFinding, PaymentProviderReadiness } from '@/lib/payments/types'
import { fetchToolBarHealth, initialToolBarHealth, type ToolBarLabel } from '@/lib/warRoomToolBarHealth'
import {
  buildCouncilPlanningAugment,
  buildDecreeFamilyAugment,
  buildOrchestrationAugment,
  type CouncilAugmentContext,
  COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS,
  COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS_DEEP,
  COUNCIL_ORCHESTRATION_INTERVAL_MS,
  COUNCIL_SESSION_STORAGE_KEY,
  councilContentHash,
  orchestrationFamilyToTypingFamily,
  pickNextOrchestrationFamily,
  useCouncilSession,
  useConversationRuntime,
} from '@/components/council'
import type { CouncilMemoryRecallPreview, CouncilOrchestrationFamily } from '@/components/council'
import type { EngineControlStatusResponse, EngineId, EngineStatus } from '@/lib/engine-control/types'
import type { RouteCommandResult } from '@/lib/engine-control/router'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'
import { grantWarRoomStandingAck, resolveStandingPostExtra } from '@/lib/permissions/standingInlineGate'
import { postCouncilChat, sendLiveCouncilThroneMessage, type CouncilChatJson } from '@/lib/council/liveChatPipeline'
import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { ContinuationRequest } from '@/lib/council/continuationRequest'
import { classifyCommand } from '@/lib/engine-control/permissions'
import { ProviderSetupChecklistPanel } from '@/components/war-room/ProviderSetupChecklistPanel'
import { BabyAiAcademyPanel } from '@/components/war-room/baby-ai/BabyAiAcademyPanel'
import { ConfigurationHealthSummaryPanel, ConfigurationSweepPanel } from '@/components/war-room/configuration/ConfigurationSweepPanel'
import { Phase3WarRoomPanels } from '@/components/war-room/phase3/Phase3WarRoomPanels'
import { Phase5DeployPanels } from '@/components/war-room/phase5/DeployPanels'
import { Phase6MemoryPanels } from '@/components/war-room/memory/Phase6MemoryPanels'
import { SystemResourcesPanel } from '@/components/war-room/phase3/SystemResourcesPanel'
import { WorkerHealthPanel } from '@/components/war-room/phase3/WorkerHealthPanel'
import { StandingPermissionsPanel } from '@/components/war-room/permissions/StandingPermissionsPanel'
import { WarRoomUiModeProvider, useWarRoomUiMode } from '@/components/war-room/WarRoomUiModeContext'
import {
  COUNCIL_ROSTER,
  LIVE_COUNCIL_CONV_STORAGE_KEY,
  buildDecreeFamilyOrder,
  detectCouncilPlanningMode,
  engineRowMap,
  isEngineFunctional,
  participationFromDecree,
  unavailableReason,
  type CouncilDutyState,
  type CouncilParticipationToggles,
} from '@/lib/council/familyRoster'
import { extractProposedCouncilActions } from '@/lib/council/extractCouncilActions'
import { classifyRaElMessage, type ClassifyRaElMessageResult } from '@/lib/council/conversationIntent'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { parseEconomicOperationalCommand } from '@/lib/economic/commands'
import { logEconomicOpsResolvedMode, resolveEconomicOpsRouting } from '@/lib/economic/routing'
import { CouncilCommandBadges } from '@/components/war-room/CouncilCommandBadges'
import { LiveEnvironmentPanel } from '@/components/intelligence/LiveEnvironmentPanel'
import { AnalystOperationsPanel } from '@/components/war-room/analysts/AnalystOperationsPanel'
import {
  DEFAULT_COMMANDER_LOCATION,
  forgetLocationHistory,
  type CommanderLocationState,
  type LocationMode,
} from '@/lib/intelligence/environment/locationPolicy'
import type { AstrologyInterpretationMode } from '@/lib/intelligence/environment/horoscopeEnvironment'
import { DEFAULT_COUNCIL_COMMAND, type CouncilCommand } from '@/lib/council/councilCommandTypes'
import { councilModeExtensionWarnings, resolveActiveCommand } from '@/lib/council/commandAuthority'
import {
  ALL_ORCHESTRATION_FAMILIES,
  filterOrchestrationOrderByCommand,
} from '@/lib/council/commandParser'
import { deriveTopicScopeLock } from '@/lib/council/topicScope'
import { runFinalModerator } from '@/lib/council/finalModerator'
import { resolveCurrentIntent } from '@/lib/council/currentIntent'
import { shouldSuppressStaleAutonomousReveal } from '@/lib/council/sessionBarrier'
import { resolveDiagnosticIntentMode } from '@/lib/council/diagnosticMode'
import { buildDefaultDiagnosticOrder } from '@/lib/council/turnSequencer'
import { detectRedTeamRuntimeHold } from '@/lib/council/redTeamHold'
import { useSequentialDiagnostics } from '@/components/war-room/runtime/useSequentialDiagnostics'
import { DiagnosticSessionPanel } from '@/components/war-room/runtime/DiagnosticSessionPanel'
import { RuntimeContinuityIndicator } from '@/components/war-room/runtime/RuntimeContinuityIndicator'
import { RUNTIME_STATE_KEYS } from '@/lib/runtime/runtimeContinuityConstants'
import type { DiagnosticHistoryEvent, RedTeamHoldUnresolvedPayload, RuntimeAttendanceSummary } from '@/lib/runtime/runtimeContinuityTypes'
import type { RuntimeIntegrityPartial } from '@/lib/runtime/finalizeRuntimeIntegrityResponse'
import type { RuntimeIntegrityResponse } from '@/lib/runtime/runtimeIntegrityTypes'
import {
  buildIntegrityPersistencePayload,
  fetchRuntimeRecoveryBundle,
  postRuntimeStatePatch,
  type RuntimeContinuityIndicatorMode,
} from '@/lib/runtime/runtimeStateClient'
import {
  buildCouncilRenderPacket,
  type CouncilProviderRuntimeDetails,
  type CouncilRenderPacket,
} from '@/lib/council/renderPacket'
import { resolveCouncilPacketSyncMs } from '@/lib/council/packetSync'
import {
  buildAttendanceDirectedOrder,
  isAttendanceIntent,
  packetHasActionableProviderIssues,
  runtimeAfterAttendanceHardClose,
  runtimeAfterAttendanceSoftCap,
} from '@/lib/council/attendanceReadiness'
import {
  DECREE_GATHER_HARD_HANG_MS,
  DIRECT_INVOCATION_GROK_OUTER_TIMEOUT_MS,
  resolveAttendanceBatchCeilingMs,
  resolveAttendanceHardCloseMs,
  resolveProviderTimeoutMs,
} from '@/lib/council/providerTimeouts'
import { shapeAttendanceForModeGovernor } from '@/lib/council/responseCompression'
import { shouldSuppressProviderFailureFromChatStream } from '@/lib/council/chatStreamFilters'
import {
  attendancePreflightSkipsChat,
  attendancePreflightToProviderRuntime,
  runAttendancePreflight,
  type AttendancePreflightStatus,
} from '@/lib/council/attendancePreflight'
import {
  buildCouncilPersistenceContext,
  councilMessageFromLivePost,
  councilMessageFromWarRoomRow,
  shouldPersistCouncilMessage,
} from '@/lib/council/messagePersistenceFilter'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import { resolveModeGovernor } from '@/lib/council/modeGovernor'
import {
  evaluateFullTeamSatisfied,
  FULL_TEAM_GATE_TIMEOUT_MS,
  FULL_TEAM_UNSATISFIED_MESSAGE,
} from '@/lib/council/fullTeamGate'
import { buildRoomStatusesFromEngineFunctional, buildRoomStatusesFromProviderStates } from '@/lib/council/roomStatus'
import {
  providerOutcomeToVerifiedContext,
  replaceWithRuntimeTruthLine,
  verifiedContextsFromProviderStates,
} from '@/lib/council/runtimeTruth'
import { detectDirectInvocation } from '@/lib/council/directInvocation'
import {
  GEMINI_REPAIR_ENQUEUE_METADATA_KEY,
  shouldInjectRedTeamEarly,
  type CouncilMessageLike,
} from '@/lib/council/redTeamTriggers'
import { formatActionQueuePersistFailureMessage, isActionQueuePostSucceeded, type ActionQueuePostFailureBody } from '@/lib/war-room/actionQueueClient'
import { buildPlatformBrief } from '@/lib/council/platformBrief'
import {
  applyCouncilRenderGate,
  isCouncilMessageRepairPacketEligible,
  parseCouncilMessageFamily,
  type GeminiRenderDiagnostics,
} from '@/lib/council/councilRenderGate'
import { compactDisplayWhitespace, toDisplayText } from '@/lib/council/toDisplayText'
import type { ResponseIntegrityStatus } from '@/lib/providers/responseIntegrity'
import { createMessageId } from '@/lib/council/messageIds'
import { cloudEngineReadinessLabel, cloudEngineStripStatus, internetToolReadinessParts } from '@/lib/warRoom/providerReadiness'
import { windowLiveChatMessages } from '@/lib/conversation/liveWindow'
import {
  parseRecallCommand,
  type ParsedRecallCommand,
  type RecallSummaryPreview,
  type RecallTranscriptPreview,
} from '@/lib/memory/recallCommands'
import { mapRawMemoryRuntimeState, sanitizeMemoryRuntimeText, type MemoryRuntimeState } from '@/lib/memory/runtimeState'
import type {
  RedTeamCoderDiagnosisResult,
  RedTeamCoderIssue,
  RedTeamCoderRepairPlan,
  RedTeamCoderSignal,
  RedTeamCoderStatus,
} from '@/lib/red-team-coder/types'
import { createEngineeringTaskPacket, type EngineeringTaskPacket } from '@/lib/engineering/engineeringTaskPacket'
import { createAnalystOperationsPacket, type AnalystOperationsPacket } from '@/lib/analysts/analystOutcomeEvaluator'
import { createProjectOrchestrationPacket, type ProjectOrchestrationPacket } from '@/lib/projects/projectOrchestrator'
import type { CouncilRepairPacket } from '@/lib/council-repair'
import {
  COUNCIL_OUTPUT_MODES,
  buildCouncilOutputModeInstruction,
  compressCouncilOutput,
  councilOutputModeLabel,
  type CouncilCompressedSummary,
  type CouncilOutputMode,
} from '@/lib/council/compression'
import { OperatorCommandDeck, OperatorCommandEnvironment } from '@/components/war-room/operator'

export type OperatorTab = 'command' | 'income' | 'agents' | 'analysts' | 'approvals' | 'memory' | 'system' | 'engineering' | 'diagnostics'

const OPERATOR_TABS: { id: OperatorTab; label: string }[] = [
  { id: 'command', label: 'Command Center' },
  { id: 'income', label: 'Income Operations' },
  { id: 'agents', label: 'Agents' },
  { id: 'analysts', label: 'Analysts' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'memory', label: 'Memory' },
  { id: 'system', label: 'System Health' },
  { id: 'engineering', label: 'Engineering View' },
  { id: 'diagnostics', label: 'Diagnostics' },
]

const TOOLBAR_HEALTH_POLL_INTERVAL_MS = 120_000

const ENGINEERING_TABS: OperatorTab[] = ['agents', 'analysts', 'system', 'engineering', 'diagnostics']

const RepairPacketPanel = dynamic(
  () => import('@/components/war-room/engineering/RepairPacketPanel').then(mod => mod.RepairPacketPanel),
  {
    ssr: false,
    loading: () => (
      <section className="rounded border border-sky-500/20 bg-black/20 p-3 text-[10px] tracking-widest text-sky-200">
        Repair packets loading on demand.
      </section>
    ),
  },
)

const SchemaSweepPanel = dynamic(
  () => import('@/components/war-room/schema/SchemaSweepPanel').then(mod => mod.SchemaSweepPanel),
  {
    ssr: false,
    loading: () => (
      <section className="rounded border border-violet-500/20 bg-black/20 p-3 text-[10px] tracking-widest text-violet-200">
        Schema sweep loading on demand.
      </section>
    ),
  },
)

const CouncilDeliberationStream = dynamic(
  () => import('@/components/war-room/council/CouncilDeliberationStream').then(mod => mod.CouncilDeliberationStream),
  { ssr: false },
)

const ConversationStatePanel = dynamic(
  () => import('@/components/war-room/council/ConversationStatePanel').then(mod => mod.ConversationStatePanel),
  {
    ssr: false,
    loading: () => (
      <section className="rounded-xl border border-white/10 bg-black/30 p-3 text-[9px] tracking-widest text-slate-600">
        Council state loading…
      </section>
    ),
  },
)

type CouncilMessage = {
  id: string
  familyName: string
  content: string
  timestamp: string
  color: string
  icon: string
  provider: string
  messageType: string
  degraded?: boolean
  integrityStatus?: ResponseIntegrityStatus
  renderDiagnostics?: GeminiRenderDiagnostics
  recallPreview?: CouncilMemoryRecallPreview
  engineeringTaskPacket?: EngineeringTaskPacket
  repairPacket?: CouncilRepairPacket
  projectOrchestrationPacket?: ProjectOrchestrationPacket
  analystOperationsPacket?: AnalystOperationsPacket
}

type CouncilSessionLifecycle = 'active' | 'archived'

type CouncilThreadHygieneResult = {
  visibleMessages: CouncilMessage[]
  collapsedCount: number
}

type WarRoomPerformanceDiagnostics = {
  renderCount: number
  lastRenderMs: number
  slowPanel: string
  lastRefreshDurationMs: number | null
  lastRefreshAt: string | null
  pollingIntervalMs: number
}

function applyLiveCouncilRenderGate(message: CouncilMessage): CouncilMessage {
  if (message.messageType === 'decree' || message.messageType === 'system') return message
  const family = parseCouncilMessageFamily(message.familyName)
  if (!family || message.messageType !== 'response') {
    const content = sanitizeMemoryRuntimeText(toDisplayText(message.content))
    return content === toDisplayText(message.content) ? message : { ...message, content }
  }
  const gate = applyCouncilRenderGate(family, message.content)
  const content = sanitizeMemoryRuntimeText(gate.displayText)
  if (
    content === toDisplayText(message.content)
    && !message.degraded
    && message.integrityStatus === gate.integrityStatus
  ) {
    return message
  }
  return {
    ...message,
    content,
    degraded: gate.degraded,
    integrityStatus: gate.integrityStatus,
    renderDiagnostics: gate.diagnostics ?? message.renderDiagnostics,
  }
}

function sanitizedCouncilMessage(message: CouncilMessage): CouncilMessage {
  return applyLiveCouncilRenderGate(message)
}

function councilProviderTextAfterRenderGate(family: CouncilOrchestrationFamily, text: string): string {
  return applyCouncilRenderGate(family, text).displayText
}

function councilNoiseKey(message: CouncilMessage): string | null {
  if (message.messageType === 'decree') return null
  const content = compactDisplayWhitespace(sanitizeMemoryRuntimeText(toDisplayText(message.content))).toLowerCase()
  if (!content) return null
  if (
    /\b(warning|provider notice|runtime notice|runtime continuity|persistence|temporary learning|session-only learning|durable memory offline|learning persistence unavailable)\b/i.test(content)
    || /^(confirmed|acknowledged|understood|copy|standing by|noted)[.! ]*$/i.test(content)
  ) {
    return `${message.familyName.toLowerCase()}|${message.messageType.toLowerCase()}|${content}`
  }
  return null
}

function applyCouncilThreadHygiene(messages: CouncilMessage[]): CouncilThreadHygieneResult {
  const seenNoise = new Set<string>()
  const visibleMessages: CouncilMessage[] = []
  let collapsedCount = 0

  for (const raw of messages) {
    const message = sanitizedCouncilMessage(raw)
    const key = councilNoiseKey(message)
    if (key && seenNoise.has(key)) {
      collapsedCount += 1
      continue
    }
    if (key) seenNoise.add(key)
    visibleMessages.push(message)
  }

  return { visibleMessages, collapsedCount }
}

const RAEL_PROFILE = `Commander: Ra'el (Mark Broughton). Mission: generational wealth and sovereignty. Philosophy: Nation of Islam economic self-determination, Black ownership, ancestral wisdom. Businesses: Higher Vision Inc, Broughton Transports LLC, RUAH patent. Family: Jasmine, seven children. Goal: Panama relocation. Motivated by vision of success. Wants truth about systems that harm Black and low income communities.`

function cloudEngineIdForCouncilFamily(f: CouncilOrchestrationFamily): EngineId | null {
  if (f === 'chatgpt' || f === 'baby') return 'chatgpt'
  if (f === 'claude' || f === 'red_team') return 'claude'
  if (f === 'grok') return 'grok'
  if (f === 'gemini') return 'gemini'
  return null
}

function familyFromContinuationDirective(text: string): CouncilOrchestrationFamily | null {
  const t = text.trim().toLowerCase().replace(/\u2019/g, "'").replace(/\s+/g, ' ')
  if (/\bchatgpt\b|\bchat gpt\b|\bopenai\b/.test(t)) return 'chatgpt'
  if (/\bclaude\b|\banthropic\b/.test(t)) return 'claude'
  if (/\bgrok\b|\bxai\b/.test(t)) return 'grok'
  if (/\bgemini\b|\bgoogle\b/.test(t)) return 'gemini'
  if (/\bred\s*team\b|\bredteam\b/.test(t)) return 'red_team'
  if (/\bbaby\b|\bobserver\b/.test(t)) return 'baby'
  if (/\bkimi\b|\bmoonshot\b/.test(t)) return 'kimi'
  if (/\bbridge(?:\s*architect)?\b/.test(t)) return 'bridge_architect'
  return null
}

function buildSingleFamilyContinuationCommand(family: CouncilOrchestrationFamily): CouncilCommand {
  return {
    ...DEFAULT_COUNCIL_COMMAND,
    mode: 'council',
    authority: 'rael_explicit',
    scope: 'session',
    targetFamilies: [family],
    directInvocation: true,
    directInvocationRemainder: 'permissioned continuation',
    responseLimits: { maxResponsesPerFamily: 1, maxChars: 4000 },
  }
}

function continuationDiagnosticSummary(diagnostics: ContinuationDiagnostics) {
  return {
    type: 'council.continuation_diagnostics',
    ...diagnostics,
  }
}

function isGeminiCouncilBackoffFailure(
  family: CouncilOrchestrationFamily,
  res: Response,
  data: { error?: string; message?: string },
): boolean {
  if (family !== 'gemini') return false
  if (res.status === 503) return true
  if (data.error === 'gemini_unavailable') return true
  return false
}

function councilMessagesForRedTeam(msgs: CouncilMessage[]): CouncilMessageLike[] {
  return msgs.map(m => ({
    familyName: m.familyName,
    content: m.content,
    messageType: m.messageType,
  }))
}

function mapWarRoomRowToCouncilMessage(row: {
  id: string
  role: string
  content: string
  family?: string | null
  created_at: string
}): CouncilMessage {
  const ts = row.created_at ? new Date(row.created_at).toLocaleTimeString() : '--:--'
  if (row.role === 'user') {
    return {
      id: row.id,
      familyName: "RA'EL",
      content: row.content,
      timestamp: ts,
      color: '#FFD700',
      icon: '⚔',
      provider: '',
      messageType: 'decree',
    }
  }
  if (row.role === 'system') {
    return {
      id: row.id,
      familyName: 'SYSTEM',
      content: sanitizeMemoryRuntimeText(row.content),
      timestamp: ts,
      color: '#FFD700',
      icon: '⚙',
      provider: '',
      messageType: 'system',
    }
  }
  const fam = (row.family && row.family.trim()) || 'Council'
  const base: CouncilMessage = {
    id: row.id,
    familyName: fam,
    content: sanitizeMemoryRuntimeText(row.content),
    timestamp: ts,
    color: '#9CA3AF',
    icon: '•',
    provider: '',
    messageType: 'response',
  }
  return applyLiveCouncilRenderGate(base)
}

function normalizeCouncilMessageIds(input: CouncilMessage[], scope = 'hydrated'): CouncilMessage[] {
  const seen = new Set<string>()
  return input.map(message => {
    const existing = typeof message.id === 'string' ? message.id.trim() : ''
    if (existing && !seen.has(existing)) {
      seen.add(existing)
      return message
    }
    const normalizedId = createMessageId(`${scope}-${message.messageType || message.familyName || 'message'}`)
    seen.add(normalizedId)
    return { ...message, id: normalizedId }
  })
}

function isRaelCouncilMessage(message: CouncilMessage): boolean {
  return message.messageType === 'decree' || message.familyName.toUpperCase().includes("RA'EL")
}

function isCouncilFamilyResponse(message: CouncilMessage): boolean {
  return message.messageType === 'response' && !isRaelCouncilMessage(message) && message.familyName !== 'SYSTEM'
}

function archiveRoleForMessage(message: CouncilMessage): 'user' | 'assistant' | 'system' {
  if (isRaelCouncilMessage(message)) return 'user'
  if (message.familyName === 'SYSTEM' || message.messageType === 'system') return 'system'
  return 'assistant'
}

function archiveTopicForMessage(message: CouncilMessage): string | null {
  const text = `${message.familyName} ${message.content}`.toLowerCase()
  if (/\bgrok\b|\bxai\b/.test(text)) return 'grok'
  if (/\beconomic ops\b|\bopportunity scout\b|\bincome radar\b/.test(text)) return 'economic_ops'
  if (/\bincome\b|\brevenue\b|\bopportunit(y|ies)\b|\bclient\b|\bleads?\b/.test(text)) return 'income_ideas'
  return null
}

function recallLabel(command: ParsedRecallCommand): string {
  if (command.kind === 'recall today' || command.kind === 'summarize today') return "Today's Memory"
  if (command.kind === 'recall last session' || command.kind === 'summarize last session') return 'Last Session Memory'
  if (command.kind === 'recall grok') return 'Grok Memory'
  if (command.kind === 'recall economic ops') return 'Economic Ops Memory'
  if (command.kind === 'recall income ideas') return 'Income Ideas Memory'
  return 'Memory Archive'
}

function compactRecallSnippet(value: unknown, max = 140): string {
  const compact = compactDisplayWhitespace(value)
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function buildRecallPreview(args: {
  command: ParsedRecallCommand
  records: RecallTranscriptPreview[]
  summaries: RecallSummaryPreview[]
}): CouncilMemoryRecallPreview {
  const summaryItems = args.summaries.map(summary => compactRecallSnippet(summary.summary))
  const recordItems = args.records.map(record => compactRecallSnippet(record.content))
  const topItems = [...summaryItems, ...recordItems].filter(Boolean).slice(0, 3)
  const latestRecordTimestamp = args.records[0]?.timestamp ?? null
  const latestSummaryTimestamp = args.summaries[0]?.createdAt ?? null
  const latestTimestamp = latestRecordTimestamp ?? latestSummaryTimestamp

  return {
    label: recallLabel(args.command),
    resultCount: args.records.length + args.summaries.length,
    topItems,
    latestTimestamp,
    commandKind: args.command.kind,
  }
}

type ToneMode = 'casual' | 'build' | 'business' | 'debate' | 'reflection'
type TypingFamily = 'CHATGPT FAMILY' | 'CLAUDE FAMILY' | 'GROK FAMILY' | 'GEMINI FAMILY' | 'KIMI FAMILY' | 'BRIDGE ARCHITECT'
type UsageFamily = 'Claude Family' | 'ChatGPT Family' | 'Kimi Family' | 'Grok Family' | 'Gemini Family'
type CouncilMode = 'continue' | 'expanded' | 'summarize'
type ContinuationDecision = 'allow' | 'summarize' | 'hold' | 'deny'

type ContinuationDiagnostics = {
  created: number
  granted: number
  denied: number
  summarized: number
  held: number
  suppressedRecursive: number
  holdSuppressions: number
}

type UsageEstimate = {
  familyName: UsageFamily
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  active: boolean
}

type ExpansionPrompt = {
  decree: string
  extraCost: number
  reason: string
  urgent: boolean
}

type MemoryEntry = {
  id: string
  content: string
  source: string
  family: string
  tags: string[]
  importance: number
  created_at: string
}

type MemorySavePrompt = {
  memory: Omit<MemoryEntry, 'id' | 'created_at'>
  reason: string
}

type MemoryRecallView = {
  command: ParsedRecallCommand
  records: RecallTranscriptPreview[]
  summaries: RecallSummaryPreview[]
  recalledAt: string
  persistenceAvailable: boolean
  error?: string | null
}

type FamilyPresence = {
  status: 'idle' | 'thinking' | 'streaming' | 'complete'
  label: string
}

type SubAgentNode = {
  name: string
  status: 'idle' | 'active' | 'reviewing' | 'blocked'
  task: string
}

type FamilyNodeGroup = {
  familyName: string
  presenceKey?: TypingFamily
  color: string
  nodes: SubAgentNode[]
}

type OpportunityType = 'surveys' | 'AI evaluation' | 'user testing' | 'research studies' | 'remote micro-contracts' | 'digital service gigs'
type OpportunityStatus = 'not started' | 'applied' | 'active' | 'paid'
type RiskLevel = 'low' | 'medium' | 'high'
type IncomeRadarView = 'active' | 'expiring' | 'expired'
type OpportunityScoutStatus = 'idle' | 'searching' | 'reviewing' | 'found' | 'error'
type ProviderHealth = 'online' | 'standby' | 'offline' | 'error'
type RaelActionStatus = 'pending' | 'answered' | 'expired'
type RaelActionUrgency = 'low' | 'medium' | 'high'
type SmsBridgeStatus = 'not configured' | 'standby' | 'online' | 'error'
type RepoScanStatus = 'idle' | 'scanning' | 'indexed' | 'error'
type ProviderConnectionStatus = 'online' | 'standby' | 'error' | 'not_connected'
type ProviderFamilyKey = 'claude' | 'chatgpt' | 'grok' | 'gemini' | 'redteam'

type RaelActionItem = {
  action_id: string
  related_opportunity_id: string | null
  title: string
  question: string
  response_options: string[]
  status: RaelActionStatus
  urgency: RaelActionUrgency
  created_at: string
  expires_at: string | null
  source_agent: string
  selected_response?: string
  answered_at?: string
}

type SmsBridgeState = {
  status: SmsBridgeStatus
  lastNotification: string | null
  message: string
  sending: boolean
}

type OpportunityScoutState = {
  status: OpportunityScoutStatus
  message: string
  lastScanTime: string | null
  sourcesChecked: number
  opportunitiesFound: number
  opportunitiesRejected: number
  riskFilterStatus: string
  nextScanAction: string
  results: OpportunityScoutResult[]
  providerUsed: string
  scanDurationMs: number
  providerStatus: {
    tavily: ProviderHealth
    firecrawl: ProviderHealth
  }
}

type EconomicScoutDiagnostics = {
  tavily_enabled: boolean
  tavily_query_count: number
  tavily_results_count: number
  firecrawl_enabled: boolean
  firecrawl_targets_count: number
  normalized_candidates_count: number
  ranked_candidates_count: number
  fallback_triggered: boolean
  fallback_reason: string | null
  ranked_preview?: { title: string; score: number }[]
  missing_api_keys: string[]
  last_updated_at: string | null
}

type OpportunityScoutResult = {
  title: string
  url: string
  source: string
  country: string
  payout: string | null
  currency: string | null
  expiration: string | null
  type: string
  riskLevel: RiskLevel
  verificationStatus: 'candidate' | 'rejected'
  reason: string
  provider?: string
}

type IncomeOpportunity = {
  id: string
  title: string
  platform: string
  country: string
  currency: string
  local_payout: number | null
  usd_estimate: number | null
  estimated_hourly: number | null
  payout_speed: string
  type: OpportunityType
  risk_level: RiskLevel
  status: OpportunityStatus
  apply_url: string
  notes: string
  expires_at: string | null
  discovered_at: string
  last_checked_at: string | null
  is_active: boolean
  created_at: string
}

type WarRoomFile = {
  id: string
  file_name: string
  file_type: string
  mime_type: string
  size_bytes: number
  storage_path: string
  source_context: string
  uploaded_at: string
  tags: string[]
  status: 'uploaded' | 'indexed' | 'error'
  notes: string
}

type RepoCommit = {
  hash: string
  message: string
  author: string
  date: string | null
  timezone: string
}

type RepoFeature = {
  name: string
  detected: boolean
}

type RepoArchitectureModule = {
  module: string
  fileCount: number
}

type RepoAwarenessState = {
  repoStatus: string
  totalFilesIndexed: number
  routes: string[]
  apiRoutes: string[]
  extensionCounts: Record<string, number>
  features: RepoFeature[]
  latestCommits: RepoCommit[]
  currentBranch: string
  lastScanTime: string | null
  scanStatus: RepoScanStatus
  buildStatus: string
  deploymentStatus: string
  architectureMap: RepoArchitectureModule[]
  restrictions: string[]
  durationMs: number
  message: string
}

type ProviderHealthState = {
  providers: Record<ProviderFamilyKey, ProviderConnectionStatus>
  labels: Record<ProviderFamilyKey, string>
}

type RedTeamCoderUiState = {
  status: RedTeamCoderStatus
  latestDetectedIssue: RedTeamCoderIssue | null
  latestRepairPlan: RedTeamCoderRepairPlan | null
  recommendedAgent: string | null
  actionQueued: boolean
  actionId: string | null
  message: string
  lastCheckedAt: string | null
}

type PaymentLedgerState = {
  deposits: DepositRecord[]
  providers: PaymentProviderReadiness[]
  persistenceLabel: string
  redSentinel: {
    status: 'clear' | 'review' | 'blocked'
    findings: PaymentGuardFinding[]
    blocksConfirmation: boolean
  }
  message: string
}

const FAMILY_META: Record<TypingFamily, { color: string; icon: string }> = {
  'GROK FAMILY': { color: '#F97316', icon: 'GX' },
  'CHATGPT FAMILY': { color: '#34D399', icon: '🧠' },
  'CLAUDE FAMILY': { color: '#A78BFA', icon: '🔮' },
  'GEMINI FAMILY': { color: '#38BDF8', icon: '◇' },
  'KIMI FAMILY': { color: '#60A5FA', icon: '◎' },
  'BRIDGE ARCHITECT': { color: '#C084FC', icon: '⎈' },
}

const DEFAULT_OUTPUT_TOKEN_BUDGET = 160
const EXPANDED_OUTPUT_TOKEN_BUDGET = 480
const STREAM_CHUNK_SIZE = 8
const STREAM_CHUNK_DELAY_MS = 35
const TOOL_REQUEST_TIMEOUT_MS = 45000
const INITIAL_OPPORTUNITY_SCOUT_STATE: OpportunityScoutState = {
  status: 'idle',
  message: 'Ready to scan when a live provider is connected.',
  lastScanTime: null,
  sourcesChecked: 0,
  opportunitiesFound: 0,
  opportunitiesRejected: 0,
  riskFilterStatus: 'verification required before save',
  nextScanAction: 'Connect live search provider',
  results: [],
  providerUsed: 'none',
  scanDurationMs: 0,
  providerStatus: {
    tavily: 'offline',
    firecrawl: 'offline',
  },
}
const INITIAL_ECONOMIC_SCOUT_DIAGNOSTICS: EconomicScoutDiagnostics = {
  tavily_enabled: false,
  tavily_query_count: 0,
  tavily_results_count: 0,
  firecrawl_enabled: false,
  firecrawl_targets_count: 0,
  normalized_candidates_count: 0,
  ranked_candidates_count: 0,
  fallback_triggered: false,
  fallback_reason: null,
  ranked_preview: [],
  missing_api_keys: [],
  last_updated_at: null,
}
const INITIAL_SMS_BRIDGE_STATE: SmsBridgeState = {
  status: 'standby',
  lastNotification: null,
  message: 'SMS Bridge ready for configuration check.',
  sending: false,
}
const INITIAL_REPO_AWARENESS_STATE: RepoAwarenessState = {
  repoStatus: 'idle',
  totalFilesIndexed: 0,
  routes: [],
  apiRoutes: [],
  extensionCounts: {},
  features: [],
  latestCommits: [],
  currentBranch: 'unknown',
  lastScanTime: null,
  scanStatus: 'idle',
  buildStatus: 'not scanned',
  deploymentStatus: 'not scanned',
  architectureMap: [],
  restrictions: [
    'read/analyze only',
    'no code execution',
    'no auto-modification',
    'no autonomous commits',
    'no shell command execution from UI',
  ],
  durationMs: 0,
  message: 'Repo scan has not run yet.',
}
const INITIAL_PROVIDER_HEALTH: ProviderHealthState = {
  providers: {
    claude: 'not_connected',
    chatgpt: 'not_connected',
    grok: 'not_connected',
    gemini: 'not_connected',
    redteam: 'standby',
  },
  labels: {
    claude: 'Anthropic · Claude · checking',
    chatgpt: 'OpenAI · ChatGPT · checking',
    grok: 'xAI · Grok · checking',
    gemini: 'Google · Gemini · not connected',
    redteam: 'War Room · Red Team · standby',
  },
}
const INITIAL_RED_TEAM_CODER_STATE: RedTeamCoderUiState = {
  status: 'watching',
  latestDetectedIssue: null,
  latestRepairPlan: null,
  recommendedAgent: null,
  actionQueued: false,
  actionId: null,
  message: 'Watching Live Council silently for stalled response paths.',
  lastCheckedAt: null,
}
const INITIAL_INCOME_WORKER_SCOUT: IncomeWorkerScoutResult = {
  status: 'no_results',
  message: 'No income worker scout has run yet.',
  scannedAt: '',
  providerUsed: 'none',
  sourcesChecked: 0,
  candidates: [],
  rejected: [],
  executionState: 'scouting',
  activityLog: [],
  degradedMode: false,
  opportunityPackets: [],
}
const INITIAL_PAYMENT_LEDGER_STATE: PaymentLedgerState = {
  deposits: [],
  providers: [],
  persistenceLabel: 'Session-only fallback',
  redSentinel: {
    status: 'clear',
    findings: [],
    blocksConfirmation: false,
  },
  message: 'Deposit ledger not loaded yet.',
}
const INITIAL_INTERNET_STATUS: InternetStatusResponse = {
  tools: {
    tavily: { id: 'tavily', name: 'Tavily', status: 'config_needed', lastChecked: '', notes: 'Not checked yet.' },
    firecrawl: { id: 'firecrawl', name: 'Firecrawl', status: 'config_needed', lastChecked: '', notes: 'Not checked yet.' },
    grok_xai: { id: 'grok_xai', name: 'Grok / xAI', status: 'config_needed', lastChecked: '', notes: 'Not checked yet.' },
    direct_fetch: { id: 'direct_fetch', name: 'Direct Fetch', status: 'config_needed', lastChecked: '', notes: 'Not checked yet.' },
  },
  serverSideOnly: true,
  canUseInternet: false,
  lastChecked: '',
  overallStatus: 'unknown',
  label: 'Unknown',
  tavily: { keyPresent: false, configured: false, notes: 'Not checked yet.' },
  firecrawl: { keyPresent: false, configured: false, notes: 'Not checked yet.' },
}
const INITIAL_REPO_STATUS: RepoStatus = {
  repoPath: '',
  gitAvailable: false,
  currentBranch: 'unknown',
  workingTreeStatus: 'unknown',
  uncommittedFilesCount: 0,
  changedFiles: [],
  lastCommitHash: null,
  remoteConfigured: false,
  canReadRepo: false,
  canWriteRepo: false,
  canCommit: false,
  canRollback: false,
  capabilities: {
    canWriteFilesystem: false,
    canGitCommit: false,
    canCreateCheckpoint: false,
  },
  policy: {
    writeRequiresApproval: true,
    commitRequiresApproval: true,
    rollbackRequiresApproval: true,
  },
  allowed: {
    write: false,
    commit: false,
    rollback: false,
  },
  permissions: {
    canRead: false,
    canProposeDiff: false,
    canModifyFiles: 'approval_required',
    canCommit: 'approval_required',
    canDeploy: 'approval_required',
    canRollback: 'approval_required',
    canUseInternet: false,
    canExecuteShell: false,
  },
  checkedAt: '',
}
const INITIAL_ROLLBACK_STATUS: RollbackStatus = {
  latestCheckpoint: null,
  rollbackAvailable: false,
  checkpointRequiredBeforeApply: true,
  message: '',
  approvalRequired: true,
  checkedAt: '',
}
const INITIAL_DEPLOY_STATUS: DeployStatusResponse = {
  awarenessOnly: true,
  checkedAt: '',
  provider: 'unknown',
  lastDeployment: null,
  localDev: {
    inferFrom: 'NODE_ENV',
    nodeEnv: 'unknown',
    localDevProcessRunning: 'unknown',
    localDevProbe: 'disabled',
    localDevProbeDetail: 'Not checked yet.',
  },
  production: {
    candidateUrl: null,
    urlSources: [],
    productionReachable: 'not_probed',
    productionProbeDetail: 'Not checked yet.',
  },
  supabase: {
    urlPresent: false,
    anonKeyPresent: false,
    serviceRolePresent: false,
    serverPersistenceReady: false,
    clientBundleReady: false,
    status: 'config_needed',
  },
  build: { hasBuildScript: false },
  blockers: [],
}
const BASE_USAGE_ROWS: UsageEstimate[] = [
  { familyName: 'Claude Family', provider: 'Anthropic', model: 'claude-sonnet-4-20250514', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: true },
  { familyName: 'ChatGPT Family', provider: 'OpenAI', model: 'gpt-4o', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: true },
  { familyName: 'Kimi Family', provider: 'Moonshot', model: 'not configured', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: false },
  { familyName: 'Grok Family', provider: 'xAI', model: 'grok', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: true },
  { familyName: 'Gemini Family', provider: 'Google', model: 'gemini (engine probe)', inputTokens: 0, outputTokens: 0, estimatedCost: 0, active: true },
]

const FAMILY_NODE_GROUPS: FamilyNodeGroup[] = [
  {
    familyName: 'ChatGPT Family',
    presenceKey: 'CHATGPT FAMILY',
    color: '#34D399',
    nodes: ['Strategy', 'UX', 'Synthesis', 'Language', 'Continuity'].map(name => ({ name, status: 'idle', task: 'standing by' })),
  },
  {
    familyName: 'Claude Family',
    presenceKey: 'CLAUDE FAMILY',
    color: '#A78BFA',
    nodes: ['Architecture', 'Governance', 'Security', 'Logic', 'Documentation'].map(name => ({ name, status: 'idle', task: 'standing by' })),
  },
  {
    familyName: 'Kimi Family',
    color: '#60A5FA',
    nodes: ['Task Tree', 'Dependency', 'Parallelization', 'Operations', 'Sequencing'].map(name => ({ name, status: 'idle', task: 'future worker node' })),
  },
  {
    familyName: 'Grok Family',
    presenceKey: 'GROK FAMILY',
    color: '#F97316',
    nodes: ['Realtime', 'Trend', 'Social Pulse', 'Contradiction', 'Alert'].map(name => ({ name, status: 'idle', task: 'standing by' })),
  },
  {
    familyName: 'Gemini Family',
    presenceKey: 'GEMINI FAMILY',
    color: '#38BDF8',
    nodes: ['Vision', 'Pattern', 'Document', 'Multimodal', 'Forecast'].map(name => ({ name, status: 'idle', task: 'standing by' })),
  },
  {
    familyName: 'Red Team',
    color: '#EF4444',
    nodes: ['Risk', 'Attack', 'Weakness', 'Assumption', 'Stress Test'].map(name => ({ name, status: 'idle', task: 'future worker node' })),
  },
]

const MOCK_RATES_PER_MILLION: Record<UsageFamily, { input: number; output: number }> = {
  'Claude Family': { input: 3, output: 15 },
  'ChatGPT Family': { input: 2.5, output: 10 },
  'Kimi Family': { input: 0, output: 0 },
  'Grok Family': { input: 0, output: 0 },
  'Gemini Family': { input: 2, output: 8 },
}

function detectToneMode(message: string): ToneMode {
  const text = message.toLowerCase()

  if (/\b(build|code|bug|fix|debug|implement|component|api|route|database|deploy|typescript|react|next)\b/.test(text)) {
    return 'build'
  }

  if (/\b(revenue|business|client|customer|market|sales|pricing|profit|contract|proposal|investor|strategy)\b/.test(text)) {
    return 'business'
  }

  if (/\b(debate|argue|challenge|push back|red team|prove|disagree|versus|vs\.?)\b/.test(text)) {
    return 'debate'
  }

  if (/\b(reflect|meaning|feel|feeling|family|purpose|spirit|lesson|truth|remember|why am i|what am i)\b/.test(text)) {
    return 'reflection'
  }

  return 'casual'
}

function detectOpportunityScoutIntent(message: string) {
  const text = message.toLowerCase()

  return /\b(opportunity scout|scout opportunities|scout for opportunities|search opportunities|find opportunities|income radar search|income scout)\b/.test(text)
    || resolveEconomicOpsRouting(message).mode === 'economic_ops'
}

function detectToolIntent(message: string) {
  const text = message.toLowerCase()

  if (detectOpportunityScoutIntent(text)) return false

  return /\b(search|research|look up|lookup|find live info|live info|current info|current information|web check|verify online|check online|find online|online research)\b/.test(text)
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

function estimateFamilyCost(familyName: UsageFamily, inputTokens: number, outputTokens: number) {
  const rates = MOCK_RATES_PER_MILLION[familyName]
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000
}

function formatCost(cost: number) {
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatLocalMoney(amount: number | null, currency: string) {
  if (amount === null || Number.isNaN(amount)) return 'Not set'

  return `${currency || 'LOCAL'} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function isExpired(opportunity: IncomeOpportunity) {
  return !opportunity.is_active || Boolean(opportunity.expires_at && new Date(opportunity.expires_at) <= new Date())
}

function expiresSoon(opportunity: IncomeOpportunity) {
  if (!opportunity.expires_at || isExpired(opportunity)) return false

  const now = Date.now()
  const expiresAt = new Date(opportunity.expires_at).getTime()
  return expiresAt - now <= 72 * 60 * 60 * 1000
}

function formatDateLabel(value: string | null) {
  if (!value) return 'Expiration unknown'

  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function normalizeProviderHealth(value: unknown): ProviderHealth {
  return value === 'online' || value === 'standby' || value === 'error' || value === 'offline'
    ? value
    : 'offline'
}

function createUsageEstimate(inputText: string, outputBudget: number) {
  const inputTokens = estimateTokens(inputText)

  return BASE_USAGE_ROWS.map(row => {
    if (!row.active) return row

    return {
      ...row,
      inputTokens,
      outputTokens: outputBudget,
      estimatedCost: estimateFamilyCost(row.familyName, inputTokens, outputBudget),
    }
  })
}

function totalUsageCost(rows: UsageEstimate[]) {
  return rows.reduce((total, row) => total + row.estimatedCost, 0)
}

function detectExpansionNeed(message: string): Omit<ExpansionPrompt, 'decree'> | null {
  const text = message.toLowerCase()

  if (/\b(legal|lawsuit|medical|tax|financial risk|urgent|emergency|security breach|compliance)\b/.test(text)) {
    return {
      extraCost: totalUsageCost(createUsageEstimate(message, EXPANDED_OUTPUT_TOKEN_BUDGET)) - totalUsageCost(createUsageEstimate(message, DEFAULT_OUTPUT_TOKEN_BUDGET)),
      reason: 'high-stakes context benefits from a more careful pass',
      urgent: true,
    }
  }

  if (/\b(deep|deeper|detailed|long|comprehensive|full analysis|analyze fully|research deeply|break it all down)\b/.test(text)) {
    return {
      extraCost: totalUsageCost(createUsageEstimate(message, EXPANDED_OUTPUT_TOKEN_BUDGET)) - totalUsageCost(createUsageEstimate(message, DEFAULT_OUTPUT_TOKEN_BUDGET)),
      reason: 'the decree asks for expanded analysis',
      urgent: false,
    }
  }

  return null
}

function isExplicitMemoryRequest(message: string) {
  return /\b(remember this|save this|save memory|commit this to memory|add this to memory)\b/i.test(message)
}

function isRepairPacketDecree(message: string) {
  return /\b(fix this|repair war room|diagnose this panel|why is this broken|create a repair packet|send this to cursor|prepare engineering task)\b/i.test(message)
}

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

function gatherCellsToProviderRuntimeDetails(
  cells: { family: CouncilOrchestrationFamily; runtimeDetail?: string }[],
): CouncilProviderRuntimeDetails | undefined {
  const out: CouncilProviderRuntimeDetails = {}
  for (const c of cells) {
    if (c.runtimeDetail) out[c.family] = c.runtimeDetail
  }
  return Object.keys(out).length ? out : undefined
}

const MessageBubble = memo(function MessageBubble({
  msg,
  diagnosticsOpen,
  onOpenFullMemory,
  onProjectAction,
  onPrepareRepairPacket,
}: {
  msg: CouncilMessage
  diagnosticsOpen?: boolean
  onOpenFullMemory?: (preview: CouncilMemoryRecallPreview) => void
  onProjectAction?: (action: 'approve' | 'pause' | 'redirect' | 'deeper_work', packet: ProjectOrchestrationPacket) => void
  onPrepareRepairPacket?: (message: CouncilMessage) => void
}) {
  const isRael = msg.familyName === "RA'EL"
  if (
    msg.messageType === 'system'
    && shouldSuppressProviderFailureFromChatStream(msg.content, { diagnosticsOpen })
  ) {
    return null
  }
  if (msg.messageType === 'memory_recall_preview' && msg.recallPreview) {
    const preview = msg.recallPreview
    return (
      <div className="message-fade-in mb-4 ml-11 rounded-lg p-3 text-sm"
        style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.25)' }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-bold tracking-widest" style={{ color: '#93C5FD' }}>
              {preview.label}
            </div>
            <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#64748B' }}>
              {preview.resultCount} result{preview.resultCount === 1 ? '' : 's'}
              {preview.latestTimestamp ? ` · latest ${new Date(preview.latestTimestamp).toLocaleString()}` : ''}
            </div>
          </div>
          <button
            type="button"
            className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
            style={{ border: '1px solid rgba(96,165,250,0.45)', color: '#BFDBFE' }}
            onClick={() => onOpenFullMemory?.(preview)}
          >
            Open Full Memory
          </button>
        </div>
        {preview.topItems.length ? (
          <ul className="space-y-1 text-xs text-slate-300">
            {preview.topItems.map((item, index) => (
              <li key={`${preview.commandKind}-${index}`}>- {item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">No memory found for today yet.</p>
        )}
      </div>
    )
  }
  if (msg.messageType === 'project_orchestration' && msg.projectOrchestrationPacket) {
    const packet = msg.projectOrchestrationPacket
    const copyPacket = () => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return
      void navigator.clipboard.writeText(JSON.stringify(packet.approvalPacket, null, 2))
    }

    return (
      <div className="message-fade-in mb-4 ml-11 rounded-lg p-3 text-sm"
        style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(52,211,153,0.28)' }}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
              Project orchestration
            </div>
            <div className="mt-1 text-sm font-bold" style={{ color: '#D1FAE5' }}>{packet.intake.projectType}</div>
            <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#94A3B8' }}>
              {packet.id} · {packet.status.replaceAll('_', ' ')}
            </div>
          </div>
          <button type="button" onClick={copyPacket}
            className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
            style={{ border: '1px solid rgba(52,211,153,0.45)', color: '#A7F3D0' }}>
            Copy Approval Packet
          </button>
        </div>

        <div className="grid gap-2 text-xs md:grid-cols-3">
          <div className="rounded px-2 py-2 md:col-span-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#A7F3D0' }}>LANES ASSIGNED</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {packet.lanes.map(lane => (
                <div key={lane.lane} className="flex items-center justify-between gap-2 rounded px-2 py-1" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ color: '#E5E7EB' }}>{lane.lane.replaceAll('_', '/')}</span>
                  <span className="text-[10px]" style={{ color: lane.status === 'waiting_approval' ? '#FDE68A' : '#93C5FD' }}>
                    {lane.family} · {lane.status.replaceAll('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(239,68,68,0.18)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#FCA5A5' }}>QUALITY GATE</div>
            <div style={{ color: '#CBD5E1' }}>{packet.qualityGate.status.replaceAll('_', ' ')}</div>
            <div className="mt-1" style={{ color: '#94A3B8' }}>{packet.qualityGate.redTeamSummary}</div>
          </div>
        </div>

        <div className="mt-2 rounded px-2 py-2 text-xs" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-1 font-bold tracking-widest" style={{ color: '#FDE68A' }}>APPROVAL PACKET</div>
          <div style={{ color: '#E5E7EB' }}>{packet.approvalPacket.executiveSummary}</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>
              <div className="font-bold tracking-widest" style={{ color: '#93C5FD' }}>RECOMMENDED PATH</div>
              <div className="mt-1" style={{ color: '#CBD5E1' }}>{packet.approvalPacket.recommendedPath}</div>
            </div>
            <div>
              <div className="font-bold tracking-widest" style={{ color: '#FCA5A5' }}>OPEN RISKS</div>
              <ul className="mt-1 space-y-1" style={{ color: '#CBD5E1' }}>
                {packet.approvalPacket.openRisks.slice(0, 3).map(risk => <li key={risk}>- {risk}</li>)}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-2 rounded px-2 py-2 text-xs" style={{ border: '1px solid rgba(56,189,248,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-1 font-bold tracking-widest" style={{ color: '#BAE6FD' }}>ANALYST FINDINGS</div>
          <div style={{ color: '#CBD5E1' }}>{packet.approvalPacket.confidenceSummary}</div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <div>
              <div className="font-bold tracking-widest" style={{ color: '#86EFAC' }}>TRENDS</div>
              <ul className="mt-1 space-y-1" style={{ color: '#CBD5E1' }}>
                {packet.approvalPacket.trendObservations.slice(0, 2).map(item => <li key={item}>- {item}</li>)}
              </ul>
            </div>
            <div>
              <div className="font-bold tracking-widest" style={{ color: '#FDE68A' }}>SCORES</div>
              <ul className="mt-1 space-y-1" style={{ color: '#CBD5E1' }}>
                {packet.approvalPacket.opportunityScores.slice(0, 2).map(item => (
                  <li key={item.label}>- {item.label}: {item.score}/100 ({item.band})</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-bold tracking-widest" style={{ color: '#FCA5A5' }}>ANOMALIES</div>
              <ul className="mt-1 space-y-1" style={{ color: '#CBD5E1' }}>
                {packet.approvalPacket.anomalyAlerts.slice(0, 2).map(item => <li key={item}>- {item}</li>)}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {([
            ['approve', 'Approve'],
            ['pause', 'Pause'],
            ['redirect', 'Redirect'],
            ['deeper_work', 'Deeper Work'],
          ] as const).map(([action, label]) => (
            <button
              key={action}
              type="button"
              onClick={() => onProjectAction?.(action, packet)}
              className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
              style={{
                border: action === 'approve' ? '1px solid #34D399' : action === 'pause' ? '1px solid #FBBF24' : '1px solid #60A5FA',
                color: action === 'approve' ? '#34D399' : action === 'pause' ? '#FBBF24' : '#BFDBFE',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 text-[10px] tracking-widest" style={{ color: '#64748B' }}>
          Prepared workflow only. Commander approval is required before execution, file mutation, commit, push, deploy, legal reliance, or external action.
        </div>
      </div>
    )
  }
  if (msg.messageType === 'analyst_operations' && msg.analystOperationsPacket) {
    const packet = msg.analystOperationsPacket
    const copyPacket = () => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return
      void navigator.clipboard.writeText(JSON.stringify(packet, null, 2))
    }

    return (
      <div className="message-fade-in mb-4 ml-11 rounded-lg p-3 text-sm"
        style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.28)' }}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>
              Analyst operations
            </div>
            <div className="mt-1 text-sm font-bold" style={{ color: '#E0F2FE' }}>{packet.report.title}</div>
            <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#94A3B8' }}>
              {packet.id} · {packet.status.replaceAll('_', ' ')}
            </div>
          </div>
          <button type="button" onClick={copyPacket}
            className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
            style={{ border: '1px solid rgba(56,189,248,0.45)', color: '#BAE6FD' }}>
            Copy Analyst Packet
          </button>
        </div>
        <AnalystOperationsPanel packet={packet} compact />
        <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(52,211,153,0.16)', background: 'rgba(0,0,0,0.22)' }}>
            <div className="font-bold tracking-widest" style={{ color: '#86EFAC' }}>CONFIDENCE</div>
            <div style={{ color: '#CBD5E1' }}>{packet.report.confidenceSummary}</div>
          </div>
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(251,191,36,0.16)', background: 'rgba(0,0,0,0.22)' }}>
            <div className="font-bold tracking-widest" style={{ color: '#FDE68A' }}>DATA GAPS / UNKNOWNS</div>
            <ul className="mt-1 space-y-1" style={{ color: '#CBD5E1' }}>
              {[...packet.report.dataGaps, ...packet.report.unknowns].slice(0, 3).map(item => <li key={item}>- {item}</li>)}
            </ul>
          </div>
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(248,113,113,0.16)', background: 'rgba(0,0,0,0.22)' }}>
            <div className="font-bold tracking-widest" style={{ color: '#FCA5A5' }}>RISKS</div>
            <ul className="mt-1 space-y-1" style={{ color: '#CBD5E1' }}>
              {packet.report.anomalyAlerts.slice(0, 3).map(item => <li key={item}>- {item}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-2 text-[10px] tracking-widest" style={{ color: '#64748B' }}>
          Analyst lanes assist Commander decisions only. No external action, commit, push, deploy, outreach, purchase, or legal reliance is performed.
        </div>
      </div>
    )
  }
  if (msg.messageType === 'engineering_task' && msg.engineeringTaskPacket) {
    const packet = msg.engineeringTaskPacket
    const copyPacket = () => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return
      void navigator.clipboard.writeText(packet.cursorCommand)
    }

    return (
      <div className="message-fade-in mb-4 ml-11 rounded-lg p-3 text-sm"
        style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.28)' }}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>
              Engineering task prepared
            </div>
            <div className="mt-1 text-sm font-bold" style={{ color: '#E0F2FE' }}>{packet.title}</div>
            <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#94A3B8' }}>
              Assigned executor: {packet.assignedExecutorLabel} · status: prepared / awaiting Commander approval
            </div>
          </div>
          <button type="button" onClick={copyPacket}
            className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
            style={{ border: '1px solid rgba(56,189,248,0.45)', color: '#BAE6FD' }}>
            Copy Cursor Packet
          </button>
        </div>
        <div className="grid gap-2 text-xs md:grid-cols-3">
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#94A3B8' }}>FILES TO INSPECT</div>
            <ul className="space-y-1" style={{ color: '#CBD5E1' }}>
              {packet.filesToInspect.map(file => <li key={file}>- {file}</li>)}
            </ul>
          </div>
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#FDE68A' }}>VALIDATION</div>
            <ul className="space-y-1" style={{ color: '#E5E7EB' }}>
              {packet.validationCommands.map(command => <li key={command}>- {command}</li>)}
            </ul>
          </div>
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(239,68,68,0.18)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#FCA5A5' }}>APPROVAL / AUDIT</div>
            <div style={{ color: '#CBD5E1' }}>Commander approval required before execution or repo mutation.</div>
            <div className="mt-1" style={{ color: '#94A3B8' }}>{packet.rollbackRecommendation}</div>
          </div>
        </div>
        <textarea readOnly value={packet.cursorCommand}
          className="mt-3 h-40 w-full resize-y rounded bg-black/40 p-3 font-mono text-[11px] leading-relaxed outline-none"
          style={{ border: '1px solid rgba(56,189,248,0.18)', color: '#CBD5E1' }}
          aria-label="Cursor task packet" />
        <div className="mt-2 text-[10px] tracking-widest" style={{ color: '#64748B' }}>
          Optional review lane: Claude architecture review / Red Team risk review. War Room does not invoke Cursor or mutate files from this card.
        </div>
      </div>
    )
  }
  if (msg.messageType === 'repair_packet' && msg.repairPacket) {
    const packet = msg.repairPacket
    const copyPacket = () => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return
      void navigator.clipboard.writeText(packet.cursorReadyPrompt)
    }

    return (
      <div className="message-fade-in mb-4 ml-11 rounded-lg p-3 text-sm"
        style={{ background: 'rgba(14,165,233,0.07)', border: '1px solid rgba(14,165,233,0.3)' }}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold tracking-widest" style={{ color: '#7DD3FC' }}>
              Repair packet prepared
            </div>
            <div className="mt-1 text-sm font-bold" style={{ color: '#E0F2FE' }}>{packet.title}</div>
            <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#94A3B8' }}>
              {packet.classification.replaceAll('_', ' ')} · {packet.approvalStatus.replaceAll('_', ' ')} · manual Cursor copy only
            </div>
          </div>
          <button type="button" onClick={copyPacket}
            className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
            style={{ border: '1px solid rgba(14,165,233,0.45)', color: '#BAE6FD' }}>
            Copy Cursor Packet
          </button>
        </div>
        <div className="grid gap-2 text-xs md:grid-cols-3">
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#94A3B8' }}>SYMPTOMS</div>
            <ul className="space-y-1" style={{ color: '#CBD5E1' }}>
              {packet.observedSymptoms.slice(0, 3).map(item => <li key={item}>- {item}</li>)}
            </ul>
          </div>
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#FDE68A' }}>INSPECT</div>
            <ul className="space-y-1" style={{ color: '#E5E7EB' }}>
              {packet.filesRoutesToInspect.slice(0, 5).map(file => <li key={file}>- {file}</li>)}
            </ul>
          </div>
          <div className="rounded px-2 py-2" style={{ border: '1px solid rgba(239,68,68,0.18)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#FCA5A5' }}>GUARDRAILS</div>
            <div style={{ color: '#CBD5E1' }}>Advisory only. Approval required. No browser execution, file mutation, Cursor API, deploy, commit, push, or fake completion.</div>
          </div>
        </div>
        <textarea readOnly value={packet.cursorReadyPrompt}
          className="mt-3 h-36 w-full resize-y rounded bg-black/40 p-3 font-mono text-[11px] leading-relaxed outline-none"
          style={{ border: '1px solid rgba(14,165,233,0.18)', color: '#CBD5E1' }}
          aria-label="Cursor repair packet" />
        <div className="mt-2 text-[10px] tracking-widest" style={{ color: '#64748B' }}>
          Logged to System Ledger / Activity Stream when available. Baby Observer lesson remains a candidate until approved or validated.
        </div>
      </div>
    )
  }
  return (
    <div className={`message-fade-in flex items-start gap-3 mb-4 ${isRael ? 'flex-row-reverse' : ''}`}>
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm"
        style={{ background: msg.color + '22', border: `1px solid ${msg.color}40` }}>
        {msg.icon}
      </div>
      <div className={`flex-1 max-w-2xl ${isRael ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`flex items-center gap-2 mb-1 ${isRael ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-bold tracking-widest" style={{ color: msg.color }}>{msg.familyName}</span>
          {msg.provider && <span className="text-xs" style={{ color: '#444' }}>{msg.provider}</span>}
          <span className="text-xs" style={{ color: '#333' }}>{msg.timestamp}</span>
          <span className="text-xs px-1 rounded" style={{ color: '#555', background: '#111' }}>{msg.messageType}</span>
        </div>
        <div className="rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap"
          style={{
            background: isRael ? '#1a1500' : 'rgba(255,255,255,0.03)',
            borderLeft: isRael ? 'none' : `2px solid ${msg.color}`,
            borderRight: isRael ? `2px solid ${msg.color}` : 'none',
          }}>
          {msg.content}
        </div>
        {!isRael && msg.messageType === 'response' && isCouncilMessageRepairPacketEligible(msg) ? (
          <button
            type="button"
            onClick={() => onPrepareRepairPacket?.(msg)}
            className="mt-2 self-start rounded px-2 py-1 text-[10px] font-bold tracking-widest"
            style={{ border: '1px solid rgba(14,165,233,0.35)', color: '#7DD3FC', background: 'rgba(0,0,0,0.24)' }}
          >
            Prepare Repair Packet
          </button>
        ) : null}
        {msg.degraded && msg.messageType === 'response' ? (
          <p className="mt-2 text-[10px] tracking-widest" style={{ color: '#FBBF24' }}>
            Degraded response quality — excluded from synthesis and repair packets.
          </p>
        ) : null}
      </div>
    </div>
  )
})

const CouncilMessageRows = memo(function CouncilMessageRows({
  messages,
  hiddenCount,
  collapsedNoiseCount,
  onViewArchive,
  onSummarizeSession,
  onRecallEconomicOps,
  onOpenFullMemory,
  onProjectAction,
  onPrepareRepairPacket,
}: {
  messages: CouncilMessage[]
  hiddenCount: number
  collapsedNoiseCount: number
  onViewArchive: () => void
  onSummarizeSession: () => void
  onRecallEconomicOps: () => void
  onOpenFullMemory: (preview: CouncilMemoryRecallPreview) => void
  onProjectAction: (action: 'approve' | 'pause' | 'redirect' | 'deeper_work', packet: ProjectOrchestrationPacket) => void
  onPrepareRepairPacket: (message: CouncilMessage) => void
}) {
  return (
    <>
      {hiddenCount > 0 ? (
        <div
          className="mb-4 ml-11 flex flex-wrap items-center gap-2 rounded px-3 py-2 text-xs"
          style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.24)', color: '#93C5FD' }}
        >
          <span className="tracking-widest">
            Older messages archived. Use recall to retrieve. {hiddenCount} hidden from live view.
          </span>
          <button type="button" onClick={onViewArchive} className="rounded px-2 py-1 tracking-widest" style={{ border: '1px solid #60A5FA', color: '#BFDBFE' }}>
            View Archive
          </button>
          <button type="button" onClick={onSummarizeSession} className="rounded px-2 py-1 tracking-widest" style={{ border: '1px solid #FFD700', color: '#FFD700' }}>
            Summarize Session
          </button>
          <button type="button" onClick={onRecallEconomicOps} className="rounded px-2 py-1 tracking-widest" style={{ border: '1px solid #34D399', color: '#86EFAC' }}>
            Recall Economic Ops
          </button>
        </div>
      ) : null}
      {collapsedNoiseCount > 0 ? (
        <div
          className="mb-4 ml-11 rounded px-3 py-2 text-[10px] tracking-widest"
          style={{ background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.22)', color: '#CBD5E1' }}
        >
          Clear Noise active: {collapsedNoiseCount} repeated notice{collapsedNoiseCount === 1 ? '' : 's'} collapsed from the live view.
        </div>
      ) : null}
      {messages.map(msg => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          diagnosticsOpen={false}
          onOpenFullMemory={onOpenFullMemory}
          onProjectAction={onProjectAction}
          onPrepareRepairPacket={onPrepareRepairPacket}
        />
      ))}
    </>
  )
})

function EvidencePill({ weight }: { weight: CouncilCompressedSummary['evidence'][number]['evidenceWeight'] }) {
  const color =
    weight === 'verified'
      ? '#34D399'
      : weight === 'source-backed'
        ? '#38BDF8'
        : weight === 'inferred'
          ? '#FBBF24'
          : weight === 'uncertain'
            ? '#A78BFA'
            : '#F87171'
  return (
    <span className="rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest" style={{ border: `1px solid ${color}66`, color }}>
      {weight}
    </span>
  )
}

const CompressedCouncilPanel = memo(function CompressedCouncilPanel({
  summary,
  onGenerateRepairPacket,
  onGenerateRevenuePacket,
  onSaveLessonCandidate,
}: {
  summary: CouncilCompressedSummary
  onGenerateRepairPacket: () => void
  onGenerateRevenuePacket: () => void
  onSaveLessonCandidate: () => void
}) {
  const isBrief = summary.mode === 'brief'
  const bullets = isBrief
    ? [
        `Priority: ${summary.nextAction}`,
        `Risk: ${summary.risk.summary}`,
        `Evidence: ${summary.evidence[0]?.text ?? 'No current evidence note.'}`,
        ...summary.decisionSummary.slice(0, 2),
      ].slice(0, 5)
    : summary.decisionSummary

  return (
    <section className="mt-3 rounded border border-emerald-500/20 bg-emerald-950/10 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#86EFAC' }}>
            Compressed Council Intelligence · {councilOutputModeLabel(summary.mode)}
          </div>
          <p className="mt-1 text-[10px]" style={{ color: '#94A3B8' }}>
            Duplicate findings collapsed: {summary.duplicateReduction.rawFindingCount} raw to {summary.duplicateReduction.collapsedFindingCount} shared.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {summary.repairPacket?.applicable ? (
            <button type="button" onClick={onGenerateRepairPacket} className="rounded px-2 py-1 text-[9px] font-bold tracking-widest" style={{ border: '1px solid rgba(14,165,233,0.45)', color: '#BAE6FD' }}>
              Generate Repair Packet
            </button>
          ) : null}
          {summary.revenuePacket?.applicable ? (
            <button type="button" onClick={onGenerateRevenuePacket} className="rounded px-2 py-1 text-[9px] font-bold tracking-widest" style={{ border: '1px solid rgba(52,211,153,0.45)', color: '#A7F3D0' }}>
              Generate Revenue Action Packet
            </button>
          ) : null}
          {summary.evidence.some(item => /lesson|pattern|durable|remember/i.test(item.text)) ? (
            <button type="button" onClick={onSaveLessonCandidate} className="rounded px-2 py-1 text-[9px] font-bold tracking-widest" style={{ border: '1px solid rgba(167,139,250,0.45)', color: '#DDD6FE' }}>
              Save Lesson Candidate
            </button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: '#D1FAE5' }}>Decision Summary</div>
          <ul className="space-y-1" style={{ color: '#E5E7EB' }}>
            {bullets.map((item, index) => <li key={`${index}-${item}`}>- {item}</li>)}
          </ul>
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-2">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#FDE68A' }}>Next Action</div>
          <p className="mt-1" style={{ color: '#F8FAFC' }}>{summary.nextAction}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[8px] uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
              risk {summary.risk.level}
            </span>
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[8px] uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
              {summary.risk.redTeamCalibration.replaceAll('_', ' ')}
            </span>
          </div>
        </div>
      </div>
      {summary.evidence.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {summary.evidence.slice(0, summary.mode === 'deep' ? 6 : 4).map(item => (
            <article key={item.id} className="rounded border border-white/10 bg-black/20 p-2">
              <div className="mb-1 flex flex-wrap items-center gap-1">
                <EvidencePill weight={item.evidenceWeight} />
                <span className="text-[8px] uppercase tracking-widest" style={{ color: '#64748B' }}>
                  {item.supportingFamilies.join(' + ')}
                </span>
              </div>
              <p style={{ color: '#CBD5E1' }}>{item.text}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
})

type CouncilSessionControlHandlers = {
  onNewSession: () => void
  onClearChat: () => void
  onSoftReset: () => void
  onArchiveSession: () => void
  onClearNoise: () => void
  onExportSession: () => void
}

const sessionControlButtonStyle = {
  border: '1px solid rgba(148,163,184,0.35)',
  color: '#CBD5E1',
  background: 'rgba(0,0,0,0.22)',
}

const CouncilSessionControls = memo(function CouncilSessionControls({
  compact = false,
  onNewSession,
  onClearChat,
  onSoftReset,
  onArchiveSession,
  onClearNoise,
  onExportSession,
}: CouncilSessionControlHandlers & { compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'justify-start' : 'justify-end'}`}>
      <button type="button" onClick={onNewSession} className="rounded px-2 py-1 text-[9px] font-bold tracking-widest" style={{ border: '1px solid rgba(52,211,153,0.45)', color: '#A7F3D0', background: 'rgba(0,0,0,0.22)' }}>
        New Council Session
      </button>
      <button type="button" onClick={onClearChat} className="rounded px-2 py-1 text-[9px] tracking-widest" style={sessionControlButtonStyle}>
        Clear Chat
      </button>
      <button type="button" onClick={onSoftReset} className="rounded px-2 py-1 text-[9px] tracking-widest" style={sessionControlButtonStyle}>
        Soft Reset
      </button>
      <button type="button" onClick={onArchiveSession} className="rounded px-2 py-1 text-[9px] tracking-widest" style={{ border: '1px solid rgba(96,165,250,0.45)', color: '#BFDBFE', background: 'rgba(0,0,0,0.22)' }}>
        Archive Session
      </button>
      <button type="button" onClick={onClearNoise} className="rounded px-2 py-1 text-[9px] tracking-widest" style={sessionControlButtonStyle}>
        Clear Noise
      </button>
      <button type="button" onClick={onExportSession} className="rounded px-2 py-1 text-[9px] tracking-widest" style={sessionControlButtonStyle}>
        Export Session
      </button>
    </div>
  )
})

const CouncilLifecycleIndicators = memo(function CouncilLifecycleIndicators({
  lifecycle,
  memoryState,
  sessionOnly,
}: {
  lifecycle: CouncilSessionLifecycle
  memoryState: MemoryRuntimeState
  sessionOnly: boolean
}) {
  const indicators = [
    lifecycle === 'archived' ? 'Session Archived' : 'Session Active',
    sessionOnly ? 'Temporary Learning' : 'Durable Memory Online',
    sessionOnly || memoryState !== 'ONLINE' ? 'Observer Session Mode' : 'Durable Memory Online',
  ]

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] tracking-widest">
      {[...new Set(indicators)].map(item => (
        <span key={item} className="rounded border border-white/10 px-2 py-1" style={{ color: item.includes('Online') ? '#86EFAC' : '#FDE68A', background: 'rgba(0,0,0,0.2)' }}>
          {item}
        </span>
      ))}
    </div>
  )
})

function TypingIndicator({ familyName, label }: { familyName: TypingFamily; label?: string }) {
  const family = FAMILY_META[familyName]

  return (
    <div className="flex items-center gap-3 ml-11 mb-4 message-fade-in">
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
        style={{ background: family.color + '22', border: `1px solid ${family.color}40` }}>
        {family.icon}
      </div>
      <div className="flex items-center gap-2 rounded px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `2px solid ${family.color}` }}>
        <span className="text-xs font-bold tracking-widest" style={{ color: family.color }}>
          {label ?? `${familyName} THINKING`}
        </span>
        <span className="typing-dot" style={{ background: family.color }} />
        <span className="typing-dot" style={{ background: family.color, animationDelay: '120ms' }} />
        <span className="typing-dot" style={{ background: family.color, animationDelay: '240ms' }} />
      </div>
    </div>
  )
}

function toolBarTone(label: ToolBarLabel) {
  if (label === '—') {
    return {
      active: false,
      nameColor: '#555',
      labelColor: '#444',
      border: '1px solid #222',
      background: 'rgba(255,255,255,0.02)',
      dot: '#333',
      dotGlow: 'none',
    }
  }

  if (label === 'SCANNING' || label === 'ACTIVE') {
    return {
      active: true,
      nameColor: '#FFD700',
      labelColor: '#fde68a',
      border: '1px solid rgba(255,215,0,0.45)',
      background: 'rgba(255,215,0,0.08)',
      dot: '#FFD700',
      dotGlow: '0 0 8px rgba(255,215,0,0.75)',
    }
  }

  if (label === 'ERROR') {
    return {
      active: true,
      nameColor: '#fca5a5',
      labelColor: '#fecaca',
      border: '1px solid rgba(239,68,68,0.45)',
      background: 'rgba(239,68,68,0.06)',
      dot: '#EF4444',
      dotGlow: '0 0 8px rgba(239,68,68,0.55)',
    }
  }

  if (label === 'CONFIG NEEDED' || label === 'PARTIAL') {
    return {
      active: true,
      nameColor: '#fdba74',
      labelColor: '#ffedd5',
      border: '1px solid rgba(251,146,60,0.45)',
      background: 'rgba(251,146,60,0.06)',
      dot: '#fb923c',
      dotGlow: '0 0 8px rgba(251,146,60,0.45)',
    }
  }

  if (label === 'NOT CONNECTED') {
    return {
      active: false,
      nameColor: '#666',
      labelColor: '#737373',
      border: '1px solid #2a2a2a',
      background: 'rgba(255,255,255,0.02)',
      dot: '#525252',
      dotGlow: 'none',
    }
  }

  return {
    active: true,
    nameColor: '#34D399',
    labelColor: '#7ee7b7',
    border: '1px solid rgba(52,211,153,0.45)',
    background: 'rgba(52,211,153,0.08)',
    dot: '#34D399',
    dotGlow: '0 0 8px rgba(52,211,153,0.8)',
  }
}

function ToolStatusPanel({
  health,
  activity,
}: {
  health: Record<ToolId, ToolBarLabel>
  activity: Partial<Record<ToolId, ToolBarLabel>>
}) {
  return (
    <div className="border-b border-yellow-900 px-6 py-2 flex-shrink-0"
      style={{ background: 'rgba(255,215,0,0.02)' }}>
      <div className="flex items-center gap-2 overflow-x-auto">
        {TOOL_REGISTRY.map(tool => {
          const label = activity[tool.id] ?? health[tool.id] ?? '—'
          const tone = toolBarTone(label)
          const tooltipSynonym = label === 'REACHABLE' && tool.id === 'memory'
            ? ' (memory store reachable; same as API complete)'
            : ''

          return (
            <div key={tool.id}
              className="flex items-center gap-2 rounded px-3 py-2 text-xs tracking-widest whitespace-nowrap"
              title={`${tool.description} Endpoint: ${tool.endpoint}${tool.requiresAuth ? ' Auth required.' : ''}${tooltipSynonym}`}
              style={{
                border: tone.border,
                color: tone.nameColor,
                background: tone.background,
              }}>
              <span className={tone.active ? 'tool-dot-active' : ''}
                style={{
                  width: '0.45rem',
                  height: '0.45rem',
                  borderRadius: '9999px',
                  background: tone.dot,
                  boxShadow: tone.dotGlow,
                }} />
              <span>{tool.name}</span>
              <span style={{ color: tone.labelColor }}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const WarRoomPerformancePanel = memo(function WarRoomPerformancePanel({
  diagnostics,
  activeTab,
}: {
  diagnostics: WarRoomPerformanceDiagnostics
  activeTab: OperatorTab
}) {
  const refreshLabel = diagnostics.lastRefreshDurationMs === null
    ? 'not measured'
    : `${Math.round(diagnostics.lastRefreshDurationMs)}ms`
  const renderTone = diagnostics.lastRenderMs > 24 ? '#FBBF24' : '#34D399'

  return (
    <section className="mb-3 rounded border border-white/10 bg-black/25 px-3 py-2 text-[10px]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold uppercase tracking-widest" style={{ color: '#A7F3D0' }}>UI Performance</div>
        <div className="uppercase tracking-widest" style={{ color: '#64748B' }}>active tab: {activeTab}</div>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Render count</div>
          <div className="mt-1 font-bold" style={{ color: '#E5E7EB' }}>{diagnostics.renderCount}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Last commit</div>
          <div className="mt-1 font-bold" style={{ color: renderTone }}>{diagnostics.lastRenderMs.toFixed(1)}ms</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Slow panel hint</div>
          <div className="mt-1 font-bold uppercase" style={{ color: '#FDE68A' }}>{diagnostics.slowPanel}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Toolbar refresh</div>
          <div className="mt-1 font-bold" style={{ color: '#93C5FD' }}>{refreshLabel}</div>
        </div>
      </div>
      <div className="mt-2 uppercase tracking-widest" style={{ color: '#64748B' }}>
        Status polling interval: {Math.round(diagnostics.pollingIntervalMs / 1000)}s
        {diagnostics.lastRefreshAt ? ` · last refresh ${new Date(diagnostics.lastRefreshAt).toLocaleTimeString()}` : ''}
      </div>
    </section>
  )
})

function TokenUsagePanel({
  rows,
  currentCost,
  sessionTotal,
  providerHealth,
}: {
  rows: UsageEstimate[]
  currentCost: number
  sessionTotal: number
  providerHealth: ProviderHealthState
}) {
  const modelLabel = (row: UsageEstimate) => {
    if (row.familyName === 'Grok Family') return providerHealth.labels.grok
    if (row.familyName === 'Gemini Family') return providerHealth.labels.gemini
    if (row.familyName === 'Claude Family') return providerHealth.labels.claude
    if (row.familyName === 'ChatGPT Family') return providerHealth.labels.chatgpt
    return `${row.provider} · ${row.model}`
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FFD700' }}>TOKEN USAGE</h2>
          <p className="text-xs" style={{ color: '#555' }}>Mock estimates. Concise mode is default.</p>
        </div>
        <div className="flex gap-4 text-xs tracking-widest">
          <span style={{ color: '#888' }}>CURRENT {formatCost(currentCost)}</span>
          <span style={{ color: '#FFD700' }}>SESSION {formatCost(sessionTotal)}</span>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {rows.map(row => (
          <div key={row.familyName} className="rounded px-3 py-2"
            style={{
              border: row.active ? '1px solid #2b3325' : '1px solid #1a1a1a',
              background: row.active ? 'rgba(255,215,0,0.025)' : 'rgba(255,255,255,0.01)',
            }}>
            <div className="text-xs font-bold tracking-widest" style={{ color: row.active ? '#ddd' : '#444' }}>
              {row.familyName}
            </div>
            <div className="text-xs mt-1" style={{ color: '#555' }}>{modelLabel(row)}</div>
            <div className="text-xs mt-2" style={{ color: row.active ? '#888' : '#333' }}>
              IN {row.inputTokens} · OUT {row.outputTokens}
            </div>
            <div className="text-xs mt-1" style={{ color: row.active ? '#34D399' : '#333' }}>
              {formatCost(row.estimatedCost)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RepoAwarenessPanel({
  repo,
  onScan,
}: {
  repo: RepoAwarenessState
  onScan: () => Promise<void>
}) {
  const scanColor: Record<RepoScanStatus, string> = {
    idle: '#666',
    scanning: '#FFD700',
    indexed: '#34D399',
    error: '#EF4444',
  }
  const extensionSummary = Object.entries(repo.extensionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(167,139,250,0.016)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#A78BFA' }}>
            REPO AWARENESS
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Read-only codebase structure, routes, feature inventory, and build/deploy status labels.
          </p>
        </div>
        <button type="button" onClick={() => void onScan()} disabled={repo.scanStatus === 'scanning'}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
          style={{ background: '#A78BFA', color: '#000' }}>
          {repo.scanStatus === 'scanning' ? 'SCANNING...' : 'SCAN REPO'}
        </button>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>REPO STATUS</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{repo.repoStatus}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>FILES INDEXED</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{repo.totalFilesIndexed}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>CURRENT BRANCH</div>
          <div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{repo.currentBranch}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(239,68,68,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>SCAN STATUS</div>
          <div className="mt-1 font-bold" style={{ color: scanColor[repo.scanStatus] }}>{repo.scanStatus.toUpperCase()}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>APP ROUTES </span>
          <span style={{ color: '#888' }}>{repo.routes.length}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>API ROUTES </span>
          <span style={{ color: '#888' }}>{repo.apiRoutes.length}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>BUILD </span>
          <span style={{ color: '#888' }}>{repo.buildStatus}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>DEPLOYMENT </span>
          <span style={{ color: '#888' }}>{repo.deploymentStatus}</span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#A78BFA' }}>ARCHITECTURE MAP</div>
          <div className="grid gap-1">
            {repo.architectureMap.length === 0 ? (
              <span style={{ color: '#555' }}>No scan yet.</span>
            ) : repo.architectureMap.map(item => (
              <div key={item.module} className="flex items-center justify-between rounded px-2 py-1" style={{ border: '1px solid #222' }}>
                <span style={{ color: '#888' }}>{item.module}/</span>
                <span style={{ color: '#34D399' }}>{item.fileCount}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#34D399' }}>FEATURES DETECTED</div>
          <div className="flex flex-wrap gap-1">
            {repo.features.length === 0 ? (
              <span style={{ color: '#555' }}>No scan yet.</span>
            ) : repo.features.map(feature => (
              <span key={feature.name} className="rounded px-2 py-1 text-[10px] tracking-widest"
                style={{ border: '1px solid rgba(52,211,153,0.2)', color: '#9AE6B4' }}>
                {feature.name}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#FFD700' }}>LATEST COMMITS</div>
          <div className="grid gap-1">
            {repo.latestCommits.length === 0 ? (
              <span style={{ color: '#555' }}>No commit data yet.</span>
            ) : repo.latestCommits.slice(0, 3).map(commit => (
              <div key={`${commit.hash}-${commit.message}`} className="rounded px-2 py-1" style={{ border: '1px solid #222' }}>
                <span style={{ color: '#FFD700' }}>{commit.hash}</span>
                <span style={{ color: '#888' }}> {commit.message || 'commit'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 tracking-widest" style={{ color: '#555' }}>ROUTES</div>
          <div className="flex flex-wrap gap-1">
            {repo.routes.slice(0, 12).map(route => (
              <span key={route} className="rounded px-2 py-1 text-[10px]" style={{ border: '1px solid #222', color: '#888' }}>{route}</span>
            ))}
          </div>
        </div>
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 tracking-widest" style={{ color: '#555' }}>API ROUTES</div>
          <div className="flex flex-wrap gap-1">
            {repo.apiRoutes.slice(0, 16).map(route => (
              <span key={route} className="rounded px-2 py-1 text-[10px]" style={{ border: '1px solid #222', color: '#888' }}>{route}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {extensionSummary.map(([extension, count]) => (
          <span key={extension} className="rounded px-2 py-1 text-[10px] tracking-widest"
            style={{ border: '1px solid rgba(167,139,250,0.18)', color: '#999' }}>
            .{extension}: {count}
          </span>
        ))}
        {repo.restrictions.map(restriction => (
          <span key={restriction} className="rounded px-2 py-1 text-[10px] tracking-widest"
            style={{ border: '1px solid rgba(239,68,68,0.2)', color: '#777' }}>
            {restriction}
          </span>
        ))}
      </div>

      <div className="mt-3 text-xs" style={{ color: '#555' }}>
        Last scan: {repo.lastScanTime ? new Date(repo.lastScanTime).toLocaleString() : 'never'} | {repo.message}
      </div>
    </div>
  )
}

function KernelStatusPanel() {
  const routingCount = Object.keys(CAPABILITY_ROUTES).length
  const familyCount = Object.keys(AGENT_FAMILY_CAPABILITIES).length
  const gateCount = Object.keys(APPROVAL_RISK_GATES).length
  const memoryCategories = MEMORY_POLICY.categories.length
  const kernelReady = routingCount > 0 && familyCount > 0 && gateCount > 0 && memoryCategories > 0
  const statusItems = [
    { label: 'KERNEL', value: kernelReady ? 'READY' : 'DEGRADED', color: kernelReady ? '#34D399' : '#FBBF24' },
    { label: 'ROUTING', value: 'ACTIVE', color: '#38BDF8' },
    { label: 'EVENT BUS', value: 'READY', color: '#A78BFA' },
    { label: 'MEMORY POLICY', value: 'ACTIVE', color: '#34D399' },
    { label: 'APPROVAL GATES', value: 'ACTIVE', color: '#FFD700' },
    { label: 'COST LEDGER', value: 'PLACEHOLDER', color: '#777' },
  ]
  const safetyRules = [
    'no autonomous execution',
    'no payment or banking execution',
    'no shell/code execution from UI',
    'secure approval gates enforced',
  ]

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(56,189,248,0.018)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>
            WAR ROOM KERNEL
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Capability routing, event schema, memory policy, and approval gates.
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: '#34D399', border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          NERVOUS SYSTEM READY
        </span>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-6">
        {statusItems.map(item => (
          <div key={item.label} className="rounded px-3 py-2"
            style={{ border: '1px solid rgba(56,189,248,0.16)', background: 'rgba(0,0,0,0.28)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>{item.label}</div>
            <div className="mt-1 font-bold" style={{ color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 text-xs md:grid-cols-5">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>FAMILIES </span>
          <span style={{ color: '#34D399' }}>{familyCount}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(56,189,248,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>ROUTES </span>
          <span style={{ color: '#38BDF8' }}>{routingCount}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>EVENT TYPES </span>
          <span style={{ color: '#A78BFA' }}>{KERNEL_EVENT_TYPES.length}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>GATES </span>
          <span style={{ color: '#FFD700' }}>{gateCount}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <span style={{ color: '#555' }}>MEMORY TYPES </span>
          <span style={{ color: '#34D399' }}>{memoryCategories}</span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(56,189,248,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#38BDF8' }}>CAPABILITY ROUTING</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(CAPABILITY_ROUTES).slice(0, 12).map(([capability, families]) => (
              <span key={capability} className="rounded px-2 py-1 text-[10px]" style={{ border: '1px solid #222', color: '#888' }}>
                {capability} &rarr; {AGENT_FAMILY_CAPABILITIES[families[0]].label}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#A78BFA' }}>EVENT SCHEMA</div>
          <div className="flex flex-wrap gap-1">
            {KERNEL_EVENT_SCHEMA.eventTypes.slice(0, 8).map(eventType => (
              <span key={eventType} className="rounded px-2 py-1 text-[10px]" style={{ border: '1px solid #222', color: '#888' }}>
                {eventType}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#FFD700' }}>GOVERNANCE</div>
          <div className="flex flex-wrap gap-1">
            {SECURE_APPROVAL_RISKS.map(risk => (
              <span key={risk} className="rounded px-2 py-1 text-[10px]" style={{ border: '1px solid rgba(255,215,0,0.18)', color: '#FFD700' }}>
                {risk}: secure approval
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {MEMORY_POLICY.rules.map(rule => (
          <span key={rule} className="rounded px-2 py-1 text-[10px] tracking-widest"
            style={{ border: '1px solid rgba(52,211,153,0.18)', color: '#777' }}>
            {rule}
          </span>
        ))}
        {safetyRules.map(rule => (
          <span key={rule} className="rounded px-2 py-1 text-[10px] tracking-widest"
            style={{ border: '1px solid rgba(239,68,68,0.18)', color: '#777' }}>
            {rule}
          </span>
        ))}
      </div>
    </div>
  )
}

function PaymentsPayoutsPanel({
  opportunities,
  ledger,
  onRefresh,
  onNotify,
}: {
  opportunities: IncomeOpportunity[]
  ledger: PaymentLedgerState
  onRefresh: () => void
  onNotify: (depositId: string) => void
}) {
  const paidOpportunities = opportunities.filter(opportunity => opportunity.status === 'paid')
  const pendingPayments = opportunities.filter(opportunity => (
    !isExpired(opportunity) && opportunity.status !== 'paid' && (opportunity.local_payout !== null || opportunity.usd_estimate !== null)
  ))
  const expectedPayouts = pendingPayments.reduce((total, opportunity) => total + (opportunity.usd_estimate ?? 0), 0)
  const paidTotal = paidOpportunities.reduce((total, opportunity) => total + (opportunity.usd_estimate ?? 0), 0)
  const expectedDeposits = ledger.deposits.filter(deposit => deposit.depositStatus === 'expected' || deposit.depositStatus === 'pending_proof')
  const confirmedDeposits = ledger.deposits.filter(deposit => deposit.depositStatus === 'confirmed' || deposit.depositStatus === 'notified')
  const proofNeeded = ledger.deposits.filter(deposit => deposit.proofRequired && deposit.proofStatus === 'required')
  const notifications = ledger.deposits.filter(deposit => deposit.notificationStatus !== 'not_sent')
  const invoiceItems = opportunities.filter(opportunity => (
    opportunity.notes.toLowerCase().includes('invoice') || opportunity.status === 'applied' || opportunity.status === 'active'
  ))

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(52,211,153,0.016)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
            DEPOSIT + PAYOUT NOTIFICATIONS
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Expected deposits, proof collection, confirmation visibility, and Ra’el notifications.
          </p>
        </div>
        <button
          type="button"
          className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
          style={{ border: '1px solid rgba(52,211,153,0.35)', color: '#86EFAC' }}
          onClick={onRefresh}
        >
          Refresh ledger
        </button>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: ledger.persistenceLabel === 'Supabase persistent' ? '#34D399' : '#FBBF24', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.28)' }}>
          {ledger.persistenceLabel}
        </span>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: '#FFD700', border: '1px solid rgba(255,215,0,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          SECURE APPROVAL REQUIRED
        </span>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>EXPECTED DEPOSITS</div>
          <div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{expectedDeposits.length || pendingPayments.length}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>PROOF NEEDED</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{proofNeeded.length} | {formatMoney(expectedPayouts)}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>DEPOSIT CONFIRMED</div>
          <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>{confirmedDeposits.length} | {formatMoney(paidTotal)}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>RA&apos;EL NOTIFIED</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{notifications.length}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>ESTIMATED PIPELINE</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{formatMoney(expectedPayouts)}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>PAID OPPORTUNITIES</div>
          <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>{paidOpportunities.length} | {formatMoney(paidTotal)}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>INVOICE STATUS</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{invoiceItems.length ? `${invoiceItems.length} tracking` : 'none active'}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(239,68,68,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>REQUIRES REVIEW</div>
          <div className="mt-1 font-bold" style={{ color: ledger.redSentinel.status === 'clear' ? '#34D399' : '#FCA5A5' }}>{ledger.redSentinel.findings.length}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs lg:grid-cols-2">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 tracking-widest" style={{ color: '#555' }}>PAYMENT PROVIDERS</div>
          <div className="flex flex-wrap gap-2">
            {ledger.providers.map(provider => (
              <span key={provider.id} title={provider.notes} className="rounded px-2 py-1 text-[10px] tracking-widest"
                style={{ border: '1px solid rgba(52,211,153,0.18)', color: '#888', background: 'rgba(0,0,0,0.24)' }}>
                {provider.name} | {provider.status}
              </span>
            ))}
            {ledger.providers.length === 0 && <span style={{ color: '#666' }}>Provider readiness not loaded.</span>}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 tracking-widest" style={{ color: '#555' }}>RED SENTINEL PAYMENT WATCH</div>
          <div style={{ color: '#888' }}>
            {ledger.redSentinel.status === 'clear' ? 'Clear' : 'Requires review'} · {ledger.redSentinel.findings[0]?.message ?? 'No payment guard findings.'}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
        <div className="mb-2 tracking-widest" style={{ color: '#555' }}>PAYMENT LEDGER</div>
        {ledger.deposits.length === 0 ? (
          <div style={{ color: '#666' }}>No deposit records loaded.</div>
        ) : (
          <div className="grid gap-2">
            {ledger.deposits.slice(0, 4).map(deposit => (
              <div key={deposit.depositId} className="rounded border border-white/10 px-2 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span style={{ color: '#ddd' }}>{deposit.payerPlatformName} · {deposit.currency} {deposit.expectedAmount ?? 'pending'}</span>
                  <span style={{ color: deposit.riskStatus === 'clear' ? '#34D399' : '#FCA5A5' }}>{deposit.depositStatus.replaceAll('_', ' ')}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]" style={{ color: '#777' }}>
                  <span>{deposit.proofRequired && deposit.proofStatus === 'required' ? 'Proof needed' : deposit.proofStatus.replaceAll('_', ' ')}</span>
                  <span>{deposit.notificationStatus === 'sent' ? 'Ra’el notified' : deposit.notificationStatus.replaceAll('_', ' ')}</span>
                  <button type="button" className="rounded px-2 py-0.5 font-bold" style={{ border: '1px solid rgba(255,215,0,0.25)', color: '#FFD700' }} onClick={() => onNotify(deposit.depositId)}>
                    Notify Ra’el
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FilesEvidenceVaultPanel({
  files,
  loading,
  message,
  onUpload,
}: {
  files: WarRoomFile[]
  loading: boolean
  message: string | null
  onUpload: (formData: FormData) => Promise<void>
}) {
  const [sourceContext, setSourceContext] = useState('war-room')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const statusColors: Record<WarRoomFile['status'], string> = {
    uploaded: '#FFD700',
    indexed: '#34D399',
    error: '#EF4444',
  }

  const submitFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    await onUpload(formData)
    form.reset()
    setSourceContext('war-room')
    setTags('')
    setNotes('')
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-4 flex-shrink-0"
      style={{ background: 'rgba(96,165,250,0.016)' }}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#60A5FA' }}>
            FILES / EVIDENCE VAULT
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Upload real documents, screenshots, datasets, and project evidence for future analysis.
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)', background: 'rgba(0,0,0,0.28)' }}>
          {files.length} FILES
        </span>
      </div>

      <form onSubmit={submitFile} className="mb-4 rounded-md p-3"
        style={{ border: '1px solid rgba(96,165,250,0.18)', background: 'rgba(0,0,0,0.28)' }}>
        <div className="grid gap-2 md:grid-cols-4">
          <input
            name="file"
            type="file"
            accept=".pdf,.txt,.md,.markdown,.json,.csv,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,application/json,text/csv,image/png,image/jpeg,image/webp"
            required
            className="rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#60A5FA] md:col-span-2"
          />
          <input
            name="source_context"
            value={sourceContext}
            onChange={event => setSourceContext(event.target.value)}
            placeholder="Source context"
            className="rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#60A5FA]"
          />
          <input
            name="tags"
            value={tags}
            onChange={event => setTags(event.target.value)}
            placeholder="Tags, comma separated"
            className="rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#60A5FA]"
          />
        </div>
        <textarea
          name="notes"
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="Notes for future council or Baby AI analysis"
          className="mt-2 min-h-16 w-full rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#60A5FA]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs" style={{ color: message?.includes('not configured') ? '#FFD700' : '#666' }}>
            {message ?? 'Allowed: PDF, TXT, Markdown, JSON, CSV, PNG, JPG, WebP.'}
          </span>
          <button type="submit" disabled={loading}
            className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
            style={{ background: '#60A5FA', color: '#000' }}>
            {loading ? 'UPLOADING...' : 'UPLOAD FILE'}
          </button>
        </div>
      </form>

      {files.length === 0 ? (
        <div className="rounded-md px-3 py-6 text-center text-xs tracking-widest"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#666', background: 'rgba(0,0,0,0.22)' }}>
          No files uploaded yet.
        </div>
      ) : (
        <div className="grid gap-2 xl:grid-cols-3 lg:grid-cols-2">
          {files.map(file => (
            <div key={file.id} className="rounded-md p-3"
              style={{ border: '1px solid rgba(96,165,250,0.16)', background: 'rgba(0,0,0,0.26)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold tracking-widest" style={{ color: '#ddd' }}>
                    {file.file_name}
                  </div>
                  <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#555' }}>
                    {file.file_type.toUpperCase()} | {file.mime_type} | {formatFileSize(file.size_bytes)}
                  </div>
                </div>
                <span className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
                  style={{ color: statusColors[file.status], border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                  {file.status.toUpperCase()}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                  <span style={{ color: '#444' }}>UPLOADED </span>
                  <span style={{ color: '#888' }}>{new Date(file.uploaded_at).toLocaleString()}</span>
                </div>
                <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                  <span style={{ color: '#444' }}>SOURCE </span>
                  <span style={{ color: '#888' }}>{file.source_context}</span>
                </div>
              </div>
              {file.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {file.tags.map(tag => (
                    <span key={tag} className="rounded px-2 py-1 text-[10px] tracking-widest"
                      style={{ border: '1px solid rgba(96,165,250,0.18)', color: '#9CCBFF' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {file.notes && <p className="mt-3 text-xs text-slate-500">{file.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const INCOME_SCOUT_STATE_COLORS: Record<IncomeWorkerScoutExecutionState, string> = {
  scouting: '#94A3B8',
  provider_offline: '#F87171',
  fallback_active: '#FBBF24',
  opportunities_generated: '#34D399',
  awaiting_commander_review: '#60A5FA',
  failed: '#EF4444',
}

function IncomeWorkersPanel({
  opportunities,
  actions,
  scout,
  councilReviews,
  loading,
  assignLoading,
  onScout,
  onAssign,
}: {
  opportunities: IncomeOpportunity[]
  actions: RaelActionItem[]
  scout: IncomeWorkerScoutResult
  councilReviews: IncomeCouncilReview[]
  loading: boolean
  assignLoading: boolean
  onScout: () => void
  onAssign: (candidate: IncomeWorkerCandidate) => void
}) {
  const activeMissions = opportunities.filter(opportunity => opportunity.status === 'applied' || opportunity.status === 'active')
  const expectedPayout = opportunities
    .filter(opportunity => opportunity.status !== 'paid')
    .reduce((sum, opportunity) => sum + (opportunity.usd_estimate ?? opportunity.local_payout ?? 0), 0)
  const completedWork = opportunities.filter(opportunity => opportunity.status === 'paid')
  const needsApproval = actions.filter(action => action.status === 'pending' && action.source_agent === 'Income Workers')
  const latestReview = councilReviews[0] ?? null
  const executionState = scout.executionState ?? (loading ? 'scouting' : scout.candidates.length ? 'awaiting_commander_review' : 'provider_offline')
  const stateColor = INCOME_SCOUT_STATE_COLORS[executionState] ?? '#94A3B8'
  const activityLog = scout.activityLog ?? []
  const diagnostics = scout.diagnostics

  return (
    <section className="rounded border border-emerald-500/20 p-3 text-xs" style={{ background: 'rgba(6,78,59,0.10)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>INCOME WORKERS</h2>
          <p className="mt-1" style={{ color: '#888' }}>Revenue-focused worker layer for source-linked missions, approvals, payout tracking, and proof-gated completion.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-widest"
            style={{ border: `1px solid ${stateColor}55`, color: stateColor }}
          >
            {executionState.replace(/_/g, ' ')}
          </span>
          {scout.degradedMode ? (
            <span className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-widest" style={{ border: '1px solid rgba(251,191,36,0.4)', color: '#FBBF24' }}>
              degraded mode
            </span>
          ) : null}
          <button
            type="button"
            disabled={loading}
            className="rounded px-3 py-1 text-[10px] font-bold tracking-widest disabled:opacity-40"
            style={{ border: '1px solid rgba(52,211,153,0.35)', color: '#86EFAC' }}
            onClick={onScout}
          >
            {loading ? 'Scouting...' : 'Scout with Income Workers'}
          </button>
        </div>
      </div>

      {diagnostics ? (
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>PROVIDER</div>
            <div className="mt-1 font-mono" style={{ color: '#93C5FD' }}>{diagnostics.selectedProvider}</div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>SOURCE</div>
            <div className="mt-1 font-mono" style={{ color: '#A7F3D0' }}>{diagnostics.sourceType.replace(/_/g, ' ')}</div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>RESULTS</div>
            <div className="mt-1 font-bold" style={{ color: '#FBBF24' }}>{diagnostics.resultCount}</div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>DURATION</div>
            <div className="mt-1 font-mono" style={{ color: '#888' }}>{diagnostics.scoutDurationMs}ms</div>
          </div>
        </div>
      ) : null}

      {activityLog.length > 0 ? (
        <div className="mb-3 max-h-28 overflow-y-auto rounded px-3 py-2 font-mono text-[10px]" style={{ border: '1px solid rgba(52,211,153,0.16)', background: 'rgba(0,0,0,0.35)' }}>
          <div className="mb-1 font-bold tracking-widest" style={{ color: '#86EFAC' }}>SCOUT ACTIVITY</div>
          {activityLog.map((entry, index) => (
            <div key={`${entry.at}-${index}`} style={{ color: '#9CA3AF' }}>{entry.message}</div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-5">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>ACTIVE INCOME MISSIONS</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{activeMissions.length}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>OPPORTUNITY PIPELINE</div>
          <div className="mt-1 font-bold" style={{ color: '#FBBF24' }}>{scout.candidates.length}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>EXPECTED PAYOUTS</div>
          <div className="mt-1 font-bold" style={{ color: '#A7F3D0' }}>{formatCost(expectedPayout)}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>COMPLETED WORK</div>
          <div className="mt-1 font-bold" style={{ color: '#93C5FD' }}>{completedWork.length}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>NEEDS RA&apos;EL APPROVAL</div>
          <div className="mt-1 font-bold" style={{ color: '#FCA5A5' }}>{needsApproval.length}</div>
        </div>
      </div>

      <div className="mt-3 rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.22)' }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold tracking-widest" style={{ color: '#C4B5FD' }}>COUNCIL REVIEW</div>
          <span style={{ color: latestReview ? '#34D399' : '#666' }}>{latestReview ? 'review ready' : 'waiting for scout result'}</span>
        </div>
        {latestReview ? (
          <div className="grid gap-2 lg:grid-cols-2">
            <div className="rounded border border-white/10 px-2 py-2">
              <div className="font-bold" style={{ color: '#ddd' }}>{latestReview.summary}</div>
              <div className="mt-1" style={{ color: '#777' }}>Risk: {latestReview.riskLevel} · Potential: {latestReview.incomePotential} · Effort: {latestReview.effortEstimate}</div>
              <div className="mt-1" style={{ color: '#FBBF24' }}>Next action: {latestReview.nextAction}</div>
            </div>
            <div className="rounded border border-white/10 px-2 py-2">
              <div style={{ color: '#93C5FD' }}>Assigned agents: {latestReview.recommendedAgents.join(', ')}</div>
              <div className="mt-1" style={{ color: '#A7F3D0' }}>Required skills: {latestReview.requiredSkills.join(', ')}</div>
              <div className="mt-1" style={{ color: '#FCA5A5' }}>Required tools: {latestReview.recommendedTools.join(', ')}</div>
              <div className="mt-1" style={{ color: '#FBBF24' }}>Needs Ra&apos;el approval: {latestReview.approvalRequired ? 'yes' : 'no'}</div>
            </div>
          </div>
        ) : (
          <div style={{ color: '#666' }}>Scout a live opportunity to generate council routing, required skills, and approval posture.</div>
        )}
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.16)', background: 'rgba(0,0,0,0.22)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#86EFAC' }}>WORKER REGISTRY</div>
          <div className="grid gap-1 md:grid-cols-2">
            {INCOME_WORKERS.map(worker => (
              <div key={worker.id} className="rounded border border-white/10 px-2 py-1">
                <div className="font-bold" style={{ color: '#ddd' }}>{worker.name}</div>
                <div className="mt-0.5 line-clamp-2" style={{ color: '#777' }}>{worker.focus}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(251,191,36,0.16)', background: 'rgba(0,0,0,0.22)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#FBBF24' }}>RUNTIME RULES</div>
          <div className="grid gap-1">
            {INCOME_WORKER_WORKFLOW.map(step => (
              <div key={step.id} className="flex items-center justify-between gap-2 rounded border border-white/10 px-2 py-1">
                <span>{step.order}. {step.label}</span>
                <span style={{ color: step.approvalRequired ? '#FCA5A5' : '#666' }}>{step.approvalRequired ? 'approval' : 'internal'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded px-3 py-2" style={{ border: '1px solid rgba(147,197,253,0.16)', background: 'rgba(0,0,0,0.22)' }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold tracking-widest" style={{ color: '#93C5FD' }}>OPPORTUNITY PIPELINE</div>
          <div style={{ color: '#666' }}>{scout.message}</div>
        </div>
        {scout.candidates.length === 0 ? (
          <div style={{ color: '#FBBF24' }}>Scout running or awaiting fallback — click Scout with Income Workers to generate operator-safe opportunities.</div>
        ) : (
          <div className="grid gap-2">
            {scout.candidates.slice(0, 8).map(candidate => (
              <div key={candidate.url} className="rounded border border-white/10 px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {candidate.url.startsWith('http') ? (
                      <a href={candidate.url} target="_blank" rel="noreferrer" className="font-bold underline-offset-2 hover:underline" style={{ color: '#E5E7EB' }}>{candidate.title}</a>
                    ) : (
                      <span className="font-bold" style={{ color: '#E5E7EB' }}>{candidate.title}</span>
                    )}
                    <div className="mt-1" style={{ color: '#777' }}>
                      {candidate.source} · {candidate.type} · score {candidate.score}
                      {candidate.evidenceLabel ? ` · ${candidate.evidenceLabel.replace(/_/g, ' ')}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={assignLoading}
                    className="rounded px-2 py-1 text-[10px] font-bold tracking-widest disabled:opacity-40"
                    style={{ border: '1px solid rgba(251,191,36,0.35)', color: '#FBBF24' }}
                    onClick={() => onAssign(candidate)}
                  >
                    Queue Mission
                  </button>
                </div>
                <div className="mt-2 text-[10px]" style={{ color: '#888' }}>
                  Eligible: {candidate.eligibleWorkers.join(', ')} · Expected payout: {candidate.payout ?? 'unconfirmed'} · Actual payout: proof required
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function OpportunityScoutPanel({
  scout,
  loading,
  onScout,
}: {
  scout: OpportunityScoutState
  loading: boolean
  onScout: () => Promise<void>
}) {
  const statusColors: Record<OpportunityScoutStatus, string> = {
    idle: '#666',
    searching: '#34D399',
    reviewing: '#FFD700',
    found: '#60A5FA',
    error: '#EF4444',
  }
  const safeScout: OpportunityScoutState = {
    ...INITIAL_OPPORTUNITY_SCOUT_STATE,
    ...scout,
    results: scout?.results ?? [],
    providerStatus: {
      ...INITIAL_OPPORTUNITY_SCOUT_STATE.providerStatus,
      ...scout?.providerStatus,
    },
  }
  const providerItems = [
    { name: 'Tavily', status: safeScout.providerStatus.tavily },
    { name: 'Firecrawl', status: safeScout.providerStatus.firecrawl },
  ]
  const providerColor: Record<ProviderHealth, string> = {
    online: '#34D399',
    standby: '#FFD700',
    offline: '#666',
    error: '#EF4444',
  }

  return (
    <div className="mb-4 rounded-md p-3"
      style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.28)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
            OPPORTUNITY SCOUT
          </div>
          <div className="mt-1 text-xs" style={{ color: '#777' }}>
            Global income opportunity researcher
          </div>
        </div>
        <button type="button" onClick={() => void onScout()} disabled={loading}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
          style={{ background: '#34D399', color: '#000' }}>
          Scout Opportunities
        </button>
      </div>

      <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <div className="tracking-widest" style={{ color: '#444' }}>STATUS</div>
          <div className="mt-1 font-bold" style={{ color: statusColors[safeScout.status] }}>{safeScout.status.toUpperCase()}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <div className="tracking-widest" style={{ color: '#444' }}>LAST SCAN</div>
          <div className="mt-1" style={{ color: '#888' }}>
            {safeScout.lastScanTime ? new Date(safeScout.lastScanTime).toLocaleString() : 'Not scanned'}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <div className="tracking-widest" style={{ color: '#444' }}>SOURCES CHECKED</div>
          <div className="mt-1" style={{ color: '#888' }}>{safeScout.sourcesChecked}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <div className="tracking-widest" style={{ color: '#444' }}>RISK FILTER</div>
          <div className="mt-1" style={{ color: '#FFD700' }}>{safeScout.riskFilterStatus}</div>
        </div>
      </div>

      <div className="mt-2 grid gap-2 text-xs md:grid-cols-4">
        {providerItems.map(provider => (
          <div key={provider.name} className="rounded px-3 py-2"
            style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
            <span style={{ color: '#444' }}>{provider.name.toUpperCase()} </span>
            <span style={{ color: providerColor[provider.status] }}>
              {provider.status.toUpperCase()}
            </span>
          </div>
        ))}
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
          <span style={{ color: '#444' }}>PROVIDER </span>
          <span style={{ color: '#888' }}>{safeScout.providerUsed.toUpperCase()}</span>
        </div>
      </div>

      <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
          <span style={{ color: '#444' }}>FOUND </span>
          <span style={{ color: '#34D399' }}>{safeScout.opportunitiesFound}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
          <span style={{ color: '#444' }}>REJECTED </span>
          <span style={{ color: '#EF4444' }}>{safeScout.opportunitiesRejected}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
          <span style={{ color: '#444' }}>NEXT </span>
          <span style={{ color: '#888' }}>{safeScout.nextScanAction}</span>
        </div>
      </div>

      <div className="mt-2 rounded px-3 py-2 text-xs"
        style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.25)' }}>
        <span style={{ color: '#444' }}>SCAN DURATION </span>
        <span style={{ color: '#888' }}>{safeScout.scanDurationMs ? `${(safeScout.scanDurationMs / 1000).toFixed(1)}s` : 'not scanned'}</span>
      </div>

      {safeScout.message && (
        <div className="mt-3 rounded px-3 py-2 text-xs"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#888', background: 'rgba(0,0,0,0.24)' }}>
          {safeScout.message}
        </div>
      )}

      {safeScout.results.length > 0 && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {safeScout.results.map(result => (
            <div key={result.url} className="rounded px-3 py-2 text-xs"
              style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.26)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold tracking-widest" style={{ color: '#ddd' }}>{result.title}</div>
                  <div className="mt-1 tracking-widest" style={{ color: '#555' }}>
                    {result.source} | {result.type} | {result.provider ?? safeScout.providerUsed}
                  </div>
                </div>
                <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                  style={{
                    color: result.riskLevel === 'high' ? '#EF4444' : result.riskLevel === 'medium' ? '#FFD700' : '#34D399',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                  {result.riskLevel.toUpperCase()} RISK
                </span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <span style={{ color: '#888' }}>Country: {result.country}</span>
                <span style={{ color: '#888' }}>Payout: {result.payout ?? 'not found'}</span>
                <span style={{ color: '#888' }}>Expires: {result.expiration ?? 'not found'}</span>
              </div>
              <div className="mt-2" style={{ color: '#666' }}>{result.reason}</div>
              <a href={result.url} target="_blank" rel="noreferrer"
                className="mt-2 inline-flex rounded px-3 py-1 text-[10px] tracking-widest"
                style={{ border: '1px solid #333', color: '#888' }}>
                OPEN SOURCE
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ScoutDiagnosticsPanel = memo(function ScoutDiagnosticsPanel({ diagnostics }: { diagnostics: EconomicScoutDiagnostics }) {
  const [nowMs, setNowMs] = useState<number | null>(null)
  useEffect(() => {
    const update = () => setNowMs(Date.now())
    update()
    const interval = window.setInterval(update, 60_000)
    return () => window.clearInterval(interval)
  }, [])
  const updatedAtMs = diagnostics.last_updated_at ? new Date(diagnostics.last_updated_at).getTime() : 0
  const stale = !updatedAtMs || !nowMs || nowMs - updatedAtMs > 30 * 60 * 1000
  const label = (enabled: boolean) => stale ? 'STALE' : enabled ? 'CONFIGURED' : 'OFFLINE'
  const color = (enabled: boolean) => stale ? '#94A3B8' : enabled ? '#34D399' : '#FBBF24'

  return (
    <section className="rounded border border-cyan-500/20 p-3 text-[10px]" style={{ background: 'rgba(8,47,73,0.14)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold tracking-widest" style={{ color: '#67E8F9' }}>SCOUT DIAGNOSTICS</div>
        <div style={{ color: '#64748B' }}>{diagnostics.last_updated_at ? new Date(diagnostics.last_updated_at).toLocaleTimeString() : 'no scout run yet'}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Tavily</div>
          <div className="font-bold" style={{ color: color(diagnostics.tavily_enabled) }}>{label(diagnostics.tavily_enabled)}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Firecrawl</div>
          <div className="font-bold" style={{ color: color(diagnostics.firecrawl_enabled) }}>{label(diagnostics.firecrawl_enabled)}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Queries</div>
          <div style={{ color: '#E5E7EB' }}>{diagnostics.tavily_query_count}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Candidates</div>
          <div style={{ color: '#E5E7EB' }}>{diagnostics.normalized_candidates_count}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Ranked</div>
          <div style={{ color: '#E5E7EB' }}>{diagnostics.ranked_candidates_count}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-1">
          <div style={{ color: '#64748B' }}>Fallback</div>
          <div className="font-bold" style={{ color: diagnostics.fallback_triggered ? '#FBBF24' : '#34D399' }}>
            {diagnostics.fallback_triggered ? 'YES' : 'NO'}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" style={{ color: '#94A3B8' }}>
        <span>tavily results: {diagnostics.tavily_results_count}</span>
        <span>firecrawl targets: {diagnostics.firecrawl_targets_count}</span>
        {diagnostics.missing_api_keys.length ? <span style={{ color: '#FBBF24' }}>missing: {diagnostics.missing_api_keys.join(', ')}</span> : null}
        {diagnostics.fallback_reason ? <span>fallback: {diagnostics.fallback_reason}</span> : null}
      </div>
      {diagnostics.ranked_preview?.length ? (
        <div className="mt-2 space-y-1">
          {diagnostics.ranked_preview.slice(0, 3).map(row => (
            <div key={`${row.title}:${row.score}`} className="truncate" style={{ color: '#CBD5E1' }}>
              {row.title} · score {row.score}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
})

function IncomeRadarPanel({
  opportunities,
  loading,
  view,
  onViewChange,
  onCreate,
  onExpire,
  scout,
  scoutLoading,
  onScout,
}: {
  opportunities: IncomeOpportunity[]
  loading: boolean
  view: IncomeRadarView
  onViewChange: (view: IncomeRadarView) => void
  onCreate: (opportunity: Omit<IncomeOpportunity, 'id' | 'created_at'>) => Promise<void>
  onExpire: (id: string) => Promise<void>
  scout: OpportunityScoutState
  scoutLoading: boolean
  onScout: () => Promise<void>
}) {
  const [form, setForm] = useState({
    title: '',
    platform: '',
    country: '',
    currency: 'USD',
    local_payout: '',
    estimated_hourly: '',
    payout_speed: '',
    type: 'user testing' as OpportunityType,
    risk_level: 'medium' as RiskLevel,
    status: 'not started' as OpportunityStatus,
    apply_url: '',
    notes: '',
    expires_at: '',
  })
  const activeOpportunities = opportunities.filter(opportunity => !isExpired(opportunity))
  const expiredOpportunities = opportunities.filter(isExpired)
  const expiringOpportunities = activeOpportunities.filter(expiresSoon)
  const visibleOpportunities = view === 'expired'
    ? expiredOpportunities
    : view === 'expiring'
      ? expiringOpportunities
      : activeOpportunities
  const rankedOpportunities = [...visibleOpportunities].sort((a, b) => {
    const expiresA = a.expires_at ? new Date(a.expires_at).getTime() : Number.MAX_SAFE_INTEGER
    const expiresB = b.expires_at ? new Date(b.expires_at).getTime() : Number.MAX_SAFE_INTEGER
    const expiryDelta = expiresA - expiresB
    return expiryDelta !== 0 ? expiryDelta : (b.usd_estimate ?? 0) - (a.usd_estimate ?? 0)
  })
  const totalExpected = activeOpportunities.reduce((total, opportunity) => total + (opportunity.usd_estimate ?? 0), 0)
  const totalPaid = opportunities
    .filter(opportunity => opportunity.status === 'paid')
    .reduce((total, opportunity) => total + (opportunity.usd_estimate ?? 0), 0)
  const riskStyles: Record<RiskLevel, { color: string; background: string; border: string }> = {
    low: { color: '#34D399', background: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.3)' },
    medium: { color: '#FFD700', background: 'rgba(255,215,0,0.08)', border: 'rgba(255,215,0,0.28)' },
    high: { color: '#EF4444', background: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.28)' },
  }
  const statusColors: Record<OpportunityStatus, string> = {
    'not started': '#666',
    applied: '#FFD700',
    active: '#34D399',
    paid: '#60A5FA',
  }
  const inputClass = 'rounded border border-[#24301f] bg-black/40 px-2 py-2 text-xs text-slate-200 outline-none focus:border-[#34D399]'
  const submitOpportunity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.title.trim() || !form.platform.trim()) return

    const now = new Date().toISOString()
    const localPayout = form.local_payout ? Number(form.local_payout) : null

    await onCreate({
      title: form.title.trim(),
      platform: form.platform.trim(),
      country: form.country.trim(),
      currency: form.currency.trim().toUpperCase() || 'USD',
      local_payout: localPayout,
      usd_estimate: form.currency.trim().toUpperCase() === 'USD' ? localPayout : null,
      estimated_hourly: form.estimated_hourly ? Number(form.estimated_hourly) : null,
      payout_speed: form.payout_speed.trim(),
      type: form.type,
      risk_level: form.risk_level,
      status: form.status,
      apply_url: form.apply_url.trim(),
      notes: form.notes.trim(),
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      discovered_at: now,
      last_checked_at: now,
      is_active: true,
    })
    setForm({
      title: '',
      platform: '',
      country: '',
      currency: 'USD',
      local_payout: '',
      estimated_hourly: '',
      payout_speed: '',
      type: 'user testing',
      risk_level: 'medium',
      status: 'not started',
      apply_url: '',
      notes: '',
      expires_at: '',
    })
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-4 flex-shrink-0"
      style={{ background: 'rgba(0,255,65,0.02)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
            INCOME RADAR
          </h2>
          <p className="text-xs mt-1" style={{ color: '#666' }}>
            Verified income leads and tracked opportunities.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.35)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>ACTIVE EXPECTED</div>
            <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{formatMoney(totalExpected)}</div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(0,0,0,0.35)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>PAID</div>
            <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>{formatMoney(totalPaid)}</div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.35)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>EXPIRING</div>
            <div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{expiringOpportunities.length}</div>
          </div>
        </div>
      </div>

      <OpportunityScoutPanel scout={scout} loading={scoutLoading} onScout={onScout} />

      <form onSubmit={submitOpportunity} className="mb-4 rounded-md p-3"
        style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.28)' }}>
        <div className="mb-3 text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
          MANUAL OPPORTUNITY ENTRY
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <input className={inputClass} value={form.title} onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))} placeholder="Title" required />
          <input className={inputClass} value={form.platform} onChange={event => setForm(prev => ({ ...prev, platform: event.target.value }))} placeholder="Platform" required />
          <input className={inputClass} value={form.country} onChange={event => setForm(prev => ({ ...prev, country: event.target.value }))} placeholder="Country" />
          <select className={inputClass} value={form.type} onChange={event => setForm(prev => ({ ...prev, type: event.target.value as OpportunityType }))}>
            {['surveys', 'AI evaluation', 'user testing', 'research studies', 'remote micro-contracts', 'digital service gigs'].map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <input className={inputClass} value={form.currency} onChange={event => setForm(prev => ({ ...prev, currency: event.target.value }))} placeholder="Currency" />
          <input className={inputClass} value={form.local_payout} onChange={event => setForm(prev => ({ ...prev, local_payout: event.target.value }))} placeholder="Local payout" type="number" min="0" step="0.01" />
          <input className={inputClass} value={form.estimated_hourly} onChange={event => setForm(prev => ({ ...prev, estimated_hourly: event.target.value }))} placeholder="Estimated hourly" type="number" min="0" step="0.01" />
          <input className={inputClass} value={form.payout_speed} onChange={event => setForm(prev => ({ ...prev, payout_speed: event.target.value }))} placeholder="Payout speed" />
          <select className={inputClass} value={form.risk_level} onChange={event => setForm(prev => ({ ...prev, risk_level: event.target.value as RiskLevel }))}>
            {['low', 'medium', 'high'].map(risk => <option key={risk} value={risk}>{risk} risk</option>)}
          </select>
          <select className={inputClass} value={form.status} onChange={event => setForm(prev => ({ ...prev, status: event.target.value as OpportunityStatus }))}>
            {['not started', 'applied', 'active', 'paid'].map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <input className={inputClass} value={form.expires_at} onChange={event => setForm(prev => ({ ...prev, expires_at: event.target.value }))} type="date" />
          <input className={inputClass} value={form.apply_url} onChange={event => setForm(prev => ({ ...prev, apply_url: event.target.value }))} placeholder="Apply URL" />
        </div>
        <textarea className={`${inputClass} mt-2 min-h-16 w-full`} value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} placeholder="Notes, warnings, payout terms, requirements" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs" style={{ color: '#666' }}>
            USD estimate unavailable until currency tool is connected.
          </span>
          <button className="rounded px-3 py-2 text-xs font-bold tracking-widest"
            style={{ background: '#34D399', color: '#000' }} disabled={loading}>
            ADD REAL OPPORTUNITY
          </button>
        </div>
      </form>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { id: 'active' as IncomeRadarView, label: `Active Opportunities (${activeOpportunities.length})` },
          { id: 'expiring' as IncomeRadarView, label: `Expiring Soon (${expiringOpportunities.length})` },
          { id: 'expired' as IncomeRadarView, label: `Expired Archive (${expiredOpportunities.length})` },
        ].map(item => (
          <button key={item.id} type="button" onClick={() => onViewChange(item.id)}
            className="rounded px-3 py-2 text-xs tracking-widest"
            style={{
              background: view === item.id ? 'rgba(52,211,153,0.18)' : 'rgba(0,0,0,0.24)',
              border: view === item.id ? '1px solid rgba(52,211,153,0.45)' : '1px solid #222',
              color: view === item.id ? '#34D399' : '#666',
            }}>
            {item.label}
          </button>
        ))}
      </div>

      {rankedOpportunities.length === 0 ? (
        <div className="rounded-md px-3 py-6 text-center text-xs tracking-widest"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#666', background: 'rgba(0,0,0,0.22)' }}>
          No live opportunities loaded yet.
        </div>
      ) : (
      <div className="grid gap-3 xl:grid-cols-3 lg:grid-cols-2">
        {rankedOpportunities.map(opportunity => {
          const riskStyle = riskStyles[opportunity.risk_level]
          const opportunityExpired = isExpired(opportunity)
          const opportunityExpiresSoon = expiresSoon(opportunity)

          return (
            <div key={opportunity.id} className="rounded-md p-3"
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'linear-gradient(180deg, rgba(0,255,65,0.035), rgba(0,0,0,0.28))',
              }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold tracking-widest" style={{ color: '#ddd' }}>
                    {opportunity.title}
                  </div>
                  <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#555' }}>
                    {opportunity.platform} | {opportunity.country || 'country unset'} | {opportunity.type}
                  </div>
                </div>
                <span className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
                  style={{ color: riskStyle.color, background: riskStyle.background, border: `1px solid ${riskStyle.border}` }}>
                  {opportunity.risk_level.toUpperCase()} RISK
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="tracking-widest" style={{ color: '#444' }}>PAYOUT</div>
                  <div className="mt-1" style={{ color: '#FFD700' }}>{opportunity.payout_speed || 'Not set'}</div>
                </div>
                <div>
                  <div className="tracking-widest" style={{ color: '#444' }}>RATE</div>
                  <div className="mt-1" style={{ color: '#34D399' }}>
                    {opportunity.estimated_hourly === null ? 'Not set' : `${formatMoney(opportunity.estimated_hourly)}/hr`}
                  </div>
                </div>
                <div>
                  <div className="tracking-widest" style={{ color: '#444' }}>LOCAL</div>
                  <div className="mt-1" style={{ color: '#34D399' }}>{formatLocalMoney(opportunity.local_payout, opportunity.currency)}</div>
                </div>
              </div>

              <div className="mt-3 rounded px-2 py-2 text-xs leading-relaxed"
                style={{ color: '#888', border: '1px solid #1f271f', background: 'rgba(0,0,0,0.25)' }}>
                {opportunity.usd_estimate === null
                  ? 'USD estimate unavailable until currency tool is connected.'
                  : `USD estimate: ${formatMoney(opportunity.usd_estimate)}`}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                  style={{ border: '1px solid #222', color: statusColors[opportunity.status], background: 'rgba(0,0,0,0.35)' }}>
                  STATUS: {opportunity.status.toUpperCase()}
                </span>
                <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                  style={{
                    border: opportunityExpiresSoon ? '1px solid rgba(255,215,0,0.45)' : '1px solid #222',
                    color: opportunityExpired ? '#EF4444' : opportunityExpiresSoon ? '#FFD700' : '#777',
                    background: opportunityExpiresSoon ? 'rgba(255,215,0,0.08)' : 'rgba(0,0,0,0.35)',
                  }}>
                  {opportunityExpiresSoon ? 'EXPIRES SOON: ' : opportunityExpired ? 'EXPIRED: ' : ''}
                  {formatDateLabel(opportunity.expires_at)}
                </span>
              </div>
              {opportunity.notes && <p className="mt-3 text-xs text-slate-500">{opportunity.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {opportunity.apply_url ? (
                  <a href={opportunity.apply_url} target="_blank" rel="noreferrer"
                    className="rounded px-3 py-1 text-[10px] tracking-widest"
                    style={{ border: '1px solid #333', color: '#888' }}>
                    OPEN APPLY LINK
                  </a>
                ) : (
                  <span className="rounded px-3 py-1 text-[10px] tracking-widest"
                    style={{ border: '1px solid #222', color: '#555' }}>
                    NO APPLY LINK SAVED
                  </span>
                )}
                {!opportunityExpired && (
                  <button type="button" onClick={() => void onExpire(opportunity.id)}
                    className="rounded px-3 py-1 text-[10px] tracking-widest"
                    style={{ border: '1px solid rgba(239,68,68,0.35)', color: '#EF4444' }}>
                    MARK EXPIRED
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

const MemoryPanel = memo(function MemoryPanel({ memories }: { memories: MemoryEntry[] }) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(52,211,153,0.025)' }}>
      <div className="flex items-center justify-between gap-4 mb-2">
        <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
          CHRONICLE / MEMORY
        </h2>
        <span className="text-xs tracking-widest" style={{ color: '#555' }}>
          GROWTH +{memories.length} · LATEST {memories.length}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {memories.length === 0 ? (
          <div className="text-xs" style={{ color: '#555' }}>
            No saved War Room memories yet.
          </div>
        ) : memories.slice(0, 3).map(memory => (
          <div key={memory.id || `${memory.created_at}-${memory.content}`} className="rounded border border-[#00ff41]/10 bg-black/30 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] tracking-widest">
              <span style={{ color: '#34D399' }}>{memory.family}</span>
              <span style={{ color: '#555' }}>I{memory.importance}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-slate-400">{memory.content}</p>
            <div className="mt-1 truncate text-[10px]" style={{ color: '#555' }}>
              {memory.source} {memory.tags.length ? `· ${memory.tags.join(', ')}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

const MemoryRecallPanel = memo(function MemoryRecallPanel({ recall }: { recall: MemoryRecallView | null }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(96,165,250,0.028)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#60A5FA' }}>
            MEMORY ARCHIVE / RECALL VIEW
          </h2>
          <p className="mt-1 text-[10px] tracking-widest" style={{ color: '#64748B' }}>
            Archive results stay here; Live Council remains an active working surface.
          </p>
        </div>
        {recall ? (
          <span className="rounded px-2 py-1 text-[10px] tracking-widest"
            style={{ border: '1px solid rgba(96,165,250,0.28)', color: '#93C5FD' }}>
            {recall.command.kind} · {new Date(recall.recalledAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {!recall ? (
        <div className="rounded border border-white/10 bg-black/30 px-3 py-3 text-xs text-slate-500">
          No archive recall loaded yet. Use `recall today`, `show archive`, or the live chat archive buttons.
        </div>
      ) : !recall.persistenceAvailable ? (
        <div className="rounded border border-red-500/25 bg-red-950/10 px-3 py-3 text-xs text-red-300">
          Memory archive unavailable because persistence is not configured.
        </div>
      ) : (
        <div className="space-y-3">
          {recall.error ? (
            <div className="rounded border border-red-500/25 bg-red-950/10 px-3 py-2 text-xs text-red-300">
              {recall.error}
            </div>
          ) : null}

          {recall.summaries.length ? (
            <div className="grid gap-2">
              {recall.summaries.slice(0, 3).map(summary => (
                <div key={summary.id} className="rounded border border-[#60A5FA]/20 bg-black/35 px-3 py-2">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] tracking-widest">
                    <span style={{ color: '#93C5FD' }}>{summary.summaryKind}</span>
                    <span style={{ color: '#475569' }}>{new Date(summary.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-slate-300">{summary.summary}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-2">
            {recall.records.length === 0 ? (
              <div className="rounded border border-white/10 bg-black/30 px-3 py-3 text-xs text-slate-500">
                No archived transcript rows matched this recall.
              </div>
            ) : recall.records.map(record => {
              const expanded = expandedIds.has(record.id)
              const source = [record.family ?? record.role, record.provider].filter(Boolean).join(' · ')
              return (
                <div key={record.id} className="rounded border border-white/10 bg-black/35 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] tracking-widest">
                    <span style={{ color: '#BFDBFE' }}>{source || 'archive'}</span>
                    <span style={{ color: '#475569' }}>{new Date(record.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] tracking-widest" style={{ color: '#64748B' }}>
                    {record.messageType ? <span>{record.messageType}</span> : null}
                    {record.topic ? <span>{record.topic}</span> : null}
                    {record.tags.slice(0, 4).map(tag => <span key={tag}>#{tag}</span>)}
                  </div>
                  <p className={`mt-2 whitespace-pre-wrap text-xs text-slate-300 ${expanded ? '' : 'line-clamp-3'}`}>
                    {record.content}
                  </p>
                  <button
                    type="button"
                    className="mt-2 rounded px-2 py-1 text-[10px] font-bold tracking-widest"
                    style={{ border: '1px solid rgba(96,165,250,0.35)', color: '#93C5FD' }}
                    onClick={() => toggleExpanded(record.id)}
                  >
                    {expanded ? 'Collapse Transcript' : 'View Full Transcript'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
})

function SmsBridgePanel({
  bridge,
  onTest,
}: {
  bridge: SmsBridgeState
  onTest: () => void
}) {
  const statusColors: Record<SmsBridgeStatus, string> = {
    'not configured': '#666',
    standby: '#FFD700',
    online: '#34D399',
    error: '#EF4444',
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(96,165,250,0.018)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#60A5FA' }}>
            SMS BRIDGE
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Phone notification bridge for action queue approvals.
          </p>
        </div>
        <button type="button" onClick={onTest} disabled={bridge.sending}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
          style={{ border: '1px solid rgba(96,165,250,0.4)', color: '#60A5FA', background: 'rgba(0,0,0,0.25)' }}>
          {bridge.sending ? 'Sending...' : 'Test Notification'}
        </button>
      </div>
      <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}>
          <span style={{ color: '#444' }}>STATUS </span>
          <span style={{ color: statusColors[bridge.status] }}>{bridge.status.toUpperCase()}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}>
          <span style={{ color: '#444' }}>LAST NOTIFICATION </span>
          <span style={{ color: '#888' }}>{bridge.lastNotification ? new Date(bridge.lastNotification).toLocaleString() : 'None'}</span>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}>
          <span style={{ color: '#888' }}>{bridge.message}</span>
        </div>
      </div>
    </div>
  )
}

function NeedsRaelPanel({
  actions,
  opportunities,
  onRespond,
  onNotify,
}: {
  actions: RaelActionItem[]
  opportunities: IncomeOpportunity[]
  onRespond: (actionId: string, response: string) => void
  onNotify: (action: RaelActionItem) => void
}) {
  const urgencyStyles: Record<RaelActionUrgency, { color: string; border: string; background: string }> = {
    low: { color: '#60A5FA', border: 'rgba(96,165,250,0.28)', background: 'rgba(96,165,250,0.06)' },
    medium: { color: '#FFD700', border: 'rgba(255,215,0,0.28)', background: 'rgba(255,215,0,0.06)' },
    high: { color: '#EF4444', border: 'rgba(239,68,68,0.32)', background: 'rgba(239,68,68,0.08)' },
  }
  const visibleActions = [...actions].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
  const pendingCount = actions.filter(action => action.status === 'pending').length

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(255,215,0,0.018)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FFD700' }}>
            NEEDS RA&apos;EL
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Internal approval queue for War Room decisions.
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{
            color: pendingCount > 0 ? '#FFD700' : '#555',
            border: pendingCount > 0 ? '1px solid rgba(255,215,0,0.35)' : '1px solid #222',
            background: 'rgba(0,0,0,0.3)',
          }}>
          {pendingCount} PENDING
        </span>
      </div>

      {visibleActions.length === 0 ? (
        <div className="rounded-md px-3 py-4 text-center text-xs tracking-widest"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#555', background: 'rgba(0,0,0,0.22)' }}>
          No pending approvals.
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {visibleActions.map(action => {
            const relatedOpportunity = opportunities.find(opportunity => opportunity.id === action.related_opportunity_id)
            const urgencyStyle = urgencyStyles[action.urgency]

            return (
              <div key={action.action_id} className="rounded-md p-3"
                style={{ border: `1px solid ${urgencyStyle.border}`, background: urgencyStyle.background }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold tracking-widest" style={{ color: '#ddd' }}>
                      {action.title}
                    </div>
                    <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#555' }}>
                      {action.source_agent} | {new Date(action.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
                      style={{ color: urgencyStyle.color, border: `1px solid ${urgencyStyle.border}`, background: 'rgba(0,0,0,0.24)' }}>
                      {action.urgency.toUpperCase()}
                    </span>
                    <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                      style={{ color: action.status === 'pending' ? '#FFD700' : action.status === 'answered' ? '#34D399' : '#EF4444', border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                      {action.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                <p className="mt-3 text-xs leading-relaxed" style={{ color: '#bbb' }}>{action.question}</p>

                <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                  <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                    <div className="tracking-widest" style={{ color: '#444' }}>RELATED OPPORTUNITY</div>
                    <div className="mt-1" style={{ color: relatedOpportunity ? '#888' : '#555' }}>
                      {relatedOpportunity?.title ?? 'None linked'}
                    </div>
                  </div>
                  <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.24)' }}>
                    <div className="tracking-widest" style={{ color: '#444' }}>EXPIRES</div>
                    <div className="mt-1" style={{ color: action.expires_at ? '#888' : '#555' }}>
                      {action.expires_at ? new Date(action.expires_at).toLocaleString() : 'No deadline'}
                    </div>
                  </div>
                </div>

                {action.status === 'pending' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {action.response_options.map(option => (
                      <button key={option} type="button" onClick={() => onRespond(action.action_id, option)}
                        className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
                        style={{ border: '1px solid rgba(255,215,0,0.35)', color: '#FFD700', background: 'rgba(0,0,0,0.2)' }}>
                        {option}
                      </button>
                    ))}
                    {action.urgency === 'high' && (
                      <button type="button" onClick={() => onNotify(action)}
                        className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
                        style={{ border: '1px solid rgba(52,211,153,0.4)', color: '#34D399', background: 'rgba(0,0,0,0.2)' }}>
                        Notify Ra&apos;el
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded px-2 py-2 text-xs"
                    style={{ border: '1px solid #222', color: '#777', background: 'rgba(0,0,0,0.24)' }}>
                    Response: {action.selected_response ?? 'none recorded'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MemorySavePromptPanel({
  prompt,
  onSave,
  onDismiss,
}: {
  prompt: MemorySavePrompt
  onSave: () => void
  onDismiss: () => void
}) {
  return (
    <div className="message-fade-in ml-11 mb-4 p-3 rounded"
      style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.25)' }}>
      <div className="text-xs tracking-widest" style={{ color: '#ddd' }}>
        Council asks permission to save this memory. Reason: {prompt.reason}
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-slate-400">{prompt.memory.content}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={onSave} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ background: '#34D399', color: '#000', fontWeight: 'bold' }}>
          Save Memory
        </button>
        <button onClick={onDismiss} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #333', color: '#888' }}>
          Not Now
        </button>
      </div>
    </div>
  )
}

function buildOrchestrationContextFromMessages(msgs: CouncilMessage[]): string {
  const rael = [...msgs].reverse().find(m => m.familyName === "RA'EL")
  const tail = msgs.slice(-14)
  const parts = [
    rael?.content ? `Last Ra'el: ${rael.content}` : '',
    ...tail.map(m => `${m.familyName}: ${m.content}`),
  ].filter(Boolean)
  return parts.join('\n').slice(0, 12_000)
}

function FamilyPresencePanel({
  presence,
  geminiEngine,
}: {
  presence: Record<TypingFamily, FamilyPresence>
  geminiEngine: EngineStatus | null
}) {
  const coreFamilies = [
    { name: 'ChatGPT Family', role: 'orchestration/synthesis', color: '#34D399' },
    { name: 'Claude Family', role: 'architecture/systems reasoning', color: '#A78BFA' },
    { name: 'Grok Family', role: 'realtime radar, signal detection, X/web intelligence, current-event monitoring', color: '#F97316' },
    {
      name: 'Gemini Family',
      role: 'large-context analysis, document synthesis, multimodal interpretation, research assist (when engine-control reports functional)',
      color: '#38BDF8',
    },
  ]

  const geminiStatusLine = geminiEngine
    ? `Engine: configured ${geminiEngine.configured ? 'Y' : 'N'} · reachable ${geminiEngine.reachable ? 'Y' : 'N'} · functional ${geminiEngine.functional ? 'Y' : 'N'}${geminiEngine.probedModelId ? ` · model ${geminiEngine.probedModelId}` : ` · ${geminiEngine.providerLabel}`}`
    : 'Engine: not loaded — open Engine Control or refresh status.'

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(0,255,65,0.018)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#9AE6B4' }}>
            LIVE COGNITION
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Family presence means role architecture exists. Provider connection status is reported separately.
          </p>
        </div>
        <span className="text-xs tracking-widest" style={{ color: '#555' }}>
          SUB-AGENT CONSTELLATIONS
        </span>
      </div>
      <div className="mb-3 grid gap-2 lg:grid-cols-4 md:grid-cols-2">
        {coreFamilies.map(family => (
          <div key={family.name} className="rounded px-3 py-2 text-xs"
            style={{ border: `1px solid ${family.color}33`, background: 'rgba(0,0,0,0.24)' }}>
            <div className="font-bold tracking-widest" style={{ color: family.color }}>{family.name}</div>
            <div className="mt-1 leading-relaxed" style={{ color: '#888' }}>{family.role}</div>
          </div>
        ))}
      </div>
      <div className="mb-3 rounded px-3 py-2 text-[10px] leading-relaxed" style={{ border: '1px solid rgba(56,189,248,0.22)', color: '#64748b', background: 'rgba(0,0,0,0.2)' }}>
        <span className="font-bold tracking-widest" style={{ color: '#38BDF8' }}>GEMINI PROVIDER </span>
        {geminiStatusLine}
      </div>
      <div className="grid gap-2 xl:grid-cols-6 md:grid-cols-3">
        {FAMILY_NODE_GROUPS.map(group => {
          const familyPresence = group.presenceKey ? presence[group.presenceKey] : null
          const active = Boolean(familyPresence && familyPresence.status !== 'idle')

          return (
            <div key={group.familyName} className="rounded px-3 py-2"
              style={{
                border: active ? `1px solid ${group.color}55` : '1px solid rgba(255,255,255,0.08)',
                background: active ? `${group.color}10` : 'rgba(255,255,255,0.012)',
              }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold tracking-widest" style={{ color: active ? group.color : '#666' }}>
                  {group.familyName}
                </span>
                <span className="text-[10px] tracking-widest" style={{ color: active ? '#9AE6B4' : '#333' }}>
                  {familyPresence?.label ?? 'standby'}
                </span>
              </div>
              <div className="relative mt-3 flex items-center justify-between">
                <div className="pointer-events-none absolute left-1 right-1 top-1/2 h-px -translate-y-1/2"
                  style={{ background: active ? `${group.color}55` : 'rgba(255,255,255,0.08)' }} />
                {group.nodes.map((node, index) => {
                  const nodeActive = active && index === 0
                  const status = nodeActive ? 'active' : node.status

                  return (
                    <div key={node.name}
                      className={`relative z-10 h-3 w-3 rounded-full ${nodeActive ? 'tool-dot-active' : ''}`}
                      title={`${node.name} | status: ${status} | current micro-task: ${nodeActive ? familyPresence?.label : node.task}`}
                      style={{
                        background: nodeActive ? group.color : '#15251a',
                        border: `1px solid ${nodeActive ? group.color : '#25402b'}`,
                        boxShadow: nodeActive ? `0 0 10px ${group.color}` : 'none',
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RedTeamCoderPanel({
  state,
  onDiagnose,
}: {
  state: RedTeamCoderUiState
  onDiagnose: () => void
}) {
  const plan = state.latestRepairPlan
  const issue = state.latestDetectedIssue

  return (
    <section className="rounded border border-red-500/20 p-3 text-xs"
      style={{ background: 'rgba(127,29,29,0.10)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#F87171' }}>
            RED TEAM CODER
          </h2>
          <p className="mt-1 leading-relaxed" style={{ color: '#888' }}>
            Silent chat/orchestration failure monitor. It diagnoses and queues repair plans, but never edits files without approval.
          </p>
        </div>
        <button
          type="button"
          className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
          style={{ border: '1px solid rgba(248,113,113,0.35)', color: '#FCA5A5' }}
          onClick={onDiagnose}
        >
          Run diagnosis
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>STATUS</div>
          <div className="mt-1 font-bold uppercase" style={{ color: state.status === 'repair_planned' ? '#F87171' : '#34D399' }}>{state.status.replaceAll('_', ' ')}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>RECOMMENDED AGENT</div>
          <div className="mt-1 font-bold" style={{ color: '#FBBF24' }}>{state.recommendedAgent ?? plan?.recommendedAgent ?? 'none'}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>APPROVAL</div>
          <div className="mt-1 font-bold" style={{ color: '#F87171' }}>{plan?.approvalRequired ? 'required' : 'ready'}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>ACTION QUEUE</div>
          <div className="mt-1 font-bold" style={{ color: state.actionQueued ? '#34D399' : '#777' }}>{state.actionQueued ? 'queued' : 'silent'}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(248,113,113,0.18)', background: 'rgba(0,0,0,0.22)' }}>
          <div className="mb-1 font-bold tracking-widest" style={{ color: '#FCA5A5' }}>LATEST DETECTED ISSUE</div>
          {issue ? (
            <div className="space-y-1 leading-relaxed" style={{ color: '#aaa' }}>
              <div>{issue.symptom}</div>
              <div className="font-mono text-[10px]" style={{ color: '#666' }}>{issue.issueId}</div>
            </div>
          ) : (
            <div style={{ color: '#666' }}>No active chat failure detected.</div>
          )}
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(248,113,113,0.18)', background: 'rgba(0,0,0,0.22)' }}>
          <div className="mb-1 font-bold tracking-widest" style={{ color: '#FCA5A5' }}>LATEST REPAIR PLAN</div>
          {plan ? (
            <div className="space-y-1 leading-relaxed" style={{ color: '#aaa' }}>
              <div>{plan.recommendedFix}</div>
              <div className="font-mono text-[10px]" style={{ color: '#666' }}>
                Suspects: {plan.suspectedFiles.join(', ')}
              </div>
            </div>
          ) : (
            <div style={{ color: '#666' }}>{state.message}</div>
          )}
        </div>
      </div>
    </section>
  )
}

function BabyAiObserverPanel({
  memories,
  actions,
  opportunities,
}: {
  memories: MemoryEntry[]
  actions: RaelActionItem[]
  opportunities: IncomeOpportunity[]
}) {
  const familyContributions = [
    { family: 'Claude Family', skill: 'architecture, governance, systems thinking', color: '#A78BFA' },
    { family: 'ChatGPT Family', skill: 'strategy, synthesis, communication', color: '#34D399' },
    { family: 'Kimi Family', skill: 'decomposition, task sequencing, execution planning', color: '#60A5FA' },
    { family: 'Grok Family', skill: 'realtime signal awareness', color: '#F97316' },
    { family: 'Gemini Family', skill: 'reasoning, synthesis, multimodal interpretation, research assist, large-context analysis', color: '#38BDF8' },
    { family: 'Codex Agent', skill: 'coding, build, deployment awareness', color: '#FFD700' },
    { family: 'Red Team', skill: 'risk detection, contradiction checking', color: '#EF4444' },
    { family: 'Archivist / Memory', skill: 'continuity and pattern memory', color: '#38BDF8' },
  ]
  const hardRules = [
    'No speaking for Ra’el',
    'No saving sensitive memories without approval',
    'No external actions without approval',
    'No payment or banking actions without secure approval',
    'No fake identity or platform-rule evasion',
    'No uncontrolled execution',
  ]
  const experienceCount = memories.length + actions.length + opportunities.length
  const patternsLearned = Math.min(memories.length + opportunities.filter(opportunity => opportunity.status === 'paid').length, 99)
  const pendingLessons = actions.filter(action => action.status === 'pending').length + opportunities.filter(expiresSoon).length
  const approvalGatesActive = actions.filter(action => action.status === 'pending').length

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(56,189,248,0.018)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>
            BABY AI OBSERVER
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#777' }}>
            War Room Native | Memory + Council Experience + Family Skills
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: '#FFD700', border: '1px solid rgba(255,215,0,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          OBSERVES | LEARNS | RECOMMENDS
        </span>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(56,189,248,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>ORIGIN</div>
          <div className="mt-1 font-bold" style={{ color: '#38BDF8' }}>War Room Native</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>EXPERIENCE COUNT</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{experienceCount}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>PATTERNS LEARNED</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{patternsLearned}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>APPROVAL GATES ACTIVE</div>
          <div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{approvalGatesActive}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(56,189,248,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#38BDF8' }}>SKILL STACK</div>
          <div className="leading-relaxed" style={{ color: '#888' }}>
            Observes, learns, summarizes, recommends, and coordinates. Not autonomous yet.
          </div>
          <div className="mt-2 rounded px-2 py-2" style={{ border: '1px solid #222', color: '#777', background: 'rgba(0,0,0,0.22)' }}>
            Command posture: Ra&apos;el controls Baby AI Observer. It reports clearly, waits for approval, and does not act on its own.
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#34D399' }}>FAMILY CONTRIBUTIONS</div>
          <div className="grid gap-1">
            {familyContributions.map(contribution => (
              <div key={contribution.family} className="flex flex-wrap items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: contribution.color, boxShadow: `0 0 8px ${contribution.color}` }} />
                <span style={{ color: contribution.color }}>{contribution.family}</span>
                <span style={{ color: '#666' }}>{contribution.skill}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#FFD700' }}>LEARNING PROGRESS</div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded px-2 py-1" style={{ border: '1px solid #222' }}>
              <span style={{ color: '#555' }}>Pending lessons</span>
              <span style={{ color: '#FFD700' }}>{pendingLessons}</span>
            </div>
            <div className="flex items-center justify-between rounded px-2 py-1" style={{ border: '1px solid #222' }}>
              <span style={{ color: '#555' }}>Memory signals</span>
              <span style={{ color: '#34D399' }}>{memories.length}</span>
            </div>
            <div className="flex items-center justify-between rounded px-2 py-1" style={{ border: '1px solid #222' }}>
              <span style={{ color: '#555' }}>Opportunity signals</span>
              <span style={{ color: '#60A5FA' }}>{opportunities.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {hardRules.map(rule => (
          <span key={rule} className="rounded px-2 py-1 text-[10px] tracking-widest"
            style={{ border: '1px solid rgba(239,68,68,0.22)', color: '#999', background: 'rgba(0,0,0,0.24)' }}>
            {rule}
          </span>
        ))}
      </div>
    </div>
  )
}


const CLOUD_AGENT_FAMILIES = [
  { family: 'ChatGPT Family', provider: 'OpenAI', role: 'Strategy synthesis, orchestration, and response framing.', status: 'Cloud API provider' },
  { family: 'Claude Family', provider: 'Anthropic', role: 'Architecture review, invariants, and implementation risk.', status: 'Architecture reviewer' },
  { family: 'Grok Family', provider: 'xAI', role: 'Signal triage, contradictions, and opportunity framing.', status: 'Cloud API provider' },
  { family: 'Gemini Family', provider: 'Google', role: 'Long-context reasoning, synthesis, and research support.', status: 'Cloud API provider' },
  { family: 'Red Team', provider: 'Anthropic', role: 'Adversarial risk review and approval-boundary challenge.', status: 'Risk reviewer' },
]

const PROVIDER_CONFIGURATION_ITEMS = [
  { provider: 'OpenAI', env: 'OPENAI_API_KEY', powers: 'ChatGPT family, Baby AI strategy, OpenAI-backed synthesis.' },
  { provider: 'Anthropic', env: 'ANTHROPIC_API_KEY', powers: 'Claude architecture reviewer and Red Team risk reviewer.' },
  { provider: 'xAI', env: 'XAI_API_KEY', powers: 'Grok signal and contradiction review.' },
  { provider: 'Google', env: 'GEMINI_API_KEY', powers: 'Gemini long-context and synthesis lane.' },
]

const AGENT_GROWTH_STAGES = ['seed', 'observing', 'learning', 'useful', 'specialist', 'senior']

function CloudAgentFamiliesPanel({ engines }: { engines: EngineStatus[] }) {
  const engineByIdForPanel = new Map(engines.map(engine => [engine.id, engine]))
  const providerReady = (provider: string) => {
    const id = provider === 'OpenAI' ? 'chatgpt' : provider === 'Anthropic' ? 'claude' : provider === 'xAI' ? 'grok' : provider === 'Google' ? 'gemini' : null
    if (!id) return false
    return Boolean(engineByIdForPanel.get(id)?.functional)
  }

  return (
    <div data-agents-panel className="relative z-20 flex-shrink-0 border-b border-yellow-900 px-6 py-3 pointer-events-auto"
      style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.035), rgba(167,139,250,0.025), rgba(0,0,0,0.14))' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#93C5FD' }}>CLOUD AGENT FAMILIES</h2>
          <p className="mt-1 text-xs" style={{ color: '#777' }}>
            War Room agent families now route through cloud providers only. Cursor remains a manual workspace, and no browser panel invokes a machine-resident model or connector.
          </p>
        </div>
        <span className="rounded px-3 py-2 text-[10px] font-bold tracking-widest" style={{ border: '1px solid rgba(147,197,253,0.35)', color: '#BFDBFE', background: 'rgba(0,0,0,0.28)' }}>
          Cloud only
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {CLOUD_AGENT_FAMILIES.map(item => {
          const ready = providerReady(item.provider)
          return (
            <article key={item.family} className="rounded px-3 py-3 text-xs" style={{ border: ready ? '1px solid rgba(52,211,153,0.24)' : '1px solid rgba(255,255,255,0.08)', background: ready ? 'rgba(52,211,153,0.035)' : 'rgba(0,0,0,0.24)' }}>
              <div className="font-bold tracking-widest" style={{ color: ready ? '#DCFCE7' : '#CBD5E1' }}>{item.family}</div>
              <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#93C5FD' }}>{item.provider}</div>
              <p className="mt-2 leading-relaxed" style={{ color: '#94A3B8' }}>{item.role}</p>
              <div className="mt-3 rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid rgba(255,255,255,0.10)', color: ready ? '#86EFAC' : '#FDE68A' }}>
                {ready ? 'configured' : 'awaiting cloud key'}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function ProviderConfigurationPanel({ engines }: { engines: EngineStatus[] }) {
  const engineByIdForPanel = new Map(engines.map(engine => [engine.id, engine]))
  const statusFor = (provider: string) => {
    const id = provider === 'OpenAI' ? 'chatgpt' : provider === 'Anthropic' ? 'claude' : provider === 'xAI' ? 'grok' : provider === 'Google' ? 'gemini' : null
    return id ? engineByIdForPanel.get(id) : undefined
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(14,165,233,0.014)' }}>
      <div className="mb-3">
        <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>PROVIDER CONFIGURATION</h2>
        <p className="mt-1 text-xs" style={{ color: '#777' }}>Only cloud API providers are represented here. Environment names are labels only; values are never displayed.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {PROVIDER_CONFIGURATION_ITEMS.map(item => {
          const status = statusFor(item.provider)
          const configured = Boolean(status?.configured)
          return (
            <article key={item.provider} className="rounded px-3 py-2 text-xs" style={{ border: configured ? '1px solid rgba(52,211,153,0.22)' : '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
              <div className="font-bold tracking-widest" style={{ color: '#E0F2FE' }}>{item.provider}</div>
              <div className="mt-1 font-mono text-[10px]" style={{ color: '#94A3B8' }}>{item.env}</div>
              <div className="mt-2" style={{ color: configured ? '#86EFAC' : '#FDE68A' }}>{configured ? 'Configured' : 'Missing or not reported'}</div>
              <p className="mt-2 leading-relaxed" style={{ color: '#777' }}>{item.powers}</p>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function AgentGrowthTrainingPanel() {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(250,204,21,0.012)' }}>
      <div className="mb-3">
        <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FDE68A' }}>AGENT GROWTH / TRAINING</h2>
        <p className="mt-1 text-xs" style={{ color: '#777' }}>Training advances through approved lessons, validated outcomes, memory, analyst findings, income operations results, and project orchestration records.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-6">
        {AGENT_GROWTH_STAGES.map(stage => (
          <div key={stage} className="rounded px-2 py-2 text-center text-[10px] font-bold tracking-widest" style={{ border: '1px solid rgba(250,204,21,0.18)', color: '#FDE68A', background: 'rgba(0,0,0,0.24)' }}>
            {stage}
          </div>
        ))}
      </div>
    </div>
  )
}

function EngineeringLaneManualPanel({ latest }: { latest: EngineeringTaskPacket | null }) {
  const [generated, setGenerated] = useState<EngineeringTaskPacket | null>(null)
  const [source, setSource] = useState<string>('not_generated')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const packet = generated ?? latest
  const generatePacket = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/engineering/task-packet', { cache: 'no-store' })
      const body = await res.json() as { packet?: EngineeringTaskPacket; diagnostics?: { packetSource?: string }; error?: string }
      if (!res.ok || !body.packet) throw new Error(body.error || 'Engineering task packet generation failed')
      setGenerated(body.packet)
      setSource(body.diagnostics?.packetSource ?? body.packet.packetSource)
      setNotice('Cursor task packet generated for manual copy only. War Room did not invoke Cursor or mutate files.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Engineering task packet generation failed')
    } finally {
      setBusy(false)
    }
  }
  const copyPacket = async () => {
    if (!packet) return
    try {
      await navigator.clipboard.writeText(packet.cursorCommand)
      setNotice('Cursor task packet copied. Manual approval/execution remains outside War Room.')
    } catch {
      setNotice('Clipboard unavailable; use the visible packet text. War Room did not invoke Cursor.')
    }
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(52,211,153,0.014)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#86EFAC' }}>ENGINEERING LANE: CURSOR MANUAL ONLY</h2>
          <p className="mt-1 text-xs" style={{ color: '#777' }}>War Room may prepare task packets, validation expectations, and review prompts. Code edits, commits, pushes, and deployments stay in the manual Cursor workspace lane.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void generatePacket()} disabled={busy} className="rounded px-3 py-2 text-[10px] font-bold tracking-widest disabled:opacity-50" style={{ border: '1px solid rgba(52,211,153,0.32)', color: '#BBF7D0', background: 'rgba(0,0,0,0.28)' }}>{busy ? 'Preparing...' : 'Generate Packet'}</button>
          <button type="button" onClick={() => void copyPacket()} disabled={!packet} className="rounded px-3 py-2 text-[10px] font-bold tracking-widest disabled:opacity-50" style={{ border: '1px solid rgba(56,189,248,0.32)', color: '#BAE6FD', background: 'rgba(0,0,0,0.28)' }}>Copy Packet</button>
        </div>
      </div>
      {notice ? <div className="mb-2 rounded border border-white/10 bg-black/25 px-3 py-2 text-[10px]" style={{ color: '#BAE6FD' }}>{notice}</div> : null}
      <div className="rounded px-3 py-3 text-xs" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
        {packet ? (
          <div className="space-y-1" style={{ color: '#CBD5E1' }}>
            <div className="font-bold" style={{ color: '#E0F2FE' }}>{packet.title}</div>
            <div>Executor: {packet.assignedExecutorLabel}</div>
            <div>Approval status: {packet.approvalStatus}</div>
            <div>Packet source: {source === 'not_generated' ? packet.packetSource : source}</div>
            <div>Last generated: {packet.createdAt}</div>
            <div>Rollback: {packet.rollbackRecommendation}</div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <div className="rounded border border-white/10 p-2">Validation checklist: {packet.validationChecklist.slice(0, 2).join(' | ')}</div>
              <div className="rounded border border-white/10 p-2">Risk notes: {packet.riskNotes.slice(0, 2).join(' | ')}</div>
              <div className="rounded border border-white/10 p-2">Boundary: no direct Cursor API execution or autonomous code mutation.</div>
            </div>
            <textarea readOnly value={packet.cursorCommand} className="mt-2 h-36 w-full resize-y rounded bg-black/40 p-2 font-mono text-[10px] outline-none" style={{ border: '1px solid rgba(56,189,248,0.18)', color: '#CBD5E1' }} />
          </div>
        ) : <div style={{ color: '#777' }}>No Cursor task packet prepared yet.</div>}
      </div>
    </div>
  )
}

function ApprovalQueueSummaryPanel({ pendingApprovals }: { pendingApprovals: number }) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(251,191,36,0.012)' }}>
      <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FBBF24' }}>APPROVAL QUEUE</h2>
      <p className="mt-1 text-xs" style={{ color: '#777' }}>Consequential actions remain approval-gated before execution, memory promotion, finance operations, repository mutation, commit, push, or deploy.</p>
      <div className="mt-3 rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(251,191,36,0.22)', color: '#FDE68A', background: 'rgba(0,0,0,0.24)' }}>
        Pending approvals: {pendingApprovals}
      </div>
    </div>
  )
}

function RedTeamReviewSummaryPanel({ state, onDiagnose }: { state: RedTeamCoderUiState; onDiagnose: () => void }) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(239,68,68,0.012)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FCA5A5' }}>RED TEAM REVIEW</h2>
          <p className="mt-1 text-xs" style={{ color: '#777' }}>Risk review stays advisory and approval-bound. It can diagnose, challenge assumptions, and queue review notes, but does not mutate files.</p>
        </div>
        <button type="button" onClick={onDiagnose} className="rounded px-3 py-2 text-xs font-bold tracking-widest" style={{ border: '1px solid rgba(248,113,113,0.35)', color: '#FCA5A5', background: 'rgba(0,0,0,0.28)' }}>
          Run review
        </button>
      </div>
      <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(248,113,113,0.18)', color: '#FECACA', background: 'rgba(0,0,0,0.24)' }}>
        Status: {state.status.replaceAll('_', ' ')} - {state.message}
      </div>
    </div>
  )
}

function EngineTriBool({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[8px] font-bold tracking-widest" style={{ color: '#666' }}>{label}</span>
      <span className="font-bold" style={{ color: value ? '#34D399' : '#EF4444' }}>{value ? 'Yes' : 'No'}</span>
    </div>
  )
}

function formatLastSuccessfulProbe(iso: string | null | undefined): string {
  if (iso == null || iso === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function formatProviderAvailabilityDiagnostic(engine: EngineStatus): string {
  const d = engine.providerDiagnostics
  if (!d) return '—'
  const parts = [
    `provider ${d.providerId}`,
    `family ${d.familyId ?? '—'}`,
    `configured ${d.configured ? 'true' : 'false'}`,
    `apiKeyPresent ${d.apiKeyPresent ? 'true' : 'false'}`,
    `registry ${d.registryStatus}`,
    `lastCheck ${d.lastCheckResult}`,
  ]
  if (d.reason) parts.push(`reason ${d.reason}`)
  return parts.join(' · ')
}

const UnifiedEngineControlPanel = memo(function UnifiedEngineControlPanel() {
  const { uiMode } = useWarRoomUiMode()
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<EngineControlStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/engine-control/status', { cache: 'no-store' })
      const json = await res.json() as EngineControlStatusResponse & { message?: string }
      if (!Array.isArray(json.engines) || !json.routingReadiness || !json.timestamp) {
        throw new Error('Engine status payload missing required fields')
      }
      setData(json)
      if (!res.ok) setError(json.degradedReason ?? 'Engine routing unavailable')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Engine status failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true)
    })
  }, [])

  useEffect(() => {
    if (!mounted) return
    void Promise.resolve().then(() => load())
  }, [mounted])

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(244,114,182,0.012)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#F472B6' }}>SYSTEM INTELLIGENCE NETWORK</h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Live engine matrix: cloud keys and Cursor manual workspace posture. Read-only status - no execution from this table.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || !mounted}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
          style={{ border: '1px solid rgba(244,114,182,0.45)', color: '#F472B6', background: 'rgba(0,0,0,0.28)' }}>
          {loading ? 'REFRESHING...' : 'REFRESH ENGINES'}
        </button>
      </div>
      {!mounted ? (
        <div className="text-xs tracking-widest" style={{ color: '#555' }}>Mounting…</div>
      ) : error ? (
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>{error}</div>
      ) : !data ? (
        <div className="text-xs tracking-widest" style={{ color: '#555' }}>Loading engine matrix…</div>
      ) : uiMode === 'operator' ? (
        <details className="overflow-x-auto rounded border border-white/10 bg-black/20 p-2">
          <summary className="cursor-pointer text-xs font-bold tracking-widest" style={{ color: '#F472B6' }}>Advanced Diagnostics (full engine matrix)</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left text-[11px]" style={{ color: '#bbb' }}>
              <thead>
                <tr style={{ color: '#888' }}>
                  <th className="pb-2 pr-2 font-bold tracking-widest">ENGINE</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest">CATEGORY</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest" title="Installed / detected where applicable">INST</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest" title="Credentials or paths present">CONFIGURED</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest" title="Service or API responded">REACHABLE</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest" title="End-to-end probe succeeded">FUNCTIONAL</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest" title="Last successful probe">LAST OK</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest">PROVIDER</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest">READINESS</th>
                  <th className="pb-2 pr-2 font-bold tracking-widest">DIAGNOSTIC</th>
                  <th className="pb-2 font-bold tracking-widest">NOTES</th>
                </tr>
              </thead>
              <tbody>
                {data.engines.map((engine: EngineStatus) => (
                  <tr
                    key={engine.id}
                    className="border-t border-yellow-900/40 align-top"
                    style={engine.id === 'gemini' ? { background: 'rgba(96,165,250,0.06)' } : undefined}
                  >
                    <td className="py-2 pr-2 font-bold" style={{ color: '#F9A8D4' }}>{engine.displayName}</td>
                    <td className="py-2 pr-2" style={{ color: '#999' }}>{engine.category}</td>
                    <td className="py-2 pr-2">
                      <EngineTriBool label="INST" value={engine.installed} />
                    </td>
                    <td className="py-2 pr-2">
                      <EngineTriBool label="CFG" value={engine.configured} />
                    </td>
                    <td className="py-2 pr-2">
                      <EngineTriBool label="REACH" value={engine.reachable} />
                    </td>
                    <td className="py-2 pr-2">
                      <EngineTriBool label="OK" value={engine.functional} />
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap" style={{ color: '#9ca3af' }}>
                      {formatLastSuccessfulProbe(engine.lastSuccessfulProbeAt)}
                    </td>
                    <td className="py-2 pr-2 font-medium" style={{ color: engine.id === 'gemini' ? '#93C5FD' : '#aaa' }}>
                      {engine.providerLabel}
                    </td>
                    <td className="py-2 pr-2 text-[10px] font-bold tracking-widest" style={{ color: '#9AE6B4' }}>
                      {['chatgpt', 'claude', 'grok', 'gemini'].includes(engine.id) ? cloudEngineReadinessLabel(engine) : '—'}
                    </td>
                    <td className="py-2 pr-2 max-w-xs leading-snug" style={{ color: '#94a3b8' }}>
                      {formatProviderAvailabilityDiagnostic(engine)}
                    </td>
                    <td className="py-2 max-w-xs leading-snug md:max-w-md" style={{ color: '#777' }}>{engine.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 text-[10px] tracking-widest" style={{ color: '#555' }}>
              checkedAt: {data.checkedAt ? new Date(data.checkedAt).toLocaleString() : '—'}
            </div>
          </div>
        </details>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-[11px]" style={{ color: '#bbb' }}>
            <thead>
              <tr style={{ color: '#888' }}>
                <th className="pb-2 pr-2 font-bold tracking-widest">ENGINE</th>
                <th className="pb-2 pr-2 font-bold tracking-widest">CATEGORY</th>
                <th className="pb-2 pr-2 font-bold tracking-widest" title="Installed / detected where applicable">INST</th>
                <th className="pb-2 pr-2 font-bold tracking-widest" title="Credentials or paths present">CONFIGURED</th>
                <th className="pb-2 pr-2 font-bold tracking-widest" title="Service or API responded">REACHABLE</th>
                <th className="pb-2 pr-2 font-bold tracking-widest" title="End-to-end probe succeeded">FUNCTIONAL</th>
                <th className="pb-2 pr-2 font-bold tracking-widest" title="Last successful probe (Gemini: list-models + minimal generateContent)">LAST OK</th>
                <th className="pb-2 pr-2 font-bold tracking-widest">PROVIDER</th>
                <th className="pb-2 pr-2 font-bold tracking-widest">READINESS</th>
                <th className="pb-2 pr-2 font-bold tracking-widest">DIAGNOSTIC</th>
                <th className="pb-2 font-bold tracking-widest">NOTES</th>
              </tr>
            </thead>
            <tbody>
              {data.engines.map((engine: EngineStatus) => (
                <tr
                  key={engine.id}
                  className="border-t border-yellow-900/40 align-top"
                  style={engine.id === 'gemini' ? { background: 'rgba(96,165,250,0.06)' } : undefined}
                >
                  <td className="py-2 pr-2 font-bold" style={{ color: '#F9A8D4' }}>{engine.displayName}</td>
                  <td className="py-2 pr-2" style={{ color: '#999' }}>{engine.category}</td>
                  <td className="py-2 pr-2">
                    <EngineTriBool label="INST" value={engine.installed} />
                  </td>
                  <td className="py-2 pr-2">
                    <EngineTriBool label="CFG" value={engine.configured} />
                  </td>
                  <td className="py-2 pr-2">
                    <EngineTriBool label="REACH" value={engine.reachable} />
                  </td>
                  <td className="py-2 pr-2">
                    <EngineTriBool label="OK" value={engine.functional} />
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap" style={{ color: '#9ca3af' }}>
                    {formatLastSuccessfulProbe(engine.lastSuccessfulProbeAt)}
                  </td>
                  <td className="py-2 pr-2 font-medium" style={{ color: engine.id === 'gemini' ? '#93C5FD' : '#aaa' }}>
                    {engine.providerLabel}
                  </td>
                  <td className="py-2 pr-2 text-[10px] font-bold tracking-widest" style={{ color: '#9AE6B4' }}>
                    {['chatgpt', 'claude', 'grok', 'gemini'].includes(engine.id) ? cloudEngineReadinessLabel(engine) : '—'}
                  </td>
                  <td className="py-2 pr-2 max-w-xs leading-snug" style={{ color: '#94a3b8' }}>
                    {formatProviderAvailabilityDiagnostic(engine)}
                  </td>
                  <td className="py-2 max-w-xs leading-snug md:max-w-md" style={{ color: '#777' }}>{engine.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] tracking-widest" style={{ color: '#555' }}>
            checkedAt: {data.checkedAt ? new Date(data.checkedAt).toLocaleString() : '—'}
          </div>
        </div>
      )}
    </div>
  )
})

type EngineRouteCommandApiResponse = RouteCommandResult & {
  enginesSummary?: Array<{ id: string; functional: boolean; reachable: boolean; configured: boolean }>
  message?: string
}

const LiveCouncilHealthBadgesRow = memo(function LiveCouncilHealthBadgesRow({
  chatHealthLabel,
  providerHealthLabel,
  persistenceHealthLabel,
  internetHealthLabel,
}: {
  chatHealthLabel: string
  providerHealthLabel: string
  persistenceHealthLabel: string
  internetHealthLabel: string
}) {
  return (
    <div className="mt-2 grid gap-2 text-[9px] tracking-widest sm:grid-cols-4" style={{ color: '#94a3b8' }}>
      <span className="rounded border border-white/10 px-2 py-1">Chat: {chatHealthLabel}</span>
      <span className="rounded border border-white/10 px-2 py-1">Providers: {providerHealthLabel}</span>
      <span className="rounded border border-white/10 px-2 py-1">Persistence: {persistenceHealthLabel}</span>
      <span className="rounded border border-white/10 px-2 py-1">Internet: {internetHealthLabel}</span>
    </div>
  )
})

const LiveCouncilBabyObserverLane = memo(function LiveCouncilBabyObserverLane({
  memoryCount,
  memoryRuntimeState,
  memoryRuntimeLabel,
  sessionOnlyLearning,
  pendingApprovals,
  opportunityCount,
  providerReady,
}: {
  memoryCount: number
  memoryRuntimeState: MemoryRuntimeState
  memoryRuntimeLabel: string
  sessionOnlyLearning: boolean
  pendingApprovals: number
  opportunityCount: number
  providerReady: boolean
}) {
  const hasMemory = memoryCount > 0
  const hasOutcomeCue = pendingApprovals > 0 || opportunityCount > 0
  const progress = providerReady
    ? hasMemory && hasOutcomeCue ? 72 : hasMemory ? 52 : 34
    : 18
  const state = !providerReady
    ? 'provider readiness degraded'
    : hasMemory && hasOutcomeCue
      ? 'extracting lesson'
      : hasMemory
        ? 'listening'
        : sessionOnlyLearning
          ? 'session-only learning active'
          : 'observer in temporary learning mode'
  const readiness = [
    sessionOnlyLearning ? memoryRuntimeLabel : `memory ${memoryRuntimeState === 'ONLINE' ? 'ready' : 'temporary'}`,
    `outcome ${hasOutcomeCue ? 'ready' : 'awaiting'}`,
    `signal ${opportunityCount > 0 ? 'ready' : 'awaiting'}`,
    `provider ${providerReady ? 'ready' : 'degraded'}`,
    'future online ready',
    'future offline not enabled',
  ]

  return (
    <section className="mt-3 rounded border border-sky-500/20 bg-sky-500/5 p-3 text-[10px]" style={{ color: '#BAE6FD' }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold uppercase tracking-widest" style={{ color: '#67E8F9' }}>Baby AI Observer</div>
          <p className="mt-1 leading-relaxed" style={{ color: '#94A3B8' }}>
            Observes Live Council conversation, approved outcomes, rejected plans, Commander corrections, Feature Builder packets, Revenue Engine moves, Signal Radar rows, and Outcome Ledger results. Observe/propose only.
          </p>
        </div>
        <span className="rounded border border-sky-300/30 px-2 py-1 font-bold uppercase tracking-widest">{state}</span>
      </div>
      <div className="mt-2">
        <div className="mb-1 flex justify-between gap-2" style={{ color: '#64748B' }}>
          <span>Learning progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-white/10">
          <div className="h-full rounded bg-sky-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-white/10 bg-black/20 p-2">
          Current lesson candidate: {hasOutcomeCue ? 'Compare council recommendation with approval/outcome evidence.' : 'Waiting for outcome or Commander correction before lesson storage.'}
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-2">
          Needs next: {providerReady ? 'Commander approval, rejection, or measured outcome.' : 'Provider health recovery from sanitized runtime status.'}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1" style={{ color: '#94A3B8' }}>
        {readiness.map(item => <span key={item} className="rounded border border-white/10 px-2 py-0.5">{item}</span>)}
      </div>
    </section>
  )
})

function InternetAccessPanel({ internet, onRefresh }: { internet: InternetStatusResponse; onRefresh: () => void }) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(52,211,153,0.014)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>GLOBAL INTEL ACCESS</h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>Server-side only. API keys never leave the backend.</p>
        </div>
        <button type="button" onClick={onRefresh} className="rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ border: '1px solid rgba(52,211,153,0.35)', color: '#34D399', background: 'rgba(0,0,0,0.28)' }}>
          Refresh Intel
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {Object.values(internet.tools).map(tool => {
          const { headline, envHint } = internetToolReadinessParts(tool)
          const color = headline === 'Ready' ? '#34D399' : headline === 'Needs API key' ? '#FBBF24' : headline === 'Error - check key' ? '#EF4444' : '#888'

          return (
            <div key={tool.id} className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.28)' }}>
              <div className="font-bold tracking-widest" style={{ color: '#ddd' }}>{tool.name}</div>
              <div className="mt-1 font-bold" style={{ color }}>{headline}</div>
              {envHint && <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#888' }}>{envHint}</div>}
              <div className="mt-2 leading-relaxed" style={{ color: '#666' }}>{tool.notes}</div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 text-xs" style={{ color: '#555' }}>Last checked: {internet.lastChecked ? new Date(internet.lastChecked).toLocaleString() : 'not checked yet'} - research adapters: {internet.label}</div>
    </div>
  )
}

function RepoAccessPanel({
  repo,
  onRefresh,
  onCouncilHandoff,
}: {
  repo: RepoStatus
  onRefresh: () => void
  onCouncilHandoff: (decree: string) => void
}) {
  const caps = repo.capabilities
  const repoState = repo.canReadRepo ? 'Connected' : repo.gitAvailable ? 'Git detected' : 'Awaiting repo scan'
  const accessState = repo.allowed.write ? 'Approval protected write lane' : 'Read-only secured'
  const remoteState = repo.remoteConfigured ? 'Remote connected' : 'Remote not configured'
  const rollbackState = caps.canCreateCheckpoint ? 'Rollback protected' : 'Rollback checkpoint unavailable'
  const protectionRows = [
    {
      label: 'Read posture',
      value: repo.canReadRepo ? 'Connected' : 'Awaiting repo scan',
      detail: 'War Room can inspect repo state without applying changes.',
      color: repo.canReadRepo ? '#34D399' : '#FBBF24',
    },
    {
      label: 'Mutation policy',
      value: accessState,
      detail: 'Writes, commits, rollback apply, and deploy actions stay behind Commander approval.',
      color: '#FDE68A',
    },
    {
      label: 'Git status',
      value: repo.gitAvailable ? 'Git detected' : 'Git unavailable',
      detail: repo.gitAvailable ? `Branch ${repo.currentBranch} is visible to the repo status check.` : 'Install or expose git before repo-aware checks can run.',
      color: repo.gitAvailable ? '#A7F3D0' : '#FCA5A5',
    },
    {
      label: 'Remote',
      value: remoteState,
      detail: repo.remoteConfigured ? 'Remote metadata is visible; push still requires explicit approval.' : 'Remote status is not available from repo scan.',
      color: repo.remoteConfigured ? '#93C5FD' : '#94A3B8',
    },
    {
      label: 'Rollback',
      value: rollbackState,
      detail: 'Checkpoint readiness matters before any file-changing engineering packet is approved.',
      color: caps.canCreateCheckpoint ? '#FCA5A5' : '#F87171',
    },
  ]

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgba(167,139,250,0.035), rgba(0,0,0,0.16))' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#A78BFA' }}>REPO ACCESS COMMAND POST</h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Operational repo awareness without hidden mutation. Status labels explain what War Room can inspect and what remains approval protected.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onCouncilHandoff('Claude Architecture Reviewer, explain the current War Room repo access posture, approval protections, rollback readiness, and safest next engineering step.')}
            className="rounded px-3 py-2 text-xs font-bold tracking-widest"
            style={{ border: '1px solid rgba(96,165,250,0.35)', color: '#BAE6FD', background: 'rgba(0,0,0,0.28)' }}>
            Ask Council
          </button>
          <button type="button" onClick={onRefresh} className="rounded px-3 py-2 text-xs font-bold tracking-widest"
            style={{ border: '1px solid rgba(167,139,250,0.35)', color: '#A78BFA', background: 'rgba(0,0,0,0.28)' }}>
            Refresh Repo
          </button>
        </div>
      </div>
      <div className="grid gap-2 text-xs md:grid-cols-5">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>REPO BRIDGE</div><div className="mt-1 font-bold" style={{ color: repo.canReadRepo ? '#34D399' : '#FFD700' }}>{repoState}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>ACCESS LEVEL</div><div className="mt-1 font-bold" style={{ color: '#FDE68A' }}>{accessState}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>BRANCH</div><div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{repo.currentBranch}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>WORKING TREE</div><div className="mt-1 font-bold" style={{ color: statusColor(repo.workingTreeStatus) }}>{repo.workingTreeStatus === 'clean' ? 'Clean' : repo.workingTreeStatus}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(239,68,68,0.22)', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>ROLLBACK</div><div className="mt-1 font-bold" style={{ color: caps.canCreateCheckpoint ? '#FCA5A5' : '#F87171' }}>{rollbackState}</div></div>
      </div>
      <div className="mt-3 grid gap-2 text-xs md:grid-cols-5">
        {protectionRows.map(row => (
          <div key={row.label} className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>{row.label.toUpperCase()}</div>
            <div className="mt-1 font-bold" style={{ color: row.color }}>{row.value}</div>
            <div className="mt-2 text-[10px] leading-relaxed" style={{ color: '#94A3B8' }}>{row.detail}</div>
          </div>
        ))}
      </div>

      <details className="mt-3 rounded px-3 py-2 text-[10px]" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.22)' }}>
        <summary className="cursor-pointer font-bold tracking-widest" style={{ color: '#C4B5FD' }}>Deep repo diagnostics</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div className="rounded px-3 py-2" style={{ border: '1px solid #222' }}>
            <div className="mb-1 font-bold" style={{ color: '#9CA3AF' }}>CAPABILITIES (raw)</div>
            <div className="flex flex-wrap gap-2">
              <span style={{ color: caps.canWriteFilesystem ? '#34D399' : '#EF4444' }}>fs_write: {String(caps.canWriteFilesystem)}</span>
              <span style={{ color: caps.canGitCommit ? '#34D399' : '#FFD700' }} title="user.name / user.email and not bare">git_commit_ready: {String(caps.canGitCommit)}</span>
              <span style={{ color: caps.canCreateCheckpoint ? '#34D399' : '#EF4444' }}>checkpoint_dir_ok: {String(caps.canCreateCheckpoint)}</span>
            </div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid #222' }}>
            <div className="mb-1 font-bold" style={{ color: '#FFD700' }}>ALLOWED (War Room policy)</div>
            <div className="flex flex-wrap gap-2">
              <span style={{ color: repo.allowed.write ? '#34D399' : '#777' }}>write: {String(repo.allowed.write)}</span>
              <span style={{ color: repo.allowed.commit ? '#34D399' : '#777' }}>commit: {String(repo.allowed.commit)}</span>
              <span style={{ color: repo.allowed.rollback ? '#34D399' : '#777' }}>rollback_apply: {String(repo.allowed.rollback)}</span>
            </div>
          </div>
          <div className="rounded px-3 py-2 md:col-span-2" style={{ border: '1px solid #222' }}>
            <div style={{ color: '#555' }}>PATH</div>
            <div className="mt-1 truncate" style={{ color: '#ddd' }}>{repo.repoPath || 'unknown'}</div>
            <div className="mt-2" style={{ color: '#555' }}>LAST COMMIT</div>
            <div className="mt-1 font-mono" style={{ color: '#888' }}>{repo.lastCommitHash?.short ?? '-'}</div>
          </div>
        </div>
      </details>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] tracking-widest">
        {Object.entries(repo.permissions).map(([key, value]) => (
          <span key={key} className="rounded px-2 py-1" style={{ border: '1px solid #222', color: value === true ? '#34D399' : value === false ? '#EF4444' : '#FFD700' }}>{key}: {String(value)}</span>
        ))}
      </div>
    </div>
  )
}

function RollbackSafetyPanel({ rollback, onRefresh, onCheckpoint }: { rollback: RollbackStatus; onRefresh: () => void; onCheckpoint: () => void }) {
  const checkpoint = rollback.latestCheckpoint
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(239,68,68,0.012)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#EF4444' }}>ROLLBACK SAFETY</h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>JSON checkpoints under .war-room/checkpoints (gitignored). No stash, reset, or commit.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onRefresh} className="rounded px-3 py-2 text-xs font-bold tracking-widest" style={{ border: '1px solid #333', color: '#888' }}>Refresh</button>
          <button type="button" onClick={onCheckpoint} className="rounded px-3 py-2 text-xs font-bold tracking-widest" style={{ border: '1px solid rgba(239,68,68,0.35)', color: '#EF4444', background: 'rgba(0,0,0,0.28)' }}>Create Checkpoint</button>
        </div>
      </div>
      <div className="mb-2 rounded px-3 py-2 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.28)', color: '#aaa' }}>
        {rollback.message || '-'}
      </div>
      <div className="grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>CHECKPOINT BEFORE APPLY</div><div className="mt-1 font-bold" style={{ color: rollback.checkpointRequiredBeforeApply ? '#FFD700' : '#34D399' }}>{String(rollback.checkpointRequiredBeforeApply)}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>CHECKPOINT ID</div><div className="mt-1 truncate font-mono text-[10px]" style={{ color: '#ddd' }}>{checkpoint?.checkpointId ?? 'none'}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>TIME</div><div className="mt-1" style={{ color: '#888' }}>{checkpoint ? new Date(checkpoint.timestamp).toLocaleString() : 'none'}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>ROLLBACK AVAILABLE</div><div className="mt-1 font-bold" style={{ color: rollback.rollbackAvailable ? '#34D399' : '#777' }}>{String(rollback.rollbackAvailable)}</div></div>
      </div>
    </div>
  )
}

function DiffPreviewPanel({
  preview,
  staged,
  loading,
  error,
  onStagedChange,
  onLoad,
}: {
  preview: DiffPreviewResponse | null
  staged: boolean
  loading: boolean
  error: string | null
  onStagedChange: (staged: boolean) => void
  onLoad: () => void
}) {
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(56,189,248,0.012)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>DIFF PREVIEW</h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>Read-only git diff from the server. Nothing is applied.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[10px] tracking-widest" style={{ color: '#888' }}>
            <input type="checkbox" checked={staged} onChange={event => onStagedChange(event.target.checked)} />
            staged (--cached)
          </label>
          <button type="button" onClick={onLoad} disabled={loading}
            className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
            style={{ border: '1px solid rgba(56,189,248,0.45)', color: '#38BDF8', background: 'rgba(0,0,0,0.28)' }}>
            {loading ? 'LOADING...' : 'LOAD PREVIEW'}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-2 text-xs" style={{ color: '#EF4444' }}>{error}</div>
      )}
      {preview?.truncated && (
        <div className="mb-2 text-[10px] font-bold tracking-widest" style={{ color: '#FFD700' }}>OUTPUT TRUNCATED - see API cap.</div>
      )}
      <pre className="max-h-64 overflow-auto rounded p-3 text-[11px] leading-snug" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.45)', color: '#9CA3AF' }}>
        {preview?.diff ? preview.diff : '- click Load preview -'}
      </pre>
    </div>
  )
}

type QueueActionRow = {
  status: string
  type: string
  created_at: string
  payload?: Record<string, unknown> | null
}

function formatApprovalPendingLabel(action: QueueActionRow): string {
  const rawTitle = action.payload && typeof action.payload.title === 'string' ? action.payload.title.trim() : ''
  const title = rawTitle.length > 0 ? rawTitle : null
  if (title) return `${action.type} - ${title}`
  return action.type
}

function WriteApprovalBanner() {
  const [phase, setPhase] = useState<'initial' | 'ready' | 'error'>('initial')
  const [pendingLabel, setPendingLabel] = useState<string | null>(null)
  const [hostingIsVercel, setHostingIsVercel] = useState(false)
  const queueInFlight = useRef(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/deploy/status', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { provider?: string }
        setHostingIsVercel(data.provider === 'vercel')
      } catch {
        /* keep false - do not claim Vercel */
      }
    })()
  }, [])

  const refreshApprovalBanner = useCallback(async () => {
    if (queueInFlight.current) return
    queueInFlight.current = true
    try {
      const res = await fetch('/api/actions/queue', { cache: 'no-store' })
      if (!res.ok) {
        setPhase('error')
        setPendingLabel(null)
        return
      }
      const j = await res.json() as { actions?: unknown }
      if (!Array.isArray(j.actions)) {
        setPhase('error')
        setPendingLabel(null)
        return
      }
      const rows = j.actions as QueueActionRow[]
      const waiting = rows.filter(row => row.status === 'waiting_approval')
      waiting.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
      const next = waiting[0] ?? null
      setPendingLabel(next ? formatApprovalPendingLabel(next) : null)
      setPhase('ready')
    } catch {
      setPhase('error')
      setPendingLabel(null)
    } finally {
      queueInFlight.current = false
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void refreshApprovalBanner()
    })
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void refreshApprovalBanner()
    }, 30_000)
    const onVis = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refreshApprovalBanner()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refreshApprovalBanner])

  const pending = Boolean(pendingLabel)
  const unknown = phase === 'error'
  const calmIdle = phase === 'ready' && !pending && !unknown

  const borderColor = pending
    ? 'rgba(234,179,8,0.55)'
    : unknown
      ? 'rgba(248,113,113,0.45)'
      : 'rgba(71,85,105,0.45)'
  const bg = pending
    ? 'rgba(234,179,8,0.08)'
    : unknown
      ? 'rgba(248,113,113,0.06)'
      : 'rgba(15,23,42,0.35)'
  const textColor = pending ? '#EAB308' : unknown ? '#F87171' : '#94A3B8'

  const primaryLine = unknown
    ? 'Approval gate status unknown.'
    : pending
      ? `Approval required: ${pendingLabel}.`
      : 'Approval gate active. No pending write actions.'

  return (
    <div className="border-b px-6 py-2 flex-shrink-0" style={{ borderColor, background: bg }}>
      <p className="text-[10px] font-bold tracking-widest" style={{ color: textColor }}>
        {phase === 'initial' ? 'Checking approval queue...' : primaryLine}
      </p>
      {calmIdle && hostingIsVercel ? (
        <p className="mt-1 text-[9px] font-bold tracking-widest" style={{ color: '#64748B' }}>
          Repo mutation controls unavailable in production dashboard.
        </p>
      ) : null}
    </div>
  )
}

function DeploymentAwarenessPanel({ deploy, onRefresh }: { deploy: DeployStatusResponse; onRefresh: () => void }) {
  const persistenceReady = deploy.supabase.serverPersistenceReady
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(96,165,250,0.014)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#60A5FA' }}>DEPLOYMENT STATUS</h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>Awareness only. No deployment execution is wired from this dashboard. Optional probes are controlled via deploy environment flags.</p>
        </div>
        <button type="button" onClick={onRefresh} className="rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ border: '1px solid rgba(96,165,250,0.35)', color: '#60A5FA', background: 'rgba(0,0,0,0.28)' }}>
          Refresh Deploy
        </button>
      </div>
      <div className="grid gap-2 text-xs md:grid-cols-5">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>LOCAL DEV</div><div className="mt-1 font-bold" style={{ color: statusColor(deploy.localDev.localDevProbe) }}>{deploy.localDev.localDevProbe.toUpperCase()}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>PRODUCTION</div><div className="mt-1 font-bold" style={{ color: statusColor(deploy.production.productionReachable) }}>{deploy.production.productionReachable.toUpperCase().replaceAll('_', ' ')}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>HOSTING</div><div className="mt-1 font-mono text-[10px]" style={{ color: '#888' }}>{deploy.provider}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>PERSISTENCE</div><div className="mt-1 font-bold" style={{ color: persistenceReady ? '#34D399' : '#FFD700' }}>{String(persistenceReady)}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>SUPABASE</div><div className="mt-1 font-bold" style={{ color: statusColor(deploy.supabase.status) }}>{deploy.supabase.status.toUpperCase()}</div></div>
      </div>
    </div>
  )
}

function statusColor(status: string) {
  if (['reachable', 'detected', 'online', 'clean', 'ready', 'created', 'configured', 'true'].includes(status)) return '#34D399'
  if (['config_needed', 'missing', 'required', 'dirty', 'standby', 'unknown', 'false', 'not_probed', 'disabled'].includes(status)) return '#FFD700'
  if (['error', 'unreachable'].includes(status)) return '#EF4444'
  return '#777'
}

function CommandRouterPanel() {
  const { uiMode } = useWarRoomUiMode()
  const [mounted, setMounted] = useState(false)
  const [text, setText] = useState('')
  const [routing, setRouting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EngineRouteCommandApiResponse | null>(null)

  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true)
    })
  }, [])

  const route = async () => {
    setRouting(true)
    setError(null)
    try {
      const res = await fetch('/api/engine-control/route-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: text, approvals: {} }),
      })
      const json = await res.json() as EngineRouteCommandApiResponse
      if (!res.ok) throw new Error(json.message || 'Route command failed')
      setResult(json)
    } catch (routeError) {
      setError(routeError instanceof Error ? routeError.message : 'Route command failed')
    } finally {
      setRouting(false)
    }
  }

  const draftActionType = classifyCommand(text)
  const routedActionType = result ? classifyCommand(result.requestedCommand) : null

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(129,140,248,0.012)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#818CF8' }}>COMMAND DISPATCH</h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Policy-aware routing via POST /api/engine-control/route-command. No shell or model execution from this control.
          </p>
        </div>
        <button type="button" onClick={() => void route()} disabled={routing || !mounted || !text.trim()}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
          style={{ background: '#818CF8', color: '#000' }}>
          {routing ? 'DISPATCHING…' : 'DISPATCH'}
        </button>
      </div>
      <textarea value={text} onChange={event => setText(event.target.value)} rows={3}
        data-command-surface-id="engine-command-router-preview"
        data-command-surface-role="secondary_router_preview"
        className="w-full rounded bg-black px-3 py-2 text-xs font-mono"
        style={{ border: '1px solid #222', color: '#ddd' }}
        placeholder="Tell War Room what you want done…" />
      {error && (
        <div className="mt-2 rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>{error}</div>
      )}
      <div className="mt-3 grid gap-2 text-[10px] md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: '#666' }}>Selected family</div>
          <div className="font-bold tracking-widest" style={{ color: result ? '#A5B4FC' : '#555' }}>{result?.selectedFamily ?? '—'}</div>
        </div>
        <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: '#666' }}>Selected engine</div>
          <div className="font-bold tracking-widest" style={{ color: result ? '#ddd' : '#555' }}>
            {result ? `${result.selectedEngine} · ${result.selectedProvider}` : '—'}
          </div>
        </div>
        <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: '#666' }}>Action type</div>
          <div className="font-mono" style={{ color: '#9CA3AF' }}>{routedActionType ?? draftActionType}</div>
          {!result && <div className="mt-1 text-[9px]" style={{ color: '#555' }}>Preview from draft text</div>}
        </div>
        <div className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: '#666' }}>Approval posture</div>
          <div className="font-bold" style={{ color: result ? (result.approvalRequired ? '#FBBF24' : '#34D399') : '#555' }}>
            {result ? (result.approvalRequired ? 'Approval required' : 'Auto-approved path (policy)') : '—'}
          </div>
        </div>
        <div className="rounded px-2 py-2 md:col-span-2 lg:col-span-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: '#666' }}>Result</div>
          {result ? (
            <div className="mt-1 space-y-1" style={{ color: '#ccc' }}>
              <div style={{ color: '#FFD700' }}>{result.recommendedNextStep}</div>
              <div style={{ color: '#888' }}>{result.reason}</div>
              {uiMode === 'advanced' && result.enginesSummary && result.enginesSummary.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {result.enginesSummary.map(row => (
                    <span key={row.id} className="rounded px-2 py-1 text-[9px] tracking-widest" style={{ border: '1px solid #333', color: '#888' }}>
                      {row.id}: fn={String(row.functional)} r={String(row.reachable)}
                    </span>
                  ))}
                </div>
              )}
              {uiMode === 'operator' && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[9px] font-bold tracking-widest" style={{ color: '#888' }}>Advanced Diagnostics (full route JSON)</summary>
                  <pre className="mt-2 max-h-40 overflow-auto text-[9px]" style={{ color: '#94a3b8' }}>{JSON.stringify(result, null, 2)}</pre>
                </details>
              )}
            </div>
          ) : (
            <div style={{ color: '#555' }}>No dispatch yet. Enter orders above, then Dispatch.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ExpansionPermissionPrompt({
  prompt,
  onApprove,
  onDecline,
  onSummarize,
}: {
  prompt: ExpansionPrompt
  onApprove: () => void
  onDecline: () => void
  onSummarize: () => void
}) {
  return (
    <div className="message-fade-in ml-11 mb-4 p-3 rounded"
      style={{ background: 'rgba(255,215,0,0.06)', border: '1px solid #3a2e00' }}>
      {prompt.urgent && (
        <div className="text-xs font-bold tracking-widest mb-2" style={{ color: '#EF4444' }}>
          URGENT: expanded analysis recommended.
        </div>
      )}
      <div className="text-xs tracking-widest" style={{ color: '#ddd' }}>
        Council requests expanded analysis. Estimated extra usage: {formatCost(prompt.extraCost)}. Reason: {prompt.reason}. Continue?
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={onApprove} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ background: '#FFD700', color: '#000', fontWeight: 'bold' }}>
          Approve
        </button>
        <button onClick={onDecline} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #333', color: '#888' }}>
          Decline
        </button>
        <button onClick={onSummarize} className="text-xs px-3 py-1 rounded tracking-widest"
          style={{ border: '1px solid #FFD700', color: '#FFD700' }}>
          Summarize instead
        </button>
      </div>
    </div>
  )
}

function Home() {
  const renderStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const { uiMode, setUiMode } = useWarRoomUiMode()
  const [command, setCommand] = useState('')

  const [loading, setLoading] = useState(false)
  const [typingFamily, setTypingFamily] = useState<TypingFamily | null>(null)
  const [toolBarHealth, setToolBarHealth] = useState(initialToolBarHealth)
  const [toolBarActivity, setToolBarActivity] = useState<Partial<Record<ToolId, ToolBarLabel>>>({})
  const [operatorTab, setOperatorTab] = useState<OperatorTab>('command')
  const renderCountRef = useRef(0)
  const lastPerfPublishRef = useRef(0)
  const [performanceDiagnostics, setPerformanceDiagnostics] = useState<WarRoomPerformanceDiagnostics>({
    renderCount: 0,
    lastRenderMs: 0,
    slowPanel: 'boot',
    lastRefreshDurationMs: null,
    lastRefreshAt: null,
    pollingIntervalMs: TOOLBAR_HEALTH_POLL_INTERVAL_MS,
  })
  const [recoveredAttendanceExpanded, setRecoveredAttendanceExpanded] = useState(false)
  const [recoveredIntegrityExpanded, setRecoveredIntegrityExpanded] = useState(false)
  renderCountRef.current += 1

  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const elapsed = now - renderStartedAt
    const shouldPublish = now - lastPerfPublishRef.current > 1000
    if (!shouldPublish) return
    lastPerfPublishRef.current = now
    setPerformanceDiagnostics(prev => ({
      ...prev,
      renderCount: renderCountRef.current,
      lastRenderMs: elapsed,
      slowPanel: elapsed > 24 ? operatorTab : prev.slowPanel,
    }))
  }, [operatorTab, renderStartedAt])

  const refreshToolBarHealthBars = useCallback(async () => {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
    try {
      const nextHealth = await fetchToolBarHealth()
      setToolBarHealth(nextHealth)
    } catch {
      return
    } finally {
      const finished = typeof performance !== 'undefined' ? performance.now() : Date.now()
      setPerformanceDiagnostics(prev => ({
        ...prev,
        lastRefreshDurationMs: finished - started,
        lastRefreshAt: new Date().toISOString(),
      }))
    }
  }, [])

  useEffect(() => {
    if (operatorTab !== 'system') return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void refreshToolBarHealthBars()
    }
    const id = window.setInterval(tick, TOOLBAR_HEALTH_POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [operatorTab, refreshToolBarHealthBars])
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [repoAwareness, setRepoAwareness] = useState<RepoAwarenessState>(INITIAL_REPO_AWARENESS_STATE)
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>(INITIAL_PROVIDER_HEALTH)
  const [redTeamCoder, setRedTeamCoder] = useState<RedTeamCoderUiState>(INITIAL_RED_TEAM_CODER_STATE)
  const [latestEngineeringTaskPacket, setLatestEngineeringTaskPacket] = useState<EngineeringTaskPacket | null>(null)
  const [latestRepairPacket, setLatestRepairPacket] = useState<CouncilRepairPacket | null>(null)
  const [latestAnalystPacket, setLatestAnalystPacket] = useState<AnalystOperationsPacket | null>(null)
  const [councilOutputMode, setCouncilOutputMode] = useState<CouncilOutputMode>('standard')
  const [sessionLifecycle, setSessionLifecycle] = useState<CouncilSessionLifecycle>('active')
  const councilPersistenceCtx = useMemo(() => buildCouncilPersistenceContext(), [])
  const { store: council, dispatch: councilDispatch, mounted: councilMounted, newSessionId } =
    useCouncilSession(councilPersistenceCtx)
  const messages = council.messages
  const liveChatWindow = useMemo(() => windowLiveChatMessages(messages), [messages])
  const liveCouncilHygiene = useMemo(
    () => applyCouncilThreadHygiene(liveChatWindow.visibleMessages),
    [liveChatWindow.visibleMessages],
  )
  const visibleCouncilMessages = liveCouncilHygiene.visibleMessages
  const collapsedCouncilNoiseCount = liveCouncilHygiene.collapsedCount
  const deferredVisibleCouncilMessages = useDeferredValue(visibleCouncilMessages)
  const compressedCouncilSummary = useMemo(
    () => compressCouncilOutput(deferredVisibleCouncilMessages, councilOutputMode),
    [deferredVisibleCouncilMessages, councilOutputMode],
  )
  const archivedCouncilMessages = liveChatWindow.archivedMessages
  const hiddenCouncilMessageCount = liveChatWindow.hiddenCount
  const [internetStatus, setInternetStatus] = useState<InternetStatusResponse>(INITIAL_INTERNET_STATUS)
  const [repoStatus, setRepoStatus] = useState<RepoStatus>(INITIAL_REPO_STATUS)
  const [rollbackStatus, setRollbackStatus] = useState<RollbackStatus>(INITIAL_ROLLBACK_STATUS)
  const [diffPreview, setDiffPreview] = useState<DiffPreviewResponse | null>(null)
  const [diffPreviewStaged, setDiffPreviewStaged] = useState(false)
  const [diffPreviewLoading, setDiffPreviewLoading] = useState(false)
  const [diffPreviewError, setDiffPreviewError] = useState<string | null>(null)
  const [deployStatus, setDeployStatus] = useState<DeployStatusResponse>(INITIAL_DEPLOY_STATUS)
  const [warRoomFiles, setWarRoomFiles] = useState<WarRoomFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesMessage, setFilesMessage] = useState<string | null>(null)
  const [incomeOpportunities, setIncomeOpportunities] = useState<IncomeOpportunity[]>([])
  const [incomeLoading, setIncomeLoading] = useState(false)
  const [incomeView, setIncomeView] = useState<IncomeRadarView>('active')
  const [opportunityScout, setOpportunityScout] = useState<OpportunityScoutState>(INITIAL_OPPORTUNITY_SCOUT_STATE)
  const [economicScoutDiagnostics, setEconomicScoutDiagnostics] = useState<EconomicScoutDiagnostics>(INITIAL_ECONOMIC_SCOUT_DIAGNOSTICS)
  const [opportunityScoutLoading, setOpportunityScoutLoading] = useState(false)
  const [incomeWorkerScout, setIncomeWorkerScout] = useState<IncomeWorkerScoutResult>(INITIAL_INCOME_WORKER_SCOUT)
  const [incomeCouncilReviews, setIncomeCouncilReviews] = useState<IncomeCouncilReview[]>([])
  const [incomeWorkerLoading, setIncomeWorkerLoading] = useState(false)
  const [incomeWorkerAssignLoading, setIncomeWorkerAssignLoading] = useState(false)
  const [paymentLedger, setPaymentLedger] = useState<PaymentLedgerState>(INITIAL_PAYMENT_LEDGER_STATE)
  const [raelActions, setRaelActions] = useState<RaelActionItem[]>([])
  const [smsBridge, setSmsBridge] = useState<SmsBridgeState>(INITIAL_SMS_BRIDGE_STATE)
  const [usageRows, setUsageRows] = useState<UsageEstimate[]>(BASE_USAGE_ROWS)
  const [currentDecreeCost, setCurrentDecreeCost] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)
  const [expansionPrompt, setExpansionPrompt] = useState<ExpansionPrompt | null>(null)
  const [memorySavePrompt, setMemorySavePrompt] = useState<MemorySavePrompt | null>(null)
  const [memoryNotification, setMemoryNotification] = useState<string | null>(null)
  const [memoryRecallView, setMemoryRecallView] = useState<MemoryRecallView | null>(null)
  const [familyPresence, setFamilyPresence] = useState<Record<TypingFamily, FamilyPresence>>({
    'CHATGPT FAMILY': { status: 'idle', label: 'standby' },
    'CLAUDE FAMILY': { status: 'idle', label: 'standby' },
    'GROK FAMILY': { status: 'idle', label: 'standby' },
    'GEMINI FAMILY': { status: 'idle', label: 'standby' },
    'KIMI FAMILY': { status: 'idle', label: 'standby' },
    'BRIDGE ARCHITECT': { status: 'idle', label: 'standby' },
  })
  const [, setToolRequestActive] = useState(false)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const addSystemMessageRef = useRef<((content: string) => void) | null>(null)
  const submitDecreeRef = useRef<((decree: string, mode?: CouncilMode) => Promise<void>) | null>(null)
  const loadMemoriesRef = useRef<(() => Promise<void>) | null>(null)
  const lastDecreeIntentRef = useRef<ClassifyRaElMessageResult | null>(null)
  const decreeRoundGenRef = useRef(0)
  const autonomousOrchInFlightRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const councilPausedRef = useRef(false)
  const councilChannelOpenRef = useRef(false)
  const councilSnapRef = useRef(council)
  const messagesRef = useRef(messages)
  const archivedMessageIdsRef = useRef<Set<string>>(new Set())
  const redTeamCoderDiagnosisInFlightRef = useRef(false)
  const redTeamCoderLastDiagnosedMessageRef = useRef<string | null>(null)
  const redTeamCoderRaelSentAtRef = useRef<Record<string, number>>({})
  const orchestrationTimerRef = useRef<number | null>(null)
  const raelActionsRef = useRef<RaelActionItem[]>([])
  const toolRequestActiveRef = useRef(false)
  const toolTimeoutRef = useRef<number | null>(null)
  const activeToolSystemMessageRef = useRef<string | null>(null)
  const geminiFunctionalRef = useRef(false)
  const skipGeminiForSessionRef = useRef(false)
  const geminiFailureCountRef = useRef(0)
  const geminiLastErrorSummaryRef = useRef<string | null>(null)
  const geminiUnavailableUserMessagedRef = useRef(false)
  const orchRedTeamEarlyLatchRef = useRef(false)
  const lastCouncilFamilyErrorRef = useRef<CouncilOrchestrationFamily | null>(null)
  /** Latest decree `submitDecree` attempt id (`decreeRoundGenRef`); compared to packet-bound round for stale `provider_error`. */
  const latestDecreeAttemptRoundRef = useRef(0)
  /** `decreeRoundGenRef` value when `councilPacketRender` was last updated from the decree pipeline. */
  const councilPacketRenderBoundRoundRef = useRef(0)
  const [geminiEngineRow, setGeminiEngineRow] = useState<EngineStatus | null>(null)
  const [engineList, setEngineList] = useState<EngineStatus[]>([])
  const engineMapRef = useRef<Map<EngineId, EngineStatus>>(new Map())
  const [liveCouncilConvId, setLiveCouncilConvId] = useState<string | null>(null)
  const { snapshot: conversationRuntimeSnapshot } = useConversationRuntime(
    council,
    liveCouncilConvId,
    councilOutputMode,
    councilMounted,
  )
  const [persistenceAvailable, setPersistenceAvailable] = useState(false)
  const [continuityMode, setContinuityMode] = useState<RuntimeContinuityIndicatorMode>('Unknown')
  const [continuityRecoverAt, setContinuityRecoverAt] = useState<string | null>(null)
  const [recoverRuntimeBanner, setRecoverRuntimeBanner] = useState(false)
  const [runtimePersistenceBanner, setRuntimePersistenceBanner] = useState<string | null>(null)
  const [recoveredIntegrityPartial, setRecoveredIntegrityPartial] = useState<RuntimeIntegrityPartial | null>(null)
  const [recoveredAttendanceSummary, setRecoveredAttendanceSummary] = useState<RuntimeAttendanceSummary | null>(null)
  const [recoveredDiagnosticHistory, setRecoveredDiagnosticHistory] = useState<DiagnosticHistoryEvent[]>([])
  const [recoveredRedTeamHold, setRecoveredRedTeamHold] = useState<RedTeamHoldUnresolvedPayload | null>(null)
  const [incomeOperationsMode, setIncomeOperationsMode] = useState(false)
  const [participationToggles, setParticipationToggles] = useState<CouncilParticipationToggles>({
    includeKimi: false,
    includeRedTeam: false,
    includeBaby: false,
    includeBridgeArchitect: false,
  })
  const activeCouncilCommandRef = useRef<CouncilCommand>({ ...DEFAULT_COUNCIL_COMMAND })
  const lastRaelDirectiveContentRef = useRef('')
  const [councilUiCommand, setCouncilUiCommand] = useState<CouncilCommand>(() => ({ ...DEFAULT_COUNCIL_COMMAND }))
  const [councilPacketRender, setCouncilPacketRender] = useState<CouncilRenderPacket | null>(null)
  const applyCouncilPacketRender = useCallback((packet: CouncilRenderPacket) => {
    councilPacketRenderBoundRoundRef.current = decreeRoundGenRef.current
    setCouncilPacketRender(packet)
    if (
      packet.sessionState === 'CLOSED'
      && (packet.packetStatus === 'released' || packet.packetStatus === 'idle')
      && !packetHasActionableProviderIssues(packet.providerRuntimeStates, packet.providerRuntimeDetails)
    ) {
      if (councilSnapRef.current.councilState === 'provider_error') {
        councilDispatch({ type: 'CLEAR_PROVIDER_ERROR' })
      }
      lastCouncilFamilyErrorRef.current = null
    }
  }, [councilDispatch])
  const [continuationRequests, setContinuationRequests] = useState<ContinuationRequest[]>([])
  const continuationRequestsRef = useRef<ContinuationRequest[]>([])
  const continuationThrottleRef = useRef<Record<string, number>>({})
  const continuationDiagnosticsRef = useRef<ContinuationDiagnostics>({
    created: 0,
    granted: 0,
    denied: 0,
    summarized: 0,
    held: 0,
    suppressedRecursive: 0,
    holdSuppressions: 0,
  })
  const [liveResearchHud, setLiveResearchHud] = useState<LiveResearchClientUi | null>(null)
  const [commanderLocation, setCommanderLocation] = useState<CommanderLocationState>(DEFAULT_COMMANDER_LOCATION)
  const [horoscopeEnabled, setHoroscopeEnabled] = useState(false)
  const [astrologyMode, setAstrologyMode] = useState<AstrologyInterpretationMode>('spiritual')
  const setLocationMode = useCallback((mode: LocationMode) => {
    setCommanderLocation(prev => {
      if (mode === 'off') return { mode: 'off', historyStored: false }
      if (mode === 'precise_temporary') {
        return {
          ...prev,
          mode,
          preciseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          historyStored: false,
        }
      }
      return {
        ...prev,
        mode,
        city: prev.city ?? DEFAULT_COMMANDER_LOCATION.city,
        preciseExpiresAt: undefined,
        historyStored: false,
      }
    })
  }, [])
  const forgetCommanderLocation = useCallback(() => {
    setCommanderLocation(prev => forgetLocationHistory(prev))
  }, [])
  const injectLiveEnvironmentDecree = useCallback((decree: string) => {
    setCommand(decree)
    setOperatorTab('command')
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-command-surface-id="live-council-primary-decree"]')
      input?.focus()
    })
  }, [setOperatorTab])
  const decreePacketFlushCompleteRef = useRef(false)
  const decreePacketOpenedAtMsRef = useRef(0)
  const lastAutonomousResearchFamilyRef = useRef<CouncilOrchestrationFamily | null>(null)
  const lastAutonomousHadLiveResearchRef = useRef(false)
  /** After attendance soft gather snapshot, block late gather error lines from chat / persistence. */
  const attendanceSoftGatherUiClosedRef = useRef(false)
  const [familyDuty, setFamilyDuty] = useState<Record<string, CouncilDutyState>>(() =>
    Object.fromEntries(COUNCIL_ROSTER.map(r => [r.id, r.defaultDuty])),
  )
  const [familyCurrentFocus, setFamilyCurrentFocus] = useState<Partial<Record<CouncilOrchestrationFamily, string>>>({})
  const [ledgerEvents, setLedgerEvents] = useState<{ id: string; type: string; createdAt: string; payload?: Record<string, unknown> }[]>([])
  const [queueActions, setQueueActions] = useState<{ id: string; type: string; status: string; created_at: string; conversation_id: string | null }[]>([])
  const [permSnap, setPermSnap] = useState<{ mode: StandingPermissionMode; safetyLock: boolean } | null>(null)
  const [internetMonitorBusy, setInternetMonitorBusy] = useState(false)
  const loadInternetStatusRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const [standingAckHint, setStandingAckHint] = useState<string | null>(null)
  const pendingAuditDecreeRef = useRef<string | null>(null)
  const ledgerFetchInFlightRef = useRef(false)
  const sequentialDiagnosticHoldRef = useRef(false)
  const sequentialDiagnosticApiRef = useRef<{
    turn: number
    total: number
    order: CouncilOrchestrationFamily[]
  } | null>(null)
  const diagnosticIntegritySnapshotRef = useRef<string | null>(null)
  const diagnosticIntegrityGeneratedAtRef = useRef<string | null>(null)
  const diagnosticHoldTimerRef = useRef<number | null>(null)
  const diagnosticHoldReleaseRef = useRef<(() => void) | null>(null)
  const sequentialDiagnostics = useSequentialDiagnostics()
  const sequentialDiagnosticsSessionRef = useRef(sequentialDiagnostics.session)
  useEffect(() => {
    sequentialDiagnosticsSessionRef.current = sequentialDiagnostics.session
  }, [sequentialDiagnostics.session])

  const releaseSequentialDiagnosticHold = useCallback(() => {
    diagnosticHoldReleaseRef.current?.()
  }, [])

  useEffect(() => {
    try {
      const s = sequentialDiagnostics.session
      if (s?.active) {
        sessionStorage.setItem(
          'warRoomDiagnosticStrip',
          JSON.stringify({
            active: s.active,
            turnIndex: s.turnIndex,
            order: s.order,
            hold: s.hold,
            intentMode: s.intentMode,
            outcomes: s.outcomes,
            holdReason: s.holdReason,
          }),
        )
      } else {
        sessionStorage.removeItem('warRoomDiagnosticStrip')
      }
    } catch {
      /* private mode / no sessionStorage */
    }
  }, [sequentialDiagnostics.session])

  const standingPostExtra = (actionKind: string) => resolveStandingPostExtra(permSnap, actionKind)

  const councilPaused = council.councilState === 'paused'
  const showContinue = council.councilChannelOpen

  useEffect(() => {
    councilSnapRef.current = council
    messagesRef.current = council.messages
    councilPausedRef.current = council.councilState === 'paused'
    councilChannelOpenRef.current = council.councilChannelOpen
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync refs from granular council fields (avoid `[council]`-only churn)
  }, [
    council.sessionId,
    council.messages,
    council.councilState,
    council.councilChannelOpen,
    council.providerErrorMessage,
    council.isAwaitingResponses,
    council.requiresRaelForAutonomous,
    council.deepDiscussionMode,
    council.consecutiveAutonomousCount,
    council.lastSpeakerFamily,
    council.lastActivityAt,
    council.autonomousRoundIndex,
    council.recentOrchestrationSpeakers,
    council.lastContentHashByFamily,
    council.cooldownUntil,
  ])

  useEffect(() => {
    continuationRequestsRef.current = continuationRequests
  }, [continuationRequests])

  const recordContinuationDiagnostic = (key: keyof ContinuationDiagnostics, amount = 1) => {
    continuationDiagnosticsRef.current = {
      ...continuationDiagnosticsRef.current,
      [key]: continuationDiagnosticsRef.current[key] + amount,
    }
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Live Council] continuation diagnostics', continuationDiagnosticSummary(continuationDiagnosticsRef.current))
    }
  }

  const continuationRequestThrottleKey = (cr: ContinuationRequest) =>
    [
      cr.family,
      cr.kind,
      cr.reasonKey,
      cr.message.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120),
    ].join('|')

  const buildRedTeamCoderSignal = useCallback((latestRaelMessageId?: string | null): RedTeamCoderSignal => {
    const currentMessages = messagesRef.current
    const raelIndex = latestRaelMessageId
      ? currentMessages.findIndex(message => message.id === latestRaelMessageId)
      : currentMessages.findLastIndex(isRaelCouncilMessage)
    const latestRael = raelIndex >= 0 ? currentMessages[raelIndex] : null
    const messagesAfterRael = raelIndex >= 0 ? currentMessages.slice(raelIndex + 1) : []
    const familyResponsesAfterRael = messagesAfterRael.filter(isCouncilFamilyResponse)
    const sentAtMs = latestRael ? redTeamCoderRaelSentAtRef.current[latestRael.id] : null
    const systemNotes = currentMessages
      .filter(message => message.messageType === 'system' || message.familyName === 'SYSTEM')
      .slice(-16)
      .map(message => message.content)

    return {
      conversationId: liveCouncilConvId,
      lastRaelMessageId: latestRael?.id ?? null,
      lastRaelMessageAt: sentAtMs ? new Date(sentAtMs).toISOString() : null,
      lastFamilyResponseAt: familyResponsesAfterRael.length > 0 ? new Date().toISOString() : null,
      familiesResponded: familyResponsesAfterRael.map(message => message.familyName),
      loading,
      inputDisabled: loading || councilSnapRef.current.isAwaitingResponses,
      providerStatuses: providerHealth.providers,
      systemNotes,
      apiChatFailures: systemNotes
        .filter(note => note.includes('/api/chat') || note.toLowerCase().includes('provider failed'))
        .map(note => ({ message: note })),
      timeoutMs: 45_000,
      fallbackAttempted: familyResponsesAfterRael.length > 0 || systemNotes.some(note => note.toLowerCase().includes('fallback')),
      scrollInputOk: Boolean(scrollContainerRef.current && bottomRef.current),
    }
  }, [liveCouncilConvId, loading, providerHealth.providers])

  const runRedTeamCoderDiagnosis = useCallback(async (reason: 'manual' | 'auto-stalled-response', signalOverride?: RedTeamCoderSignal) => {
    if (redTeamCoderDiagnosisInFlightRef.current) return
    redTeamCoderDiagnosisInFlightRef.current = true
    const signal = signalOverride ?? buildRedTeamCoderSignal()

    if (signal.lastRaelMessageId) {
      redTeamCoderLastDiagnosedMessageRef.current = signal.lastRaelMessageId
    }

    try {
      const res = await fetch('/api/red-team-coder/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, conversationId: liveCouncilConvId, signal }),
      })
      const data = await res.json() as RedTeamCoderDiagnosisResult
      const latestIssue = data.issues[0] ?? null
      setRedTeamCoder({
        status: data.status,
        latestDetectedIssue: latestIssue,
        latestRepairPlan: data.latestRepairPlan,
        recommendedAgent: data.latestRepairPlan?.recommendedAgent ?? null,
        actionQueued: Boolean(data.actionQueued),
        actionId: data.actionId ?? null,
        message: data.message ?? (data.latestRepairPlan ? 'Repair plan created. Awaiting Ra’el approval.' : 'No active chat failure detected.'),
        lastCheckedAt: new Date().toISOString(),
      })
    } catch (err) {
      setRedTeamCoder(prev => ({
        ...prev,
        status: 'error',
        message: err instanceof Error ? err.message : 'Red Team Coder diagnosis failed.',
        lastCheckedAt: new Date().toISOString(),
      }))
    } finally {
      redTeamCoderDiagnosisInFlightRef.current = false
    }
  }, [buildRedTeamCoderSignal, liveCouncilConvId])

  useEffect(() => {
    const currentMessages = messages
    const latestRaelIndex = currentMessages.findLastIndex(isRaelCouncilMessage)
    if (latestRaelIndex < 0) return

    const latestRael = currentMessages[latestRaelIndex]
    if (!redTeamCoderRaelSentAtRef.current[latestRael.id]) {
      redTeamCoderRaelSentAtRef.current[latestRael.id] = Date.now()
    }

    const familyResponded = currentMessages.slice(latestRaelIndex + 1).some(isCouncilFamilyResponse)
    if (familyResponded || redTeamCoderLastDiagnosedMessageRef.current === latestRael.id) return

    const elapsed = Date.now() - redTeamCoderRaelSentAtRef.current[latestRael.id]
    const waitMs = Math.max(0, 46_000 - elapsed)
    const timeoutId = window.setTimeout(() => {
      const latestMessages = messagesRef.current
      const currentRaelIndex = latestMessages.findIndex(message => message.id === latestRael.id)
      const hasFamilyResponse = currentRaelIndex >= 0 && latestMessages.slice(currentRaelIndex + 1).some(isCouncilFamilyResponse)
      if (hasFamilyResponse || redTeamCoderLastDiagnosedMessageRef.current === latestRael.id) return
      void runRedTeamCoderDiagnosis('auto-stalled-response', buildRedTeamCoderSignal(latestRael.id))
    }, waitMs)

    return () => window.clearTimeout(timeoutId)
  }, [messages, buildRedTeamCoderSignal, runRedTeamCoderDiagnosis])

  useEffect(() => {
    if (!engineList.length) return
    const pick = (id: EngineId) => engineList.find(e => e.id === id)
    const chatgpt = pick('chatgpt')
    const claude = pick('claude')
    const grok = pick('grok')
    const gemini = pick('gemini')
    if (!chatgpt || !claude || !grok || !gemini) return
    setProviderHealth(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        chatgpt: cloudEngineStripStatus(chatgpt),
        claude: cloudEngineStripStatus(claude),
        grok: cloudEngineStripStatus(grok),
        gemini: cloudEngineStripStatus(gemini),
      },
      labels: {
        ...prev.labels,
        chatgpt: `ChatGPT · ${cloudEngineReadinessLabel(chatgpt)}`,
        claude: `Claude · ${cloudEngineReadinessLabel(claude)}`,
        grok: `Grok · ${cloudEngineReadinessLabel(grok)}`,
        gemini: `Gemini · ${cloudEngineReadinessLabel(gemini)}`,
      },
    }))
  }, [engineList])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/permissions/status', { cache: 'no-store' })
        const j = await res.json() as { mode?: string; safetyLock?: boolean }
        if (
          res.ok
          && (j.mode === 'manual' || j.mode === 'operator' || j.mode === 'commander')
        ) {
          setPermSnap({ mode: j.mode as StandingPermissionMode, safetyLock: Boolean(j.safetyLock) })
        } else {
          setPermSnap(null)
        }
      } catch {
        setPermSnap(null)
      }
    })()
  }, [])

  const refreshLedger = useCallback(async () => {
    if (ledgerFetchInFlightRef.current) return
    ledgerFetchInFlightRef.current = true
    try {
      const res = await fetch('/api/events/recent?limit=20', { cache: 'no-store' })
      const j = await res.json() as { events?: { id: string; type: string; createdAt: string; payload?: Record<string, unknown> }[] }
      setLedgerEvents(Array.isArray(j.events) ? j.events : [])
    } catch {
      setLedgerEvents([])
    } finally {
      ledgerFetchInFlightRef.current = false
    }
  }, [])

  const refreshQueueActions = useCallback(async () => {
    const q = liveCouncilConvId ? `?conversationId=${encodeURIComponent(liveCouncilConvId)}` : ''
    try {
      const res = await fetch(`/api/actions/queue${q}`, { cache: 'no-store' })
      const j = await res.json() as { actions?: { id: string; type: string; status: string; created_at: string; conversation_id: string | null }[] }
      setQueueActions(Array.isArray(j.actions) ? j.actions.slice(0, 14) : [])
    } catch {
      setQueueActions([])
    }
  }, [liveCouncilConvId])

  useEffect(() => {
    if (operatorTab !== 'diagnostics') return
    void refreshLedger()
  }, [operatorTab, refreshLedger])

  useEffect(() => {
    if (operatorTab !== 'command' && operatorTab !== 'approvals') return
    void refreshQueueActions()
  }, [operatorTab, refreshQueueActions])

  useEffect(() => {
    if (operatorTab !== 'income') return
    void loadPaymentLedger()
  }, [operatorTab])

  useEffect(() => {
    if (!councilMounted) return
    void (async () => {
      try {
        const res = await fetch('/api/conversations', { cache: 'no-store' })
        const persist = res.headers.get('x-war-room-persistence') === 'available'
        setPersistenceAvailable(persist)
        if (!res.ok || !persist) return

        const j = await res.json() as { conversations?: { id: string; metadata?: Record<string, unknown> }[] }
        const convs = Array.isArray(j.conversations) ? j.conversations : []
        let id: string | null = typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem(LIVE_COUNCIL_CONV_STORAGE_KEY)
          : null
        if (id && !convs.some(c => c.id === id)) id = null
        if (!id) {
          const live = convs.find(c => {
            const m = c.metadata as { council?: { source?: string } } | undefined
            return m?.council?.source === 'live_council'
          })
          if (live) id = live.id
        }
        if (!id) {
          const cre = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Live Council',
              metadata: { council: { source: 'live_council', incomeOperationsMode: false } },
            }),
          })
          if (!cre.ok) return
          const cj = await cre.json() as { conversation?: { id: string } }
          id = cj.conversation?.id ?? null
        }
        if (!id) return
        sessionStorage.setItem(LIVE_COUNCIL_CONV_STORAGE_KEY, id)
        setLiveCouncilConvId(id)

        const tr = await fetch(`/api/conversations/${id}`, { cache: 'no-store' })
        if (!tr.ok) return
        const tj = await tr.json() as {
          messages?: {
            id: string
            role: string
            content: string
            family?: string | null
            created_at: string
            metadata?: Record<string, unknown>
          }[]
          conversation?: { metadata?: Record<string, unknown> }
        }
        const meta = tj.conversation?.metadata as { council?: Record<string, unknown> } | undefined
        const cmeta = meta?.council as {
          incomeOperationsMode?: boolean
          participation?: CouncilParticipationToggles
          duty?: Record<string, CouncilDutyState>
        } | undefined
        if (cmeta?.incomeOperationsMode !== undefined) setIncomeOperationsMode(Boolean(cmeta.incomeOperationsMode))
        if (cmeta?.participation && typeof cmeta.participation === 'object') {
          setParticipationToggles(p => ({ ...p, ...cmeta.participation }))
        }
        if (cmeta?.duty && typeof cmeta.duty === 'object') {
          setFamilyDuty(prev => ({ ...prev, ...cmeta.duty }))
        }
        const councilMeta = meta?.council
        if (
          councilMeta
          && typeof councilMeta === 'object'
          && (councilMeta as Record<string, unknown>)[GEMINI_REPAIR_ENQUEUE_METADATA_KEY] === true
          && typeof sessionStorage !== 'undefined'
        ) {
          sessionStorage.setItem(GEMINI_REPAIR_ENQUEUE_METADATA_KEY, '1')
        }
        const rows = Array.isArray(tj.messages) ? tj.messages : []
        if (rows.length > 0) {
          const mapped = normalizeCouncilMessageIds(
            rows
              .filter(row =>
                shouldPersistCouncilMessage(
                  councilMessageFromWarRoomRow({
                    role: row.role,
                    content: row.content,
                    family: row.family,
                    metadata:
                      row.metadata && typeof row.metadata === 'object'
                        ? (row.metadata as Record<string, unknown>)
                        : undefined,
                  }),
                  councilPersistenceCtx,
                ),
              )
              .map(row => mapWarRoomRowToCouncilMessage(row)),
            'persisted',
          )
          if (mapped.length > 0) {
            councilDispatch({ type: 'SET_MESSAGES', payload: mapped })
          }
        }
      } catch {
        /* session-only council */
      }
    })()
  }, [councilMounted, councilDispatch, councilPersistenceCtx])

  useEffect(() => {
    if (!autoScrollEnabled) return
    const frame = window.requestAnimationFrame(() => {
      const el = scrollContainerRef.current
      if (!el) return
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } catch {
        el.scrollTop = el.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages, autoScrollEnabled])

  const addMessages = (newMsgs: CouncilMessage[], opts?: { removeIds?: string[] }) => {
    const existing = new Set(messagesRef.current.map(message => message.id))
    const normalized = newMsgs.map(message => {
      const existingId = typeof message.id === 'string' ? message.id.trim() : ''
      if (existingId && !existing.has(existingId)) {
        existing.add(existingId)
        return message
      }
      const nextId = createMessageId(`live-${message.messageType || message.familyName || 'message'}`)
      existing.add(nextId)
      return { ...message, id: nextId }
    })
    if (opts?.removeIds?.length) {
      councilDispatch({
        type: 'ADD_MESSAGES_REMOVING',
        payload: { messages: normalized, removeIds: opts.removeIds },
      })
      return
    }
    councilDispatch({ type: 'ADD_MESSAGES', payload: normalized })
  }

  const updateMessageContent = (id: string, content: string) => {
    councilDispatch({ type: 'UPDATE_MESSAGE', payload: { id, content } })
  }

  const setPresence = (familyName: TypingFamily, status: FamilyPresence['status'], label: string) => {
    setFamilyPresence(prev => ({ ...prev, [familyName]: { status, label } }))
  }

  const addSystemMessage = (content: string, opts?: { force?: boolean; id?: string }) => {
    const safeContent = sanitizeMemoryRuntimeText(content)
    const isSilentInfrastructureNotice = (line: string) =>
      /\b(memory preview ready|archive loaded|telemetry updated|persistence synced|runtime continuity notice)\b/i.test(
        line,
      )
    if (
      !opts?.force
      && (
        isSilentInfrastructureNotice(safeContent)
        || shouldSuppressProviderFailureFromChatStream(safeContent, { diagnosticsOpen: operatorTab === 'diagnostics' })
      )
    ) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('[Live Council] Silent infrastructure notice:', safeContent)
      }
      return
    }
    councilDispatch({
      type: 'ADD_SYSTEM_MESSAGE_DEDUPED',
      payload: { id: opts?.id ?? createMessageId('system'), content: safeContent, timestamp: new Date().toLocaleTimeString() },
    })
  }

  const prepareRepairPacketFromCouncilMessage = async (message: CouncilMessage) => {
    if (!isCouncilMessageRepairPacketEligible(message)) {
      addSystemMessage(
        'Repair packet cannot use greeting-only or degraded council placeholders. Describe the broken panel, symptom, and expected behavior in a decree first.',
        { force: true },
      )
      return
    }
    const latestDecree = [...messagesRef.current].reverse().find(isRaelCouncilMessage)
    const decree = latestDecree?.content || message.content
    if (!decree?.trim()) {
      addSystemMessage('Repair packet needs a concrete Commander decree describing the broken panel, symptom, and expected behavior.', { force: true })
      return
    }
    try {
      const res = await fetch('/api/council/repair-packet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decree,
          sourceMessageId: message.id,
          sourceFamily: message.familyName,
          sourceContent: message.content,
        }),
      })
      const body = await res.json() as {
        packet?: CouncilRepairPacket
        error?: string
        scope?: string
        clarification?: string
      }
      if (res.status === 422 && body.scope === 'needs_scope') {
        addSystemMessage(body.clarification || 'Repair packet needs a more concrete issue description before Engineering Lane handoff.', { force: true })
        return
      }
      if (!res.ok || !body.packet) throw new Error(body.error || 'Repair packet generation failed')
      setLatestRepairPacket(body.packet)
      addMessages([{
        id: createMessageId('repair-packet'),
        familyName: 'ENGINEERING LANE',
        content: `Repair packet prepared: ${body.packet.title}`,
        timestamp: new Date().toLocaleTimeString(),
        color: '#7DD3FC',
        icon: 'R',
        provider: 'Council repair pipeline',
        messageType: 'repair_packet',
        repairPacket: body.packet,
      }])
      setFamilyDuty(prev => ({
        ...prev,
        chatgpt: 'working',
        claude: 'working',
        grok: 'working',
        gemini: 'working',
        red_team: 'working',
        baby: 'working',
        bridge_architect: 'waiting_approval',
      }))
      addSystemMessage('Repair packet creation logged. Engineering Lane is manual copy only; no code was executed or mutated.', { force: true })
      void refreshLedger()
    } catch (error) {
      addSystemMessage(error instanceof Error ? error.message : 'Repair packet generation failed.', { force: true })
    }
  }

  const generateRepairPacketFromCompression = () => {
    const repair = compressedCouncilSummary.repairPacket
    const latestResponse = [...messagesRef.current].reverse().find(isCouncilFamilyResponse)
    void prepareRepairPacketFromCouncilMessage({
      id: latestResponse?.id ?? createMessageId('compressed-repair-source'),
      familyName: latestResponse?.familyName ?? 'COUNCIL COMPRESSION',
      content: repair
        ? [
            `Symptom: ${repair.symptom}`,
            `Root cause: ${repair.rootCause}`,
            `Fix plan: ${repair.fixPlan.join('; ')}`,
          ].join('\n')
        : compressedCouncilSummary.nextAction,
      timestamp: new Date().toLocaleTimeString(),
      color: '#7DD3FC',
      icon: 'R',
      provider: 'Council compression',
      messageType: 'response',
    })
  }

  const generateRevenueActionPacket = () => {
    const revenue = compressedCouncilSummary.revenuePacket
    if (!revenue?.applicable) return
    addRaelAction({
      action_id: `revenue-action-${Date.now()}`,
      related_opportunity_id: null,
      title: 'Revenue action packet',
      question: [
        `Opportunity: ${revenue.opportunity}`,
        `Leverage score: ${revenue.leverageScore}`,
        `Time-to-money: ${revenue.timeToMoney}`,
        `Next action: ${revenue.nextAction}`,
        `Risk: ${revenue.risk}`,
        `Required evidence: ${revenue.requiredEvidence.join(', ')}`,
      ].join('\n'),
      response_options: ['Approve review', 'Needs evidence', 'Reject'],
      urgency: revenue.leverageScore >= 75 ? 'high' : 'medium',
      expires_at: null,
      source_agent: 'Council Compression',
    })
    addSystemMessage('Revenue action packet queued for Commander approval. No outreach, spend, or income claim was executed.', { force: true })
  }

  const saveLessonCandidateFromCompression = () => {
    const candidate =
      compressedCouncilSummary.evidence.find(item => /lesson|pattern|durable|remember/i.test(item.text))
      ?? compressedCouncilSummary.evidence[0]
    if (!candidate) return
    addRaelAction({
      action_id: `lesson-candidate-${Date.now()}`,
      related_opportunity_id: null,
      title: 'Baby Observer lesson candidate',
      question: `Save as durable lesson candidate after approval? ${candidate.text}`,
      response_options: ['Approve lesson candidate', 'Hold for outcome', 'Reject'],
      urgency: 'medium',
      expires_at: null,
      source_agent: 'Baby Observer',
    })
    addSystemMessage('Lesson candidate queued for approval. Durable memory was not written automatically.', { force: true })
  }

  useEffect(() => {
    if (!loading) return
    const timeoutId = window.setTimeout(() => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      setTypingFamily(null)
      councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: false })
      addSystemMessageRef.current?.('Council wait limit reached. Input released.')
      setLoading(false)
    }, 75_000)
    return () => window.clearTimeout(timeoutId)
  }, [loading, councilDispatch])

  const mergeCouncilConversationMetadata = async (patch: Record<string, unknown>) => {
    if (!liveCouncilConvId || !persistenceAvailable) return
    try {
      await fetch(`/api/conversations/${liveCouncilConvId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeMetadata: true, metadata: { council: patch } }),
      })
    } catch {
      /* ignore */
    }
  }

  const maybeEnqueueGeminiRepairIfNeeded = async (gemRow: EngineStatus | undefined | null) => {
    if (!gemRow?.configured || gemRow.functional) return
    const misconfig = (gemRow.reachable && !gemRow.functional) || (!gemRow.reachable && gemRow.configured)
    if (!misconfig) return
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(GEMINI_REPAIR_ENQUEUE_METADATA_KEY) === '1') {
      return
    }
    try {
      const res = await fetch('/api/actions/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'sentinel_watch',
          payload: {
            title: 'Repair Gemini generateContent provider path.',
            subject: 'gemini_provider',
            detail: 'Repair generateContent path',
          },
          conversationId: liveCouncilConvId,
        }),
      })
      let repairQueueJson: { persisted?: boolean; queued?: boolean } = {}
      try {
        repairQueueJson = (await res.json()) as { persisted?: boolean; queued?: boolean }
      } catch {
        repairQueueJson = {}
      }
      if (!isActionQueuePostSucceeded(res, repairQueueJson)) return
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(GEMINI_REPAIR_ENQUEUE_METADATA_KEY, '1')
      }
      void mergeCouncilConversationMetadata({ [GEMINI_REPAIR_ENQUEUE_METADATA_KEY]: true })
      void refreshQueueActions()
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (operatorTab !== 'agents' && operatorTab !== 'diagnostics' && operatorTab !== 'system') return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/engine-control/status', { cache: 'no-store' })
        const json = await res.json() as EngineControlStatusResponse & { message?: string }
        if (cancelled || !res.ok) return
        engineMapRef.current = engineRowMap(json.engines)
        setEngineList(json.engines)
        const g = json.engines.find(e => e.id === 'gemini')
        setGeminiEngineRow(g ?? null)
        geminiFunctionalRef.current = Boolean(g?.functional)
        if (g?.functional) skipGeminiForSessionRef.current = false
        void maybeEnqueueGeminiRepairIfNeeded(g)
      } catch {
        /* keep defaults until Engine Control refresh */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operatorTab]) // eslint-disable-line react-hooks/exhaustive-deps -- tab-scoped engine status + repair scan

  const postLiveCouncilMessage = async (
    input: { role: 'user' | 'assistant' | 'system'; content: string; family?: string | null },
    opts?: {
      applyAttendanceLateGatherSkip?: boolean
      responseSuccessful?: boolean
      providerRuntime?: ProviderFamilyOutcomeStatus
      transientProviderStatus?: boolean
      allowProviderFailureMessage?: boolean
      directInvocationMetadata?: Record<string, unknown>
    },
  ): Promise<string | null> => {
    if (
      opts?.applyAttendanceLateGatherSkip
      && attendanceSoftGatherUiClosedRef.current
    ) {
      return null
    }
    if (
      !opts?.allowProviderFailureMessage
      &&
      (input.role === 'system' || input.role === 'assistant')
      && shouldSuppressProviderFailureFromChatStream(input.content, { diagnosticsOpen: operatorTab === 'diagnostics' })
    ) {
      return null
    }
    const persistable = councilMessageFromLivePost(input, {
      responseSuccessful: opts?.responseSuccessful,
      providerRuntime: opts?.providerRuntime,
    })
    if (!shouldPersistCouncilMessage(persistable, councilPersistenceCtx)) return null
    if (!liveCouncilConvId || !persistenceAvailable) return null
    try {
      const res = await fetch(`/api/conversations/${liveCouncilConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: input.role,
          content: input.content,
          family: input.family ?? null,
          metadata: {
            responseSuccessful: opts?.responseSuccessful === true,
            ...(opts?.providerRuntime ? { providerRuntime: opts.providerRuntime } : {}),
            ...(opts?.transientProviderStatus ? { transientProviderStatus: true } : {}),
            ...(opts?.directInvocationMetadata ? { directInvocation: opts.directInvocationMetadata } : {}),
          },
        }),
      })
      if (!res.ok) return null
      const data = await res.json() as { message?: { id?: unknown } }
      return typeof data.message?.id === 'string' ? data.message.id : null
    } catch {
      /* session fallback */
      return null
    }
  }

  useEffect(() => {
    if (!persistenceAvailable || !liveCouncilConvId || archivedCouncilMessages.length === 0) return
    const batch = archivedCouncilMessages.filter(message => !archivedMessageIdsRef.current.has(message.id))
    if (!batch.length) return

    batch.forEach(message => archivedMessageIdsRef.current.add(message.id))
    const latestDecree = [...messagesRef.current].reverse().find(isRaelCouncilMessage)

    void fetch('/api/memory/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: liveCouncilConvId,
        createSummary: true,
        messages: batch.map(message => ({
          id: message.id,
          sessionId: liveCouncilConvId,
          decreeId: latestDecree?.id ?? null,
          timestamp: new Date().toISOString(),
          role: archiveRoleForMessage(message),
          family: message.familyName,
          provider: message.provider || null,
          content: message.content,
          messageType: message.messageType,
          tags: [message.messageType, message.familyName].filter(Boolean),
          topic: archiveTopicForMessage(message),
          sourceMode: 'live_chat_window',
          operatorId: null,
          operatorName: "Ra'el",
          visibility: 'private',
        })),
      }),
    }).catch(() => {
      batch.forEach(message => archivedMessageIdsRef.current.delete(message.id))
    })
  }, [archivedCouncilMessages, liveCouncilConvId, persistenceAvailable])

  const isTransientProviderStatusContent = (
    content: unknown,
    family: CouncilOrchestrationFamily,
    opts?: { includeGenericRecovery?: boolean },
  ) => {
    const text = compactDisplayWhitespace(content)
    if (!text) return false
    if (opts?.includeGenericRecovery && /^Recovery ping requested\.$/i.test(text)) return true

    const label = COUNCIL_ROSTER.find(r => r.id === family)?.label ?? family
    const normalized = text.toLowerCase()
    const normalizedLabel = label.toLowerCase()
    const startsWithFamily =
      normalized.startsWith(`${normalizedLabel}:`)
      || normalized.startsWith(`${normalizedLabel} has `)
      || normalized.startsWith(`${normalizedLabel} pending`)
    if (!startsWithFamily) return false

    return /\b(engine status unknown|unavailable|has not responded yet|pending|provider returned timeout|provider call failed|not configured|configured|not reachable|reachable|client_abort_or_budget|cloud_provider_unavailable|engine_unavailable|empty_response|cloud_provider_failed|recovery)\b/i.test(text)
  }

  const collectTransientProviderStatusMessageIds = (args: {
    family: CouncilOrchestrationFamily
    messageIds?: string[]
    includeGenericRecovery?: boolean
    keepMessageIds?: string[]
    contentFallback?: boolean
  }): string[] => {
    const ids = new Set(args.messageIds ?? [])
    const keepIds = new Set(args.keepMessageIds ?? [])
    const latestRaelIndex = messagesRef.current.findLastIndex(isRaelCouncilMessage)
    const removeIds: string[] = []
    for (let index = 0; index < messagesRef.current.length; index += 1) {
      const message = messagesRef.current[index]!
      if (keepIds.has(message.id)) continue
      if (index <= latestRaelIndex) continue
      const matchesTrackedId = ids.has(message.id)
      const matchesTransientStatus =
        args.contentFallback === true
        && message.familyName === 'SYSTEM'
        && isTransientProviderStatusContent(message.content, args.family, {
          includeGenericRecovery: args.includeGenericRecovery,
        })
      if (matchesTrackedId || matchesTransientStatus) {
        removeIds.push(message.id)
      }
    }
    return removeIds
  }

  const terminalReasonForDirectInvocation = (
    cell: { runtime: ProviderFamilyOutcomeStatus; runtimeDetail?: string; textOut: string | null },
  ): 'timeout' | 'unavailable' | 'error' | 'no_response' => {
    const detail = cell.runtimeDetail ?? ''
    if (cell.runtime === 'TIMED_OUT' || /\b(timeout|timed\s+out|abort|deadline)\b/i.test(detail)) return 'timeout'
    if (cell.runtime === 'SKIPPED' || /\b(unavailable|not configured|engine status unknown|engine_unavailable|cloud_provider_unavailable)\b/i.test(detail)) return 'unavailable'
    if (cell.runtime === 'FAILED' && detail.trim()) return 'error'
    return 'no_response'
  }

  const terminalTextForDirectInvocation = (
    family: CouncilOrchestrationFamily,
    reason: 'timeout' | 'unavailable' | 'error' | 'no_response',
    detail?: string,
  ): string => {
    const label = COUNCIL_ROSTER.find(r => r.id === family)?.label ?? family
    if (reason === 'timeout') {
      return family === 'grok' ? 'Grok Family timed out after 25s.' : `${label} timed out.`
    }
    if (reason === 'unavailable') return `${label} unavailable.`
    if (reason === 'error') {
      const clean = compactDisplayWhitespace(detail, 180)
      return clean ? `${label}: ${clean}` : `${label} unavailable.`
    }
    return `${label} did not return a response in time.`
  }

  const emitDirectInvocationTerminalDebug = (metadata: {
    directInvocationTarget: CouncilOrchestrationFamily
    finalVisibleMessageEmitted: boolean
    temporaryMessagesRemoved: number
    placeholdersRemoved: number
    terminalReason: 'success' | 'timeout' | 'unavailable' | 'error' | 'no_response'
    terminalVisibleMessageExists: boolean
    terminalFallbackInserted: boolean
    packetCloseAllowed: boolean
  }) => {
    console.debug('[Live Council] direct_invocation_terminal', metadata)
    void fetch('/api/events/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'audit.logged',
        source: 'system',
        payload: metadata,
      }),
    }).catch(() => undefined)
  }

  const emitDecreeEvents = async (decree: string, shouldEmit: boolean) => {
    if (!shouldEmit) return
    const gate = standingPostExtra('audit_logging')
    if (!gate.proceed) {
      if (gate.needsAck && gate.ackMessage) {
        setStandingAckHint(gate.ackMessage)
        pendingAuditDecreeRef.current = decree
      }
      return
    }
    const extra = gate.extra
    const base = { decreePreview: decree.slice(0, 400), conversationId: liveCouncilConvId }
    await fetch('/api/events/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'command.received', payload: base, source: 'user', ...extra }),
    }).catch(() => undefined)
    await fetch('/api/events/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'command.routed',
        payload: { ...base, target: 'live_council' },
        source: 'user',
        ...extra,
      }),
    }).catch(() => undefined)
    void refreshLedger()
  }

  const runInternetMonitorOnce = async () => {
    const gate = standingPostExtra('engine_probe')
    if (!gate.proceed) {
      if (gate.needsAck && gate.ackMessage) setStandingAckHint(gate.ackMessage)
      return
    }
    const { extra } = gate
    setInternetMonitorBusy(true)
    try {
      await fetch('/api/workers/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId: 'internet_monitor', ...extra }),
      })
      void refreshLedger()
    } finally {
      setInternetMonitorBusy(false)
    }
  }

  const addRaelAction = (action: Omit<RaelActionItem, 'created_at' | 'status'> & { status?: RaelActionStatus; created_at?: string }) => {
    const createdAt = action.created_at ?? new Date().toISOString()
    const queuedAction = {
      ...action,
      status: action.status ?? 'pending',
      created_at: createdAt,
    }

    setRaelActions(prev => {
      const existingPendingAction = prev.find(item => item.action_id === action.action_id && item.status === 'pending')
      if (existingPendingAction) return prev

      return [queuedAction, ...prev].slice(0, 24)
    })

    void fetch('/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queuedAction),
    }).catch(() => undefined)
  }

  const respondToRaelAction = (actionId: string, response: string) => {
    const answeredAt = new Date().toISOString()

    setRaelActions(prev => prev.map(action => (
      action.action_id === actionId
        ? {
          ...action,
          status: 'answered',
          selected_response: response,
          answered_at: answeredAt,
        }
        : action
    )))
    void fetch(`/api/actions/${encodeURIComponent(actionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'answered', answer: response, answered_at: answeredAt }),
    }).catch(() => undefined)
    addSystemMessage(`Ra'el answered action queue: ${response}`)
  }

  const sendSmsNotification = async (message: string) => {
    setSmsBridge(prev => ({ ...prev, sending: true, message: 'Sending SMS notification...' }))
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await res.json()

      if (!res.ok) {
        setSmsBridge(prev => ({
          ...prev,
          status: data.status === 'not_configured' ? 'not configured' : 'error',
          message: data.message ?? 'SMS notification failed',
          sending: false,
        }))
        return
      }

      setSmsBridge({
        status: 'online',
        lastNotification: data.sentAt ?? new Date().toISOString(),
        message: data.message ?? 'SMS notification sent',
        sending: false,
      })
    } catch {
      setSmsBridge(prev => ({
        ...prev,
        status: 'error',
        message: 'SMS notification failed',
        sending: false,
      }))
    }
  }

  const testSmsBridge = () => {
    void sendSmsNotification('War Room SMS Bridge test. Reply STATUS to confirm command handling.')
  }

  const notifyRaelAction = (action: RaelActionItem) => {
    const options = action.response_options.join(' / ')
    void sendSmsNotification(`War Room needs Ra'el: ${action.title}. ${action.question} Reply options: ${options}.`)
  }

  useEffect(() => {
    addSystemMessageRef.current = addSystemMessage
  })

  useEffect(() => {
    raelActionsRef.current = raelActions
  }, [raelActions])

  useEffect(() => {
    if (operatorTab !== 'approvals') return
    const expireActions = window.setInterval(() => {
      const now = Date.now()
      const expiredActions = raelActionsRef.current.filter(action => (
        action.status === 'pending' && action.expires_at && new Date(action.expires_at).getTime() <= now
      ))

      expiredActions.forEach(action => {
        void fetch(`/api/actions/${encodeURIComponent(action.action_id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'expired' }),
        }).catch(() => undefined)
      })

      setRaelActions(prev => prev.map(action => (
        action.status === 'pending' && action.expires_at && new Date(action.expires_at).getTime() <= now
          ? { ...action, status: 'expired' }
          : action
      )))
    }, 120_000)

    return () => window.clearInterval(expireActions)
  }, [operatorTab])

  const endToolRequest = () => {
    if (toolTimeoutRef.current !== null) {
      window.clearTimeout(toolTimeoutRef.current)
      toolTimeoutRef.current = null
    }
    toolRequestActiveRef.current = false
    activeToolSystemMessageRef.current = null
    setToolRequestActive(false)
    setToolBarActivity(prev => {
      const next = { ...prev }
      delete next.web
      delete next.research
      return next
    })
    const snap = councilSnapRef.current
    if (snap.councilState === 'researching') {
      councilDispatch({ type: 'SET_COUNCIL_STATE', payload: snap.councilChannelOpen ? 'active' : 'idle' })
      void loadInternetStatusRef.current()
    }
  }

  const beginToolRequest = (controller: AbortController) => {
    if (toolRequestActiveRef.current) return false

    councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'researching' })
    toolRequestActiveRef.current = true
    setToolRequestActive(true)
    setToolBarActivity(prev => ({ ...prev, web: 'SCANNING', research: 'SCANNING' }))

    if (activeToolSystemMessageRef.current !== 'Web Research initiated') {
      activeToolSystemMessageRef.current = 'Web Research initiated'
      addSystemMessage('Web Research initiated')
    }

    toolTimeoutRef.current = window.setTimeout(() => {
      addSystemMessage('Research timed out.')
      controller.abort()
      endToolRequest()
      setTypingFamily(null)
      setPresence('CHATGPT FAMILY', 'idle', 'standby')
      setPresence('CLAUDE FAMILY', 'idle', 'standby')
      setPresence('GROK FAMILY', 'idle', 'standby')
      setPresence('GEMINI FAMILY', 'idle', 'standby')
      setPresence('KIMI FAMILY', 'idle', 'standby')
      setPresence('BRIDGE ARCHITECT', 'idle', 'standby')
      setLoading(false)
    }, TOOL_REQUEST_TIMEOUT_MS)

    return true
  }

  const cancelActiveCouncilRequest = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setTypingFamily(null)
    setPresence('CHATGPT FAMILY', 'idle', 'standby')
    setPresence('CLAUDE FAMILY', 'idle', 'standby')
    setPresence('GROK FAMILY', 'idle', 'standby')
    setPresence('GEMINI FAMILY', 'idle', 'standby')
    setPresence('KIMI FAMILY', 'idle', 'standby')
    setPresence('BRIDGE ARCHITECT', 'idle', 'standby')
    endToolRequest()
    setLoading(false)
  }

  const loadMemories = async () => {
    setToolBarActivity(prev => ({ ...prev, memory: 'ACTIVE' }))
    try {
      const res = await fetch('/api/tools/memory')
      const data = await res.json() as {
        memories?: MemoryEntry[]
        message?: string
        runtime?: ReturnType<typeof mapRawMemoryRuntimeState>
      }
      if (!res.ok) throw new Error(data.message || 'Memory retrieval failed')
      setMemories(data.memories ?? [])
      if (data.runtime?.sessionOnly) {
        setMemoryNotification(data.runtime.commanderPhrase)
        window.setTimeout(() => setMemoryNotification(null), 2400)
      }
    } catch {
      setToolBarHealth(prev => ({ ...prev, memory: 'ERROR' }))
    } finally {
      setToolBarActivity(prev => {
        const next = { ...prev }
        delete next.memory
        return next
      })
      void refreshToolBarHealthBars()
    }
  }

  const loadIncomeOpportunities = async () => {
    setIncomeLoading(true)
    try {
      const res = await fetch('/api/income/opportunities')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Income opportunities retrieval failed')
      setIncomeOpportunities(data.opportunities ?? [])
    } catch {
      setIncomeOpportunities([])
    } finally {
      setIncomeLoading(false)
    }
  }

  const loadWarRoomFiles = async () => {
    try {
      const res = await fetch('/api/files')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Files retrieval failed')
      setWarRoomFiles(Array.isArray(data.files) ? data.files : [])
      setFilesMessage(null)
    } catch (error) {
      setWarRoomFiles([])
      setFilesMessage(error instanceof Error ? error.message : 'Files retrieval failed')
    }
  }

  const uploadWarRoomFile = async (formData: FormData) => {
    setFilesLoading(true)
    setFilesMessage(null)
    setToolBarActivity(prev => ({ ...prev, files: 'ACTIVE' }))
    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'File upload failed')
      if (data.file) {
        setWarRoomFiles(prev => [data.file, ...prev])
      }
      setFilesMessage(data.message ?? 'File uploaded')
    } catch (error) {
      setFilesMessage(error instanceof Error ? error.message : 'File upload failed')
    } finally {
      setFilesLoading(false)
      setToolBarActivity(prev => {
        const next = { ...prev }
        delete next.files
        return next
      })
      void refreshToolBarHealthBars()
    }
  }

  const scanRepo = async () => {
    setToolBarActivity(prev => ({ ...prev, repo: 'SCANNING' }))
    setRepoAwareness(prev => ({
      ...prev,
      scanStatus: 'scanning',
      repoStatus: 'scanning',
      message: 'Scanning app, components, lib, and supabase directories...',
    }))

    let standingBody: Record<string, unknown> = {}
    try {
      const permRes = await fetch('/api/permissions/status', { cache: 'no-store' })
      const perm = await permRes.json() as { mode?: string; safetyLock?: boolean }
      if (
        permRes.ok
        && (perm.mode === 'manual' || perm.mode === 'operator' || perm.mode === 'commander')
      ) {
        const mode = perm.mode as StandingPermissionMode
        const snap = { mode, safetyLock: Boolean(perm.safetyLock) }
        const gate = resolveStandingPostExtra(snap, 'repo_scan_readonly')
        if (!gate.proceed) {
          if (gate.needsAck && gate.ackMessage) setStandingAckHint(gate.ackMessage)
          setRepoAwareness(prev => ({
            ...prev,
            scanStatus: 'idle',
            repoStatus: 'idle',
            message: gate.ackMessage ?? 'Repo scan requires standing approval — use the permission strip above, then retry.',
          }))
          setToolBarActivity(prev => {
            const next = { ...prev }
            delete next.repo
            return next
          })
          void refreshToolBarHealthBars()
          return
        }
        standingBody = gate.extra
      }
    } catch {
      /* server still enforces standing gate */
    }

    try {
      const res = await fetch('/api/repo/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standingBody),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Repo scan failed')

      setRepoAwareness({
        ...INITIAL_REPO_AWARENESS_STATE,
        ...data.scan,
        scanStatus: 'indexed',
        message: `Indexed in ${data.scan?.durationMs ?? 0}ms.`,
      })
    } catch (error) {
      setRepoAwareness(prev => ({
        ...prev,
        scanStatus: 'error',
        repoStatus: 'scan error',
        message: error instanceof Error ? error.message : 'Repo scan failed',
      }))
    } finally {
      setToolBarActivity(prev => {
        const next = { ...prev }
        delete next.repo
        return next
      })
      void refreshToolBarHealthBars()
    }
  }

  const loadProviderHealth = async () => {
    try {
      const res = await fetch('/api/runtime/canonical-status', { cache: 'no-store' })
      const data = await res.json() as {
        providers?: { family: ProviderFamilyKey; connectionStatus: ProviderConnectionStatus; label: string }[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Canonical provider status failed')
      const prov = { ...INITIAL_PROVIDER_HEALTH.providers }
      const lab = { ...INITIAL_PROVIDER_HEALTH.labels }
      for (const row of data.providers ?? []) {
        if (row.family in prov) {
          prov[row.family] = row.connectionStatus
          lab[row.family] = row.label
        }
      }
      setProviderHealth({ providers: prov, labels: lab })
    } catch {
      setProviderHealth(prev => ({
        ...prev,
        providers: {
          ...prev.providers,
          claude: 'error',
          chatgpt: 'error',
          grok: 'error',
        },
      }))
    }
  }


  const loadInternetStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/tools/internet/status', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Internet status failed')
      setInternetStatus(data)
    } catch {
      setInternetStatus(prev => ({
        ...prev,
        lastChecked: new Date().toISOString(),
        overallStatus: 'unknown',
        label: 'Unknown',
        canUseInternet: false,
      }))
    }
  }, [])
  loadInternetStatusRef.current = loadInternetStatus

  const loadRepoStatus = async () => {
    try {
      const res = await fetch('/api/repo/status')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Repo status failed')
      setRepoStatus(data)
    } catch {
      setRepoStatus(prev => ({ ...prev, checkedAt: new Date().toISOString() }))
    }
  }

  const loadRollbackStatus = async () => {
    try {
      const res = await fetch('/api/repo/rollback/status')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Rollback status failed')
      setRollbackStatus(data)
    } catch {
      setRollbackStatus(prev => ({ ...prev, checkedAt: new Date().toISOString() }))
    }
  }

  const loadDiffPreview = async () => {
    setDiffPreviewLoading(true)
    setDiffPreviewError(null)
    try {
      const params = new URLSearchParams()
      if (diffPreviewStaged) params.set('staged', '1')
      const paths = repoStatus.changedFiles.map(f => f.path).filter(Boolean)
      if (paths.length) params.set('paths', paths.join(','))
      const res = await fetch(`/api/repo/diff/preview?${params.toString()}`)
      const data = await res.json() as DiffPreviewResponse & { message?: string }
      if (!res.ok) throw new Error(data.message || 'Diff preview failed')
      setDiffPreview(data)
    } catch (error) {
      setDiffPreviewError(error instanceof Error ? error.message : 'Diff preview failed')
    } finally {
      setDiffPreviewLoading(false)
    }
  }

  const createRollbackCheckpoint = async () => {
    try {
      const res = await fetch('/api/repo/rollback/checkpoint', { method: 'POST' })
      const data = await res.json() as { message?: string }
      if (!res.ok) throw new Error(data.message || 'Checkpoint creation failed')
      await loadRollbackStatus()
      await loadRepoStatus()
    } catch {
      setRollbackStatus(prev => ({
        ...prev,
        message: 'Checkpoint request failed. See server logs.',
        checkedAt: new Date().toISOString(),
      }))
    }
  }

  const loadDeployStatus = async () => {
    try {
      const res = await fetch('/api/deploy/status')
      const data = (await res.json()) as DeployStatusResponse & { message?: string }
      if (!res.ok) throw new Error(data.message || 'Deploy status failed')
      setDeployStatus(data)
    } catch {
      setDeployStatus((prev: DeployStatusResponse) => ({ ...prev, checkedAt: new Date().toISOString() }))
    }
  }

  const loadRaelActions = async () => {
    try {
      const res = await fetch('/api/actions')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Rael action queue retrieval failed')

      const actions = Array.isArray(data.actions) ? data.actions : []
      setRaelActions(actions.map((action: RaelActionItem & { answer?: string | null }) => ({
        ...action,
        selected_response: action.answer ?? action.selected_response,
      })))
    } catch {
      setRaelActions([])
    }
  }

  useEffect(() => {
    loadMemoriesRef.current = loadMemories
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRaelActions()
      void loadProviderHealth()
      void loadInternetStatus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadInternetStatus])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setContinuityMode('Refreshing')
      const r = await fetchRuntimeRecoveryBundle()
      if (cancelled) return
      if (!r.persistenceConfigured) {
        setContinuityMode('Unknown')
        setRecoverRuntimeBanner(false)
        setRuntimePersistenceBanner(r.error ?? null)
        setContinuityRecoverAt(null)
        setRecoveredIntegrityPartial(null)
        setRecoveredAttendanceSummary(null)
        setRecoveredDiagnosticHistory([])
        setRecoveredRedTeamHold(null)
        return
      }
      if (Array.isArray(r.fallbackEngines) && r.fallbackEngines.length > 0) {
        engineMapRef.current = engineRowMap(r.fallbackEngines)
        setEngineList(r.fallbackEngines)
        const g = r.fallbackEngines.find(e => e.id === 'gemini')
        if (g) {
          setGeminiEngineRow(g)
          geminiFunctionalRef.current = Boolean(g.functional)
          if (g.functional) skipGeminiForSessionRef.current = false
        }
      }
      if (r.runtimeStateTableMissing || r.runtimeStateReadFailed) {
        setRuntimePersistenceBanner(
          r.runtimeStateTableMissing
            ? 'Runtime state unavailable (storage table missing) — council uses live registry engine status.'
            : 'Runtime state unavailable — council uses live registry engine status.',
        )
      } else {
        setRuntimePersistenceBanner(null)
      }
      if (r.bundle) {
        setRecoverRuntimeBanner(true)
        setContinuityRecoverAt(r.bundle.recoveredFromStorageAt)
        setRecoveredIntegrityPartial((r.bundle.integrityPartial as RuntimeIntegrityPartial | null) ?? null)
        setRecoveredAttendanceSummary((r.bundle.attendanceSummary as RuntimeAttendanceSummary | null) ?? null)
        setRecoveredDiagnosticHistory(Array.isArray(r.bundle.diagnosticHistory) ? r.bundle.diagnosticHistory : [])
        setRecoveredRedTeamHold((r.bundle.redTeamHoldUnresolved as RedTeamHoldUnresolvedPayload | null) ?? null)
        setContinuityMode('Historical')
      } else {
        setRecoverRuntimeBanner(false)
        setContinuityRecoverAt(null)
        setRecoveredIntegrityPartial(null)
        setRecoveredAttendanceSummary(null)
        setRecoveredDiagnosticHistory([])
        setRecoveredRedTeamHold(null)
        setContinuityMode('Refreshing')
      }
      await Promise.all([
        fetchToolBarHealth().then(setToolBarHealth).catch(() => undefined),
        loadProviderHealth(),
        loadInternetStatus(),
      ])
      try {
        const ir = await fetch('/api/runtime/integrity', { cache: 'no-store' })
        if (!cancelled && ir.ok) {
          await ir.json()
          setRecoveredIntegrityPartial(null)
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        setContinuityMode('Live')
        setRecoverRuntimeBanner(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadInternetStatus])

  useEffect(() => {
    const bump = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void loadInternetStatus()
      }
    }
    document.addEventListener('visibilitychange', bump)
    window.addEventListener('pageshow', bump)
    return () => {
      document.removeEventListener('visibilitychange', bump)
      window.removeEventListener('pageshow', bump)
    }
  }, [loadInternetStatus])

  const createIncomeOpportunity = async (opportunity: Omit<IncomeOpportunity, 'id' | 'created_at'>) => {
    setIncomeLoading(true)
    try {
      const res = await fetch('/api/income/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opportunity),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Income opportunity save failed')
      if (data.opportunity) {
        setIncomeOpportunities(prev => [data.opportunity, ...prev])
      }
    } finally {
      setIncomeLoading(false)
    }
  }

  const markIncomeOpportunityExpired = async (id: string) => {
    setIncomeLoading(true)
    try {
      const res = await fetch('/api/income/opportunities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: false, expires_at: new Date().toISOString() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Income opportunity update failed')
      if (data.opportunity) {
        setIncomeOpportunities(prev => prev.map(opportunity => (
          opportunity.id === id ? data.opportunity : opportunity
        )))
      }
    } finally {
      setIncomeLoading(false)
    }
  }

  const runOpportunityScout = async () => {
    if (opportunityScoutLoading) return

    setOpportunityScoutLoading(true)
    setOpportunityScout(prev => ({
      ...prev,
      status: 'searching',
      message: 'Opportunity Scout scanning provider status...',
      lastScanTime: new Date().toISOString(),
      providerUsed: 'tavily',
    }))

    window.setTimeout(() => {
      setOpportunityScout(prev => (
        prev.status === 'searching'
          ? { ...prev, status: 'reviewing', message: 'Opportunity Scout reviewing live results...' }
          : prev
      ))
    }, 600)

    try {
      const res = await fetch('/api/income/scout', { method: 'POST' })
      const data = await res.json()
      setOpportunityScout({
        status: data.status ?? (res.ok ? 'found' : 'error'),
        message: data.message ?? 'Opportunity Scout scan complete.',
        lastScanTime: data.lastScanTime ?? new Date().toISOString(),
        sourcesChecked: Number(data.sourcesChecked ?? 0),
        opportunitiesFound: Number(data.opportunitiesFound ?? 0),
        opportunitiesRejected: Number(data.opportunitiesRejected ?? 0),
        riskFilterStatus: String(data.riskFilterStatus ?? 'verification required before save'),
        nextScanAction: String(data.nextScanAction ?? 'Connect live search provider'),
        results: Array.isArray(data.opportunities) ? data.opportunities : [],
        providerUsed: String(data.providerUsed ?? data.provider ?? 'none'),
        scanDurationMs: Number(data.scanDurationMs ?? 0),
        providerStatus: {
          tavily: normalizeProviderHealth(data.providerStatus?.tavily),
          firecrawl: normalizeProviderHealth(data.providerStatus?.firecrawl),
        },
      })
      if (Array.isArray(data.opportunities) && data.opportunities.length > 0) {
        addRaelAction({
          action_id: `scout-review-${data.lastScanTime ?? Date.now()}`,
          related_opportunity_id: null,
          title: 'Opportunity Scout review',
          question: `Opportunity Scout found ${data.opportunities.length} candidate opportunities. Review candidates before saving any to Income Radar?`,
          response_options: ['Review now', 'Later', 'Dismiss'],
          urgency: 'medium',
          expires_at: null,
          source_agent: 'Opportunity Scout',
        })
      }
    } catch {
      setOpportunityScout(prev => ({
        ...prev,
        status: 'error',
        message: 'Opportunity Scout needs a live search provider connected.',
        lastScanTime: new Date().toISOString(),
        nextScanAction: 'Connect live search provider',
        results: [],
        providerUsed: 'none',
      }))
    } finally {
      setOpportunityScoutLoading(false)
    }
  }

  const runIncomeWorkerScout = async () => {
    if (incomeWorkerLoading) return
    setIncomeWorkerLoading(true)
    setIncomeWorkerScout(prev => ({
      ...prev,
      status: 'no_results',
      executionState: 'scouting',
      message: 'Income Workers scanning real source-linked opportunities...',
      scannedAt: new Date().toISOString(),
      activityLog: [{ at: new Date().toISOString(), message: '[Income Worker] Scout execution started' }],
    }))

    try {
      const res = await fetch('/api/income-workers/scout', { method: 'POST' })
      const data = await res.json() as IncomeWorkerScoutResult & {
        message?: string
        councilReviews?: IncomeCouncilReview[]
        state?: IncomeWorkerScoutResult['executionState']
      }
      const candidates = Array.isArray(data.candidates) ? data.candidates : []
      setIncomeWorkerScout({
        status: candidates.length > 0 ? 'found' : (data.status ?? 'no_results'),
        message: data.message ?? 'Income Worker scout complete.',
        scannedAt: data.scannedAt ?? new Date().toISOString(),
        providerUsed: data.providerUsed ?? 'none',
        sourcesChecked: Number(data.sourcesChecked ?? 0),
        candidates,
        rejected: Array.isArray(data.rejected) ? data.rejected : [],
        executionState: data.executionState ?? data.state ?? (candidates.length ? 'awaiting_commander_review' : 'failed'),
        diagnostics: data.diagnostics,
        activityLog: Array.isArray(data.activityLog) ? data.activityLog : [],
        degradedMode: Boolean(data.degradedMode),
        opportunityPackets: Array.isArray(data.opportunityPackets) ? data.opportunityPackets : [],
      })
      setIncomeCouncilReviews(Array.isArray(data.councilReviews) ? data.councilReviews : [])
      if (candidates.length > 0) {
        addRaelAction({
          action_id: `income-worker-scout-${data.scannedAt ?? Date.now()}`,
          related_opportunity_id: null,
          title: 'Income Worker scout review',
          question: `Income Workers surfaced ${candidates.length} opportunities${data.degradedMode ? ' (degraded / historical pattern mode)' : ''}. Review before queueing missions?`,
          response_options: ['Review now', 'Later', 'Dismiss'],
          urgency: data.degradedMode ? 'medium' : 'low',
          expires_at: null,
          source_agent: 'Income Workers',
        })
      }
    } catch {
      setIncomeWorkerScout(prev => ({
        ...prev,
        status: 'error',
        executionState: 'failed',
        message: 'Income Worker scout could not reach the server. Retry or check API route.',
        scannedAt: new Date().toISOString(),
        candidates: prev.candidates.length ? prev.candidates : [],
        activityLog: [
          ...(prev.activityLog ?? []),
          { at: new Date().toISOString(), message: '[Income Worker] Scout request failed — no silent empty state' },
        ],
      }))
    } finally {
      setIncomeWorkerLoading(false)
    }
  }

  const assignIncomeWorkerCandidate = async (candidate: IncomeWorkerCandidate) => {
    if (incomeWorkerAssignLoading) return
    setIncomeWorkerAssignLoading(true)
    try {
      const res = await fetch('/api/income-workers/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate, workerId: candidate.eligibleWorkers[0] }),
      })
      const data = await res.json() as { message?: string }
      if (!res.ok) throw new Error(data.message || 'Income worker assignment failed')
      const review = (data as { councilReview?: IncomeCouncilReview | null }).councilReview
      if (review) {
        setIncomeCouncilReviews(prev => [review, ...prev.filter(item => item.opportunityId !== review.opportunityId)])
      }
      await loadRaelActions()
      await loadPaymentLedger()
    } catch {
      addSystemMessage('Income Worker assignment could not be queued.')
    } finally {
      setIncomeWorkerAssignLoading(false)
    }
  }

  const loadPaymentLedger = async () => {
    try {
      const [statusRes, ledgerRes] = await Promise.all([
        fetch('/api/payments/status', { cache: 'no-store' }),
        fetch('/api/payments/ledger', { cache: 'no-store' }),
      ])
      const statusData = await statusRes.json() as { providers?: PaymentProviderReadiness[] }
      const ledgerData = await ledgerRes.json() as {
        ledger?: DepositRecord[]
        redSentinel?: PaymentLedgerState['redSentinel']
        message?: string
        persistenceLabel?: string
      }
      setPaymentLedger({
        deposits: Array.isArray(ledgerData.ledger) ? ledgerData.ledger : [],
        providers: Array.isArray(statusData.providers) ? statusData.providers : [],
        persistenceLabel: ledgerData.persistenceLabel ?? 'Session-only fallback',
        redSentinel: ledgerData.redSentinel ?? INITIAL_PAYMENT_LEDGER_STATE.redSentinel,
        message: ledgerData.message ?? 'Payment ledger loaded.',
      })
    } catch {
      setPaymentLedger(prev => ({ ...prev, message: 'Payment ledger unavailable.' }))
    }
  }

  const notifyDeposit = async (depositId: string) => {
    try {
      const res = await fetch('/api/payments/deposits/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositId }),
      })
      const data = await res.json() as { message?: string }
      if (!res.ok) throw new Error(data.message || 'Deposit notification failed')
      await loadPaymentLedger()
    } catch {
      addSystemMessage('Deposit notification could not be logged.')
    }
  }

  const saveMemory = async (memory: Omit<MemoryEntry, 'id' | 'created_at'>) => {
    setToolBarActivity(prev => ({ ...prev, memory: 'ACTIVE' }))
    try {
      const res = await fetch('/api/tools/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memory),
      })
      const data = await res.json() as {
        memory?: MemoryEntry
        message?: string
        runtime?: ReturnType<typeof mapRawMemoryRuntimeState>
      }
      if (!res.ok) throw new Error(data.message || 'Memory save failed')

      const savedMemory = data.memory
      if (savedMemory) {
        setMemories(prev => [savedMemory, ...prev].slice(0, 10))
        addSystemMessage('Memory saved')
        setMemoryNotification('Memory Saved')
        window.setTimeout(() => setMemoryNotification(null), 2400)
        return
      }
      const runtime = data.runtime ?? mapRawMemoryRuntimeState('Memory initialization required')
      addSystemMessage(runtime.commanderPhrase, { force: true })
      setMemoryNotification(runtime.commanderPhrase)
      window.setTimeout(() => setMemoryNotification(null), 2400)
    } catch {
      setToolBarHealth(prev => ({ ...prev, memory: 'ERROR' }))
      addSystemMessage('Session-only learning active', { force: true })
    } finally {
      setToolBarActivity(prev => {
        const next = { ...prev }
        delete next.memory
        return next
      })
      void refreshToolBarHealthBars()
    }
  }

  const streamFamilyMessage = async ({
    familyName,
    bubbleFamilyName,
    content,
    provider,
    messageId,
    thinkingLabel,
    streamingLabel,
    colorOverride,
    iconOverride,
    instant,
    removeMessageIds,
  }: {
    familyName: TypingFamily
    bubbleFamilyName?: string
    content: string
    provider: string
    messageId?: string
    thinkingLabel: string
    streamingLabel: string
    colorOverride?: string
    iconOverride?: string
    /** Skip artificial typing delays (council uses real API latency as primary UX). */
    instant?: boolean
    /** Remove stale placeholders atomically when the final visible response appears. */
    removeMessageIds?: string[]
  }) => {
    const family = colorOverride
      ? { color: colorOverride, icon: iconOverride ?? '•' }
      : FAMILY_META[familyName]
    const label = bubbleFamilyName ?? familyName
    const now = new Date().toLocaleTimeString()
    const resolvedMessageId = messageId || createMessageId(label)
    const orchFamily = parseCouncilMessageFamily(label) ?? parseCouncilMessageFamily(familyName)
    const renderGate = orchFamily ? applyCouncilRenderGate(orchFamily, content) : null
    const visibleContent = renderGate?.displayText ?? content

    if (instant) {
      addMessages([{
        id: resolvedMessageId,
        familyName: label,
        content: visibleContent,
        timestamp: now,
        color: family.color,
        icon: family.icon,
        provider,
        messageType: 'response',
        degraded: renderGate?.degraded,
        integrityStatus: renderGate?.integrityStatus,
        renderDiagnostics: renderGate?.diagnostics,
      }], removeMessageIds?.length ? { removeIds: removeMessageIds } : undefined)
      setPresence(familyName, 'idle', 'standby')
      return
    }

    setPresence(familyName, 'thinking', thinkingLabel)
    setTypingFamily(familyName)
    await wait(
      familyName === 'CHATGPT FAMILY'
        ? 450
        : familyName === 'CLAUDE FAMILY'
          ? 700
          : familyName === 'GEMINI FAMILY'
            ? 800
            : 850,
    )
    if (councilPausedRef.current || !councilChannelOpenRef.current) return

    addMessages([{
      id: resolvedMessageId,
      familyName: label,
      content: '',
      timestamp: now,
      color: family.color,
      icon: family.icon,
      provider,
      messageType: 'response'
    }])

    setTypingFamily(null)
    setPresence(familyName, 'streaming', streamingLabel)

    for (let i = 0; i < visibleContent.length; i += STREAM_CHUNK_SIZE) {
      if (councilPausedRef.current || !councilChannelOpenRef.current) return
      updateMessageContent(resolvedMessageId, visibleContent.slice(0, i + STREAM_CHUNK_SIZE))
      await wait(STREAM_CHUNK_DELAY_MS)
    }

    updateMessageContent(resolvedMessageId, visibleContent)
    setPresence(familyName, 'complete', 'complete')
    await wait(350)
    setPresence(familyName, 'idle', 'standby')
  }

  const mapOrchFamilyToUsage = (f: CouncilOrchestrationFamily): UsageFamily | null => {
    if (f === 'chatgpt' || f === 'baby') return 'ChatGPT Family'
    if (f === 'claude' || f === 'red_team') return 'Claude Family'
    if (f === 'grok') return 'Grok Family'
    if (f === 'gemini') return 'Gemini Family'
    if (f === 'kimi') return 'Kimi Family'
    return null
  }

  const orchestrationVisual = (f: CouncilOrchestrationFamily) => {
    const pk = orchestrationFamilyToTypingFamily(f)
    if (f === 'red_team') {
      return {
        presenceKey: pk,
        bubbleFamilyName: 'RED TEAM',
        colorOverride: '#F87171',
        iconOverride: '⚔',
        provider: 'Red Team · adversarial',
        thinkingLabel: 'Red Team pressure-testing...',
        streamingLabel: 'Red Team streaming...',
      }
    }
    if (f === 'baby') {
      return {
        presenceKey: pk,
        bubbleFamilyName: 'BABY AI',
        colorOverride: '#5EEAD4',
        iconOverride: '◔',
        provider: 'Baby AI · observer',
        thinkingLabel: 'Baby AI observing...',
        streamingLabel: 'Baby AI streaming...',
      }
    }
    if (f === 'kimi') {
      return {
        presenceKey: pk,
        bubbleFamilyName: 'Kimi Family',
        provider: 'Local · Kimi',
        thinkingLabel: 'Kimi decomposing...',
        streamingLabel: 'Kimi streaming...',
      }
    }
    if (f === 'bridge_architect') {
      return {
        presenceKey: pk,
        bubbleFamilyName: 'Bridge Architect',
        provider: 'Local · bridge',
        thinkingLabel: 'Bridge Architect reasoning...',
        streamingLabel: 'Bridge Architect streaming...',
      }
    }
    if (f === 'claude') {
      return {
        presenceKey: pk,
        provider: 'Anthropic · claude-sonnet',
        thinkingLabel: 'Claude thinking...',
        streamingLabel: 'Claude streaming...',
      }
    }
    if (f === 'gemini') {
      return {
        presenceKey: pk,
        bubbleFamilyName: 'Gemini Family',
        provider: geminiEngineRow?.probedModelId
          ? `Google · ${geminiEngineRow.probedModelId}`
          : (geminiEngineRow?.providerLabel ?? 'Google Gemini'),
        thinkingLabel: 'Gemini reasoning...',
        streamingLabel: 'Gemini streaming...',
      }
    }
    if (f === 'grok') {
      return {
        presenceKey: pk,
        provider: 'xAI · grok',
        thinkingLabel: 'Grok scanning signals...',
        streamingLabel: 'Grok streaming...',
      }
    }
    return {
      presenceKey: pk,
      provider: 'OpenAI · gpt-4o',
      thinkingLabel: 'ChatGPT analyzing...',
      streamingLabel: 'ChatGPT streaming...',
    }
  }

  const revealOrchestrationTurn = async (
    family: CouncilOrchestrationFamily,
    text: string,
    inputText: string,
    opts?: {
      councilRevealSource?: 'autonomous' | 'decree'
      autonomousDecreeRoundAtFetch?: number
      transientMessageIds?: string[]
    },
  ) => {
    const directTarget = activeCouncilCommandRef.current.directInvocation
      ? activeCouncilCommandRef.current.targetFamilies[0]
      : undefined
    if (directTarget && family !== directTarget) {
      const metadata = {
        directInvocationTarget: directTarget,
        blockedFamily: family,
        routingViolationBlocked: true,
      }
      console.warn('[Live Council] routingViolationBlocked', metadata)
      void fetch('/api/events/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'audit.logged',
          source: 'system',
          payload: metadata,
        }),
      }).catch(() => undefined)
      return false
    }
    if (shouldSuppressProviderFailureFromChatStream(text, { diagnosticsOpen: operatorTab === 'diagnostics' })) {
      return false
    }
    const councilRevealSource = opts?.councilRevealSource ?? 'autonomous'
    if (councilRevealSource === 'decree' && decreePacketFlushCompleteRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.debug("[Live Council] Suppressed visible late family reply after packet close.")
      }
      return false
    }
    if (
      councilRevealSource === 'autonomous'
      && typeof opts?.autonomousDecreeRoundAtFetch === 'number'
      && shouldSuppressStaleAutonomousReveal(opts.autonomousDecreeRoundAtFetch, decreeRoundGenRef.current)
    ) {
      console.warn('[council-session] suppressed_stale_autonomous_reveal')
      return false
    }
    const inputTokens = estimateTokens(inputText)
    const usageName = mapOrchFamilyToUsage(family)
    const nextUsageRows = BASE_USAGE_ROWS.map(row => {
      if (!row.active || !usageName) return row
      const outputText = row.familyName === usageName ? text : ''
      const outputTokens = outputText ? estimateTokens(outputText) : 0
      return {
        ...row,
        inputTokens,
        outputTokens,
        estimatedCost: estimateFamilyCost(row.familyName, inputTokens, outputTokens),
      }
    })
    const vis = orchestrationVisual(family)
    const directInvocationFinal =
      text.trim()
      && councilRevealSource === 'decree'
      && activeCouncilCommandRef.current.directInvocation
      && activeCouncilCommandRef.current.targetFamilies[0] === family
    const directInvocationRemoveIds = directInvocationFinal
      ? collectTransientProviderStatusMessageIds({
          family,
          messageIds: opts?.transientMessageIds,
          includeGenericRecovery: true,
        })
      : []
    await streamFamilyMessage({
      familyName: vis.presenceKey,
      bubbleFamilyName: vis.bubbleFamilyName,
      colorOverride: vis.colorOverride,
      iconOverride: vis.iconOverride,
      content: text,
      provider: vis.provider,
      messageId: createMessageId(family),
      thinkingLabel: vis.thinkingLabel,
      streamingLabel: vis.streamingLabel,
      instant: true,
      removeMessageIds: directInvocationRemoveIds,
    })
    if (directInvocationFinal) {
      const providerError = councilSnapRef.current.providerErrorMessage
      if (
        providerError
        && isTransientProviderStatusContent(providerError, family, { includeGenericRecovery: true })
      ) {
        councilDispatch({ type: 'CLEAR_PROVIDER_ERROR' })
      }
      emitDirectInvocationTerminalDebug({
        directInvocationTarget: family,
        finalVisibleMessageEmitted: true,
        temporaryMessagesRemoved: directInvocationRemoveIds.length,
        placeholdersRemoved: directInvocationRemoveIds.length,
        terminalReason: 'success',
        terminalVisibleMessageExists: true,
        terminalFallbackInserted: false,
        packetCloseAllowed: true,
      })
    }
    const finalCost = totalUsageCost(nextUsageRows)
    setUsageRows(nextUsageRows)
    setCurrentDecreeCost(finalCost)
    setSessionCost(prev => prev + finalCost)
    return true
  }

  const mergeContinuationFromChatJson = (data: CouncilChatJson, opts?: { ignoreContinuation?: boolean }) => {
    if (data.liveResearchAttempted && data.liveResearchUi) {
      setLiveResearchHud(data.liveResearchUi)
    }
    if (opts?.ignoreContinuation) return
    const cr = data.continuationRequest
    if (!cr) return
    if (councilPausedRef.current || councilSnapRef.current.councilState === 'paused') {
      recordContinuationDiagnostic('holdSuppressions')
      return
    }
    const key = continuationRequestThrottleKey(cr)
    const now = Date.now()
    const last = continuationThrottleRef.current[key] ?? 0
    const activeDuplicate = continuationRequestsRef.current.some(
      p =>
        p.status === 'pending'
        && (
          p.family === cr.family
          || continuationRequestThrottleKey(p) === key
        ),
    )
    if (activeDuplicate || now - last < 5 * 60_000) {
      recordContinuationDiagnostic('suppressedRecursive')
      return
    }
    continuationThrottleRef.current[key] = now
    setContinuationRequests(prev => {
      if (prev.some(p => p.id === cr.id)) return prev
      recordContinuationDiagnostic('created')
      return [...prev, cr].slice(-14)
    })
  }

  const clearOrchestrationTimer = () => {
    if (orchestrationTimerRef.current !== null) {
      window.clearTimeout(orchestrationTimerRef.current)
      orchestrationTimerRef.current = null
    }
  }

  const scheduleNextOrchestration = () => {
    clearOrchestrationTimer()
    const sid = councilSnapRef.current.sessionId
    orchestrationTimerRef.current = window.setTimeout(() => {
      orchestrationTimerRef.current = null
      void runAutonomousOrchestration(sid)
    }, COUNCIL_ORCHESTRATION_INTERVAL_MS)
  }

  const runAutonomousOrchestration = async (expectedSessionId: string) => {
    const snap = councilSnapRef.current
    if (snap.sessionId !== expectedSessionId) return
    if (autonomousOrchInFlightRef.current) return
    if (snap.councilState !== 'active' || snap.requiresRaelForAutonomous || snap.isAwaitingResponses) return
    if (!snap.councilChannelOpen) return
    if (toolRequestActiveRef.current) return

    const autonomousCmd = activeCouncilCommandRef.current
    const autonomousIntentPrecheck = resolveCurrentIntent({
      latestRaelDecreeText: lastRaelDirectiveContentRef.current,
    })
    if (autonomousIntentPrecheck.intent === 'attendance' || autonomousCmd.mode === 'attendance') return

    autonomousOrchInFlightRef.current = true
    const autonomousDecreeRoundAtFetch = decreeRoundGenRef.current
    const decree = 'continue council discussion'
    const orchRedEarly = shouldInjectRedTeamEarly({
      decree,
      messages: councilMessagesForRedTeam(messagesRef.current),
      lastCouncilFamilyError: lastCouncilFamilyErrorRef.current,
    }) && !orchRedTeamEarlyLatchRef.current
    const geminiOk = geminiFunctionalRef.current && !skipGeminiForSessionRef.current
    const cmd = activeCouncilCommandRef.current
    const decreeDirect = detectDirectInvocation(lastRaelDirectiveContentRef.current)
    let allowed = filterOrchestrationOrderByCommand(
      ALL_ORCHESTRATION_FAMILIES,
      cmd,
      lastRaelDirectiveContentRef.current,
    )
    if (decreeDirect.invoked && decreeDirect.family) {
      allowed = [decreeDirect.family]
    }
    if (!allowed.length) {
      autonomousOrchInFlightRef.current = false
      councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: false })
      return
    }
    let family: CouncilOrchestrationFamily
    if (decreeDirect.invoked && decreeDirect.family) {
      family = decreeDirect.family
    } else {
      family = pickNextOrchestrationFamily({
        autonomousRoundIndex: snap.autonomousRoundIndex,
        recentSpeakers: snap.recentOrchestrationSpeakers,
        deepDiscussionMode: snap.deepDiscussionMode,
        geminiFunctional: geminiOk,
        orchestrationContext: buildOrchestrationContextFromMessages(messagesRef.current),
        forceRedTeamEarly: orchRedEarly,
      })
      if (!allowed.includes(family)) {
        family = allowed[snap.autonomousRoundIndex % allowed.length]!
      }
    }
    if (family === 'gemini' && skipGeminiForSessionRef.current) {
      autonomousOrchInFlightRef.current = false
      councilDispatch({ type: 'BUMP_AUTONOMOUS_ROUND' })
      councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: false })
      window.setTimeout(() => {
        const s = councilSnapRef.current
        if (s.sessionId !== expectedSessionId) return
        if (s.councilState !== 'active' || !s.councilChannelOpen || s.requiresRaelForAutonomous) return
        scheduleNextOrchestration()
      }, 0)
      return
    }
    const augment = [
      buildOrchestrationAugment(family, snap.deepDiscussionMode),
      buildCouncilOutputModeInstruction(councilOutputMode),
    ].join('\n\n')
    const autonomousIntent = resolveCurrentIntent({ latestRaelDecreeText: lastRaelDirectiveContentRef.current })
    const researchDecreeProbe = detectResearchIntent(lastRaelDirectiveContentRef.current, {
      attendanceFlow: false,
      sequentialDiagnostic: false,
      councilGatherPhase: null,
      intentKind: autonomousIntent.intent,
    }).shouldResearch
    if (
      researchDecreeProbe
      && lastAutonomousHadLiveResearchRef.current
      && lastAutonomousResearchFamilyRef.current === family
    ) {
      autonomousOrchInFlightRef.current = false
      councilDispatch({ type: 'SET_REQUIRES_RAEL', payload: true })
      councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: false })
      return
    }
    const threadHistory = messagesRef.current.map(m => ({ sender: m.familyName, content: m.content }))
    const inputText = `${decree}\n${threadHistory.map(m => `${m.sender}: ${m.content}`).join('\n')}`

    let textOut: string | null = null

    councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: true })
    let shouldScheduleNext = false
    try {
      if (!textOut) {
        const baseAutoBudget = resolveProviderTimeoutMs({
          intentKind: autonomousIntent.intent,
          mode: 'continue',
          councilCommand: activeCouncilCommandRef.current,
        })
        const directGrokAutonomous =
          family === 'grok'
          && (
            (
              activeCouncilCommandRef.current.directInvocation
              && activeCouncilCommandRef.current.targetFamilies[0] === 'grok'
            )
            || (decreeDirect.invoked && decreeDirect.family === 'grok')
          )
        const autoBudget = directGrokAutonomous
          ? DIRECT_INVOCATION_GROK_OUTER_TIMEOUT_MS
          : baseAutoBudget
        const famCtrl = new AbortController()
        const tid = window.setTimeout(() => famCtrl.abort(), autoBudget)
        let r: Response
        let data: CouncilChatJson
        try {
          const out = await postCouncilChat(
            {
              message: decree,
              profile: RAEL_PROFILE,
              threadHistory,
              mode: 'continue',
              toneMode: 'casual',
              councilSingleFamily: family,
              orchestrationAugment: augment,
              councilCommand: activeCouncilCommandRef.current,
              raelDirectiveText: lastRaelDirectiveContentRef.current,
              councilIntentKind: autonomousIntent.intent,
              councilActiveScope: autonomousIntent.scope,
              ...(liveCouncilConvId ? { conversationId: liveCouncilConvId } : {}),
            },
            famCtrl.signal,
          )
          r = out.res
          data = out.data
          mergeContinuationFromChatJson(data)
          if (data.liveResearchAttempted) {
            lastAutonomousHadLiveResearchRef.current = true
            lastAutonomousResearchFamilyRef.current = family
          } else {
            lastAutonomousHadLiveResearchRef.current = false
          }
        } finally {
          window.clearTimeout(tid)
        }
        if (!r.ok) {
          lastCouncilFamilyErrorRef.current = family
          const summary = sanitizeMemoryRuntimeText(typeof data.message === 'string' ? data.message : (data.error ?? `HTTP ${r.status}`))
          if (isGeminiCouncilBackoffFailure(family, r, data)) {
            geminiFailureCountRef.current += 1
            geminiLastErrorSummaryRef.current = summary
            skipGeminiForSessionRef.current = true
            if (!geminiUnavailableUserMessagedRef.current) {
              geminiUnavailableUserMessagedRef.current = true
              addSystemMessage(`Gemini unavailable: ${summary.slice(0, 500)}`)
              void postLiveCouncilMessage({
                role: 'system',
                content: `Gemini unavailable: ${summary.slice(0, 500)}`,
              })
            }
            councilDispatch({ type: 'BUMP_AUTONOMOUS_ROUND' })
            shouldScheduleNext = true
            return
          }
          const famLabel = COUNCIL_ROSTER.find(ro => ro.id === family)?.label ?? family
          const errLine = `[Error] ${famLabel}: ${summary}`
          addSystemMessage(errLine)
          void postLiveCouncilMessage({ role: 'system', content: errLine })
          councilDispatch({ type: 'SET_PROVIDER_ERROR', payload: errLine })
          shouldScheduleNext = true
          return
        }
        if (data.councilProviderHttpStatus === 'timed_out' || data.councilProviderHttpStatus === 'failed') {
          lastCouncilFamilyErrorRef.current = data.councilProviderHttpStatus === 'failed' ? family : null
          councilDispatch({ type: 'BUMP_AUTONOMOUS_ROUND' })
          shouldScheduleNext = true
          return
        }
        if (data.councilGovernorSkipped) {
          lastCouncilFamilyErrorRef.current = null
          councilDispatch({ type: 'BUMP_AUTONOMOUS_ROUND' })
          shouldScheduleNext = true
          return
        }
        textOut = typeof data.councilSingleResponse === 'string' ? data.councilSingleResponse.trim() : ''
        if (textOut) {
          textOut = councilProviderTextAfterRenderGate(family, textOut)
        }
        if (!textOut) {
          const famLabel = COUNCIL_ROSTER.find(ro => ro.id === family)?.label ?? family
          const errLine = `[Error] ${famLabel}: empty response`
          addSystemMessage(errLine)
          void postLiveCouncilMessage({ role: 'system', content: errLine })
          shouldScheduleNext = true
          return
        }
      }

      if (councilSnapRef.current.sessionId !== expectedSessionId) return

      const h = councilContentHash(textOut)
      const lastHash = councilSnapRef.current.lastContentHashByFamily[family]
      if (lastHash === h) {
        councilDispatch({ type: 'BUMP_AUTONOMOUS_ROUND' })
        shouldScheduleNext = true
        return
      }

      await revealOrchestrationTurn(family, textOut, inputText, {
        councilRevealSource: 'autonomous',
        autonomousDecreeRoundAtFetch,
      })
      if (orchRedEarly && family === 'red_team') orchRedTeamEarlyLatchRef.current = true
      if (councilSnapRef.current.sessionId !== expectedSessionId) return

      const snapBeforeIncrement = councilSnapRef.current
      const cap = snapBeforeIncrement.deepDiscussionMode ? COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS_DEEP : COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS
      const willHitRaelGate = snapBeforeIncrement.consecutiveAutonomousCount + 1 >= cap

      councilDispatch({ type: 'RECORD_ORCHESTRATION_SPEAKER', payload: { family, contentHash: h } })
      councilDispatch({ type: 'INCREMENT_AUTONOMOUS' })
      councilDispatch({ type: 'BUMP_AUTONOMOUS_ROUND' })
      shouldScheduleNext = activeCouncilCommandRef.current.mode === 'emergency' && !willHitRaelGate
    } catch (e) {
      lastCouncilFamilyErrorRef.current = family
      councilDispatch({
        type: 'SET_PROVIDER_ERROR',
        payload: sanitizeMemoryRuntimeText(e instanceof Error ? e.message : String(e)),
      })
    } finally {
      autonomousOrchInFlightRef.current = false
      councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: false })
      if (activeCouncilCommandRef.current.mode !== 'emergency') {
        shouldScheduleNext = false
      }
      if (shouldScheduleNext) {
        window.setTimeout(() => {
          const s = councilSnapRef.current
          if (s.sessionId !== expectedSessionId) return
          if (s.councilState !== 'active' || !s.councilChannelOpen || s.requiresRaelForAutonomous) return
          scheduleNextOrchestration()
        }, 0)
      }
    }
  }

  const submitDecree = async (decree: string, mode?: CouncilMode) => {
    const myRound = ++decreeRoundGenRef.current
    latestDecreeAttemptRoundRef.current = myRound
    orchRedTeamEarlyLatchRef.current = false
    lastAutonomousResearchFamilyRef.current = null
    lastAutonomousHadLiveResearchRef.current = false
    const toolIntent = mode !== 'continue' && detectToolIntent(decree)
    if (toolIntent && toolRequestActiveRef.current) {
      addSystemMessage('Research already in progress.')
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller
    setLoading(true)
    if (mode !== 'continue') {
      setLiveResearchHud(null)
    }
    if (mode === 'continue') {
      addSystemMessage('Council channel continuing')
    } else if (toolIntent && !beginToolRequest(controller)) {
      addSystemMessage('Research already in progress.')
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setLoading(false)
      return
    }

    const threadHistory = () => messagesRef.current.map(m => ({ sender: m.familyName, content: m.content }))
    const inputText = () => `${decree}\n${threadHistory().map(m => `${m.sender}: ${m.content}`).join('\n')}`
    const projectedUsage = createUsageEstimate(inputText(), mode === 'expanded' ? EXPANDED_OUTPUT_TOKEN_BUDGET : DEFAULT_OUTPUT_TOKEN_BUDGET)
    setUsageRows(projectedUsage)
    setCurrentDecreeCost(totalUsageCost(projectedUsage))
    const toneMode = detectToneMode(decree)
    const outputModeInstruction = buildCouncilOutputModeInstruction(councilOutputMode)
    const intent = lastDecreeIntentRef.current ?? classifyRaElMessage(decree)
    const decreeRequiresLiveRetrieval = detectResearchIntent(decree).shouldResearch
    if (mode !== 'continue' && decreeRequiresLiveRetrieval) {
      setLiveResearchHud({
        mode: 'active',
        sourcesCount: 0,
        label: 'Retrieving live intelligence...',
        councilPhase: 'evidence',
        retrievalStatus: {
          retrieval_required: true,
          retrieval_started: true,
          retrieval_complete: false,
          retrieval_failed: false,
          synthesis_allowed: false,
        },
      })
    }

    const rosterLabel = (fid: CouncilOrchestrationFamily) =>
      COUNCIL_ROSTER.find(r => r.id === fid)?.label ?? fid

    const postCouncilChatDecreeGather = async (
      body: Parameters<typeof postCouncilChat>[0],
      continuationMergeOpts?: { ignoreContinuation?: boolean },
    ) => {
      const merged = new AbortController()
      const onDecreeAbort = () => merged.abort()
      controller.signal.addEventListener('abort', onDecreeAbort, { once: true })
      const hangId = window.setTimeout(() => merged.abort(), DECREE_GATHER_HARD_HANG_MS)
      if (controller.signal.aborted) merged.abort()
      try {
        const out = await postCouncilChat({ ...body, councilGatherPhase: 'decree_soft' }, merged.signal)
        mergeContinuationFromChatJson(out.data, continuationMergeOpts)
        return out
      } finally {
        window.clearTimeout(hangId)
        controller.signal.removeEventListener('abort', onDecreeAbort)
      }
    }

    const fetchEngineStatusWithTimeout = async () => {
      const statusController = new AbortController()
      const timeoutId = window.setTimeout(() => statusController.abort(), 8_000)
      try {
        return await fetch('/api/engine-control/status', { cache: 'no-store', signal: statusController.signal })
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    const enqueueCouncilProposals = async (text: string, family: CouncilOrchestrationFamily) => {
      if (intent.tier === 'casual') return
      const lines = extractProposedCouncilActions(text)
      if (!lines.length || !liveCouncilConvId || !persistenceAvailable) return
      for (const line of lines) {
        try {
          const res = await fetch('/api/actions/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'research',
              payload: { proposed: line, sourceFamily: rosterLabel(family), decreePreview: decree.slice(0, 280) },
              conversationId: liveCouncilConvId,
            }),
          })
          let j: ActionQueuePostFailureBody = {}
          try {
            j = (await res.json()) as ActionQueuePostFailureBody
          } catch {
            j = {}
          }
          if (isActionQueuePostSucceeded(res, j)) continue
          const lineMsg = formatActionQueuePersistFailureMessage(j)
          addSystemMessage(lineMsg)
          void postLiveCouncilMessage({ role: 'system', content: lineMsg, family: 'SYSTEM' })
        } catch {
          const fail = 'Approval task could not be persisted (network error).'
          addSystemMessage(fail)
          void postLiveCouncilMessage({ role: 'system', content: fail, family: 'SYSTEM' })
        }
      }
      void refreshQueueActions()
    }

    const economicRouting = resolveEconomicOpsRouting(decree)
    const economicCommand = parseEconomicOperationalCommand(decree)
    if (mode !== 'continue' && economicRouting.mode === 'economic_ops' && economicCommand.matched) {
      logEconomicOpsResolvedMode({
        decree,
        resolvedMode: 'economic_ops',
        source: 'client',
        reason: economicRouting.reason,
      })

      const assignedFamily = economicCommand.domain.providerPriority[0]
      const cmdForEconomicOps = activeCouncilCommandRef.current
      applyCouncilPacketRender(
        buildCouncilRenderPacket({
          command: cmdForEconomicOps,
          sessionState: 'OPEN',
          packetStatus: 'gathering',
          families: [],
          extraWarnings: ['economic_ops_bypass_active'],
        }),
      )

      const selectedProviderFamily = assignedFamily
      const providerAnalysis = ''
      const providerFailure: string | null = null
      const providerAttempts: {
        provider_family: typeof assignedFamily
        content: string
        success: boolean
        latency_ms?: number
      }[] = []
      console.info('[economic-ops-provider]', {
        event: 'live_scout_ingestion_before_provider_analysis',
        provider: assignedFamily,
        command: economicCommand.command,
        providerInvocationSkipped: true,
      })

      const economicRes = await fetch('/api/economic/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decree,
          sessionId: liveCouncilConvId ?? 'live-council',
          providerAnalyses: providerAnalysis
            ? providerAttempts.map(attempt => (
                attempt.provider_family === selectedProviderFamily
                  ? { ...attempt, content: providerAnalysis, success: true }
                  : attempt
              ))
            : providerAttempts,
        }),
        signal: controller.signal,
      })
      const economicJson = await economicRes.json() as {
        summary?: string
        error?: string
        opportunityCount?: number
        scout?: {
          diagnostics?: Omit<EconomicScoutDiagnostics, 'missing_api_keys' | 'last_updated_at'>
          missingApiKeys?: string[]
        }
      }
      if (economicJson.scout?.diagnostics) {
        setEconomicScoutDiagnostics({
          ...INITIAL_ECONOMIC_SCOUT_DIAGNOSTICS,
          ...economicJson.scout.diagnostics,
          missing_api_keys: economicJson.scout.missingApiKeys ?? [],
          last_updated_at: new Date().toISOString(),
        })
      }
      console.info('[economic-ops-provider]', {
        event: 'extraction_completed',
        selectedProvider: selectedProviderFamily,
        providerAttemptCount: providerAttempts.length,
        extractionInputCount: providerAttempts.filter(attempt => attempt.success && attempt.content.trim()).length,
        extractionOutputCount: Number(economicJson.opportunityCount ?? 0),
      })
      const summary = economicJson.summary
        ?? economicJson.error
        ?? 'Economic Ops routed to Opportunity Scout.'
      if (economicJson.scout?.missingApiKeys?.length) {
        addSystemMessage('Scout provider unavailable: missing API key.')
      }
      const assignedVisual = orchestrationVisual(assignedFamily)
      const assignedLabel = assignedVisual.bubbleFamilyName ?? rosterLabel(assignedFamily)
      addMessages([{
        id: createMessageId(`economic-${assignedFamily}`),
        familyName: assignedLabel,
        content: summary,
        timestamp: new Date().toLocaleTimeString(),
        color: assignedVisual.colorOverride ?? FAMILY_META[assignedVisual.presenceKey].color,
        icon: assignedVisual.iconOverride ?? FAMILY_META[assignedVisual.presenceKey].icon,
        provider: assignedVisual.provider,
        messageType: 'response',
      }])
      void postLiveCouncilMessage(
        { role: 'assistant', content: summary, family: assignedLabel },
        { responseSuccessful: !economicJson.error },
      )
      applyCouncilPacketRender(
        buildCouncilRenderPacket({
          command: cmdForEconomicOps,
          sessionState: 'CLOSED',
          packetStatus: 'released',
          families: [{
            family: assignedFamily,
            content: summary,
          }],
          extraWarnings: [
            'economic_ops_bypassed_attendance',
            'economic_ops_bypassed_legacy_research',
            ...(providerFailure && !providerAnalysis ? ['economic_ops_provider_failure_telemetry_only'] : []),
            ...(selectedProviderFamily !== assignedFamily ? ['economic_ops_provider_priority_fallback'] : []),
          ],
        }),
      )
      decreePacketFlushCompleteRef.current = true
      setLoading(false)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      return
    }

    let decreeSubmitFaultAnchor: CouncilOrchestrationFamily | undefined
    try {
      try {
        const er = await fetchEngineStatusWithTimeout()
        if (er.ok) {
          const ej = await er.json() as EngineControlStatusResponse
          engineMapRef.current = engineRowMap(ej.engines)
          setEngineList(ej.engines)
          const g = ej.engines.find(e => e.id === 'gemini')
          geminiFunctionalRef.current = Boolean(g?.functional)
          if (g?.functional) skipGeminiForSessionRef.current = false
          setGeminiEngineRow(g ?? null)
          void maybeEnqueueGeminiRepairIfNeeded(g)
        }
      } catch {
        /* use last known map */
      }

      if (controller.signal.aborted || councilPausedRef.current) return
      if (myRound !== decreeRoundGenRef.current) return

      let augmentCtx: CouncilAugmentContext = { tier: intent.tier }
      if (intent.tier !== 'casual') {
        const brief = await buildPlatformBrief()
        augmentCtx = {
          tier: intent.tier,
          platformBriefJson: JSON.stringify(brief).slice(0, 3200),
        }
      }

      const planningMode =
        mode === 'summarize'
        || intent.tier === 'income_ops'
        || detectCouncilPlanningMode(decree)
      const extra = participationFromDecree(decree, participationToggles)
      const errSnap = lastCouncilFamilyErrorRef.current
      const injectLeadRed = shouldInjectRedTeamEarly({
        decree,
        messages: councilMessagesForRedTeam(messagesRef.current),
        lastCouncilFamilyError: errSnap,
      })
      if (errSnap && injectLeadRed) lastCouncilFamilyErrorRef.current = null

      const cmd = activeCouncilCommandRef.current
      const councilIntentState = resolveCurrentIntent({ latestRaelDecreeText: decree })
      const attendanceWave = isAttendanceIntent(cmd, councilIntentState.intent)
      const redTeamLeadOnly = injectLeadRed && !extra.includes('red_team')
      const standardFamilyCap = Math.max(
        intent.maxFamilies,
        4 + extra.length + (redTeamLeadOnly ? 1 : 0),
      )

      let order = buildDecreeFamilyOrder({
        incomeOperationsMode: incomeOperationsMode || intent.tier === 'income_ops',
        planningMode,
        extraFamilies: extra,
        maxFamilies: cmd.directInvocation
          ? 1
          : attendanceWave
            ? 8
            : cmd.mode === 'emergency'
              ? intent.maxFamilies
              : standardFamilyCap,
        singleFamilyRotate:
          cmd.directInvocation
          || cmd.mode === 'emergency'
            ? undefined
            : intent.tier === 'casual'
              ? messagesRef.current.length
              : undefined,
        leadWithRedTeam: injectLeadRed && !cmd.directInvocation,
      })
      if (cmd.directInvocation && cmd.targetFamilies[0]) {
        order = [cmd.targetFamilies[0]]
      }
      if (intent.tier === 'casual' && !attendanceWave) {
        const casualFallbacks: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok', 'gemini']
        order = [...order, ...casualFallbacks.filter(f => !order.includes(f))]
      }
      if (skipGeminiForSessionRef.current) order = order.filter(f => f !== 'gemini')

      const directedOrder = attendanceWave
        ? buildAttendanceDirectedOrder({
            cmd,
            decree,
            participationToggles,
          })
        : filterOrchestrationOrderByCommand(order, cmd, decree)
      const diagnosticIntentMode = resolveDiagnosticIntentMode(decree)
      const diagnosticSequential = diagnosticIntentMode !== 'none' && !attendanceWave
      const orderForGather = diagnosticSequential ? buildDefaultDiagnosticOrder(directedOrder) : directedOrder
      decreeSubmitFaultAnchor = orderForGather[0] ?? directedOrder[0]
      const decreeTopicLockPreview = deriveTopicScopeLock(decree, undefined, {
        allowBusinessTopicsFromIntent: councilIntentState.intent === 'business_ops',
      })

      const modeWarnings = councilModeExtensionWarnings(cmd)

      let modeGovernor = resolveModeGovernor({
        decreeText: decree,
        intentKind: councilIntentState.intent,
        councilCommand: cmd,
      })

      const isCouncilFamilyEngineReady = (family: CouncilOrchestrationFamily): boolean => {
        if (family === 'gemini' && skipGeminiForSessionRef.current) return false
        const eid = cloudEngineIdForCouncilFamily(family)
        if (!eid) return false
        const row = engineMapRef.current.get(eid)
        if (!row) return true
        return isEngineFunctional(engineMapRef.current, eid)
      }

      if (modeGovernor.mode === 'council' && modeGovernor.fullTeamRequired) {
        let teamStatuses = buildRoomStatusesFromEngineFunctional(directedOrder, isCouncilFamilyEngineReady)
        if (!evaluateFullTeamSatisfied(directedOrder, teamStatuses)) {
          await wait(FULL_TEAM_GATE_TIMEOUT_MS)
          try {
            const er = await fetchEngineStatusWithTimeout()
            if (er.ok) {
              const ej = await er.json() as EngineControlStatusResponse
              engineMapRef.current = engineRowMap(ej.engines)
            }
          } catch {
            /* keep prior engine map */
          }
          teamStatuses = buildRoomStatusesFromEngineFunctional(directedOrder, isCouncilFamilyEngineReady)
          if (!evaluateFullTeamSatisfied(directedOrder, teamStatuses)) {
            addSystemMessage(FULL_TEAM_UNSATISFIED_MESSAGE)
            void postLiveCouncilMessage({ role: 'system', content: FULL_TEAM_UNSATISFIED_MESSAGE, family: 'SYSTEM' })
            decreePacketFlushCompleteRef.current = true
            applyCouncilPacketRender(
              buildCouncilRenderPacket({
                command: cmd,
                sessionState: 'CLOSED',
                packetStatus: 'idle',
                families: [],
                extraWarnings: [...modeWarnings, 'full_team_gate_unsatisfied'],
              }),
            )
            return
          }
        }
      }

      decreePacketFlushCompleteRef.current = false
      attendanceSoftGatherUiClosedRef.current = false
      decreePacketOpenedAtMsRef.current = Date.now()
      type StagedCouncilLine = {
        family: CouncilOrchestrationFamily
        textOut: string
        transientMessageIds?: string[]
      }
      const staged: StagedCouncilLine[] = []

      const batchCeilingMs = attendanceWave
        ? resolveAttendanceBatchCeilingMs({ familyCount: directedOrder.length })
        : null

      const gatherPostSystem = (line: string, opts?: { id?: string }) => {
        if (attendanceWave && attendanceSoftGatherUiClosedRef.current) return
        addSystemMessage(line, opts)
      }
      const gatherPostLive = (
        input: { role: 'user' | 'assistant' | 'system'; content: string; family?: string | null },
        opts?: { transientProviderStatus?: boolean; providerRuntime?: ProviderFamilyOutcomeStatus },
      ) =>
        postLiveCouncilMessage(input, {
          applyAttendanceLateGatherSkip: attendanceWave,
          transientProviderStatus: opts?.transientProviderStatus,
          providerRuntime: opts?.providerRuntime,
        })

      let providerRuntimeStates: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> = {}
      let providerRuntimeDetails: CouncilProviderRuntimeDetails | undefined
      let attendancePreflightMap: Partial<Record<CouncilOrchestrationFamily, AttendancePreflightStatus>> = {}

      if (attendanceWave) {
        attendancePreflightMap = await runAttendancePreflight(directedOrder, {
          engineMap: engineMapRef.current,
          skipGeminiForSession: skipGeminiForSessionRef.current,
        })
        providerRuntimeStates = Object.fromEntries(
          directedOrder.map(f => [f, attendancePreflightToProviderRuntime(attendancePreflightMap[f])]),
        ) as Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>
        const preflightUnavailable = directedOrder.filter(f =>
          attendancePreflightSkipsChat(attendancePreflightMap[f]),
        )
        providerRuntimeDetails = preflightUnavailable.length
          ? Object.fromEntries(preflightUnavailable.map(f => [f, 'preflight_unavailable'] as const))
          : undefined
      }

      applyCouncilPacketRender(
        buildCouncilRenderPacket({
          command: cmd,
          sessionState: 'OPEN',
          packetStatus: 'gathering',
          families: [],
          extraWarnings: modeWarnings,
          providerRuntimeStates,
          providerRuntimeDetails,
        }),
      )

      sequentialDiagnosticApiRef.current = null
      if (diagnosticSequential) {
        sequentialDiagnosticHoldRef.current = false
        diagnosticIntegritySnapshotRef.current = null
        diagnosticIntegrityGeneratedAtRef.current = null
        void fetch('/api/runtime/integrity', { cache: 'no-store' })
          .then(r => (r.ok ? r.json() : null))
          .then(obj => {
            if (!obj) return
            try {
              diagnosticIntegritySnapshotRef.current = JSON.stringify(obj).slice(0, 12_000)
              diagnosticIntegrityGeneratedAtRef.current =
                typeof (obj as { generatedAt?: unknown }).generatedAt === 'string'
                  ? (obj as { generatedAt: string }).generatedAt
                  : null
              void postRuntimeStatePatch({ set: buildIntegrityPersistencePayload(obj as RuntimeIntegrityResponse) })
            } catch {
              diagnosticIntegritySnapshotRef.current = null
              diagnosticIntegrityGeneratedAtRef.current = null
            }
          })
          .catch(() => {
            diagnosticIntegritySnapshotRef.current = null
            diagnosticIntegrityGeneratedAtRef.current = null
          })
        sequentialDiagnostics.start(orderForGather, diagnosticIntentMode)
      }

      let anySuccess = false

      type GatherCell = {
        family: CouncilOrchestrationFamily
        textOut: string | null
        runtime: ProviderFamilyOutcomeStatus
        runtimeDetail?: string
        transientMessageIds?: string[]
      }

      const gatherFamily = async (family: CouncilOrchestrationFamily): Promise<GatherCell> => {
        if (myRound !== decreeRoundGenRef.current) {
          return { family, textOut: null, runtime: 'SKIPPED', runtimeDetail: 'superseded' }
        }
        if (controller.signal.aborted || councilPausedRef.current) {
          return { family, textOut: null, runtime: 'SKIPPED', runtimeDetail: 'aborted' }
        }

        if (attendanceWave && attendancePreflightSkipsChat(attendancePreflightMap[family])) {
          return { family, textOut: null, runtime: 'SKIPPED', runtimeDetail: 'preflight_unavailable' }
        }

        setFamilyDuty(prev => ({ ...prev, [family]: 'working' }))
        const isDirectInvoke = Boolean(cmd.directInvocation && cmd.targetFamilies[0] === family)
        const transientDirectStatusMessageIds: string[] = []
        const postDirectUnavailable = async (rt: ProviderFamilyOutcomeStatus, detail?: string) => {
          const line = replaceWithRuntimeTruthLine(
            family,
            providerOutcomeToVerifiedContext({ family, runtime: rt, runtimeDetail: detail }),
          )
          const uiMessageId = createMessageId(`transient-${family}`)
          transientDirectStatusMessageIds.push(uiMessageId)
          gatherPostSystem(line, { id: uiMessageId })
          await gatherPostLive(
            { role: 'system', content: line, family },
            { transientProviderStatus: true, providerRuntime: rt },
          )
        }
        const deep = councilSnapRef.current.deepDiscussionMode
        const summarizeAugment = mode === 'summarize'
          ? `${buildDecreeFamilyAugment(family, deep, augmentCtx)}\n\nTASK: Summarize the council thread so far for Ra'el in concise bullets. Do not invent facts beyond the thread.`
          : null
        const augment = [
          summarizeAugment
            ?? (planningMode ? buildCouncilPlanningAugment(family, deep, augmentCtx) : buildDecreeFamilyAugment(family, deep, augmentCtx)),
          outputModeInstruction,
        ].join('\n\n')

        let textOut: string | null = null
        let runtime: ProviderFamilyOutcomeStatus = 'SKIPPED'
        let runtimeDetail: string | undefined

        try {
          if (family === 'kimi' || family === 'bridge_architect') {
            runtime = 'SKIPPED'
            runtimeDetail = 'cloud_provider_unavailable'
            if (isDirectInvoke) await postDirectUnavailable('SKIPPED', runtimeDetail)
          } else if (family === 'gemini' && skipGeminiForSessionRef.current) {
            runtime = 'SKIPPED'
            runtimeDetail = 'gemini_session_backoff'
            if (isDirectInvoke) await postDirectUnavailable('SKIPPED', runtimeDetail)
          } else {
            const eid = cloudEngineIdForCouncilFamily(family)
            const row = eid ? engineMapRef.current.get(eid) : undefined
            const engineGateBlocksChat =
              !attendanceWave && Boolean(row) && !isEngineFunctional(engineMapRef.current, eid)
            if (engineGateBlocksChat) {
              const reason = unavailableReason(row)
              if (isDirectInvoke) {
                await postDirectUnavailable('SKIPPED', reason)
              }
              runtime = 'SKIPPED'
              runtimeDetail = reason
            } else {
              try {
                const { res: chatRes, data: chatData } = await postCouncilChatDecreeGather({
                  message: decree,
                  profile: RAEL_PROFILE,
                  threadHistory: threadHistory(),
                  mode: mode === 'expanded' ? 'expanded' : 'continue',
                  toneMode,
                  councilSingleFamily: family,
                  orchestrationAugment: augment,
                  councilCommand: activeCouncilCommandRef.current,
                  raelDirectiveText: decree,
                  councilIntentKind: councilIntentState.intent,
                  councilActiveScope: councilIntentState.scope,
                  councilModeGovernor: modeGovernor,
                  councilProviderRuntimeStates: providerRuntimeStates,
                  ...(sequentialDiagnosticApiRef.current
                    ? {
                        sequentialDiagnostic: true,
                        diagnosticTurnIndex: sequentialDiagnosticApiRef.current.turn,
                        diagnosticTurnTotal: sequentialDiagnosticApiRef.current.total,
                        diagnosticOrder: sequentialDiagnosticApiRef.current.order,
                      }
                    : {}),
                  ...(diagnosticSequential && diagnosticIntegritySnapshotRef.current
                    ? {
                        runtimeIntegritySnapshot: diagnosticIntegritySnapshotRef.current,
                        ...(diagnosticIntegrityGeneratedAtRef.current
                          ? { integrityGeneratedAt: diagnosticIntegrityGeneratedAtRef.current }
                          : {}),
                      }
                    : {}),
                  ...(diagnosticSequential ? { diagnosticIntentMode } : {}),
                  ...(liveCouncilConvId ? { conversationId: liveCouncilConvId } : {}),
                }, attendanceWave ? { ignoreContinuation: true } : undefined)

                if (chatRes.ok && chatData.councilProviderHttpStatus === 'timed_out') {
                  runtime = 'TIMED_OUT'
                  runtimeDetail = chatData.councilProviderHttpDetail
                  textOut = null
                  if (isDirectInvoke) await postDirectUnavailable('TIMED_OUT', runtimeDetail)
                } else if (chatRes.ok && chatData.councilProviderHttpStatus === 'failed') {
                  runtime = 'FAILED'
                  runtimeDetail = chatData.councilProviderHttpDetail
                  textOut = null
                  if (isDirectInvoke) {
                    await postDirectUnavailable('FAILED', runtimeDetail)
                  }
                } else if (!chatRes.ok) {
                  lastCouncilFamilyErrorRef.current = family
                  const summary = typeof chatData.message === 'string' ? chatData.message : (chatData.error ?? `HTTP ${chatRes.status}`)
                  if (isGeminiCouncilBackoffFailure(family, chatRes, chatData)) {
                    geminiFailureCountRef.current += 1
                    geminiLastErrorSummaryRef.current = summary
                    skipGeminiForSessionRef.current = true
                    if (isDirectInvoke && !geminiUnavailableUserMessagedRef.current) {
                      geminiUnavailableUserMessagedRef.current = true
                      const line = `Gemini unavailable: ${summary.slice(0, 500)}`
                      gatherPostSystem(line)
                      void gatherPostLive({ role: 'system', content: line })
                    }
                    textOut = null
                    runtime = 'FAILED'
                    runtimeDetail = 'gemini_backoff'
                  } else if (isDirectInvoke) {
                    await postDirectUnavailable('FAILED', summary)
                    runtime = 'FAILED'
                    runtimeDetail = summary
                  } else {
                    runtime = 'FAILED'
                    runtimeDetail = summary
                  }
                } else if (chatData.councilGovernorSkipped) {
                  textOut = null
                  runtime = 'SKIPPED'
                  runtimeDetail = 'governor_silent_skip'
                } else {
                  textOut = typeof chatData.councilSingleResponse === 'string' ? chatData.councilSingleResponse.trim() : ''
                  if (textOut) {
                    textOut = councilProviderTextAfterRenderGate(family, textOut)
                  }
                  if (!textOut) {
                    if (!isDirectInvoke) {
                      lastCouncilFamilyErrorRef.current = family
                    }
                    if (isDirectInvoke) await postDirectUnavailable('FAILED', 'empty_response')
                    runtime = 'FAILED'
                    runtimeDetail = 'empty_response'
                  } else {
                    runtime = 'RESPONDED'
                  }
                }
              } catch (familyError) {
                const familyTimedOut = familyError instanceof DOMException && familyError.name === 'AbortError'
                if (familyTimedOut) {
                  runtime = 'TIMED_OUT'
                  runtimeDetail = 'client_abort_or_budget'
                  textOut = null
                  if (isDirectInvoke) await postDirectUnavailable('TIMED_OUT', runtimeDetail)
                } else if (isDirectInvoke) {
                  const summary = familyError instanceof Error ? familyError.message : String(familyError)
                  await postDirectUnavailable('FAILED', summary)
                  runtime = 'FAILED'
                  runtimeDetail = summary
                } else {
                  lastCouncilFamilyErrorRef.current = family
                  const summary = familyError instanceof Error ? familyError.message : String(familyError)
                  runtime = 'FAILED'
                    runtimeDetail = summary
                }
              }
            }
          }
        } finally {
          setFamilyDuty(prev => ({ ...prev, [family]: 'standing_by' }))
        }

        return {
          family,
          textOut,
          runtime,
          runtimeDetail,
          transientMessageIds: transientDirectStatusMessageIds,
        }
      }

      const outcomeByFamily = new Map<CouncilOrchestrationFamily, GatherCell>()
      /** Parallel in-flight gathers only for non-sequential decree gathers (sequential diagnostics must not fan out). */
      const gatherPromises = diagnosticSequential
        ? []
        : orderForGather.map(family =>
            gatherFamily(family).then(cell => {
              const prev = outcomeByFamily.get(family)
              if (prev?.textOut?.trim() && cell.textOut?.trim()) return prev
              outcomeByFamily.set(family, cell)
              return cell
            }),
          )

      const mapSoftCapCells = (): GatherCell[] =>
        directedOrder.map(family => {
          const done = outcomeByFamily.get(family)
          if (done) {
            const hasContent = Boolean(done.textOut?.trim())
            return {
              ...done,
              runtime: runtimeAfterAttendanceSoftCap({
                runtime: done.runtime,
                hasContent,
                runtimeDetail: done.runtimeDetail,
              }),
              runtimeDetail: hasContent ? done.runtimeDetail : (done.runtimeDetail ?? 'attendance_soft_cap'),
            }
          }
          return {
            family,
            textOut: null,
            runtime: 'IN_FLIGHT' as const,
            runtimeDetail: 'attendance_soft_cap',
          }
        })

      if (attendanceWave && batchCeilingMs != null) {
        await wait(batchCeilingMs)
      } else if (diagnosticSequential) {
        for (let i = 0; i < orderForGather.length; i++) {
          const family = orderForGather[i]!
          sequentialDiagnosticApiRef.current = {
            turn: i,
            total: orderForGather.length,
            order: orderForGather,
          }
          sequentialDiagnostics.setTurn(i)
          const cell = await gatherFamily(family)
          const prev = outcomeByFamily.get(family)
          if (prev?.textOut?.trim() && cell.textOut?.trim()) continue
          outcomeByFamily.set(family, cell)
          sequentialDiagnostics.recordOutcome(family, cell.runtime)
          if (family === 'red_team' && typeof cell.textOut === 'string' && detectRedTeamRuntimeHold(cell.textOut)) {
            sequentialDiagnosticHoldRef.current = true
            sequentialDiagnostics.setHold(true, 'red_team_runtime_hold')
            const holdOutcomes = orderForGather.map(f => ({
              family: f,
              runtime: (outcomeByFamily.get(f)?.runtime ?? 'SKIPPED') as ProviderFamilyOutcomeStatus,
            }))
            void postRuntimeStatePatch({
              appendDiagnosticEvents: [
                { kind: 'red_team_hold', at: new Date().toISOString(), reason: 'red_team_runtime_hold' },
              ],
              set: {
                [RUNTIME_STATE_KEYS.redTeamHoldUnresolved]: {
                  capturedAt: new Date().toISOString(),
                  holdReason: 'red_team_runtime_hold',
                  panel: {
                    order: orderForGather,
                    turnIndex: i,
                    outcomes: holdOutcomes,
                  },
                },
              },
            })
            await new Promise<void>(resolve => {
              let settled = false
              const finish = () => {
                if (settled) return
                settled = true
                if (diagnosticHoldTimerRef.current != null) {
                  window.clearTimeout(diagnosticHoldTimerRef.current)
                  diagnosticHoldTimerRef.current = null
                }
                diagnosticHoldReleaseRef.current = null
                sequentialDiagnosticHoldRef.current = false
                sequentialDiagnostics.setHold(false)
                void postRuntimeStatePatch({ set: { [RUNTIME_STATE_KEYS.redTeamHoldUnresolved]: null } })
                resolve()
              }
              diagnosticHoldReleaseRef.current = finish
              diagnosticHoldTimerRef.current = window.setTimeout(() => {
                const line = `Red Team HOLD — timed out after 60s; auto-resuming diagnostic queue.`
                gatherPostSystem(line)
                void gatherPostLive({ role: 'system', content: line })
                finish()
              }, 60_000)
            })
          }
          await new Promise<void>(resolve => {
            window.setTimeout(resolve, 250)
          })
        }
        sequentialDiagnosticApiRef.current = null
      } else {
        await Promise.allSettled(gatherPromises)
      }

      let cells: GatherCell[] = attendanceWave
        ? mapSoftCapCells()
        : orderForGather.map(family => {
            const done = outcomeByFamily.get(family)
            if (done) return done
            return { family, textOut: null, runtime: 'SKIPPED' as const, runtimeDetail: 'missing_gather_slot' }
          })

      if (attendanceWave) {
        attendanceSoftGatherUiClosedRef.current = true
      }

      providerRuntimeStates = Object.fromEntries(cells.map(c => [c.family, c.runtime])) as Partial<
        Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>
      >
      providerRuntimeDetails = gatherCellsToProviderRuntimeDetails(cells)

      void postRuntimeStatePatch({
        set: {
          [RUNTIME_STATE_KEYS.attendanceSummary]: {
            capturedAt: new Date().toISOString(),
            providerRuntimeStates,
            providerRuntimeDetails,
          },
        },
      })

      modeGovernor = resolveModeGovernor({
        decreeText: decree,
        intentKind: councilIntentState.intent,
        councilCommand: cmd,
        providerStates: providerRuntimeStates,
        directedFamilies: orderForGather,
      })

      const stagedCandidates = cells
        .filter(c => Boolean(c.textOut?.trim()))
        .map(c => ({
          family: c.family,
          textOut: councilProviderTextAfterRenderGate(c.family, c.textOut!.trim()),
          transientMessageIds: c.transientMessageIds,
        }))

      for (const row of stagedCandidates) staged.push(row)

      const allNonDirectProvidersFailed =
        !attendanceWave
        && !cmd.directInvocation
        && orderForGather.length > 0
        && stagedCandidates.length === 0
        && cells.some(c => c.runtime === 'FAILED' || c.runtime === 'TIMED_OUT' || c.runtime === 'SKIPPED')
      if (allNonDirectProvidersFailed) {
        const line = 'Council provider calls did not return a response. See Diagnostics for per-family status.'
        gatherPostSystem(line)
        void gatherPostLive({ role: 'system', content: line, family: 'SYSTEM' })
      }

      const attendanceRevealedFamilies = new Set<CouncilOrchestrationFamily>(
        staged.map(s => s.family),
      )

      const directInvocationTarget =
        !attendanceWave && cmd.directInvocation ? cmd.targetFamilies[0] : undefined
      const directInvocationHasStagedResult = Boolean(
        directInvocationTarget && staged.some(s => s.family === directInvocationTarget && s.textOut.trim()),
      )
      if (directInvocationTarget && !directInvocationHasStagedResult) {
        const cell = cells.find(c => c.family === directInvocationTarget) ?? {
          family: directInvocationTarget,
          textOut: null,
          runtime: 'SKIPPED' as const,
          runtimeDetail: 'missing_direct_invocation_result',
        }
        const terminalReason = terminalReasonForDirectInvocation(cell)
        const terminalText = terminalTextForDirectInvocation(
          directInvocationTarget,
          terminalReason,
          cell.runtimeDetail,
        )
        const terminalMessageId = createMessageId(`direct-terminal-${directInvocationTarget}`)
        const removeIds = collectTransientProviderStatusMessageIds({
          family: directInvocationTarget,
          messageIds: cell.transientMessageIds,
          includeGenericRecovery: true,
          keepMessageIds: [terminalMessageId],
          contentFallback: !cell.transientMessageIds?.length,
        })
        const terminalMessage: CouncilMessage = {
          id: terminalMessageId,
          familyName: 'SYSTEM',
          content: terminalText,
          timestamp: new Date().toLocaleTimeString(),
          color: '#FFD700',
          icon: '⚙',
          provider: '',
          messageType: 'system',
        }
        addMessages([terminalMessage], { removeIds })
        const providerError = councilSnapRef.current.providerErrorMessage
        if (
          providerError
          && isTransientProviderStatusContent(providerError, directInvocationTarget, { includeGenericRecovery: true })
        ) {
          councilDispatch({ type: 'CLEAR_PROVIDER_ERROR' })
        }
        const terminalMetadata = {
          directInvocationTarget,
          finalVisibleMessageEmitted: true,
          temporaryMessagesRemoved: removeIds.length,
          placeholdersRemoved: removeIds.length,
          terminalReason,
          terminalVisibleMessageExists: true,
          terminalFallbackInserted: true,
          packetCloseAllowed: true,
        }
        void postLiveCouncilMessage(
          { role: 'system', content: terminalText, family: directInvocationTarget },
          {
            allowProviderFailureMessage: true,
            providerRuntime: cell.runtime,
            directInvocationMetadata: terminalMetadata,
          },
        )
        emitDirectInvocationTerminalDebug(terminalMetadata)
      }

      if (staged.length) {
        anySuccess = true
        councilDispatch({ type: 'CLEAR_PROVIDER_ERROR' })
      }

      if (controller.signal.aborted || councilPausedRef.current) {
        decreePacketFlushCompleteRef.current = true
        applyCouncilPacketRender(
          buildCouncilRenderPacket({
            command: activeCouncilCommandRef.current,
            sessionState: 'CLOSED',
            packetStatus: 'idle',
            families: [],
            extraWarnings: [...modeWarnings, 'packet_cancelled_mid_gather'],
            providerRuntimeStates,
            providerRuntimeDetails,
          }),
        )
        return
      }

      const releaseAttendancePacket = async (
        linesToRelease: StagedCouncilLine[],
        runtimeStates: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>,
      ) => {
        if (!linesToRelease.length) return []
        const topicLock = decreeTopicLockPreview
        const runtimeDetailsByFamily = Object.fromEntries(
          cells
            .filter((c): c is GatherCell & { runtimeDetail: string } => Boolean(c.runtimeDetail))
            .map(c => [c.family, c.runtimeDetail]),
        ) as Partial<Record<CouncilOrchestrationFamily, string>>
        const verifiedRuntimeByFamily = verifiedContextsFromProviderStates(
          runtimeStates,
          runtimeDetailsByFamily,
        )
        const roomStatuses = buildRoomStatusesFromProviderStates(runtimeStates, orderForGather)
        const moderated = runFinalModerator({
          lines: linesToRelease.map(s => ({ family: s.family, content: s.textOut })),
          topicLock,
          activeScope: councilIntentState.scope,
          councilCommand: cmd,
          modeGovernor,
          roomStatuses,
          verifiedRuntimeByFamily,
        })
        for (const line of moderated) {
          if (!line.content.trim()) {
            attendanceRevealedFamilies.add(line.family)
            continue
          }
          const sourceLine =
            linesToRelease.find(l => l.family === line.family && l.textOut.trim() === line.content.trim())
            ?? linesToRelease.find(l => l.family === line.family)
          const visible = await revealOrchestrationTurn(line.family, line.content, inputText(), {
            councilRevealSource: 'decree',
            transientMessageIds: sourceLine?.transientMessageIds,
          })
          if (!visible) continue
          attendanceRevealedFamilies.add(line.family)
          const vis = orchestrationVisual(line.family)
          const bubble = vis.bubbleFamilyName ?? rosterLabel(line.family)
          void postLiveCouncilMessage(
            { role: 'assistant', content: line.content, family: bubble },
            {
              responseSuccessful: true,
              providerRuntime: runtimeStates[line.family],
            },
          )
          const focusSnippet = compactDisplayWhitespace(line.content, 120)
          setFamilyCurrentFocus(prev => ({ ...prev, [line.family]: focusSnippet }))
          void enqueueCouncilProposals(line.content, line.family)
        }
        return moderated
      }

      if (staged.length > 0 || attendanceWave) {
        applyCouncilPacketRender(
          buildCouncilRenderPacket({
            command: activeCouncilCommandRef.current,
            sessionState: 'FINALIZING',
            packetStatus: 'finalizing',
            families: staged.map(s => ({ family: s.family, content: s.textOut })),
            extraWarnings: [...modeWarnings, 'packet_finalizing'],
            providerRuntimeStates,
            providerRuntimeDetails,
          }),
        )
        const syncMs = resolveCouncilPacketSyncMs({
          intentTier: intent.tier,
          mode: activeCouncilCommandRef.current.mode,
          intentKind: councilIntentState.intent,
          renderImmediately: modeGovernor.renderImmediately,
        })
        const elapsed = Date.now() - decreePacketOpenedAtMsRef.current
        if (elapsed < syncMs) await wait(syncMs - elapsed)

        if (controller.signal.aborted || councilPausedRef.current) {
          decreePacketFlushCompleteRef.current = true
          applyCouncilPacketRender(
            buildCouncilRenderPacket({
              command: activeCouncilCommandRef.current,
              sessionState: 'CLOSED',
              packetStatus: 'idle',
              families: [],
              extraWarnings: [...modeWarnings, 'packet_cancelled_before_release'],
              providerRuntimeStates,
              providerRuntimeDetails,
            }),
          )
          return
        }

        let allModerated: Awaited<ReturnType<typeof releaseAttendancePacket>> = []
        if (staged.length > 0) {
          allModerated = await releaseAttendancePacket(staged, providerRuntimeStates)
        }

        if (attendanceWave && batchCeilingMs != null) {
          const hardCloseMs = resolveAttendanceHardCloseMs({ familyCount: directedOrder.length })
          const hardRemaining = Math.max(0, hardCloseMs - batchCeilingMs)
          if (hardRemaining > 0) {
            await Promise.race([wait(hardRemaining), Promise.allSettled(gatherPromises)])
          } else {
            await Promise.allSettled(gatherPromises)
          }

          cells = directedOrder.map(family => {
            const done = outcomeByFamily.get(family)
            if (!done) {
              return {
                family,
                textOut: null,
                runtime: 'TIMED_OUT' as const,
                runtimeDetail: 'attendance_hard_close',
              }
            }
            const hasContent = Boolean(done.textOut?.trim())
            return {
              ...done,
              runtime: runtimeAfterAttendanceHardClose({
                runtime: done.runtime,
                hasContent,
                runtimeDetail: done.runtimeDetail,
              }),
            }
          })

          providerRuntimeStates = Object.fromEntries(cells.map(c => [c.family, c.runtime])) as Partial<
            Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>
          >
          providerRuntimeDetails = gatherCellsToProviderRuntimeDetails(cells)

          modeGovernor = resolveModeGovernor({
            decreeText: decree,
            intentKind: councilIntentState.intent,
            councilCommand: cmd,
            providerStates: providerRuntimeStates,
            directedFamilies: directedOrder,
          })

          const lateLines: StagedCouncilLine[] = []
          for (const c of cells) {
            if (attendanceRevealedFamilies.has(c.family)) continue
            if (c.textOut?.trim()) {
              lateLines.push({
                family: c.family,
                textOut: c.textOut.trim(),
                transientMessageIds: c.transientMessageIds,
              })
              continue
            }
            const slotStatus =
              c.runtime === 'DEGRADED'
                ? 'DEGRADED'
                : c.runtime === 'FAILED'
                  ? 'FAILED'
                  : 'UNAVAILABLE'
            lateLines.push({
              family: c.family,
              textOut: shapeAttendanceForModeGovernor('', c.family, slotStatus),
            })
          }
          if (lateLines.length) {
            const lateModerated = await releaseAttendancePacket(lateLines, providerRuntimeStates)
            allModerated = [...allModerated, ...lateModerated]
          }
        }

        decreePacketFlushCompleteRef.current = true

        const topicLock = decreeTopicLockPreview
        const isIntegrityish = (w: string) =>
          w.startsWith('integrity_')
          || w.startsWith('protocol_drift_response')
          || w === 'protocol_drift_topic_scope_residual'
          || w === 'protocol_drift_active_scope_residual'

        const packetFamilies = allModerated
          .filter(m => m.content.trim())
          .map(m => {
            const iw = m.warnings.filter(isIntegrityish)
            const mw = m.warnings.filter(w => !isIntegrityish(w))
            return {
              family: m.family,
              content: m.content,
              ...(iw.length ? { integrityWarnings: iw } : {}),
              ...(mw.length ? { moderatorWarnings: mw } : {}),
            }
          })

        applyCouncilPacketRender(
          buildCouncilRenderPacket({
            command: activeCouncilCommandRef.current,
            sessionState: 'CLOSED',
            packetStatus: packetFamilies.length ? 'released' : 'idle',
            families: packetFamilies,
            extraWarnings: [
              ...modeWarnings,
              ...(topicLock.locked ? ['topic_scope_lock_active'] : []),
            ],
            providerRuntimeStates,
            providerRuntimeDetails,
          }),
        )
      } else {
        decreePacketFlushCompleteRef.current = true
        applyCouncilPacketRender(
          buildCouncilRenderPacket({
            command: activeCouncilCommandRef.current,
            sessionState: 'CLOSED',
            packetStatus: 'idle',
            families: [],
            extraWarnings: modeWarnings,
            providerRuntimeStates,
            providerRuntimeDetails,
          }),
        )
      }

      if (controller.signal.aborted || councilPausedRef.current) return

      councilDispatch({ type: 'SET_COUNCIL_CHANNEL_OPEN', payload: true })
      if (!attendanceWave) {
        if (councilSnapRef.current.councilState === 'idle') {
          councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'active' })
        }
      } else {
        councilDispatch({ type: 'RESET_AUTONOMOUS' })
        councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: false })
        councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'idle' })
        setContinuationRequests([])
        orchRedTeamEarlyLatchRef.current = false
        lastAutonomousHadLiveResearchRef.current = false
        lastAutonomousResearchFamilyRef.current = null
        setTypingFamily(null)
        setLiveResearchHud(null)
        setFamilyDuty(Object.fromEntries(COUNCIL_ROSTER.map(r => [r.id, r.defaultDuty])))
        setFamilyCurrentFocus({})
      }

      if (
        anySuccess
        && intent.tier !== 'casual'
        && !inputText().toLowerCase().includes('continue council discussion')
        && !attendanceWave
      ) {
        const memoryActionId = `memory-save-${Date.now()}`
        addRaelAction({
          action_id: memoryActionId,
          related_opportunity_id: null,
          title: 'Memory save approval',
          question: 'Council wants permission to save this response into Chronicle memory.',
          response_options: ['Save Memory', 'Not Now'],
          urgency: 'low',
          expires_at: null,
          source_agent: 'Memory',
        })
        setMemorySavePrompt({
          reason: 'new council response may be useful later',
          memory: {
            content: `Council response (latest decree): ${decree}`.slice(0, 1200),
            source: 'council',
            family: 'Council',
            tags: ['council', 'response'],
            importance: 2,
          },
        })
      }

      clearOrchestrationTimer()
      if (
        intent.maxFamilies > 0
        && !attendanceWave
        && activeCouncilCommandRef.current.mode === 'emergency'
      ) {
        window.setTimeout(() => {
          const s = councilSnapRef.current
          if (s.councilState !== 'active' || !s.councilChannelOpen) return
          scheduleNextOrchestration()
        }, 0)
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      const msg = sanitizeMemoryRuntimeText(error instanceof Error ? error.message : 'Council unreachable.')
      addSystemMessage(`[Error] ${msg}`)
      lastCouncilFamilyErrorRef.current = decreeSubmitFaultAnchor ?? 'chatgpt'
      councilDispatch({
        type: 'SET_PROVIDER_ERROR',
        payload: msg,
      })
      if (toolIntent) endToolRequest()
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      sequentialDiagnosticApiRef.current = null
      const snap = sequentialDiagnosticsSessionRef.current
      if (snap?.active && snap.order.length) {
        const outs = (snap.outcomes ?? []).filter(o => o && o.runtime !== 'IN_FLIGHT')
        if (outs.length === snap.order.length) {
          const mode = snap.intentMode && snap.intentMode !== 'none' ? snap.intentMode : 'sequential_diagnostics'
          const modeLabel =
            mode === 'runtime_audit'
              ? 'Runtime audit'
              : mode === 'repair_review'
                ? 'Repair review'
                : mode === 'sequential_diagnostics'
                  ? 'Sequential diagnostics'
                  : 'Sequential diagnostic'
          void postRuntimeStatePatch({
            appendDiagnosticEvents: [
              {
                kind: 'diagnostic_session_complete',
                at: new Date().toISOString(),
                intentMode: mode,
                order: snap.order,
                outcomes: outs,
              },
            ],
            set: {
              [RUNTIME_STATE_KEYS.diagnosticModeSummary]: {
                at: new Date().toISOString(),
                intentMode: mode,
                label: modeLabel,
              },
            },
          })
        }
      }
      sequentialDiagnostics.stop()
      setTypingFamily(null)
      if (toolIntent) endToolRequest()
      setLoading(false)
    }
  }

  useEffect(() => {
    submitDecreeRef.current = submitDecree
  })

  const handleDecree = async (event?: FormEvent) => {
    event?.preventDefault()
    await sendLiveCouncilThroneMessage({
      rawInput: command,
      isBusy: () => loading,
      clearDraft: () => setCommand(''),
      detectExpansion: d => {
        const expansionNeed = detectExpansionNeed(d)
        if (!expansionNeed) return null
        return { decree: d, ...expansionNeed }
      },
      onExpansionQueued: (decree, expansion) => {
        addRaelAction({
          action_id: `expanded-analysis-${decree.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`,
          related_opportunity_id: null,
          title: 'Expanded analysis approval',
          question: `Council requests expanded analysis. Estimated extra usage: ${formatCost(expansion.extraCost)}. Reason: ${expansion.reason}. Continue?`,
          response_options: ['Approve', 'Decline', 'Summarize instead'],
          urgency: expansion.urgent ? 'high' : 'medium',
          expires_at: null,
          source_agent: 'Cost Guard',
        })
        setExpansionPrompt({ decree, extraCost: expansion.extraCost, reason: expansion.reason, urgent: expansion.urgent })
        setUsageRows(createUsageEstimate(decree, DEFAULT_OUTPUT_TOKEN_BUDGET))
        setCurrentDecreeCost(totalUsageCost(createUsageEstimate(decree, DEFAULT_OUTPUT_TOKEN_BUDGET)))
      },
      sendDecree: sendRaelDecree,
    })
  }

  const executeRecallCommand = async (recallCommand: ParsedRecallCommand) => {
    try {
      const params = new URLSearchParams({
        command: recallCommand.kind,
        limit: recallCommand.summarize ? '30' : '20',
        full: '1',
      })
      if (liveCouncilConvId) params.set('sessionId', liveCouncilConvId)
      const res = await fetch(`/api/memory/archive?${params.toString()}`, { cache: 'no-store' })
      const payload = await res.json() as {
        command?: ParsedRecallCommand
        records?: RecallTranscriptPreview[]
        summaries?: RecallSummaryPreview[]
        error?: string
      }
      const persistenceAvailable = res.headers.get('x-war-room-persistence') === 'available'
      const command = payload.command ?? recallCommand
      const records = Array.isArray(payload.records) ? payload.records : []
      const summaries = Array.isArray(payload.summaries) ? payload.summaries : []
      setMemoryRecallView({
        command,
        records,
        summaries,
        recalledAt: new Date().toISOString(),
        persistenceAvailable,
        error: typeof payload.error === 'string' ? payload.error : null,
      })
      const recallPreview = buildRecallPreview({ command, records, summaries })
      addMessages([{
        id: createMessageId('memory-recall'),
        familyName: 'MEMORY ARCHIVE',
        content: persistenceAvailable
          ? `${recallPreview.label}: ${recallPreview.resultCount} result${recallPreview.resultCount === 1 ? '' : 's'}.`
          : 'Memory archive recall unavailable; persistence is not configured.',
        timestamp: new Date().toLocaleTimeString(),
        color: '#60A5FA',
        icon: '◷',
        provider: 'archive',
        messageType: 'memory_recall_preview',
        recallPreview,
      }])
      if (process.env.NODE_ENV === 'development') {
        console.debug('[Live Council] Memory preview ready in Live Council.')
      }
    } catch {
      setMemoryRecallView({
        command: recallCommand,
        records: [],
        summaries: [],
        recalledAt: new Date().toISOString(),
        persistenceAvailable: false,
        error: 'Memory archive recall failed. Raw transcript remains preserved; try again after persistence recovers.',
      })
      addMessages([{
        id: createMessageId('memory-recall-error'),
        familyName: 'MEMORY ARCHIVE',
        content: 'Memory archive recall failed. See archive view.',
        timestamp: new Date().toLocaleTimeString(),
        color: '#F87171',
        icon: '!',
        provider: 'archive',
        messageType: 'memory_recall_preview',
        recallPreview: {
          label: recallLabel(recallCommand),
          resultCount: 0,
          topItems: [],
          latestTimestamp: null,
          commandKind: recallCommand.kind,
        },
      }])
    }
  }

  const appendVisibleRaelDecree = (decree: string) => {
    addMessages([{
      id: createMessageId('rael'),
      familyName: "RA'EL",
      content: decree,
      timestamp: new Date().toLocaleTimeString(),
      color: '#FFD700',
      icon: '⚔',
      provider: '',
      messageType: 'decree'
    }])

    void postLiveCouncilMessage(
      { role: 'user', content: decree, family: "RA'EL" },
      { responseSuccessful: true },
    )
  }

  const updateContinuationRequestStatus = (id: string, decision: ContinuationDecision) => {
    const status =
      decision === 'allow'
        ? 'approved'
        : decision === 'summarize'
          ? 'summarized'
          : decision === 'hold'
            ? 'held'
            : 'rejected'
    setContinuationRequests(prev => prev.map(p => (p.id === id ? { ...p, status } : p)))
    if (decision === 'allow') recordContinuationDiagnostic('granted')
    if (decision === 'deny') recordContinuationDiagnostic('denied')
    if (decision === 'summarize') recordContinuationDiagnostic('summarized')
    if (decision === 'hold') recordContinuationDiagnostic('held')
  }

  const activateCouncilHold = (reason = 'Ra’el ordered hold.') => {
    clearOrchestrationTimer()
    cancelActiveCouncilRequest()
    councilDispatch({ type: 'SET_REQUIRES_RAEL', payload: true })
    councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: false })
    councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'paused' })
    setFamilyDuty(prev =>
      Object.fromEntries(Object.keys(prev).map(key => [key, 'standing_by' as CouncilDutyState])),
    )
    addSystemMessage(`Council acknowledged: hold. Families standing by. ${reason}`, { force: true })
  }

  const runPermissionedContinuation = async (
    family: CouncilOrchestrationFamily | null,
    directive: string,
    mode: CouncilMode = 'continue',
  ) => {
    const nextIntent: ClassifyRaElMessageResult = {
      tier: mode === 'summarize' ? 'council_full' : 'coordination',
      shouldEmitBusEvents: false,
      shouldRunFamilyRound: true,
      maxFamilies: family ? 1 : 1,
    }
    lastDecreeIntentRef.current = nextIntent
    if (family) {
      const cmd = buildSingleFamilyContinuationCommand(family)
      activeCouncilCommandRef.current = cmd
      setCouncilUiCommand(cmd)
    } else {
      const cmd = {
        ...DEFAULT_COUNCIL_COMMAND,
        mode: 'council' as const,
        responseLimits: { maxResponsesPerFamily: 1, maxChars: 4000 },
      }
      activeCouncilCommandRef.current = cmd
      setCouncilUiCommand(cmd)
    }
    councilDispatch({ type: 'RESET_AUTONOMOUS' })
    councilDispatch({ type: 'SET_REQUIRES_RAEL', payload: false })
    if (councilSnapRef.current.councilState === 'paused') {
      councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'active' })
    }
    await submitDecree(directive, mode)
  }

  const handleContinuationDecision = async (cr: ContinuationRequest, decision: ContinuationDecision) => {
    updateContinuationRequestStatus(cr.id, decision)
    if (decision === 'deny') return
    if (decision === 'hold') {
      activateCouncilHold(`${COUNCIL_ROSTER.find(r => r.id === cr.family)?.label ?? cr.family} continuation held.`)
      return
    }
    const familyLabel = COUNCIL_ROSTER.find(r => r.id === cr.family)?.label ?? cr.family
    if (decision === 'summarize') {
      await runPermissionedContinuation(
        cr.family,
        `${familyLabel}: summarize the concern briefly, then stop. Reason: ${cr.message}`,
        'summarize',
      )
      return
    }
    await runPermissionedContinuation(
      cr.family,
      `${familyLabel}: permission granted for one continuation turn. Address only this reason, then stop: ${cr.message}`,
      'continue',
    )
  }

  const handleContinuationAuthorityCommand = async (decree: string): Promise<boolean> => {
    const t = decree.trim().toLowerCase().replace(/\u2019/g, "'").replace(/\s+/g, ' ')
    if (t === 'hold') {
      const held = continuationRequestsRef.current.filter(p => p.status === 'pending').length
      setContinuationRequests(prev => prev.map(p => (p.status === 'pending' ? { ...p, status: 'held' } : p)))
      if (held > 0) recordContinuationDiagnostic('held', held)
      activateCouncilHold()
      return true
    }
    if (t === 'deny continuation' || t === 'deny continuations') {
      setContinuationRequests(prev => prev.map(p => (p.status === 'pending' ? { ...p, status: 'rejected' } : p)))
      const denied = continuationRequestsRef.current.filter(p => p.status === 'pending').length
      if (denied > 0) recordContinuationDiagnostic('denied', denied)
      return true
    }
    if (t === 'summarize only') {
      const pending = continuationRequestsRef.current.find(p => p.status === 'pending')
      if (pending) {
        await handleContinuationDecision(pending, 'summarize')
        return true
      }
      await runPermissionedContinuation(null, 'summarize council discussion', 'summarize')
      return true
    }
    if (t === 'continue' || t.startsWith('continue ')) {
      const requestedFamily = familyFromContinuationDirective(decree)
      const pending = requestedFamily
        ? continuationRequestsRef.current.find(p => p.status === 'pending' && p.family === requestedFamily)
        : continuationRequestsRef.current.find(p => p.status === 'pending')
      if (pending) {
        await handleContinuationDecision(pending, 'allow')
        return true
      }
      const family = requestedFamily ?? null
      await runPermissionedContinuation(
        family,
        family
          ? `${COUNCIL_ROSTER.find(r => r.id === family)?.label ?? family}: Ra’el explicitly allowed one continuation turn. Continue briefly, then stop.`
          : 'Ra’el explicitly allowed one additional council continuation turn. Continue briefly, then stop.',
        'continue',
      )
      return true
    }
    return false
  }

  const sendRaelDecree = async (decree: string, mode?: CouncilMode) => {
    setExpansionPrompt(null)

    /*
     * Ra’el directive source: Live Council composer (`sendRaelDecree` → `submitDecree`).
     * `isRaelCouncilMessage` treats `messageType === 'decree'` or familyName containing RA'EL.
     * If external channels are ambiguous, prefer user text containing "Ra'el" — not wired here.
     */
    appendVisibleRaelDecree(decree)

    if (!mode && await handleContinuationAuthorityCommand(decree)) {
      return
    }

    const recallCommand = parseRecallCommand(decree)
    if (recallCommand) {
      await executeRecallCommand(recallCommand)
      return
    }

    const projectPacket = createProjectOrchestrationPacket(decree)
    if (projectPacket) {
      if (projectPacket.engineeringTaskPacket) {
        setLatestEngineeringTaskPacket(projectPacket.engineeringTaskPacket)
      }
      setLatestAnalystPacket(projectPacket.analystPacket)
      addMessages([{
        id: createMessageId('project-orchestration'),
        familyName: 'PROJECT ORCHESTRATOR',
        content: `Project orchestration prepared: ${projectPacket.intake.projectType}`,
        timestamp: new Date().toLocaleTimeString(),
        color: '#34D399',
        icon: 'P',
        provider: 'Live Council lanes',
        messageType: 'project_orchestration',
        projectOrchestrationPacket: projectPacket,
      }])
      setFamilyDuty(prev => {
        const next: Record<string, CouncilDutyState> = { ...prev }
        for (const lane of projectPacket.lanes) {
          if ((ALL_ORCHESTRATION_FAMILIES as string[]).includes(String(lane.agent))) {
            next[String(lane.agent)] = lane.status === 'waiting_approval' ? 'waiting_approval' : 'working'
          }
          if (lane.agent === 'cursor' || lane.agent === 'codex') {
            next.bridge_architect = 'waiting_approval'
          }
        }
        return next
      })
    }

    const analystPacket = createAnalystOperationsPacket(decree)
    if (analystPacket) {
      setLatestAnalystPacket(analystPacket)
      addMessages([{
        id: createMessageId('analyst-operations'),
        familyName: 'ANALYST OPERATIONS',
        content: `Analyst packet prepared: ${analystPacket.intake.analysisType}`,
        timestamp: new Date().toLocaleTimeString(),
        color: '#38BDF8',
        icon: 'A',
        provider: 'Data analyst lanes',
        messageType: 'analyst_operations',
        analystOperationsPacket: analystPacket,
      }])
      setFamilyDuty(prev => ({
        ...prev,
        chatgpt: 'working',
        grok: 'working',
        gemini: 'working',
        red_team: 'working',
      }))
    }

    const engineeringPacket = projectPacket?.engineeringTaskPacket ?? createEngineeringTaskPacket(decree)
    if (engineeringPacket && !projectPacket) {
      setLatestEngineeringTaskPacket(engineeringPacket)
      addMessages([{
        id: createMessageId('engineering-task'),
        familyName: 'ENGINEERING AGENT',
        content: `Engineering task prepared for Cursor: ${engineeringPacket.title}`,
        timestamp: new Date().toLocaleTimeString(),
        color: '#38BDF8',
        icon: '⌘',
        provider: 'Cursor manual handoff',
        messageType: 'engineering_task',
        engineeringTaskPacket: engineeringPacket,
      }])
      setFamilyDuty(prev => ({
        ...prev,
        claude: 'working',
        red_team: 'working',
        bridge_architect: 'waiting_approval',
      }))
    }

    if (isRepairPacketDecree(decree)) {
      void prepareRepairPacketFromCouncilMessage({
        id: createMessageId('repair-decree-source'),
        familyName: "RA'EL",
        content: decree,
        timestamp: new Date().toLocaleTimeString(),
        color: '#FFD700',
        icon: '⚔',
        provider: '',
        messageType: 'decree',
      })
    }

    const parsedCmd = resolveActiveCommand({ latestDecreeText: decree }).command
    activeCouncilCommandRef.current = parsedCmd
    setCouncilUiCommand(parsedCmd)
    lastRaelDirectiveContentRef.current = decree

    const intent = classifyRaElMessage(decree)
    lastDecreeIntentRef.current = intent

    if (councilSnapRef.current.councilState === 'provider_error') {
      councilDispatch({ type: 'CLEAR_PROVIDER_ERROR' })
    }
    councilDispatch({ type: 'RESET_AUTONOMOUS' })
    if (councilSnapRef.current.councilState === 'idle') {
      councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'active' })
    }
    void emitDecreeEvents(decree, intent.shouldEmitBusEvents)

    if (intent.tier === 'income_ops') {
      setIncomeOperationsMode(true)
    }

    const planningMeta =
      intent.tier === 'council_full'
      || intent.tier === 'income_ops'
      || detectCouncilPlanningMode(decree)
    void mergeCouncilConversationMetadata({
      incomeOperationsMode: intent.tier === 'income_ops' ? true : incomeOperationsMode,
      planningMode: planningMeta,
      participation: participationToggles,
      duty: familyDuty,
      lastDecreeAt: new Date().toISOString(),
      lastIntentTier: intent.tier,
    })

    if (isExplicitMemoryRequest(decree)) {
      void saveMemory({
        content: decree,
        source: 'decree',
        family: "RA'EL",
        tags: [detectToneMode(decree), mode ?? 'standard'],
        importance: mode === 'expanded' ? 3 : 2,
      })
    }

    if (detectOpportunityScoutIntent(decree)) {
      void runOpportunityScout()
    }

    await submitDecree(decree, mode)
  }

  const handleProjectAction = (
    action: 'approve' | 'pause' | 'redirect' | 'deeper_work',
    packet: ProjectOrchestrationPacket,
  ) => {
    const [approve, pause, deeper, redirect] = packet.approvalPacket.nextDecreeSuggestions
    if (action === 'pause') {
      appendVisibleRaelDecree(pause ?? `Pause project packet ${packet.id}.`)
      activateCouncilHold(`Project packet ${packet.id} paused by Commander control.`)
      return
    }
    if (action === 'redirect') {
      setCommand(redirect ?? `Redirect project packet ${packet.id}: `)
      addSystemMessage(`Redirect template loaded for ${packet.id}. Add Commander scope changes, then send.`, { force: true })
      return
    }
    const decree =
      action === 'approve'
        ? approve ?? `Approve project packet ${packet.id} for lane work only; no external action without final approval.`
        : deeper ?? `Deepen project packet ${packet.id}: require stronger evidence, alternate paths, and Red Team objections.`
    void sendRaelDecree(decree)
  }

  const handleSummarize = () => {
    lastDecreeIntentRef.current = {
      tier: 'council_full',
      shouldEmitBusEvents: false,
      shouldRunFamilyRound: true,
      maxFamilies: 4,
    }
    window.setTimeout(() => void submitDecree('summarize council discussion', 'summarize'), 0)
  }

  const handleViewArchive = () => {
    const parsed = parseRecallCommand('show archive')
    if (parsed) void executeRecallCommand(parsed)
  }

  const handleSummarizeSessionArchive = () => {
    const parsed = parseRecallCommand('summarize last session')
    if (parsed) void executeRecallCommand(parsed)
  }

  const handleRecallEconomicOps = () => {
    const parsed = parseRecallCommand('recall economic ops')
    if (parsed) void executeRecallCommand(parsed)
  }

  const handleOpenFullMemory = (preview: CouncilMemoryRecallPreview) => {
    const parsed = parseRecallCommand(preview.commandKind)
    const loaded = memoryRecallView?.command.kind === preview.commandKind
    if (!loaded && parsed) {
      void executeRecallCommand(parsed).then(() => setOperatorTab('memory'))
      return
    }
    setOperatorTab('memory')
  }

  const cycleFamilyDuty = (fid: CouncilOrchestrationFamily) => {
    const seq: CouncilDutyState[] = ['off_duty', 'standing_by', 'working', 'waiting_approval', 'blocked', 'completed']
    setFamilyDuty(prev => {
      const cur = prev[fid] ?? 'standing_by'
      const ix = Math.max(0, seq.indexOf(cur))
      const next = seq[(ix + 1) % seq.length]!
      const merged = { ...prev, [fid]: next }
      void mergeCouncilConversationMetadata({
        duty: merged,
        participation: participationToggles,
        incomeOperationsMode,
      })
      return merged
    })
  }

  const toggleParticipation = (key: keyof CouncilParticipationToggles) => {
    setParticipationToggles(p => {
      const next = { ...p, [key]: !p[key] }
      void mergeCouncilConversationMetadata({
        duty: familyDuty,
        participation: next,
        incomeOperationsMode,
      })
      return next
    })
  }

  const setIncomeOps = (next: boolean) => {
    setIncomeOperationsMode(next)
    void mergeCouncilConversationMetadata({
      duty: familyDuty,
      participation: participationToggles,
      incomeOperationsMode: next,
    })
  }

  const pauseCouncil = () => {
    activateCouncilHold('Manual pause control engaged.')
  }

  const resumeCouncil = () => {
    const waiting = councilSnapRef.current.requiresRaelForAutonomous
    if (waiting) {
      councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'waiting_for_rael' })
    } else {
      councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'active' })
    }
    if (!waiting && councilSnapRef.current.councilChannelOpen) {
      scheduleNextOrchestration()
    }
  }

  const resetCouncilTemporaryRuntime = () => {
    clearOrchestrationTimer()
    cancelActiveCouncilRequest()
    skipGeminiForSessionRef.current = false
    geminiFailureCountRef.current = 0
    geminiLastErrorSummaryRef.current = null
    geminiUnavailableUserMessagedRef.current = false
    orchRedTeamEarlyLatchRef.current = false
    lastCouncilFamilyErrorRef.current = null
    activeCouncilCommandRef.current = { ...DEFAULT_COUNCIL_COMMAND }
    lastRaelDirectiveContentRef.current = ''
    continuationThrottleRef.current = {}
    setContinuationRequests([])
    setCouncilUiCommand({ ...DEFAULT_COUNCIL_COMMAND })
    setCouncilPacketRender(null)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(GEMINI_REPAIR_ENQUEUE_METADATA_KEY)
    }
  }

  const startFreshCouncilSession = async (reason: 'new' | 'archive') => {
    resetCouncilTemporaryRuntime()
    setSessionLifecycle(reason === 'archive' ? 'archived' : 'active')
    const nextSessionId = newSessionId()
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(COUNCIL_SESSION_STORAGE_KEY)
      sessionStorage.removeItem(LIVE_COUNCIL_CONV_STORAGE_KEY)
    }
    councilDispatch({ type: 'END_SESSION', payload: { sessionId: nextSessionId } })
    if (persistenceAvailable) {
      try {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: reason === 'archive' ? 'Live Council Archive Follow-up' : 'Live Council',
            metadata: { council: { source: 'live_council', incomeOperationsMode, previousSession: liveCouncilConvId ?? councilSnapRef.current.sessionId } },
          }),
        })
        if (res.ok) {
          const body = await res.json() as { conversation?: { id?: string } }
          const id = typeof body.conversation?.id === 'string' ? body.conversation.id : null
          if (id) {
            sessionStorage.setItem(LIVE_COUNCIL_CONV_STORAGE_KEY, id)
            setLiveCouncilConvId(id)
          }
        }
      } catch {
        /* session-only fallback */
      }
    }
    addSystemMessage(reason === 'archive'
      ? 'Session archived. Clean council session is ready.'
      : 'New Council Session ready. Approved memory and provider state preserved.', { force: true })
  }

  const clearCouncilSession = () => {
    councilDispatch({ type: 'SET_MESSAGES', payload: [] })
    addSystemMessage('Visible council thread cleared. Durable archive and audit history were not deleted.', { force: true })
  }

  const softResetCouncilSession = () => {
    resetCouncilTemporaryRuntime()
    setSessionLifecycle('active')
    councilDispatch({ type: 'CLEAR_SESSION', payload: { sessionId: councilSnapRef.current.sessionId } })
    addSystemMessage('Soft reset complete. Temporary family context cleared; approved memory preserved.', { force: true })
  }

  const archiveCurrentCouncilSession = () => {
    const snapshot = messagesRef.current
    if (snapshot.length && liveCouncilConvId && persistenceAvailable) {
      const latestDecree = [...snapshot].reverse().find(isRaelCouncilMessage)
      void fetch('/api/memory/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: liveCouncilConvId,
          createSummary: true,
          messages: snapshot.map(message => ({
            id: message.id,
            sessionId: liveCouncilConvId,
            decreeId: latestDecree?.id ?? null,
            timestamp: new Date().toISOString(),
            role: archiveRoleForMessage(message),
            family: message.familyName,
            provider: message.provider || null,
            content: message.content,
            messageType: message.messageType,
            tags: [message.messageType, message.familyName, 'manual_archive'].filter(Boolean),
            topic: archiveTopicForMessage(message),
            sourceMode: 'manual_archive',
            operatorId: null,
            operatorName: "Ra'el",
            visibility: 'private',
          })),
        }),
      }).catch(() => undefined)
    }
    void startFreshCouncilSession('archive')
  }

  const clearCouncilNoise = () => {
    addSystemMessage(`Clear Noise active. ${collapsedCouncilNoiseCount} repeated notice${collapsedCouncilNoiseCount === 1 ? '' : 's'} collapsed; persisted history unchanged.`, { force: true })
  }

  const exportCouncilSession = () => {
    const payload = {
      sessionId: councilSnapRef.current.sessionId,
      conversationId: liveCouncilConvId,
      exportedAt: new Date().toISOString(),
      messages: messagesRef.current.map(sanitizedCouncilMessage),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `council-session-${payload.sessionId}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggleDeepDiscussion = () => {
    councilDispatch({ type: 'SET_DEEP_DISCUSSION', payload: !councilSnapRef.current.deepDiscussionMode })
  }

  const retryProvider = () => {
    councilDispatch({ type: 'CLEAR_PROVIDER_ERROR' })
    if (councilSnapRef.current.councilChannelOpen) scheduleNextOrchestration()
  }

  const handleScroll = () => {
    const el = scrollContainerRef.current
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const next = distanceFromBottom < 80
    setAutoScrollEnabled(prev => (prev === next ? prev : next))
  }

  const grantStandingAndRetryAudit = () => {
    grantWarRoomStandingAck()
    setStandingAckHint(null)
    const d = pendingAuditDecreeRef.current
    pendingAuditDecreeRef.current = null
    if (d) void emitDecreeEvents(d, true)
  }

  const standingPermissionStrip = standingAckHint ? (
    <div
      className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-yellow-900 px-6 py-2"
      style={{ background: 'rgba(251,191,36,0.08)' }}
    >
      <span className="max-w-[70%] text-[10px] leading-snug tracking-widest" style={{ color: '#FDE047' }}>{standingAckHint}</span>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
          style={{ background: '#FBBF24', color: '#000' }}
          onClick={grantStandingAndRetryAudit}
        >
          Approve for this tab
        </button>
        <button
          type="button"
          className="rounded px-3 py-1 text-[10px] font-bold tracking-widest"
          style={{ border: '1px solid #555', color: '#888' }}
          onClick={() => {
            setStandingAckHint(null)
            pendingAuditDecreeRef.current = null
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  ) : null

  const activeFamiliesSection = (
    <section className="flex-shrink-0 rounded border border-white/10 p-3 mx-6 mb-2" style={{ color: '#aaa' }}>
      <div className="mb-1 font-bold" style={{ color: '#86EFAC' }}>ACTIVE FAMILIES</div>
      <div className="flex flex-wrap gap-1">
        {COUNCIL_ROSTER.map(entry => {
          const eid = entry.engineId
          const providerKey = eid && eid in providerHealth.providers ? eid as ProviderFamilyKey : null
          const fn = providerKey ? providerHealth.providers[providerKey] === 'online' || providerHealth.providers[providerKey] === 'standby' : false
          const duty = familyDuty[entry.id] ?? entry.defaultDuty
          return (
            <button
              key={entry.id}
              type="button"
              title="Cycle duty (saved to thread metadata when DB online)"
              onClick={() => cycleFamilyDuty(entry.id)}
              className="rounded px-2 py-0.5 text-[9px]"
              style={{ border: '1px solid #333', color: fn ? '#9AE6B4' : '#777' }}
            >
              {entry.label}
              {' '}
              <span style={{ color: '#888' }}>({duty})</span>
            </button>
          )
        })}
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px]" style={{ color: '#888' }}>
        <input type="checkbox" checked={incomeOperationsMode} onChange={() => setIncomeOps(!incomeOperationsMode)} />
        Income Operations (Grok/Gemini/ChatGPT first)
      </label>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px]" style={{ color: '#888' }}>
        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={participationToggles.includeKimi} onChange={() => toggleParticipation('includeKimi')} />Kimi</label>
        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={participationToggles.includeRedTeam} onChange={() => toggleParticipation('includeRedTeam')} />Red Team</label>
        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={participationToggles.includeBaby} onChange={() => toggleParticipation('includeBaby')} />Baby</label>
        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={participationToggles.includeBridgeArchitect} onChange={() => toggleParticipation('includeBridgeArchitect')} />Bridge Architect</label>
      </div>
      {uiMode === 'operator' && (
        <div className="mt-2 rounded border border-white/5 px-2 py-1 text-[8px] leading-tight" style={{ color: '#666' }}>
          <div className="mb-0.5 font-bold tracking-widest" style={{ color: '#9CA3AF' }}>AGENT DUTY · CURRENT FOCUS</div>
          <div className="flex flex-wrap gap-1">
            {COUNCIL_ROSTER.slice(0, 7).map(entry => {
              const duty = familyDuty[entry.id] ?? entry.defaultDuty
              const focus = familyCurrentFocus[entry.id]
              return (
                <span key={entry.id} className="max-w-[11rem] truncate rounded border border-white/10 px-1 py-0.5" title={focus ? `${duty} — ${focus}` : duty}>
                  <span style={{ color: '#86EFAC' }}>{entry.label.replace(' Family', '')}</span>
                  <span style={{ color: '#555' }}> · </span>
                  <span style={{ color: '#888' }}>{focus ?? duty}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )

  const activeOrdersStrip = (
    <div className="flex-shrink-0 border-b border-yellow-900 px-6 py-2" style={{ background: 'rgba(96,165,250,0.04)' }}>
      <div className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: '#93C5FD' }}>ACTIVE ORDERS (queue)</div>
      {queueActions.length === 0 ? (
        <p className="text-[9px]" style={{ color: '#555' }}>No recent queued actions for this thread.</p>
      ) : (
        <ul className="flex flex-wrap gap-2 text-[9px]" style={{ color: '#aaa' }}>
          {queueActions.map(q => (
            <li key={q.id} className="rounded border border-white/10 px-2 py-0.5 font-mono">
              {q.type} · {q.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const jumpToLatest = () => {
    setAutoScrollEnabled(true)
    window.requestAnimationFrame(() => {
      const el = scrollContainerRef.current
      if (!el) return
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } catch {
        el.scrollTop = el.scrollHeight
      }
    })
  }

  const handleExpansionApprove = async () => {
    if (!expansionPrompt || loading) return
    await sendRaelDecree(expansionPrompt.decree, 'expanded')
  }

  const handleExpansionDecline = async () => {
    if (!expansionPrompt || loading) return
    await sendRaelDecree(expansionPrompt.decree)
  }

  const handleExpansionSummarize = async () => {
    if (!expansionPrompt || loading) return
    await sendRaelDecree(expansionPrompt.decree, 'summarize')
  }

  const pendingNeedsRael = raelActions.some(a => a.status === 'pending')
  const visibleOperatorTabs = useMemo(
    () => OPERATOR_TABS.filter(tab => uiMode === 'advanced' || !ENGINEERING_TABS.includes(tab.id)),
    [uiMode],
  )
  useEffect(() => {
    if (uiMode === 'operator' && ENGINEERING_TABS.includes(operatorTab)) {
      setOperatorTab('command')
    }
  }, [operatorTab, uiMode])
  const providerStripKeys: ProviderFamilyKey[] = ['claude', 'chatgpt', 'grok', 'gemini', 'redteam']
  const providerStatusStyles: Record<ProviderConnectionStatus, { color: string; dot: string; shadow: string }> = {
    online: { color: '#9AE6B4', dot: '#00ff41', shadow: '0 0 8px #00ff41' },
    standby: { color: '#FFD700', dot: '#FFD700', shadow: '0 0 8px rgba(255,215,0,0.7)' },
    not_connected: { color: '#444', dot: '#203321', shadow: 'none' },
    error: { color: '#EF4444', dot: '#EF4444', shadow: '0 0 8px rgba(239,68,68,0.8)' },
  }
  const coreProviderStates = [providerHealth.providers.chatgpt, providerHealth.providers.claude, providerHealth.providers.grok]
  const currentPacketProviderIssue = useMemo(
    () => packetHasActionableProviderIssues(
      councilPacketRender?.providerRuntimeStates,
      councilPacketRender?.providerRuntimeDetails,
    ),
    [councilPacketRender],
  )
  const packetTerminalProviderHealthy = useMemo(() => {
    const p = councilPacketRender
    if (!p) return false
    if (p.sessionState !== 'CLOSED') return false
    if (p.packetStatus !== 'released' && p.packetStatus !== 'idle') return false
    return !packetHasActionableProviderIssues(p.providerRuntimeStates, p.providerRuntimeDetails)
  }, [councilPacketRender])
  /** Council latched `provider_error` that disagrees with current packet + decree attempt (stale latch after success). */
  const councilProviderErrorFooterActive =
    council.councilState === 'provider_error'
    && !(
      packetTerminalProviderHealthy
      && councilPacketRenderBoundRoundRef.current === latestDecreeAttemptRoundRef.current
      && lastCouncilFamilyErrorRef.current === null
    )
  const footerShowsPacketOrCouncilProviderIssue =
    Boolean(currentPacketProviderIssue) || councilProviderErrorFooterActive
  const chatHealthLabel = useMemo(() => {
    if (loading) return 'Working'
    if (liveResearchHud?.mode === 'failed') return 'Error'
    if (footerShowsPacketOrCouncilProviderIssue) return 'Error'
    return 'Ready'
  }, [
    loading,
    liveResearchHud?.mode,
    footerShowsPacketOrCouncilProviderIssue,
  ])
  const councilContinueStatusLine = useMemo(() => {
    if (footerShowsPacketOrCouncilProviderIssue) return 'Provider issue — see family status badges.'
    if (liveResearchHud?.mode === 'completing' || liveResearchHud?.councilPhase === 'model_running') {
      return 'Research completing'
    }
    if (liveResearchHud?.mode === 'failed') return 'Research failed'
    if (liveResearchHud?.responseCompletion === 'truncated' || liveResearchHud?.responseCompletion === 'partial') {
      return 'Council Active · response partial'
    }
    if (council.councilState === 'paused') return 'Paused'
    if (council.councilState === 'idle') return 'Idle'
    if (council.councilState === 'waiting_for_rael') return 'Waiting for Ra’el'
    if (council.councilState === 'researching') return 'Researching'
    if (council.councilState === 'active' && council.isAwaitingResponses) return 'Families Responding'
    if (council.councilState === 'active') return 'Council Active'
    return council.councilState
  }, [
    footerShowsPacketOrCouncilProviderIssue,
    council.councilState,
    council.isAwaitingResponses,
    liveResearchHud?.mode,
    liveResearchHud?.councilPhase,
    liveResearchHud?.responseCompletion,
  ])
  const providerHealthLabel = coreProviderStates.some(status => status === 'online' || status === 'standby')
    ? 'Ready'
    : 'Degraded'
  const persistenceHealthLabel = persistenceAvailable ? 'Ready' : 'Session only'
  const memoryRuntime = useMemo(
    () => mapRawMemoryRuntimeState(
      persistenceAvailable
        ? null
        : memories.length > 0
          ? 'Durable memory offline'
          : 'Memory initialization required',
      { configured: true },
    ),
    [memories.length, persistenceAvailable],
  )
  const internetHealthLabel = useMemo(() => {
    const live = internetStatus.overallStatus === 'live' || internetStatus.canUseInternet === true
    if (live) {
      const trimmed = typeof internetStatus.label === 'string' ? internetStatus.label.trim() : ''
      if (trimmed) return trimmed
      return 'Live'
    }
    const fallback = typeof internetStatus.label === 'string' ? internetStatus.label.trim() : ''
    return fallback || 'Unknown'
  }, [
    internetStatus.canUseInternet,
    internetStatus.label,
    internetStatus.overallStatus,
  ])
  const councilSessionControls = (
    <CouncilSessionControls
      onNewSession={() => startTransition(() => { void startFreshCouncilSession('new') })}
      onClearChat={() => startTransition(clearCouncilSession)}
      onSoftReset={() => startTransition(softResetCouncilSession)}
      onArchiveSession={() => startTransition(archiveCurrentCouncilSession)}
      onClearNoise={() => startTransition(clearCouncilNoise)}
      onExportSession={exportCouncilSession}
    />
  )
  const councilSessionIndicators = (
    <CouncilLifecycleIndicators
      lifecycle={sessionLifecycle}
      memoryState={memoryRuntime.state}
      sessionOnly={memoryRuntime.sessionOnly}
    />
  )
  const operatorNav = (
    <>
      {uiMode === 'operator' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-yellow-900 px-6 py-2" style={{ background: 'rgba(0,0,0,0.35)' }}>
          <span className="text-[10px]" style={{ color: '#94a3b8' }}>
            System: {queueActions.length} queued · session {formatCost(sessionCost)} · heavy pages manual-refresh by default.
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="text-[10px] font-bold tracking-widest" style={{ color: '#FFD700' }} onClick={() => startTransition(() => setOperatorTab('system'))}>Open System</button>
            <button type="button" className="text-[10px] tracking-widest" style={{ color: '#888' }} onClick={() => window.setTimeout(() => {
              void loadProviderHealth()
              void loadInternetStatus()
            }, 0)}>Refresh provider summary</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-yellow-900 px-6 py-2" style={{ background: 'rgba(0,0,0,0.35)' }}>
        <span className="text-[10px] tracking-widest" style={{ color: '#888' }}>UI mode</span>
        <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: uiMode === 'operator' ? '1px solid #FFD700' : '1px solid #444', color: uiMode === 'operator' ? '#FFD700' : '#888' }} onClick={() => setUiMode('operator')}>Operator</button>
        <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: uiMode === 'advanced' ? '1px solid #FFD700' : '1px solid #444', color: uiMode === 'advanced' ? '#FFD700' : '#888' }} onClick={() => setUiMode('advanced')}>Engineering</button>
      </div>

      <div className="relative z-10 flex flex-wrap gap-1 border-b border-yellow-900 px-4 py-2" style={{ background: 'rgba(0,0,0,0.45)' }}>
        {visibleOperatorTabs.map(({ id: tab, label }) => (
          <button
            key={tab}
            type="button"
            className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
            style={{
              border: operatorTab === tab ? '1px solid #FFD700' : '1px solid #333',
              color: operatorTab === tab ? '#FFD700' : '#888',
            }}
            onClick={() => startTransition(() => setOperatorTab(tab))}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  )

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-black font-mono text-white">
      <MatrixCodeRain />
      <style>{`
        .message-fade-in {
          animation: message-fade-in 220ms ease-out;
        }

        .typing-dot {
          width: 0.375rem;
          height: 0.375rem;
          border-radius: 9999px;
          animation: typing-dot 900ms ease-in-out infinite;
        }

        .tool-dot-active {
          animation: tool-dot-pulse 900ms ease-in-out infinite;
        }

        [data-agents-panel] {
          isolation: isolate;
          pointer-events: auto;
        }

        [data-agents-panel] button,
        [data-agents-panel] input,
        [data-agents-panel] select,
        [data-agents-panel] summary {
          pointer-events: auto;
          position: relative;
          z-index: 30;
        }

        [data-agents-panel] button:not(:disabled) {
          cursor: pointer;
        }

        @keyframes message-fade-in {
          from {
            opacity: 0;
            transform: translateY(4px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes typing-dot {
          0%, 80%, 100% {
            opacity: 0.35;
            transform: translateY(0);
          }

          40% {
            opacity: 1;
            transform: translateY(-3px);
          }
        }

        @keyframes tool-dot-pulse {
          0%, 100% {
            opacity: 0.5;
            transform: scale(0.85);
          }

          50% {
            opacity: 1;
            transform: scale(1.2);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .message-fade-in,
          .typing-dot,
          .tool-dot-active {
            animation: none !important;
          }
        }
      `}</style>
      <header className="relative z-10 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-yellow-900 px-6 py-3">
        <div>
          <h1 className="text-xl font-bold tracking-widest" style={{ color: '#FFD700' }}>⚔ WAR ROOM</h1>
          <p className="text-xs tracking-widest" style={{ color: '#444' }}>RA&apos;EL — HIGHER VISION INC</p>
        </div>
        <Link
          href="/baby"
          className="rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ border: '1px solid rgba(56,189,248,0.35)', color: '#38BDF8', background: 'rgba(0,0,0,0.28)' }}
        >
          Baby AI Private
        </Link>
      </header>

      <div
        className="relative z-10 flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-yellow-900/80 px-6 py-2"
        style={{ background: 'rgba(0,0,0,0.45)' }}
      >
        <span className="text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>PROVIDERS</span>
        {providerStripKeys.map(k => {
          const providerStatus = providerHealth.providers[k]
          const statusStyle = providerStatusStyles[providerStatus]
          return (
            <span key={k} className="flex items-center gap-1.5" title={providerHealth.labels[k] ?? k}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusStyle.dot, boxShadow: statusStyle.shadow }} />
              <span className="text-[10px] tracking-widest" style={{ color: statusStyle.color }}>{k.toUpperCase()}</span>
            </span>
          )
        })}
      </div>

      <LiveEnvironmentPanel
        liveResearchHud={liveResearchHud}
        location={commanderLocation}
        horoscopeEnabled={horoscopeEnabled}
        astrologyMode={astrologyMode}
        onSetLocationMode={setLocationMode}
        onForgetLocation={forgetCommanderLocation}
        onToggleHoroscope={() => setHoroscopeEnabled(prev => !prev)}
        onSetAstrologyMode={setAstrologyMode}
        onCouncilHandoff={injectLiveEnvironmentDecree}
      />

      {standingPermissionStrip}

      {memoryNotification && (
        <div className="pointer-events-none fixed right-6 top-28 z-30 message-fade-in rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.35)', color: '#34D399' }}>
          {memoryNotification}
        </div>
      )}

      <div className="relative z-10 flex flex-col">
        <WriteApprovalBanner />
        {operatorNav}
        {uiMode === 'operator' && operatorTab === 'command' && (
          <OperatorCommandEnvironment
            version="24"
            sessionIndicators={councilSessionIndicators}
            onOpenEngineering={() => {
              setUiMode('advanced')
              setOperatorTab('engineering')
            }}
          />
        )}
        {operatorTab === 'command' && (
        <section data-testid="live-council-chat-card" className="mx-4 mt-4 overflow-hidden rounded border border-yellow-900/50" style={{ background: 'rgba(10,8,4,0.58)' }}>
        <div
          className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-yellow-900/60 px-6 py-2"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          <div>
            <span className="text-[10px] font-bold tracking-widest" style={{ color: '#93C5FD' }}>
              FAMILY COMMAND FLOW
            </span>
            <p className="text-[9px] tracking-widest" style={{ color: '#555' }}>
              Ra’el speaks to the AI families; infrastructure notices stay minimal.
            </p>
            {councilSessionIndicators}
          </div>
          <div className="flex max-w-full flex-wrap items-center justify-start gap-1.5 sm:justify-end">
            <span className="mr-1 text-[9px] tracking-widest" style={{ color: '#555' }}>Session controls</span>
            {councilSessionControls}
            <label className="flex items-center gap-1 rounded px-2 py-0.5 text-[9px] tracking-widest" style={{ border: '1px solid #333', color: '#888' }}>
              Mode
              <select
                value={councilOutputMode}
                onChange={event => setCouncilOutputMode(event.target.value as CouncilOutputMode)}
                className="bg-black text-[9px] outline-none"
                style={{ color: '#FDE68A' }}
                aria-label="Council response mode"
              >
                {COUNCIL_OUTPUT_MODES.map(mode => (
                  <option key={mode} value={mode}>{councilOutputModeLabel(mode)}</option>
                ))}
              </select>
            </label>
            {!councilPaused ? (
              <button type="button" onClick={() => startTransition(pauseCouncil)}
                className="rounded px-2 py-0.5 text-[9px] tracking-widest"
                style={{ border: '1px solid #333', color: '#888' }}>
                Pause
              </button>
            ) : (
              <button type="button" onClick={() => startTransition(resumeCouncil)}
                className="rounded px-2 py-0.5 text-[9px] tracking-widest"
                style={{ background: '#34D399', color: '#000', fontWeight: 'bold' }}>
                Resume
              </button>
            )}
            <button type="button" onClick={() => startTransition(toggleDeepDiscussion)}
              className="rounded px-2 py-0.5 text-[9px] tracking-widest"
              style={{
                border: council.deepDiscussionMode ? '1px solid #34D399' : '1px solid #333',
                color: council.deepDiscussionMode ? '#34D399' : '#888',
              }}>
              Deep {council.deepDiscussionMode ? 'ON' : 'OFF'}
            </button>
            {footerShowsPacketOrCouncilProviderIssue && (
              <button type="button" onClick={() => startTransition(retryProvider)}
                className="rounded px-2 py-0.5 text-[9px] tracking-widest"
                style={{ background: '#F97316', color: '#000', fontWeight: 'bold' }}>
                Retry
              </button>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 px-6 pt-3 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FFD700' }}>LIVE COUNCIL</h2>
            {!autoScrollEnabled && (
              <button
                type="button"
                onClick={jumpToLatest}
                className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
                style={{ background: '#FFD700', color: '#000' }}
              >
                Go to latest
              </button>
            )}
          </div>
          <p className="text-[9px] tracking-widest" style={{ color: '#666' }}>
            Council thread below — type at the bottom to speak with the families (Enter sends, Shift+Enter newline).
          </p>
          <LiveCouncilHealthBadgesRow
            chatHealthLabel={chatHealthLabel}
            providerHealthLabel={providerHealthLabel}
            persistenceHealthLabel={persistenceHealthLabel}
            internetHealthLabel={internetHealthLabel}
          />
          <LiveCouncilBabyObserverLane
            memoryCount={memories.length}
            memoryRuntimeState={memoryRuntime.state}
            memoryRuntimeLabel={memoryRuntime.label}
            sessionOnlyLearning={memoryRuntime.sessionOnly}
            pendingApprovals={raelActions.filter(action => action.status === 'pending').length}
            opportunityCount={incomeOpportunities.length}
            providerReady={coreProviderStates.some(status => status === 'online' || status === 'standby')}
          />
          <div className="mt-1">
            <RuntimeContinuityIndicator
              mode={continuityMode}
              lastRecoveredAt={continuityRecoverAt}
              recoverBanner={recoverRuntimeBanner}
              persistNote={runtimePersistenceBanner}
            />
          </div>
          <CouncilCommandBadges cmd={councilUiCommand} packet={councilPacketRender} />
          <ConversationStatePanel runtime={conversationRuntimeSnapshot} className="mt-2" />
          <CouncilDeliberationStream threadId={liveCouncilConvId} enabled={operatorTab === 'command'} />
          {continuationRequests.some(c => c.status === 'pending') ? (
            <div
              className="mt-2 rounded border border-amber-900/40 px-3 py-2"
              style={{ background: 'rgba(0,0,0,0.35)' }}
            >
              <p className="mb-1 text-[9px] font-bold tracking-widest" style={{ color: '#EAB308' }}>
                CONTINUATION REQUESTS
              </p>
              <ul className="space-y-2 text-[9px] tracking-wide" style={{ color: '#a8a29e' }}>
                {continuationRequests
                  .filter(c => c.status === 'pending')
                  .map(cr => (
                    <li key={cr.id} className="rounded border border-amber-900/30 px-2 py-2">
                      <div className="font-bold tracking-widest" style={{ color: '#EAB308' }}>
                        {COUNCIL_ROSTER.find(r => r.id === cr.family)?.label ?? cr.family} requesting continuation.
                      </div>
                      <div className="mt-1" style={{ color: '#a8a29e' }}>
                        Reason: {cr.message}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-[8px] font-bold tracking-widest"
                        style={{ border: '1px solid #34D399', color: '#34D399' }}
                        onClick={() => void handleContinuationDecision(cr, 'allow')}
                      >
                        Allow
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-[8px] font-bold tracking-widest"
                        style={{ border: '1px solid #FFD700', color: '#FFD700' }}
                        onClick={() => void handleContinuationDecision(cr, 'summarize')}
                      >
                        Summarize Instead
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-[8px] font-bold tracking-widest"
                        style={{ border: '1px solid #60A5FA', color: '#60A5FA' }}
                        onClick={() => void handleContinuationDecision(cr, 'hold')}
                      >
                        Hold
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-[8px] font-bold tracking-widest"
                        style={{ border: '1px solid #888', color: '#888' }}
                        onClick={() => void handleContinuationDecision(cr, 'deny')}
                      >
                        Deny
                      </button>
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div
          data-testid="live-council-messages"
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="max-h-[58vh] min-h-[22rem] overflow-y-auto px-6 py-2"
        >
          <CouncilMessageRows
            messages={visibleCouncilMessages}
            hiddenCount={hiddenCouncilMessageCount}
            collapsedNoiseCount={collapsedCouncilNoiseCount}
            onViewArchive={handleViewArchive}
            onSummarizeSession={handleSummarizeSessionArchive}
            onRecallEconomicOps={handleRecallEconomicOps}
            onOpenFullMemory={handleOpenFullMemory}
            onProjectAction={handleProjectAction}
            onPrepareRepairPacket={prepareRepairPacketFromCouncilMessage}
          />

          {expansionPrompt && (
            <ExpansionPermissionPrompt
              prompt={expansionPrompt}
              onApprove={handleExpansionApprove}
              onDecline={handleExpansionDecline}
              onSummarize={handleExpansionSummarize}
            />
          )}

          {memorySavePrompt && (
            <MemorySavePromptPanel
              prompt={memorySavePrompt}
              onSave={() => {
                void saveMemory(memorySavePrompt.memory)
                setMemorySavePrompt(null)
              }}
              onDismiss={() => setMemorySavePrompt(null)}
            />
          )}

          {typingFamily && (
            <TypingIndicator familyName={typingFamily} label={familyPresence[typingFamily].label} />
          )}

          {councilMounted && showContinue && (
            <div className="flex flex-wrap items-center gap-3 ml-11 mb-4 p-3 rounded"
              style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid #3a2e00' }}>
              <span className="text-xs tracking-widest" style={{ color: '#888' }}>
                {councilContinueStatusLine}
              </span>
              {liveResearchHud ? (
                <span
                  className="text-[9px] tracking-wide rounded px-2 py-0.5"
                  style={{
                    border: '1px solid #333',
                    color:
                      liveResearchHud.mode === 'verified'
                        ? '#86EFAC'
                        : liveResearchHud.mode === 'unavailable'
                          ? '#f87171'
                          : liveResearchHud.mode === 'failed'
                            ? '#f97316'
                            : liveResearchHud.mode === 'completing'
                              ? '#93C5FD'
                              : liveResearchHud.mode === 'partial'
                                ? '#fcd34d'
                                : '#94a3b8',
                  }}
                  title={
                    liveResearchHud.mode === 'inactive'
                      ? 'Live internet research not invoked for this turn.'
                      : [
                          'Phase 5/6 live research HUD.',
                          liveResearchHud.intelligence
                            ? ` Phase 8A intelligence: ${liveResearchHud.intelligence.sourcesUsed} source(s): ${liveResearchHud.intelligence.sourcesPreview || 'none'}. Confidence ${liveResearchHud.intelligence.confidenceLevel} (${Math.round(liveResearchHud.intelligence.confidenceScore * 100)}%), freshness ${liveResearchHud.intelligence.freshness}, contradictions ${liveResearchHud.intelligence.contradictionWarnings}, weak signal ${liveResearchHud.intelligence.weakSignalDetected ? 'yes' : 'no'}.`
                            : '',
                          liveResearchHud.intelligence?.local?.active
                            ? ` Local: source depth ${liveResearchHud.intelligence.local.sourceDepth}, locality ${liveResearchHud.intelligence.local.localityDepth}, corroboration ${liveResearchHud.intelligence.local.corroborationLevel}, weak signals ${liveResearchHud.intelligence.local.weakSignalCount}, contradictions ${liveResearchHud.intelligence.local.contradictionWarnings}.`
                            : '',
                          liveResearchHud.intelligence?.retrieval
                            ? ` Retrieval: required ${liveResearchHud.intelligence.retrieval.required ? 'yes' : 'no'}, success ${liveResearchHud.intelligence.retrieval.success ? 'yes' : 'no'}, gaps ${liveResearchHud.intelligence.retrieval.gaps}, mix ${Object.entries(liveResearchHud.intelligence.retrieval.sourceMix).map(([tier, count]) => `${tier}:${count}`).join(', ') || 'none'}.`
                            : '',
                          liveResearchHud.responseCompletion
                            ? ` Model completion: ${liveResearchHud.responseCompletion}.`
                            : '',
                        ].join('')
                  }
                >
                  {liveResearchHud.mode === 'inactive' ? 'Research idle' : liveResearchHud.label}
                  {liveResearchHud.responseCompletion && liveResearchHud.mode !== 'inactive'
                    ? ` · ${liveResearchHud.responseCompletion}`
                    : ''}
                  {liveResearchHud.sourcesCount > 0 ? ` · ${liveResearchHud.sourcesCount}` : ''}
                  {liveResearchHud.intelligence
                    ? ` · src ${liveResearchHud.intelligence.sourcesUsed} · ${liveResearchHud.intelligence.freshness} · ${liveResearchHud.intelligence.confidenceLevel}`
                    : ''}
                  {liveResearchHud.intelligence?.contradictionWarnings
                    ? ` · contradiction ${liveResearchHud.intelligence.contradictionWarnings}`
                    : ''}
                  {liveResearchHud.intelligence?.weakSignalDetected ? ' · weak signal' : ''}
                  {liveResearchHud.intelligence?.local?.active
                    ? ` · local ${liveResearchHud.intelligence.local.localityDepth}/${liveResearchHud.intelligence.local.corroborationLevel}`
                    : ''}
                  {liveResearchHud.intelligence?.retrieval
                    ? ` · retrieval ${liveResearchHud.intelligence.retrieval.success ? 'ok' : 'gap'}`
                    : ''}
                </span>
              ) : null}
              <button type="button" onClick={() => startTransition(() => void handleSummarize())}
                className="text-xs px-3 py-1 rounded tracking-widest"
                style={{ border: '1px solid #FFD700', color: '#FFD700' }}>
                Summarize
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="flex-shrink-0 border-t border-yellow-900 px-6 py-4" style={{ background: 'rgba(255,215,0,0.09)' }}>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold tracking-widest" style={{ color: '#FFD700' }}>Speak to the AI families</p>
              <p className="text-[9px] tracking-widest" style={{ color: '#666' }}>Claude builds, ChatGPT orchestrates, Grok scouts, Gemini cross-references, Red Team checks risk.</p>
            </div>
            <span className="rounded px-2 py-0.5 text-[9px] tracking-widest" style={{ border: '1px solid rgba(255,215,0,0.35)', color: '#FDE68A' }}>
              Main command input
            </span>
          </div>
          <form
            className="flex items-start gap-3 rounded p-4"
            style={{ background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.55)', boxShadow: '0 0 24px rgba(255,215,0,0.08)' }}
            onSubmit={handleDecree}
          >
            <span className="mt-1 shrink-0" style={{ color: '#FFD700' }}>⚔</span>
            <textarea
              data-command-surface-id="live-council-primary-decree"
              data-command-surface-role="primary_decree"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (!loading) void handleDecree()
                }
              }}
              rows={3}
              placeholder="Speak your decree to the families..."
              className="min-h-[3rem] flex-1 resize-y bg-transparent text-sm tracking-widest outline-none"
              style={{ color: '#FFD700', caretColor: '#FFD700' }}
              disabled={loading}
            />
            <button type="submit" disabled={loading}
              className="mt-0.5 shrink-0 rounded px-5 py-2 text-xs font-bold tracking-widest disabled:opacity-30"
              style={{ border: '1px solid #FFD700', color: '#000', background: '#FFD700' }}>
              {loading ? '…' : 'Send'}
            </button>
          </form>
          <p className="mt-2 text-[9px] tracking-widest" style={{ color: '#555' }}>
            Messages persist to Supabase when configured; otherwise this tab uses sessionStorage. Cloud order: ChatGPT → Claude → Grok → Gemini (Income Operations: Grok → Gemini → ChatGPT → Claude).
          </p>
        </div>
        </section>
        )}

        {uiMode === 'operator' && operatorTab === 'command' && <OperatorCommandDeck />}
        {uiMode === 'operator' && operatorTab === 'command' && activeFamiliesSection}
        {uiMode === 'operator' && operatorTab === 'command' && pendingNeedsRael && (
          <NeedsRaelPanel actions={raelActions} opportunities={incomeOpportunities} onRespond={respondToRaelAction} onNotify={notifyRaelAction} />
        )}
        {uiMode === 'operator' && operatorTab === 'command' && activeOrdersStrip}
        <div className="px-6 py-4">
          <div className="space-y-4">
            {operatorTab === 'command' && (
              <section className="rounded border border-white/10 p-3 text-[10px]" style={{ background: 'rgba(0,0,0,0.24)', color: '#94a3b8' }}>
                <div className="mb-2 font-bold tracking-widest" style={{ color: '#86EFAC' }}>COMMAND CENTER</div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded border border-white/10 px-2 py-1">Pending approvals: {raelActions.filter(a => a.status === 'pending').length}</span>
                  <span className="rounded border border-white/10 px-2 py-1">Active orders: {queueActions.length}</span>
                  <span className="rounded border border-white/10 px-2 py-1">Providers: {providerStripKeys.filter(k => providerHealth.providers[k] === 'online').length} online</span>
                </div>
              </section>
            )}
            {uiMode === 'advanced' && operatorTab === 'command' && <ScoutDiagnosticsPanel diagnostics={economicScoutDiagnostics} />}
            {operatorTab === 'agents' && (
              <>
                <div className="mb-3 border-b border-yellow-900/40 pb-2">
                  <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FBBF24' }}>AGENTS</h2>
                  <p className="mt-1 text-[9px] tracking-widest" style={{ color: '#666' }}>Cloud families, Baby AI training, provider configuration, approvals, Red Team review, and Cursor manual engineering lane.</p>
                </div>
                <CloudAgentFamiliesPanel engines={engineList} />
                <BabyAiAcademyPanel />
                <ProviderConfigurationPanel engines={engineList} />
                <AgentGrowthTrainingPanel />
                <ApprovalQueueSummaryPanel pendingApprovals={raelActions.filter(action => action.status === 'pending').length} />
                <RedTeamReviewSummaryPanel state={redTeamCoder} onDiagnose={() => void runRedTeamCoderDiagnosis('manual')} />
              </>
            )}
            {uiMode === 'advanced' && operatorTab === 'engineering' && (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-yellow-900/40 pb-2">
                  <div>
                    <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>ENGINEERING VIEW</h2>
                    <p className="mt-1 text-[9px] tracking-widest" style={{ color: '#666' }}>
                      Runtime diagnostics, provider tables, repair packets, logs, system health, and dependency checks. Manual approval gates remain active.
                    </p>
                  </div>
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void refreshToolBarHealthBars()}>Refresh engineering status</button>
                </div>
                <WarRoomPerformancePanel diagnostics={performanceDiagnostics} activeTab={operatorTab} />
                <ConfigurationHealthSummaryPanel />
                <ProviderSetupChecklistPanel />
                <UnifiedEngineControlPanel />
                <ToolStatusPanel health={toolBarHealth} activity={toolBarActivity} />
                <div className="grid gap-4 md:grid-cols-2">
                  <SystemResourcesPanel autoRefreshEnabled={false} tabActive={operatorTab === 'engineering'} />
                  <WorkerHealthPanel uiMode={uiMode} autoRefreshEnabled={false} tabActive={operatorTab === 'engineering'} />
                </div>
                <CompressedCouncilPanel
                  summary={compressedCouncilSummary}
                  onGenerateRepairPacket={generateRepairPacketFromCompression}
                  onGenerateRevenuePacket={generateRevenueActionPacket}
                  onSaveLessonCandidate={saveLessonCandidateFromCompression}
                />
                <SchemaSweepPanel />
                <EngineeringLaneManualPanel latest={latestEngineeringTaskPacket} />
                <RepairPacketPanel latest={latestRepairPacket} />
                <RedTeamCoderPanel state={redTeamCoder} onDiagnose={() => void runRedTeamCoderDiagnosis('manual')} />
                <RepoAwarenessPanel repo={repoAwareness} onScan={scanRepo} />
                {uiMode === 'advanced' && (
                  <section className="rounded border border-white/10 p-2 text-[10px]" style={{ color: '#aaa' }}>
                    <div className="mb-1 flex items-center justify-between font-bold" style={{ color: '#94A3B8' }}>
                      <span>SYSTEM LEDGER</span>
                      <button type="button" className="text-[9px]" style={{ color: '#666' }} onClick={() => void refreshLedger()}>Refresh</button>
                    </div>
                    <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-[9px]">
                      {ledgerEvents.length === 0 ? <li style={{ color: '#555' }}>No recent events.</li> : ledgerEvents.map(ev => (
                        <li key={ev.id}><span style={{ color: '#7dd3fc' }}>{ev.type}</span> {ev.createdAt?.slice(5, 22)}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            {operatorTab === 'analysts' && (
              <>
                <div className="mb-3 border-b border-yellow-900/40 pb-2">
                  <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FBBF24' }}>ANALYST OPERATIONS</h2>
                  <p className="mt-1 text-[9px] tracking-widest" style={{ color: '#666' }}>
                    Outcome intelligence, scoring, trends, forecasts, bottlenecks, and learning signals remain advisory only.
                  </p>
                </div>
                <AnalystOperationsPanel packet={latestAnalystPacket} />
              </>
            )}
            {operatorTab === 'income' && (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-yellow-900/40 pb-2">
                  <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FBBF24' }}>REVENUE / OPPORTUNITY RADAR</h2>
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void loadIncomeOpportunities()}>Refresh opportunities</button>
                </div>
                <PaymentsPayoutsPanel
                  opportunities={incomeOpportunities}
                  ledger={paymentLedger}
                  onRefresh={() => void loadPaymentLedger()}
                  onNotify={notifyDeposit}
                />
                <IncomeWorkersPanel
                  opportunities={incomeOpportunities}
                  actions={raelActions}
                  scout={incomeWorkerScout}
                  councilReviews={incomeCouncilReviews}
                  loading={incomeWorkerLoading}
                  assignLoading={incomeWorkerAssignLoading}
                  onScout={runIncomeWorkerScout}
                  onAssign={assignIncomeWorkerCandidate}
                />
                <IncomeRadarPanel
                  opportunities={incomeOpportunities}
                  loading={incomeLoading}
                  view={incomeView}
                  onViewChange={setIncomeView}
                  onCreate={createIncomeOpportunity}
                  onExpire={markIncomeOpportunityExpired}
                  scout={opportunityScout}
                  scoutLoading={opportunityScoutLoading}
                  onScout={runOpportunityScout}
                />
              </>
            )}
            {operatorTab === 'memory' && (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-yellow-900/40 pb-2">
                  <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FBBF24' }}>MEMORY</h2>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void loadMemoriesRef.current?.()}>Refresh memory</button>
                    <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void loadWarRoomFiles()}>Refresh files</button>
                  </div>
                </div>
                <MemoryRecallPanel recall={memoryRecallView} />
                <MemoryPanel memories={memories} />
                <Phase6MemoryPanels />
                <FilesEvidenceVaultPanel
                  files={warRoomFiles}
                  loading={filesLoading}
                  message={filesMessage}
                  onUpload={uploadWarRoomFile}
                />
              </>
            )}
            {operatorTab === 'approvals' && (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-yellow-900/40 pb-2">
                  <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FBBF24' }}>APPROVALS / ACTION QUEUE</h2>
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void loadRaelActions()}>Refresh approvals</button>
                </div>
                <NeedsRaelPanel actions={raelActions} opportunities={incomeOpportunities} onRespond={respondToRaelAction} onNotify={notifyRaelAction} />
                <StandingPermissionsPanel />
                <SmsBridgePanel bridge={smsBridge} onTest={testSmsBridge} />
              </>
            )}
            {operatorTab === 'system' && (
              <>
                <ConfigurationHealthSummaryPanel />
                <WarRoomPerformancePanel diagnostics={performanceDiagnostics} activeTab={operatorTab} />
                <ToolStatusPanel health={toolBarHealth} activity={toolBarActivity} />
                <button type="button" className="mb-3 rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void refreshToolBarHealthBars()}>Refresh tool bar</button>
                <TokenUsagePanel rows={usageRows} currentCost={currentDecreeCost} sessionTotal={sessionCost} providerHealth={providerHealth} />
                <div className="grid gap-4 md:grid-cols-2">
                  <SystemResourcesPanel autoRefreshEnabled={false} tabActive={operatorTab === 'system'} />
                  <WorkerHealthPanel uiMode={uiMode} autoRefreshEnabled={false} tabActive={operatorTab === 'system'} />
                </div>
              </>
            )}
            {operatorTab === 'diagnostics' && (
              <>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px]" style={{ color: '#94a3b8' }}>
                  <Link href="/war-room/integrity" className="font-semibold tracking-wide text-sky-400 underline underline-offset-2">
                    Open runtime integrity dashboard →
                  </Link>
                </div>
                <WarRoomPerformancePanel diagnostics={performanceDiagnostics} activeTab={operatorTab} />
                {recoveredRedTeamHold ? (
                  <div
                    className="mb-3 rounded border border-amber-500/45 px-3 py-2 text-[10px]"
                    style={{ color: '#fde68a', background: 'rgba(69,26,3,0.35)' }}
                  >
                    <div className="font-bold tracking-widest">PREVIOUS RED TEAM HOLD (STORAGE)</div>
                    <div className="mt-1 text-amber-100/90">
                      An unresolved hold was recorded in durable state. This is historical context only — diagnostics do not
                      auto-resume.
                    </div>
                    <div className="mt-1 text-white/55">
                      Captured {new Date(recoveredRedTeamHold.capturedAt).toLocaleString()}
                      {recoveredRedTeamHold.holdReason ? ` · ${recoveredRedTeamHold.holdReason}` : ''}
                    </div>
                  </div>
                ) : null}
                {recoveredAttendanceSummary ? (
                  <details
                    className="mb-3 rounded border border-white/10 px-3 py-2 text-[10px]"
                    style={{ color: '#a8a29e' }}
                    onToggle={event => setRecoveredAttendanceExpanded(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer font-bold tracking-widest text-white/70">LAST ATTENDANCE SUMMARY (HISTORICAL)</summary>
                    <div className="mt-1 text-white/55">
                      Captured {new Date(recoveredAttendanceSummary.capturedAt).toLocaleString()}
                    </div>
                    {recoveredAttendanceExpanded ? (
                      <pre className="mt-1 max-h-28 overflow-auto text-[9px] text-white/60">
                        {JSON.stringify(recoveredAttendanceSummary.providerRuntimeStates, null, 2)}
                      </pre>
                    ) : (
                      <div className="mt-1 text-[9px] uppercase tracking-widest text-white/40">Provider runtime JSON deferred until expanded.</div>
                    )}
                  </details>
                ) : null}
                {recoveredDiagnosticHistory.length ? (
                  <div className="mb-3 rounded border border-white/10 px-3 py-2 text-[10px]" style={{ color: '#a8a29e' }}>
                    <div className="font-bold tracking-widest text-white/70">DIAGNOSTIC HISTORY (HISTORICAL)</div>
                    <ul className="mt-1 max-h-40 list-inside list-disc space-y-1 overflow-auto text-[9px] text-white/65">
                      {recoveredDiagnosticHistory.slice(-12).map((ev, idx) => (
                        <li key={`${ev.kind}-${idx}-${(ev as { at?: string }).at ?? idx}`}>
                          {(ev as { kind: string }).kind}
                          {(ev as { at?: string }).at ? ` · ${new Date((ev as { at: string }).at).toLocaleString()}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {recoveredIntegrityPartial ? (
                  <details
                    className="mb-3 rounded border border-white/10 px-3 py-2 text-[10px]"
                    style={{ color: '#a8a29e' }}
                    onToggle={event => setRecoveredIntegrityExpanded(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer font-bold tracking-widest text-white/70">
                      Historical runtime integrity snapshot (from storage)
                    </summary>
                    <div className="mt-1 text-white/50">
                      Generated {new Date(recoveredIntegrityPartial.generatedAt).toLocaleString()} — superseded after live
                      integrity refresh.
                    </div>
                    {recoveredIntegrityExpanded ? (
                      <pre className="mt-1 max-h-48 overflow-auto text-[9px] text-white/60">
                        {JSON.stringify(
                          {
                            overall: recoveredIntegrityPartial.subsystems?.length ?? 0,
                            providers: recoveredIntegrityPartial.providers,
                            persistence: recoveredIntegrityPartial.persistence,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    ) : (
                      <div className="mt-1 text-[9px] uppercase tracking-widest text-white/40">Integrity JSON deferred until expanded.</div>
                    )}
                  </details>
                ) : null}
                {sequentialDiagnostics.session?.active ? (
                  <div className="mb-4">
                    <DiagnosticSessionPanel
                      state={{
                        active: sequentialDiagnostics.session.active,
                        turnIndex: sequentialDiagnostics.session.turnIndex,
                        order: sequentialDiagnostics.session.order,
                        hold: sequentialDiagnostics.session.hold,
                        intentMode: sequentialDiagnostics.session.intentMode,
                        outcomes: sequentialDiagnostics.session.outcomes,
                        holdReason: sequentialDiagnostics.session.holdReason,
                      }}
                      onReleaseHold={releaseSequentialDiagnosticHold}
                    />
                  </div>
                ) : null}
                <ConfigurationSweepPanel />
                <ProviderSetupChecklistPanel />
                <KernelStatusPanel />
                <UnifiedEngineControlPanel />
                <CommandRouterPanel />
                <InternetAccessPanel internet={internetStatus} onRefresh={() => void loadInternetStatus()} />
                <RepoAwarenessPanel repo={repoAwareness} onScan={scanRepo} />
                <RepoAccessPanel repo={repoStatus} onRefresh={() => void loadRepoStatus()} onCouncilHandoff={injectLiveEnvironmentDecree} />
                <RollbackSafetyPanel rollback={rollbackStatus} onRefresh={() => void loadRollbackStatus()} onCheckpoint={() => void createRollbackCheckpoint()} />
                <DiffPreviewPanel
                  preview={diffPreview}
                  staged={diffPreviewStaged}
                  loading={diffPreviewLoading}
                  error={diffPreviewError}
                  onStagedChange={setDiffPreviewStaged}
                  onLoad={() => void loadDiffPreview()}
                />
                <DeploymentAwarenessPanel deploy={deployStatus} onRefresh={() => void loadDeployStatus()} />
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px]" style={{ color: '#888' }}>
                  <button
                    type="button"
                    disabled={internetMonitorBusy}
                    className="rounded px-2 py-1 font-bold tracking-widest disabled:opacity-40"
                    style={{ border: '1px solid #444', color: '#93C5FD' }}
                    onClick={() => void runInternetMonitorOnce()}
                  >
                    {internetMonitorBusy ? 'Running internet worker…' : 'Run internet status worker'}
                  </button>
                </div>
                <Phase5DeployPanels autoRefreshEnabled={false} tabActive={operatorTab === 'diagnostics'} />
                <Phase3WarRoomPanels uiMode={uiMode} homeBundle="diagnostics" />
                <RedTeamCoderPanel state={redTeamCoder} onDiagnose={() => void runRedTeamCoderDiagnosis('manual')} />
                <EngineeringLaneManualPanel latest={latestEngineeringTaskPacket} />
                <RepairPacketPanel latest={latestRepairPacket} />
                <CloudAgentFamiliesPanel engines={engineList} />
                <BabyAiObserverPanel memories={memories} actions={raelActions} opportunities={incomeOpportunities} />
                <FamilyPresencePanel presence={familyPresence} geminiEngine={geminiEngineRow} />
                {uiMode === 'advanced' && (
                  <section className="rounded border border-white/10 p-2 text-[10px]" style={{ color: '#aaa' }}>
                    <div className="mb-1 flex items-center justify-between font-bold" style={{ color: '#94A3B8' }}>
                      <span>SYSTEM LEDGER</span>
                      <button type="button" className="text-[9px]" style={{ color: '#666' }} onClick={() => void refreshLedger()}>Refresh</button>
                    </div>
                    <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-[9px]">
                      {ledgerEvents.length === 0 ? <li style={{ color: '#555' }}>No recent events.</li> : ledgerEvents.map(ev => (
                        <li key={ev.id}><span style={{ color: '#7dd3fc' }}>{ev.type}</span> {ev.createdAt?.slice(5, 22)}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>

    </main>
  )
}

export default function HomePage() {
  return (
    <WarRoomUiModeProvider>
      <Home />
    </WarRoomUiModeProvider>
  )
}
