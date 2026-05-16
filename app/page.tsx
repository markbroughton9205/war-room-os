'use client'

import { useState, useRef, useEffect, useCallback, useMemo, memo, startTransition } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { MatrixCodeRain } from '@/components/MatrixCodeRain'
import { APPROVAL_RISK_GATES, SECURE_APPROVAL_RISKS } from '@/lib/kernel/approvals'
import { KERNEL_EVENT_SCHEMA, KERNEL_EVENT_TYPES } from '@/lib/kernel/events'
import { MEMORY_POLICY } from '@/lib/kernel/memoryPolicy'
import { AGENT_FAMILY_CAPABILITIES, CAPABILITY_ROUTES } from '@/lib/kernel/routing'
import { LOCAL_FAMILY_AGENTS } from '@/lib/local-agent/family-agents'
import { LOCAL_AGENT_ENGINES, LOCAL_AGENT_RELIABILITY_PRINCIPLES, LOCAL_AGENT_TASK_LIFECYCLE } from '@/lib/local-agent/engines'
import { LOCAL_TASK_CATEGORIES } from '@/lib/local-agent/router'
import type { LocalAgentBridgeStatusResponse, LocalAgentEngineId, LocalFamilyAgentsResponse, LocalTaskCategory, LocalTaskRoutingDecision } from '@/lib/local-agent/types'
import { INCOME_WORKERS, INCOME_WORKER_WORKFLOW } from '@/lib/income-workers/registry'
import type { IncomeWorkerCandidate, IncomeWorkerScoutResult } from '@/lib/income-workers/types'
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
  councilContentHash,
  orchestrationFamilyToLocalAgentId,
  orchestrationFamilyToTypingFamily,
  pickNextOrchestrationFamily,
  useCouncilSession,
} from '@/components/council'
import type { CouncilOrchestrationFamily } from '@/components/council'
import type { EngineControlStatusResponse, EngineId, EngineStatus } from '@/lib/engine-control/types'
import type { RouteCommandResult } from '@/lib/engine-control/router'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'
import { grantWarRoomStandingAck, resolveStandingPostExtra } from '@/lib/permissions/standingInlineGate'
import { postCouncilChat, sendLiveCouncilThroneMessage, type CouncilChatJson } from '@/lib/council/liveChatPipeline'
import type { ContinuationRequest } from '@/lib/council/continuationRequest'
import { decreeAsksMultiFamilyGreeting } from '@/lib/council/greetingRouting'
import { classifyCommand } from '@/lib/engine-control/permissions'
import { ProviderSetupChecklistPanel } from '@/components/war-room/ProviderSetupChecklistPanel'
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
import { CouncilCommandBadges } from '@/components/war-room/CouncilCommandBadges'
import { DEFAULT_COUNCIL_COMMAND, type CouncilCommand } from '@/lib/council/councilCommandTypes'
import { councilModeExtensionWarnings, resolveActiveCommand } from '@/lib/council/commandAuthority'
import {
  ALL_ORCHESTRATION_FAMILIES,
  filterOrchestrationOrderByCommand,
} from '@/lib/council/commandParser'
import { applyGovernor, COUNCIL_GOVERNOR_SILENT_SKIP } from '@/lib/council/responseGovernor'
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
import { createMessageId } from '@/lib/council/messageIds'
import { cloudEngineReadinessLabel, cloudEngineStripStatus, internetToolReadinessParts } from '@/lib/warRoom/providerReadiness'
import type {
  RedTeamCoderDiagnosisResult,
  RedTeamCoderIssue,
  RedTeamCoderRepairPlan,
  RedTeamCoderSignal,
  RedTeamCoderStatus,
} from '@/lib/red-team-coder/types'

export type OperatorTab = 'command' | 'income' | 'agents' | 'approvals' | 'memory' | 'system' | 'diagnostics'

const OPERATOR_TABS: { id: OperatorTab; label: string }[] = [
  { id: 'command', label: 'Command Center' },
  { id: 'income', label: 'Income Operations' },
  { id: 'agents', label: 'Agents' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'memory', label: 'Memory' },
  { id: 'system', label: 'System Health' },
  { id: 'diagnostics', label: 'Diagnostics' },
]

type CouncilMessage = {
  id: string
  familyName: string
  content: string
  timestamp: string
  color: string
  icon: string
  provider: string
  messageType: string
}

const RAEL_PROFILE = `Commander: Ra'el (Mark Broughton). Mission: generational wealth and sovereignty. Philosophy: Nation of Islam economic self-determination, Black ownership, ancestral wisdom. Businesses: Higher Vision Inc, Broughton Transports LLC, RUAH patent. Family: Jasmine, seven children. Goal: Panama relocation. Motivated by vision of success. Wants truth about systems that harm Black and low income communities.`

function cloudEngineIdForCouncilFamily(f: CouncilOrchestrationFamily): EngineId | null {
  if (f === 'chatgpt' || f === 'baby') return 'chatgpt'
  if (f === 'claude' || f === 'red_team') return 'claude'
  if (f === 'grok') return 'grok'
  if (f === 'gemini') return 'gemini'
  return null
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
      content: row.content,
      timestamp: ts,
      color: '#FFD700',
      icon: '⚙',
      provider: '',
      messageType: 'system',
    }
  }
  const fam = (row.family && row.family.trim()) || 'Council'
  return {
    id: row.id,
    familyName: fam,
    content: row.content,
    timestamp: ts,
    color: '#9CA3AF',
    icon: '•',
    provider: '',
    messageType: 'response',
  }
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

type ToneMode = 'casual' | 'build' | 'business' | 'debate' | 'reflection'
type TypingFamily = 'CHATGPT FAMILY' | 'CLAUDE FAMILY' | 'GROK FAMILY' | 'GEMINI FAMILY' | 'KIMI FAMILY' | 'BRIDGE ARCHITECT'
type UsageFamily = 'Claude Family' | 'ChatGPT Family' | 'Kimi Family' | 'Grok Family' | 'Gemini Family'
type CouncilMode = 'continue' | 'expanded' | 'summarize'

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
type BridgeLifecycleState = 'observing' | 'planning' | 'reviewing diff' | 'QA checking' | 'awaiting approval' | 'applied' | 'rollback suggested'

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
const INITIAL_LOCAL_AGENT_BRIDGE: LocalAgentBridgeStatusResponse = {
  bridge: 'config_needed',
  engines: LOCAL_AGENT_ENGINES.reduce((acc, engine) => {
    acc[engine.id] = {
      id: engine.id,
      name: engine.name,
      status: 'not_detected',
      endpoint: engine.defaultEndpoint,
      message: 'Not checked yet.',
    }
    return acc
  }, {} as LocalAgentBridgeStatusResponse['engines']),
  selectedEngine: null,
  repoAccessStatus: 'read-only status bridge; write access not granted',
  lastTask: null,
  qaStatus: 'idle',
  rollbackCheckpointStatus: 'not created',
  checkedAt: '',
}
const INITIAL_LOCAL_FAMILY_AGENTS: LocalFamilyAgentsResponse = {
  ollamaDetected: false,
  lmStudioDetected: false,
  availableModels: [],
  lmStudioModels: [],
  providers: {
    ollama: { provider: 'ollama', detected: false, reachable: false, functional: false, models: [], error: null },
    lmStudio: { provider: 'lm_studio', detected: false, reachable: false, functional: false, models: [], error: null },
  },
  preferredProvider: null,
  preferredModel: null,
  familyAgents: LOCAL_FAMILY_AGENTS.map(agent => ({
    ...agent,
    status: 'inactive',
    modelInstalled: false,
    provider: 'ollama',
    model: agent.preferredModel,
    detected: false,
    functional: false,
  })),
  checkedAt: '',
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

const MessageBubble = memo(function MessageBubble({ msg, diagnosticsOpen }: { msg: CouncilMessage; diagnosticsOpen?: boolean }) {
  const isRael = msg.familyName === "RA'EL"
  if (
    msg.messageType === 'system'
    && shouldSuppressProviderFailureFromChatStream(msg.content, { diagnosticsOpen })
  ) {
    return null
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
      </div>
    </div>
  )
})

const CouncilMessageRows = memo(function CouncilMessageRows({ messages }: { messages: CouncilMessage[] }) {
  return (
    <>
      {messages.map(msg => (
        <MessageBubble key={msg.id} msg={msg} diagnosticsOpen={false} />
      ))}
    </>
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
          const tooltipSynonym =
            label === 'ONLINE' && tool.id === 'memory'
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
  const statusItems = [
    { label: 'KERNEL', value: 'ONLINE', color: '#34D399' },
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

  return (
    <section className="rounded border border-emerald-500/20 p-3 text-xs" style={{ background: 'rgba(6,78,59,0.10)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>INCOME WORKERS</h2>
          <p className="mt-1" style={{ color: '#888' }}>Revenue-focused worker layer for source-linked missions, approvals, payout tracking, and proof-gated completion.</p>
        </div>
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
          <div style={{ color: '#666' }}>No source-linked worker candidates loaded.</div>
        ) : (
          <div className="grid gap-2">
            {scout.candidates.slice(0, 5).map(candidate => (
              <div key={candidate.url} className="rounded border border-white/10 px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <a href={candidate.url} target="_blank" rel="noreferrer" className="font-bold underline-offset-2 hover:underline" style={{ color: '#E5E7EB' }}>{candidate.title}</a>
                    <div className="mt-1" style={{ color: '#777' }}>{candidate.source} · {candidate.type} · score {candidate.score}</div>
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

function MemoryPanel({ memories }: { memories: MemoryEntry[] }) {
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
}

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
                <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2"
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

function CodexAgentPlaceholder() {
  return (
    <div className="border-b border-yellow-900 px-6 py-2 flex-shrink-0"
      style={{ background: 'rgba(0,255,65,0.025)' }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tracking-widest">
        <span style={{ color: '#FFD700' }}>Codex Agent — Engineering / Deployment</span>
        <span style={{ color: '#666' }}>Status: not connected</span>
        <span style={{ color: '#888' }}>
          Planned scope: implementation support when wired — no live agent session from this UI
        </span>
      </div>
    </div>
  )
}

function BridgeArchitectPanel({ engines }: { engines: EngineStatus[] }) {
  const lifecycleStates: BridgeLifecycleState[] = [
    'observing',
    'planning',
    'reviewing diff',
    'QA checking',
    'awaiting approval',
    'applied',
    'rollback suggested',
  ]
  const currentState: BridgeLifecycleState = 'observing'
  const ollama = engines.find(e => e.id === 'ollama')
  const lm = engines.find(e => e.id === 'lm_studio')
  const localLines: string[] = []
  if (ollama?.functional) localLines.push('Ollama connected')
  if (lm?.functional) localLines.push('LM Studio connected')
  if (ollama?.functional || lm?.functional) localLines.push('Local model access available')
  const localEnginesSummary = localLines.length > 0
    ? localLines.join(' · ')
    : (ollama?.reachable || lm?.reachable)
      ? 'Local endpoint reachable — load a model to go fully operational.'
      : 'No live local inference endpoint detected. Install Ollama or LM Studio, or configure LOCAL_AGENT_OPENHANDS_URL for OpenHands.'
  const responsibilities = [
    '🧭 explains local agent activity',
    '🧩 translates raw model output',
    '🔍 summarizes diffs and risk',
    '✅ coordinates QA flow',
    '🤝 keeps trust and transparency high',
  ]
  const guardrails = [
    'Does not modify files directly',
    'Does not execute shell commands',
    'Does not bypass approval gates',
    'Does not commit autonomously',
  ]

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(96,165,250,0.018)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#60A5FA' }}>
            🌉 BRIDGE ARCHITECT
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#777' }}>
            Translator, coordinator, explainer, and trust layer for local coding agents.
          </p>
        </div>
        <span className="rounded px-3 py-1 text-xs font-bold tracking-widest"
          style={{ color: '#FFD700', border: '1px solid rgba(255,215,0,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          {currentState.toUpperCase()}
        </span>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>PERSONALITY</div>
          <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>calm · precise · conversational</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>INTERNAL ALIAS</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>Big Sis / Big Bro</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>LOCAL ENGINES</div>
          <div className="mt-1 font-bold" style={{ color: localLines.length ? '#34D399' : '#777' }}>
            {localEnginesSummary}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>POSITION</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>between engines and Ra&apos;el</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {lifecycleStates.map(state => {
          const active = state === currentState

          return (
            <span key={state} className="rounded px-2 py-1 text-[10px] tracking-widest"
              style={{
                color: active ? '#60A5FA' : '#555',
                border: active ? '1px solid rgba(96,165,250,0.45)' : '1px solid #222',
                background: active ? 'rgba(96,165,250,0.08)' : 'rgba(0,0,0,0.22)',
              }}>
              {active ? '● ' : ''}{state}
            </span>
          )
        })}
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-4">
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(96,165,250,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#60A5FA' }}>TRANSPARENCY LOG</div>
          <div className="rounded px-2 py-3 text-center tracking-widest" style={{ border: '1px solid #222', color: '#555', background: 'rgba(0,0,0,0.22)' }}>
            No local agent activity yet.
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#34D399' }}>DIFF SUMMARY</div>
          <div className="rounded px-2 py-3 text-center tracking-widest" style={{ border: '1px solid #222', color: '#555', background: 'rgba(0,0,0,0.22)' }}>
            No diff submitted for review.
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#A78BFA' }}>QA EXPLANATION</div>
          <div className="rounded px-2 py-3 text-center tracking-widest" style={{ border: '1px solid #222', color: '#555', background: 'rgba(0,0,0,0.22)' }}>
            QA flow will appear after a local change request.
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#FFD700' }}>APPROVAL RECOMMENDATION</div>
          <div className="rounded px-2 py-3 text-center tracking-widest" style={{ border: '1px solid #222', color: '#555', background: 'rgba(0,0,0,0.22)' }}>
            No approval needed.
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(96,165,250,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#60A5FA' }}>RESPONSIBILITIES</div>
          <div className="flex flex-wrap gap-2">
            {responsibilities.map(item => (
              <span key={item} className="rounded px-2 py-1 text-[10px] tracking-widest"
                style={{ border: '1px solid rgba(96,165,250,0.18)', color: '#999' }}>
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(239,68,68,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#EF4444' }}>GUARDRAILS</div>
          <div className="flex flex-wrap gap-2">
            {guardrails.map(rule => (
              <span key={rule} className="rounded px-2 py-1 text-[10px] tracking-widest"
                style={{ border: '1px solid rgba(239,68,68,0.18)', color: '#999' }}>
                {rule}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function LocalCodeAgentBridgePanel({
  bridge,
  onRefresh,
}: {
  bridge: LocalAgentBridgeStatusResponse
  onRefresh: () => void
}) {
  const LOCAL_AGENT_ENV_HINT: Partial<Record<LocalAgentEngineId, string>> = {
    openhands: 'LOCAL_AGENT_OPENHANDS_URL',
    aider: 'LOCAL_AGENT_AIDER_PATH',
    continue: 'LOCAL_AGENT_CONTINUE_PATH',
    goose: 'LOCAL_AGENT_GOOSE_PATH',
  }
  const bridgeColor = bridge.bridge === 'online' ? '#34D399' : bridge.bridge === 'error' ? '#EF4444' : '#FFD700'
  const engineStatusStyle: Record<LocalAgentBridgeStatusResponse['engines'][LocalAgentEngineId]['status'], { color: string; label: string }> = {
    detected: { color: '#34D399', label: 'DETECTED' },
    reachable: { color: '#34D399', label: 'REACHABLE' },
    not_detected: { color: '#555', label: 'NOT DETECTED' },
    config_needed: { color: '#FFD700', label: 'CONFIG NEEDED' },
    unreachable: { color: '#EF4444', label: 'UNREACHABLE' },
    error: { color: '#EF4444', label: 'ERROR' },
  }
  const selectedEngine = bridge.selectedEngine ? bridge.engines[bridge.selectedEngine] : null

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(52,211,153,0.014)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#34D399' }}>
            LOCAL CODE AGENT BRIDGE
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Foundation for Ollama, LM Studio, OpenHands, Aider, Continue, and Goose.
          </p>
        </div>
        <button type="button" onClick={onRefresh}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ border: '1px solid rgba(52,211,153,0.35)', color: '#34D399', background: 'rgba(0,0,0,0.28)' }}>
          Refresh Bridge
        </button>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-6">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>BRIDGE STATUS</div>
          <div className="mt-1 font-bold" style={{ color: bridgeColor }}>{bridge.bridge.toUpperCase().replace('_', ' ')}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>AVAILABLE ENGINES</div>
          <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>
            {Object.values(bridge.engines).filter(engine => engine.status === 'detected').length}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>SELECTED ENGINE</div>
          <div className="mt-1 font-bold" style={{ color: selectedEngine ? '#FFD700' : '#777' }}>
            {selectedEngine?.name ?? 'none'}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>REPO ACCESS</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{bridge.repoAccessStatus}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>QA STATUS</div>
          <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>{bridge.qaStatus}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>ROLLBACK</div>
          <div className="mt-1 font-bold" style={{ color: '#EF4444' }}>{bridge.rollbackCheckpointStatus}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <div className="rounded px-3 py-2 text-xs lg:col-span-2" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#34D399' }}>ENGINE DETECTION</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {LOCAL_AGENT_ENGINES.map(engine => {
              const status = bridge.engines[engine.id]
              const style = engineStatusStyle[status.status]
              const isCliFamily = engine.id === 'continue' || engine.id === 'aider' || engine.id === 'openhands' || engine.id === 'goose'
              const rowLabel =
                isCliFamily && (status.status === 'not_detected' || status.status === 'config_needed')
                  ? 'NOT CONFIGURED'
                  : style.label
              const envHint = LOCAL_AGENT_ENV_HINT[engine.id]

              return (
                <div key={engine.id} className="rounded px-2 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold tracking-widest" style={{ color: '#ddd' }}>{engine.name}</span>
                    <span className="text-[10px] tracking-widest" style={{ color: style.color }}>{rowLabel}</span>
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed" style={{ color: '#666' }}>
                    {status.message}
                  </div>
                  {isCliFamily && !['detected', 'reachable'].includes(status.status) && envHint && (
                    <div className="mt-1 text-[10px]" style={{ color: '#888' }}>
                      Not installed/configured — install or connect to activate. Optional env: <span className="font-mono">{envHint}</span>
                    </div>
                  )}
                  <div className="mt-1 truncate text-[10px]" style={{ color: '#444' }}>
                    {status.endpoint ?? 'endpoint not configured'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,215,0,0.18)', background: 'rgba(0,0,0,0.24)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#FFD700' }}>TASK LIFECYCLE</div>
          <div className="flex flex-wrap gap-1">
            {LOCAL_AGENT_TASK_LIFECYCLE.map(step => (
              <span key={step} className="rounded px-2 py-1 text-[10px] tracking-widest"
                style={{ border: '1px solid #222', color: '#777' }}>
                {step}
              </span>
            ))}
          </div>
          <div className="mt-3 rounded px-2 py-2" style={{ border: '1px solid #222', color: '#555', background: 'rgba(0,0,0,0.22)' }}>
            Last task: {bridge.lastTask ?? 'none'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {LOCAL_AGENT_RELIABILITY_PRINCIPLES.map(principle => (
          <span key={principle} className="rounded px-2 py-1 text-[10px] tracking-widest"
            style={{ border: '1px solid rgba(52,211,153,0.18)', color: '#999', background: 'rgba(0,0,0,0.22)' }}>
            {principle}
          </span>
        ))}
      </div>

      <div className="mt-3 text-xs" style={{ color: '#555' }}>
        Last check: {bridge.checkedAt ? new Date(bridge.checkedAt).toLocaleString() : 'not checked yet'}
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
          const color = headline === 'Ready' ? '#34D399' : headline === 'Needs API key' ? '#FBBF24' : headline === 'Error — check key' ? '#EF4444' : '#888'

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
      <div className="mt-3 text-xs" style={{ color: '#555' }}>Last checked: {internet.lastChecked ? new Date(internet.lastChecked).toLocaleString() : 'not checked yet'} · research adapters: {internet.label}</div>
    </div>
  )
}

function RepoAccessPanel({ repo, onRefresh }: { repo: RepoStatus; onRefresh: () => void }) {
  const caps = repo.capabilities
  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0" style={{ background: 'rgba(167,139,250,0.014)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#A78BFA' }}>REPO ACCESS</h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Live git read from the server. <span style={{ color: '#9CA3AF' }}>Capabilities</span> report OS/git truth;{' '}
            <span style={{ color: '#FFD700' }}>Allowed</span> is War Room policy (automation never granted write/commit/rollback without explicit approval).
          </p>
        </div>
        <button type="button" onClick={onRefresh} className="rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ border: '1px solid rgba(167,139,250,0.35)', color: '#A78BFA', background: 'rgba(0,0,0,0.28)' }}>
          Refresh Repo
        </button>
      </div>
      <div className="grid gap-2 text-xs md:grid-cols-5">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>PATH</div><div className="mt-1 truncate" style={{ color: '#ddd' }}>{repo.repoPath || 'unknown'}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>GIT</div><div className="mt-1 font-bold" style={{ color: repo.gitAvailable ? '#34D399' : '#EF4444' }}>{repo.gitAvailable ? 'AVAILABLE' : 'OFF'}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>BRANCH</div><div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>{repo.currentBranch}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>WORKING TREE</div><div className="mt-1 font-bold" style={{ color: statusColor(repo.workingTreeStatus) }}>{repo.workingTreeStatus.toUpperCase()}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.28)' }}><div style={{ color: '#555' }}>CHANGED FILES</div><div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{repo.uncommittedFilesCount}</div></div>
      </div>
      <div className="mt-2 grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}><div style={{ color: '#555' }}>LAST COMMIT (short)</div><div className="mt-1 font-mono" style={{ color: '#888' }}>{repo.lastCommitHash?.short ?? '—'}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}><div style={{ color: '#555' }}>REMOTE</div><div className="mt-1 font-bold" style={{ color: repo.remoteConfigured ? '#34D399' : '#777' }}>{repo.remoteConfigured ? 'CONFIGURED' : 'NONE'}</div></div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}><div style={{ color: '#555' }}>READ (API)</div><div className="mt-1 font-bold" style={{ color: repo.canReadRepo ? '#34D399' : '#EF4444' }}>{String(repo.canReadRepo)}</div></div>
        <div className="rounded px-3 py-2 md:col-span-1" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.22)' }}><div style={{ color: '#555' }}>POLICY FLAGS</div><div className="mt-1 text-[10px] leading-snug" style={{ color: '#888' }}>write/commit/rollback require approval</div></div>
      </div>
      <div className="mt-2 rounded px-3 py-2 text-[10px] tracking-widest" style={{ border: '1px solid rgba(52,211,153,0.2)', background: 'rgba(0,0,0,0.22)' }}>
        <div className="mb-1 font-bold" style={{ color: '#9CA3AF' }}>CAPABILITIES (raw)</div>
        <div className="flex flex-wrap gap-2">
          <span style={{ color: caps.canWriteFilesystem ? '#34D399' : '#EF4444' }}>fs_write: {String(caps.canWriteFilesystem)}</span>
          <span style={{ color: caps.canGitCommit ? '#34D399' : '#FFD700' }} title="user.name / user.email and not bare">git_commit_ready: {String(caps.canGitCommit)}</span>
          <span style={{ color: caps.canCreateCheckpoint ? '#34D399' : '#EF4444' }}>checkpoint_dir_ok: {String(caps.canCreateCheckpoint)}</span>
        </div>
      </div>
      <div className="mt-2 rounded px-3 py-2 text-[10px] tracking-widest" style={{ border: '1px solid rgba(255,215,0,0.25)', background: 'rgba(0,0,0,0.22)' }}>
        <div className="mb-1 font-bold" style={{ color: '#FFD700' }}>ALLOWED (War Room — mirrors canWriteRepo / canCommit / canRollback)</div>
        <div className="flex flex-wrap gap-2">
          <span style={{ color: repo.allowed.write ? '#34D399' : '#777' }}>write: {String(repo.allowed.write)}</span>
          <span style={{ color: repo.allowed.commit ? '#34D399' : '#777' }}>commit: {String(repo.allowed.commit)}</span>
          <span style={{ color: repo.allowed.rollback ? '#34D399' : '#777' }}>rollback_apply: {String(repo.allowed.rollback)}</span>
        </div>
        <div className="mt-1 text-[9px] normal-case leading-relaxed" style={{ color: '#666' }}>
          Checkpoint JSON on disk is listed under Rollback Safety (`rollbackAvailable`), not here.
        </div>
      </div>
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
        {rollback.message || '—'}
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
            {loading ? 'LOADING…' : 'LOAD PREVIEW'}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-2 text-xs" style={{ color: '#EF4444' }}>{error}</div>
      )}
      {preview?.truncated && (
        <div className="mb-2 text-[10px] font-bold tracking-widest" style={{ color: '#FFD700' }}>OUTPUT TRUNCATED — see API cap.</div>
      )}
      <pre className="max-h-64 overflow-auto rounded p-3 text-[11px] leading-snug" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.45)', color: '#9CA3AF' }}>
        {preview?.diff ? preview.diff : '— click Load preview —'}
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
  if (title) return `${action.type} — ${title}`
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
        /* keep false — do not claim Vercel */
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
        {phase === 'initial' ? 'Checking approval queue…' : primaryLine}
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

function LocalFamilyAgentsPanel({
  families,
  onRefresh,
}: {
  families: LocalFamilyAgentsResponse
  onRefresh: () => void
}) {
  const { uiMode } = useWarRoomUiMode()
  const firstAgentId = families.familyAgents[0]?.id ?? ''
  const [selectedAgentId, setSelectedAgentId] = useState(firstAgentId)
  const [testPrompt, setTestPrompt] = useState('')
  const [testResponse, setTestResponse] = useState('')
  const [testLabel, setTestLabel] = useState('local model response')
  const [testLoading, setTestLoading] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const selectedAgent = families.familyAgents.find(agent => agent.id === selectedAgentId) ?? families.familyAgents[0]
  const availableCount = families.familyAgents.filter(agent => agent.modelInstalled).length

  const runLocalFamilyTest = async () => {
    if (!selectedAgent || !testPrompt.trim()) return

    setTestLoading(true)
    setTestError(null)
    setTestResponse('')

    try {
      const res = await fetch('/api/local-agent/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyAgentId: selectedAgent.id,
          prompt: testPrompt,
          provider: selectedAgent.provider,
          model: selectedAgent.model,
        }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.message || 'Local model invocation failed')
      setTestLabel(data.label ?? 'local model response')
      setTestResponse(data.response ?? '')
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'Local model invocation failed')
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(167,139,250,0.016)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#A78BFA' }}>
            LOCAL FAMILY AGENTS
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            War Room baby-family registry backed by local Ollama or LM Studio models. Prompt only, no execution permissions.
          </p>
        </div>
        <button type="button" onClick={onRefresh}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ border: '1px solid rgba(167,139,250,0.35)', color: '#A78BFA', background: 'rgba(0,0,0,0.28)' }}>
          Refresh Families
        </button>
      </div>

      <div className="mb-3 grid gap-2 text-xs md:grid-cols-5">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>OLLAMA</div>
          <div className="mt-1 font-bold" style={{ color: families.ollamaDetected ? '#34D399' : '#777' }}>
            {families.ollamaDetected ? 'DETECTED' : 'NOT DETECTED'}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>LM STUDIO</div>
          <div className="mt-1 font-bold" style={{ color: families.providers.lmStudio.functional ? '#34D399' : families.lmStudioDetected ? '#FFD700' : '#777' }}>
            {families.providers.lmStudio.functional ? 'FUNCTIONAL' : families.lmStudioDetected ? 'DETECTED' : 'NOT DETECTED'}
          </div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>AVAILABLE BABIES</div>
          <div className="mt-1 font-bold" style={{ color: '#60A5FA' }}>{availableCount}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(255,215,0,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>MODELS</div>
          <div className="mt-1 font-bold" style={{ color: '#FFD700' }}>{families.availableModels.length + families.lmStudioModels.length}</div>
        </div>
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(167,139,250,0.2)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="tracking-widest" style={{ color: '#555' }}>LAST CHECK</div>
          <div className="mt-1 font-bold" style={{ color: '#A78BFA' }}>
            {families.checkedAt ? new Date(families.checkedAt).toLocaleTimeString() : 'not checked'}
          </div>
        </div>
      </div>

      {families.availableModels.length === 0 && families.lmStudioModels.length === 0 ? (
        <div className="mb-3 rounded px-3 py-4 text-center text-xs tracking-widest"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#666', background: 'rgba(0,0,0,0.22)' }}>
          No local Ollama or LM Studio models found yet. Load a model, then refresh families.
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {families.availableModels.map(model => (
            <span key={model.name} className="rounded px-2 py-1 text-[10px] tracking-widest"
              style={{ border: '1px solid rgba(52,211,153,0.2)', color: '#9AE6B4', background: 'rgba(0,0,0,0.22)' }}>
              {model.name} {model.family ? `| ${model.family}` : ''} {model.parameterSize ? `| ${model.parameterSize}` : ''} {model.quantization ? `| ${model.quantization}` : ''}
            </span>
          ))}
          {families.lmStudioModels.map(model => (
            <span key={model.id} className="rounded px-2 py-1 text-[10px] tracking-widest"
              style={{ border: '1px solid rgba(167,139,250,0.2)', color: '#C4B5FD', background: 'rgba(0,0,0,0.22)' }}>
              LM Studio | {model.id}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-2 xl:grid-cols-3 lg:grid-cols-2">
        {families.familyAgents.map(agent => (
          <div key={agent.id} className="rounded px-3 py-2 text-xs"
            style={{
              border: agent.functional ? '1px solid rgba(52,211,153,0.22)' : '1px solid rgba(255,255,255,0.08)',
              background: agent.functional ? 'rgba(52,211,153,0.035)' : 'rgba(0,0,0,0.24)',
            }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold tracking-widest" style={{ color: agent.functional ? '#ddd' : '#777' }}>
                  {agent.displayName}
                </div>
                <div className="mt-1 text-[10px] tracking-widest" style={{ color: '#555' }}>{agent.family}</div>
              </div>
              <span className="rounded px-2 py-1 text-[10px] tracking-widest"
                style={{
                  border: agent.functional ? '1px solid rgba(52,211,153,0.25)' : '1px solid #222',
                  color: agent.functional ? '#34D399' : '#666',
                }}>
                {agent.status.toUpperCase()}
              </span>
            </div>
            <div className="mt-2 leading-relaxed" style={{ color: '#888' }}>{agent.role}</div>
            <div className="mt-2 grid gap-1 text-[10px]">
              <span style={{ color: '#666' }}>provider: <b style={{ color: '#A78BFA' }}>{agent.provider === 'lm_studio' ? 'LM Studio' : 'Ollama'}</b></span>
              <span style={{ color: '#666' }}>model: <b style={{ color: '#FFD700' }}>{agent.model}</b></span>
              <span style={{ color: agent.detected ? '#34D399' : '#EF4444' }}>detected: {String(agent.detected)}</span>
              <span style={{ color: agent.functional ? '#34D399' : '#EF4444' }}>functional: {String(agent.functional)}</span>
              <span style={{ color: '#777' }}>internet access: {String(agent.internetAccess)}</span>
              <span style={{ color: '#777' }}>approval required: {String(agent.requiresApproval)}</span>
              <span style={{ color: '#777' }}>can execute code: {String(agent.canExecuteCode)}</span>
              <span style={{ color: '#777' }}>can modify files: {String(agent.canModifyFiles)}</span>
            </div>
            <div className="mt-2 rounded px-2 py-2 leading-relaxed" style={{ border: '1px solid #222', color: '#666', background: 'rgba(0,0,0,0.22)' }}>
              {agent.notes}
            </div>
          </div>
        ))}
      </div>

      {uiMode === 'operator' ? (
        <details className="mt-3 rounded px-3 py-3 text-xs" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.26)' }}>
          <summary className="cursor-pointer font-bold tracking-widest" style={{ color: '#A78BFA' }}>Advanced Diagnostics (local model prompt test)</summary>
          <div className="mt-2">
            <div className="mb-2 font-bold tracking-widest" style={{ color: '#A78BFA' }}>LOCAL MODEL PROMPT</div>
            <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
              <select value={selectedAgent?.id ?? ''} onChange={event => setSelectedAgentId(event.target.value)}
                className="rounded bg-black px-3 py-2 text-xs"
                style={{ border: '1px solid #222', color: '#ddd' }}>
                {families.familyAgents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.displayName}</option>
                ))}
              </select>
              <input value={testPrompt} onChange={event => setTestPrompt(event.target.value)}
                className="rounded bg-black px-3 py-2 text-xs"
                style={{ border: '1px solid #222', color: '#ddd' }}
                placeholder="Send a safe prompt to the local model" />
              <button type="button" onClick={() => void runLocalFamilyTest()} disabled={testLoading || !selectedAgent?.functional || !testPrompt.trim()}
                className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
                style={{ background: '#A78BFA', color: '#000' }}>
                {testLoading ? 'ASKING...' : 'SEND TO LOCAL MODEL'}
              </button>
            </div>
            {(testResponse || testError) && (
              <div className="mt-3 rounded px-3 py-2 leading-relaxed" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
                <div className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: testError ? '#EF4444' : '#34D399' }}>
                  {testError ? 'LOCAL MODEL ERROR' : testLabel.toUpperCase()}
                </div>
                <div style={{ color: testError ? '#fca5a5' : '#bbb' }}>{testError ?? testResponse}</div>
              </div>
            )}
          </div>
        </details>
      ) : (
        <div className="mt-3 rounded px-3 py-3 text-xs" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.26)' }}>
          <div className="mb-2 font-bold tracking-widest" style={{ color: '#A78BFA' }}>LOCAL MODEL PROMPT</div>
          <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
            <select value={selectedAgent?.id ?? ''} onChange={event => setSelectedAgentId(event.target.value)}
              className="rounded bg-black px-3 py-2 text-xs"
              style={{ border: '1px solid #222', color: '#ddd' }}>
              {families.familyAgents.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.displayName}</option>
              ))}
            </select>
            <input value={testPrompt} onChange={event => setTestPrompt(event.target.value)}
              className="rounded bg-black px-3 py-2 text-xs"
              style={{ border: '1px solid #222', color: '#ddd' }}
              placeholder="Send a safe prompt to the local model" />
            <button type="button" onClick={() => void runLocalFamilyTest()} disabled={testLoading || !selectedAgent?.functional || !testPrompt.trim()}
              className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
              style={{ background: '#A78BFA', color: '#000' }}>
              {testLoading ? 'ASKING...' : 'SEND TO LOCAL MODEL'}
            </button>
          </div>
          {(testResponse || testError) && (
            <div className="mt-3 rounded px-3 py-2 leading-relaxed" style={{ border: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
              <div className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: testError ? '#EF4444' : '#34D399' }}>
                {testError ? 'LOCAL MODEL ERROR' : testLabel.toUpperCase()}
              </div>
              <div style={{ color: testError ? '#fca5a5' : '#bbb' }}>{testError ?? testResponse}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CapabilityRouterPanel() {
  const [taskCategory, setTaskCategory] = useState<LocalTaskCategory>('synthesis')
  const [prompt, setPrompt] = useState('')
  const [decision, setDecision] = useState<LocalTaskRoutingDecision | null>(null)
  const [routing, setRouting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const routeTask = async () => {
    setRouting(true)
    setError(null)

    try {
      const res = await fetch('/api/local-agent/route-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskCategory,
          prompt,
          requireApproval: true,
        }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.message || 'Capability routing failed')
      setDecision(data)
    } catch (routeError) {
      setError(routeError instanceof Error ? routeError.message : 'Capability routing failed')
    } finally {
      setRouting(false)
    }
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0"
      style={{ background: 'rgba(56,189,248,0.014)' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>
            CAPABILITY ROUTER
          </h2>
          <p className="mt-1 text-xs" style={{ color: '#666' }}>
            Routes task types to the right local family baby. Routing only; safe invoke remains separate.
          </p>
        </div>
        <button type="button" onClick={() => void routeTask()} disabled={routing}
          className="rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-40"
          style={{ background: '#38BDF8', color: '#000' }}>
          {routing ? 'ROUTING...' : 'ROUTE TASK'}
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-[220px_1fr]">
        <select value={taskCategory} onChange={event => setTaskCategory(event.target.value as LocalTaskCategory)}
          className="rounded bg-black px-3 py-2 text-xs"
          style={{ border: '1px solid #222', color: '#ddd' }}>
          {LOCAL_TASK_CATEGORIES.map(category => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
        <input value={prompt} onChange={event => setPrompt(event.target.value)}
          className="rounded bg-black px-3 py-2 text-xs"
          style={{ border: '1px solid #222', color: '#ddd' }}
          placeholder="Optional prompt context for routing only" />
      </div>

      {error && (
        <div className="mt-3 rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', background: 'rgba(239,68,68,0.05)' }}>
          {error}
        </div>
      )}

      {decision ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(56,189,248,0.22)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>SELECTED FAMILY</div>
            <div className="mt-1 font-bold" style={{ color: '#38BDF8' }}>{decision.selectedFamily}</div>
            <div className="mt-2 tracking-widest" style={{ color: '#555' }}>LOCAL BABY</div>
            <div className="mt-1" style={{ color: '#ddd' }}>{decision.selectedAgent.displayName}</div>
          </div>
          <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>SELECTED MODEL</div>
            <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{decision.selectedModel}</div>
            <div className="mt-2" style={{ color: decision.modelInstalled ? '#34D399' : '#EF4444' }}>
              model installed: {String(decision.modelInstalled)}
            </div>
            <div className="mt-1" style={{ color: '#777' }}>approval required: {String(decision.approvalRequired)}</div>
            <div className="mt-1" style={{ color: '#777' }}>can execute: {String(decision.canExecute)}</div>
          </div>
          <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,215,0,0.22)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="tracking-widest" style={{ color: '#555' }}>RECOMMENDED NEXT STEP</div>
            <div className="mt-1 leading-relaxed" style={{ color: '#FFD700' }}>{decision.recommendedNextStep}</div>
          </div>
          <div className="rounded px-3 py-2 text-xs lg:col-span-2" style={{ border: '1px solid rgba(167,139,250,0.18)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-2 font-bold tracking-widest" style={{ color: '#A78BFA' }}>REASONING</div>
            <div className="leading-relaxed" style={{ color: '#bbb' }}>{decision.reasoning}</div>
          </div>
          <div className="rounded px-3 py-2 text-xs" style={{ border: '1px solid rgba(239,68,68,0.18)', background: 'rgba(0,0,0,0.24)' }}>
            <div className="mb-2 font-bold tracking-widest" style={{ color: '#EF4444' }}>SUPPORT RECOMMENDATION</div>
            {decision.recommendedSupportingAgents.length === 0 ? (
              <div style={{ color: '#555' }}>No supporting baby recommended.</div>
            ) : (
              <div className="grid gap-1">
                {decision.recommendedSupportingAgents.map(agent => (
                  <span key={agent.id} style={{ color: '#999' }}>{agent.displayName}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded px-3 py-4 text-center text-xs tracking-widest"
          style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#555', background: 'rgba(0,0,0,0.22)' }}>
          No task routed yet.
        </div>
      )}
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

function UnifiedEngineControlPanel() {
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
      if (!res.ok) throw new Error(json.message || 'Engine status failed')
      setData(json)
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
            Live engine matrix: local services (Ollama, LM Studio, OpenHands), cloud keys, IDE/CLI bridges. Read-only status — no execution from this table.
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
                  <th className="pb-2 font-bold tracking-widest">READINESS</th>
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
}

type EngineRouteCommandApiResponse = RouteCommandResult & {
  enginesSummary?: Array<{ id: string; functional: boolean; reachable: boolean; configured: boolean }>
  message?: string
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
  const { uiMode, setUiMode } = useWarRoomUiMode()
  const [command, setCommand] = useState('')

  const [loading, setLoading] = useState(false)
  const [typingFamily, setTypingFamily] = useState<TypingFamily | null>(null)
  const [toolBarHealth, setToolBarHealth] = useState(initialToolBarHealth)
  const [toolBarActivity, setToolBarActivity] = useState<Partial<Record<ToolId, ToolBarLabel>>>({})
  const [operatorTab, setOperatorTab] = useState<OperatorTab>('command')

  const refreshToolBarHealthBars = () => fetchToolBarHealth().then(setToolBarHealth).catch(() => undefined)

  useEffect(() => {
    if (operatorTab !== 'system') return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void refreshToolBarHealthBars()
    }
    const id = window.setInterval(tick, 120_000)
    return () => window.clearInterval(id)
  }, [operatorTab])
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [repoAwareness, setRepoAwareness] = useState<RepoAwarenessState>(INITIAL_REPO_AWARENESS_STATE)
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>(INITIAL_PROVIDER_HEALTH)
  const [redTeamCoder, setRedTeamCoder] = useState<RedTeamCoderUiState>(INITIAL_RED_TEAM_CODER_STATE)
  const [localAgentBridge, setLocalAgentBridge] = useState<LocalAgentBridgeStatusResponse>(INITIAL_LOCAL_AGENT_BRIDGE)
  const [localFamilyAgents, setLocalFamilyAgents] = useState<LocalFamilyAgentsResponse>(INITIAL_LOCAL_FAMILY_AGENTS)
  const councilPersistenceCtx = useMemo(
    () =>
      buildCouncilPersistenceContext({
        localFamilyAgents,
        orchestrationFamilyToLocalAgentId,
      }),
    [localFamilyAgents],
  )
  const { store: council, dispatch: councilDispatch, mounted: councilMounted, newSessionId } =
    useCouncilSession(councilPersistenceCtx)
  const messages = council.messages
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
  const [geminiEngineRow, setGeminiEngineRow] = useState<EngineStatus | null>(null)
  const [engineList, setEngineList] = useState<EngineStatus[]>([])
  const engineMapRef = useRef<Map<EngineId, EngineStatus>>(new Map())
  const [liveCouncilConvId, setLiveCouncilConvId] = useState<string | null>(null)
  const [persistenceAvailable, setPersistenceAvailable] = useState(false)
  const [continuityMode, setContinuityMode] = useState<RuntimeContinuityIndicatorMode>('Unknown')
  const [continuityRecoverAt, setContinuityRecoverAt] = useState<string | null>(null)
  const [recoverRuntimeBanner, setRecoverRuntimeBanner] = useState(false)
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
  const decreePacketFlushCompleteRef = useRef(false)
  const decreePacketOpenedAtMsRef = useRef(0)
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

  const addMessages = (newMsgs: CouncilMessage[]) => {
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
    councilDispatch({ type: 'ADD_MESSAGES', payload: normalized })
  }

  const updateMessageContent = (id: string, content: string) => {
    councilDispatch({ type: 'UPDATE_MESSAGE', payload: { id, content } })
  }

  const setPresence = (familyName: TypingFamily, status: FamilyPresence['status'], label: string) => {
    setFamilyPresence(prev => ({ ...prev, [familyName]: { status, label } }))
  }

  const addSystemMessage = (content: string, opts?: { force?: boolean }) => {
    if (
      !opts?.force
      && shouldSuppressProviderFailureFromChatStream(content, { diagnosticsOpen: operatorTab === 'diagnostics' })
    ) {
      return
    }
    councilDispatch({
      type: 'ADD_SYSTEM_MESSAGE_DEDUPED',
      payload: { id: createMessageId('system'), content, timestamp: new Date().toLocaleTimeString() },
    })
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
    },
  ) => {
    if (
      opts?.applyAttendanceLateGatherSkip
      && attendanceSoftGatherUiClosedRef.current
    ) {
      return
    }
    if (
      (input.role === 'system' || input.role === 'assistant')
      && shouldSuppressProviderFailureFromChatStream(input.content, { diagnosticsOpen: operatorTab === 'diagnostics' })
    ) {
      return
    }
    const persistable = councilMessageFromLivePost(input, {
      responseSuccessful: opts?.responseSuccessful,
      providerRuntime: opts?.providerRuntime,
    })
    if (!shouldPersistCouncilMessage(persistable, councilPersistenceCtx)) return
    if (!liveCouncilConvId || !persistenceAvailable) return
    try {
      await fetch(`/api/conversations/${liveCouncilConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: input.role,
          content: input.content,
          family: input.family ?? null,
          metadata: {
            responseSuccessful: opts?.responseSuccessful === true,
            ...(opts?.providerRuntime ? { providerRuntime: opts.providerRuntime } : {}),
          },
        }),
      })
    } catch {
      /* session fallback */
    }
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
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Memory retrieval failed')
      setMemories(data.memories ?? [])
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
      const res = await fetch('/api/providers/health')
      const data = await res.json() as {
        providers?: ProviderHealthState['providers']
        labels?: ProviderHealthState['labels']
        message?: string
      }
      if (!res.ok) throw new Error(data.message || 'Provider health check failed')
      const prov = data.providers ?? INITIAL_PROVIDER_HEALTH.providers
      const lab = data.labels ?? INITIAL_PROVIDER_HEALTH.labels
      const { gemini: _gp, ...provOther } = prov
      const { gemini: _gl, ...labOther } = lab
      void _gp
      void _gl
      setProviderHealth(prev => ({
        providers: {
          ...INITIAL_PROVIDER_HEALTH.providers,
          ...provOther,
          gemini: prev.providers.gemini,
        },
        labels: {
          ...INITIAL_PROVIDER_HEALTH.labels,
          ...labOther,
          gemini: prev.labels.gemini,
        },
      }))
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

  const loadLocalAgentBridge = async () => {
    try {
      const res = await fetch('/api/local-agent/status')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Local agent bridge check failed')
      setLocalAgentBridge(data)
    } catch {
      setLocalAgentBridge(prev => ({
        ...prev,
        bridge: 'error',
        qaStatus: 'error',
        checkedAt: new Date().toISOString(),
      }))
    }
  }

  const loadLocalFamilyAgents = async () => {
    try {
      const res = await fetch('/api/local-agent/families')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Local family registry check failed')
      setLocalFamilyAgents(data)
    } catch {
      setLocalFamilyAgents(prev => ({
        ...prev,
        ollamaDetected: false,
        checkedAt: new Date().toISOString(),
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
        setContinuityRecoverAt(null)
        setRecoveredIntegrityPartial(null)
        setRecoveredAttendanceSummary(null)
        setRecoveredDiagnosticHistory([])
        setRecoveredRedTeamHold(null)
        return
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
      message: 'Income Workers scanning real source-linked opportunities...',
      scannedAt: new Date().toISOString(),
    }))

    try {
      const res = await fetch('/api/income-workers/scout', { method: 'POST' })
      const data = await res.json() as IncomeWorkerScoutResult & { message?: string }
      setIncomeWorkerScout({
        status: data.status,
        message: data.message ?? 'Income Worker scout complete.',
        scannedAt: data.scannedAt ?? new Date().toISOString(),
        providerUsed: data.providerUsed ?? 'none',
        sourcesChecked: Number(data.sourcesChecked ?? 0),
        candidates: Array.isArray(data.candidates) ? data.candidates : [],
        rejected: Array.isArray(data.rejected) ? data.rejected : [],
      })
      const reviewPayload = data as IncomeWorkerScoutResult & { councilReviews?: IncomeCouncilReview[] }
      setIncomeCouncilReviews(Array.isArray(reviewPayload.councilReviews)
        ? reviewPayload.councilReviews
        : [])
    } catch (error) {
      setIncomeWorkerScout(prev => ({
        ...prev,
        status: 'error',
        message: error instanceof Error ? error.message : 'Income Worker scout failed.',
        scannedAt: new Date().toISOString(),
        candidates: [],
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
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Memory save failed')

      if (data.memory) {
        setMemories(prev => [data.memory, ...prev].slice(0, 10))
      }
      addSystemMessage('Memory saved')
      setMemoryNotification('Memory Saved')
      window.setTimeout(() => setMemoryNotification(null), 2400)
    } catch {
      setToolBarHealth(prev => ({ ...prev, memory: 'ERROR' }))
      addSystemMessage('Memory save failed')
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
  }) => {
    const family = colorOverride
      ? { color: colorOverride, icon: iconOverride ?? '•' }
      : FAMILY_META[familyName]
    const label = bubbleFamilyName ?? familyName
    const now = new Date().toLocaleTimeString()
    const resolvedMessageId = messageId || createMessageId(label)

    if (instant) {
      addMessages([{
        id: resolvedMessageId,
        familyName: label,
        content,
        timestamp: now,
        color: family.color,
        icon: family.icon,
        provider,
        messageType: 'response',
      }])
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

    for (let i = 0; i < content.length; i += STREAM_CHUNK_SIZE) {
      if (councilPausedRef.current || !councilChannelOpenRef.current) return
      updateMessageContent(resolvedMessageId, content.slice(0, i + STREAM_CHUNK_SIZE))
      await wait(STREAM_CHUNK_DELAY_MS)
    }

    updateMessageContent(resolvedMessageId, content)
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
    opts?: { councilRevealSource?: 'autonomous' | 'decree'; autonomousDecreeRoundAtFetch?: number },
  ) => {
    if (shouldSuppressProviderFailureFromChatStream(text, { diagnosticsOpen: operatorTab === 'diagnostics' })) {
      return
    }
    const councilRevealSource = opts?.councilRevealSource ?? 'autonomous'
    if (councilRevealSource === 'decree' && decreePacketFlushCompleteRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.debug("[Live Council] Suppressed visible late family reply after packet close.")
      }
      return
    }
    if (
      councilRevealSource === 'autonomous'
      && typeof opts?.autonomousDecreeRoundAtFetch === 'number'
      && shouldSuppressStaleAutonomousReveal(opts.autonomousDecreeRoundAtFetch, decreeRoundGenRef.current)
    ) {
      console.warn('[council-session] suppressed_stale_autonomous_reveal')
      return
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
    })
    const finalCost = totalUsageCost(nextUsageRows)
    setUsageRows(nextUsageRows)
    setCurrentDecreeCost(finalCost)
    setSessionCost(prev => prev + finalCost)
  }

  const mergeContinuationFromChatJson = (data: CouncilChatJson) => {
    const cr = data.continuationRequest
    if (!cr) return
    setContinuationRequests(prev => {
      if (prev.some(p => p.id === cr.id)) return prev
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
    const augment = buildOrchestrationAugment(family, snap.deepDiscussionMode)
    const autonomousIntent = resolveCurrentIntent({ latestRaelDecreeText: lastRaelDirectiveContentRef.current })
    const threadHistory = messagesRef.current.map(m => ({ sender: m.familyName, content: m.content }))
    const inputText = `${decree}\n${threadHistory.map(m => `${m.sender}: ${m.content}`).join('\n')}`

    const agentId = orchestrationFamilyToLocalAgentId(family)
    const agent = localFamilyAgents.familyAgents.find(a => a.id === (agentId ?? ''))

    let textOut: string | null = null

    if (agent?.functional && agentId) {
      const threadBlock = threadHistory.slice(-16).map(m => `${m.sender}: ${m.content}`).join('\n')
      const authoritativeDecree = lastRaelDirectiveContentRef.current.trim() || decree
      const localPrompt = `${augment}\n\nCURRENT DECREE (authoritative):\n${authoritativeDecree}\n\nCouncil thread (continuity only, most recent last):\n${threadBlock}\n\nRespond with one concise in-character council message only.`
      try {
        const r = await fetch('/api/local-agent/invoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            familyAgentId: agentId,
            prompt: localPrompt,
            provider: agent.provider,
            model: agent.model,
          }),
        })
        if (r.ok) {
          const d = await r.json() as { response?: string }
          const t = typeof d.response === 'string' ? d.response.trim() : ''
          if (t) {
            const gov = applyGovernor(t, family, activeCouncilCommandRef.current, {
              raelDirectiveText: lastRaelDirectiveContentRef.current,
              councilIntentKind: autonomousIntent.intent,
              councilActiveScope: autonomousIntent.scope,
              verifiedRuntimeContext: { family },
            })
            if (!gov.warnings?.includes(COUNCIL_GOVERNOR_SILENT_SKIP)) {
              textOut = gov.text
            }
          }
        }
      } catch {
        textOut = null
      }
    }

    councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: true })
    let shouldScheduleNext = false
    try {
      if (!textOut) {
        const autoBudget = resolveProviderTimeoutMs({
          intentKind: autonomousIntent.intent,
          mode: 'continue',
          councilCommand: activeCouncilCommandRef.current,
        })
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
        } finally {
          window.clearTimeout(tid)
        }
        if (!r.ok) {
          lastCouncilFamilyErrorRef.current = family
          const summary = typeof data.message === 'string' ? data.message : (data.error ?? `HTTP ${r.status}`)
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
      shouldScheduleNext = !willHitRaelGate
    } catch (e) {
      councilDispatch({
        type: 'SET_PROVIDER_ERROR',
        payload: e instanceof Error ? e.message : String(e),
      })
    } finally {
      autonomousOrchInFlightRef.current = false
      councilDispatch({ type: 'SET_AWAITING_RESPONSES', payload: false })
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
    orchRedTeamEarlyLatchRef.current = false
    const toolIntent = mode !== 'continue' && detectToolIntent(decree)
    if (toolIntent && toolRequestActiveRef.current) {
      addSystemMessage('Research already in progress.')
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller
    setLoading(true)
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
    const intent = lastDecreeIntentRef.current ?? classifyRaElMessage(decree)

    const rosterLabel = (fid: CouncilOrchestrationFamily) =>
      COUNCIL_ROSTER.find(r => r.id === fid)?.label ?? fid

    const postCouncilChatDecreeGather = async (body: Parameters<typeof postCouncilChat>[0]) => {
      const merged = new AbortController()
      const onDecreeAbort = () => merged.abort()
      controller.signal.addEventListener('abort', onDecreeAbort, { once: true })
      const hangId = window.setTimeout(() => merged.abort(), DECREE_GATHER_HARD_HANG_MS)
      if (controller.signal.aborted) merged.abort()
      try {
        const out = await postCouncilChat({ ...body, councilGatherPhase: 'decree_soft' }, merged.signal)
        mergeContinuationFromChatJson(out.data)
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

      let order = buildDecreeFamilyOrder({
        incomeOperationsMode: incomeOperationsMode || intent.tier === 'income_ops',
        planningMode,
        extraFamilies: extra,
        maxFamilies: cmd.directInvocation ? 1 : attendanceWave ? 8 : intent.maxFamilies,
        singleFamilyRotate:
          cmd.directInvocation
          || (councilIntentState.intent === 'greeting' && !decreeAsksMultiFamilyGreeting(decree))
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
            localFamilyAgents,
          })
        : filterOrchestrationOrderByCommand(order, cmd, decree)
      const diagnosticIntentMode = resolveDiagnosticIntentMode(decree)
      const diagnosticSequential = diagnosticIntentMode !== 'none' && !attendanceWave
      const orderForGather = diagnosticSequential ? buildDefaultDiagnosticOrder(directedOrder) : directedOrder
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
        if (family === 'kimi' || family === 'bridge_architect') {
          const agentId = orchestrationFamilyToLocalAgentId(family)
          if (!agentId) return false
          return Boolean(localFamilyAgents.familyAgents.find(a => a.id === agentId)?.functional)
        }
        if (family === 'gemini' && skipGeminiForSessionRef.current) return false
        const eid = cloudEngineIdForCouncilFamily(family)
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
      const staged: { family: CouncilOrchestrationFamily; textOut: string }[] = []

      const batchCeilingMs = attendanceWave
        ? resolveAttendanceBatchCeilingMs({ familyCount: directedOrder.length })
        : null

      const gatherPostSystem = (line: string) => {
        if (attendanceWave && attendanceSoftGatherUiClosedRef.current) return
        addSystemMessage(line)
      }
      const gatherPostLive = (input: { role: 'user' | 'assistant' | 'system'; content: string; family?: string | null }) =>
        postLiveCouncilMessage(input, { applyAttendanceLateGatherSkip: attendanceWave })

      let providerRuntimeStates: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> = {}
      let providerRuntimeDetails: CouncilProviderRuntimeDetails | undefined
      let attendancePreflightMap: Partial<Record<CouncilOrchestrationFamily, AttendancePreflightStatus>> = {}

      if (attendanceWave) {
        attendancePreflightMap = await runAttendancePreflight(directedOrder, {
          engineMap: engineMapRef.current,
          localFamilyAgents,
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
        const label = rosterLabel(family)
        const isDirectInvoke = Boolean(cmd.directInvocation && cmd.targetFamilies[0] === family)
        const postDirectUnavailable = (rt: ProviderFamilyOutcomeStatus, detail?: string) => {
          const line = replaceWithRuntimeTruthLine(
            family,
            providerOutcomeToVerifiedContext({ family, runtime: rt, runtimeDetail: detail }),
          )
          gatherPostSystem(line)
          void gatherPostLive({ role: 'system', content: line })
        }
        const deep = councilSnapRef.current.deepDiscussionMode
        const summarizeAugment = mode === 'summarize'
          ? `${buildDecreeFamilyAugment(family, deep, augmentCtx)}\n\nTASK: Summarize the council thread so far for Ra'el in concise bullets. Do not invent facts beyond the thread.`
          : null
        const augment = summarizeAugment
          ?? (planningMode ? buildCouncilPlanningAugment(family, deep, augmentCtx) : buildDecreeFamilyAugment(family, deep, augmentCtx))

        const tryLocal = async (): Promise<string | null> => {
          const agentId = orchestrationFamilyToLocalAgentId(family)
          if (!agentId) return null
          const agent = localFamilyAgents.familyAgents.find(a => a.id === agentId)
          if (!agent?.functional) return null
          const th = threadHistory().slice(-16).map(m => `${m.sender}: ${m.content}`).join('\n')
          const localPrompt = `${augment}\n\nCURRENT DECREE (authoritative):\n${decree}\n\nCouncil thread (continuity only, most recent last):\n${th}\n\nRespond with one concise in-character council message only.`
          const localController = new AbortController()
          const abortLocal = () => localController.abort()
          controller.signal.addEventListener('abort', abortLocal, { once: true })
          const localTimeoutId = window.setTimeout(() => localController.abort(), 18_000)
          try {
            const r = await fetch('/api/local-agent/invoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                familyAgentId: agentId,
                prompt: localPrompt,
                provider: agent.provider,
                model: agent.model,
              }),
              signal: localController.signal,
            })
            if (!r.ok) return null
            const d = await r.json() as { response?: string }
            const t = typeof d.response === 'string' ? d.response.trim() : ''
            if (!t) return null
            const gov = applyGovernor(t, family, activeCouncilCommandRef.current, {
              raelDirectiveText: decree,
              councilIntentKind: councilIntentState.intent,
              councilActiveScope: councilIntentState.scope,
              modeGovernor,
              verifiedRuntimeContext: providerRuntimeStates[family]
                ? providerOutcomeToVerifiedContext({
                    family,
                    runtime: providerRuntimeStates[family]!,
                  })
                : { family },
              roomStatuses: buildRoomStatusesFromProviderStates(
                providerRuntimeStates,
                orderForGather,
              ),
            })
            if (gov.warnings?.includes(COUNCIL_GOVERNOR_SILENT_SKIP)) return null
            return gov.text || null
          } catch {
            return null
          } finally {
            window.clearTimeout(localTimeoutId)
            controller.signal.removeEventListener('abort', abortLocal)
          }
        }

        let textOut: string | null = null
        let runtime: ProviderFamilyOutcomeStatus = 'SKIPPED'
        let runtimeDetail: string | undefined

        try {
          if (family === 'kimi' || family === 'bridge_architect') {
            textOut = await tryLocal()
            if (!textOut) {
              if (isDirectInvoke) {
                postDirectUnavailable('FAILED', 'local_unavailable')
              } else {
                const sys = `${label}: unavailable (local ${family} agent not functional or invoke failed)`
                gatherPostSystem(sys)
                void gatherPostLive({ role: 'system', content: sys })
              }
              runtime = 'FAILED'
              runtimeDetail = 'local_unavailable'
            } else {
              runtime = 'RESPONDED'
            }
          } else if (family === 'gemini' && skipGeminiForSessionRef.current) {
            runtime = 'SKIPPED'
            runtimeDetail = 'gemini_session_backoff'
            if (isDirectInvoke) postDirectUnavailable('SKIPPED', runtimeDetail)
          } else {
            const eid = cloudEngineIdForCouncilFamily(family)
            const row = eid ? engineMapRef.current.get(eid) : undefined
            const engineGateBlocksChat =
              !attendanceWave && !isEngineFunctional(engineMapRef.current, eid)
            if (engineGateBlocksChat) {
              if (isDirectInvoke) {
                postDirectUnavailable('SKIPPED', unavailableReason(row))
              } else {
                const sys = `${label}: unavailable (${unavailableReason(row)})`
                gatherPostSystem(sys)
                void gatherPostLive({ role: 'system', content: sys })
              }
              runtime = 'SKIPPED'
              runtimeDetail = 'engine_unavailable'
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
                })

                if (chatRes.ok && chatData.councilProviderHttpStatus === 'timed_out') {
                  runtime = 'TIMED_OUT'
                  runtimeDetail = chatData.councilProviderHttpDetail
                  textOut = null
                  if (isDirectInvoke) postDirectUnavailable('TIMED_OUT', runtimeDetail)
                } else if (chatRes.ok && chatData.councilProviderHttpStatus === 'failed') {
                  runtime = 'FAILED'
                  runtimeDetail = chatData.councilProviderHttpDetail
                  textOut = null
                  if (isDirectInvoke) {
                    textOut = await tryLocal()
                    if (!textOut) postDirectUnavailable('FAILED', runtimeDetail)
                  }
                } else if (!chatRes.ok) {
                  lastCouncilFamilyErrorRef.current = family
                  const summary = typeof chatData.message === 'string' ? chatData.message : (chatData.error ?? `HTTP ${chatRes.status}`)
                  if (isGeminiCouncilBackoffFailure(family, chatRes, chatData)) {
                    geminiFailureCountRef.current += 1
                    geminiLastErrorSummaryRef.current = summary
                    skipGeminiForSessionRef.current = true
                    if (!geminiUnavailableUserMessagedRef.current) {
                      geminiUnavailableUserMessagedRef.current = true
                      const line = `Gemini unavailable: ${summary.slice(0, 500)}`
                      gatherPostSystem(line)
                      void gatherPostLive({ role: 'system', content: line })
                    }
                    textOut = null
                    runtime = 'FAILED'
                    runtimeDetail = 'gemini_backoff'
                  } else if (isDirectInvoke) {
                    textOut = await tryLocal()
                    if (!textOut) {
                      postDirectUnavailable('FAILED', summary)
                      runtime = 'FAILED'
                      runtimeDetail = 'cloud_and_local_failed'
                    } else {
                      runtime = 'RESPONDED'
                    }
                  } else {
                    const err = `[Error] ${label}: ${summary}`
                    gatherPostSystem(err)
                    void gatherPostLive({ role: 'system', content: err })
                    textOut = await tryLocal()
                    if (!textOut) {
                      gatherPostSystem(`${label}: cloud failed and local fallback unavailable.`)
                      runtime = 'FAILED'
                      runtimeDetail = 'cloud_and_local_failed'
                    } else {
                      runtime = 'RESPONDED'
                    }
                  }
                } else if (chatData.councilGovernorSkipped) {
                  textOut = null
                  runtime = 'SKIPPED'
                  runtimeDetail = 'governor_silent_skip'
                } else {
                  textOut = typeof chatData.councilSingleResponse === 'string' ? chatData.councilSingleResponse.trim() : ''
                  if (!textOut) {
                    if (!isDirectInvoke) {
                      const err = `[Error] ${label}: empty response`
                      lastCouncilFamilyErrorRef.current = family
                      gatherPostSystem(err)
                      void gatherPostLive({ role: 'system', content: err })
                    }
                    textOut = await tryLocal()
                    if (!textOut) {
                      if (isDirectInvoke) postDirectUnavailable('FAILED', 'empty_then_local_failed')
                      runtime = 'FAILED'
                      runtimeDetail = 'empty_then_local_failed'
                    } else {
                      runtime = 'RESPONDED'
                    }
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
                  if (isDirectInvoke) postDirectUnavailable('TIMED_OUT', runtimeDetail)
                } else if (isDirectInvoke) {
                  textOut = await tryLocal()
                  if (!textOut) {
                    const summary = familyError instanceof Error ? familyError.message : String(familyError)
                    postDirectUnavailable('FAILED', summary)
                    runtime = 'FAILED'
                  } else {
                    runtime = 'RESPONDED'
                  }
                } else {
                  lastCouncilFamilyErrorRef.current = family
                  const summary = familyError instanceof Error ? familyError.message : String(familyError)
                  const err = `[Error] ${label}: ${summary}`
                  gatherPostSystem(err)
                  void gatherPostLive({ role: 'system', content: err })
                  textOut = await tryLocal()
                  if (!textOut) {
                    gatherPostSystem(`${label}: provider failed and local fallback unavailable.`)
                    runtime = 'FAILED'
                  } else {
                    runtime = 'RESPONDED'
                  }
                }
              }
            }
          }
        } finally {
          setFamilyDuty(prev => ({ ...prev, [family]: 'standing_by' }))
        }

        return { family, textOut, runtime, runtimeDetail }
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
        .map(c => ({ family: c.family, textOut: c.textOut!.trim() }))

      if (
        intent.tier === 'casual'
        && stagedCandidates.length
        && !attendanceWave
        && !diagnosticSequential
      ) {
        staged.push(stagedCandidates[0]!)
      } else {
        for (const row of stagedCandidates) staged.push(row)
      }

      const attendanceRevealedFamilies = new Set<CouncilOrchestrationFamily>(
        staged.map(s => s.family),
      )

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
        linesToRelease: { family: CouncilOrchestrationFamily; textOut: string }[],
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
          if (!line.content.trim()) continue
          await revealOrchestrationTurn(line.family, line.content, inputText(), { councilRevealSource: 'decree' })
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
          const focusSnippet = line.content.replace(/\s+/g, ' ').trim().slice(0, 120)
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

          const lateLines: { family: CouncilOrchestrationFamily; textOut: string }[] = []
          for (const c of cells) {
            if (attendanceRevealedFamilies.has(c.family)) continue
            if (c.textOut?.trim()) {
              lateLines.push({ family: c.family, textOut: c.textOut.trim() })
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
      if (councilSnapRef.current.councilState === 'idle') {
        councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'active' })
      }

      if (anySuccess && intent.tier !== 'casual' && !inputText().toLowerCase().includes('continue council discussion')) {
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
      if (intent.maxFamilies > 0) {
        window.setTimeout(() => {
          const s = councilSnapRef.current
          if (s.councilState !== 'active' || !s.councilChannelOpen) return
          scheduleNextOrchestration()
        }, 0)
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      const msg = error instanceof Error ? error.message : 'Council unreachable.'
      addSystemMessage(`[Error] ${msg}`)
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

  const sendRaelDecree = async (decree: string, mode?: CouncilMode) => {
    setExpansionPrompt(null)

    /*
     * Ra’el directive source: Live Council composer (`sendRaelDecree` → `submitDecree`).
     * `isRaelCouncilMessage` treats `messageType === 'decree'` or familyName containing RA'EL.
     * If external channels are ambiguous, prefer user text containing "Ra'el" — not wired here.
     */
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

  const handleSummarize = () => {
    lastDecreeIntentRef.current = {
      tier: 'council_full',
      shouldEmitBusEvents: false,
      shouldRunFamilyRound: true,
      maxFamilies: 4,
    }
    window.setTimeout(() => void submitDecree('summarize council discussion', 'summarize'), 0)
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
    councilDispatch({ type: 'SET_COUNCIL_STATE', payload: 'paused' })
    clearOrchestrationTimer()
    cancelActiveCouncilRequest()
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

  const endCouncilSession = () => {
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
    setCouncilUiCommand({ ...DEFAULT_COUNCIL_COMMAND })
    setCouncilPacketRender(null)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(GEMINI_REPAIR_ENQUEUE_METADATA_KEY)
    }
    councilDispatch({ type: 'END_SESSION', payload: { sessionId: newSessionId() } })
    addSystemMessage('Council session ended. Speak your decree when ready.')
  }

  const clearCouncilSession = () => {
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
    setCouncilUiCommand({ ...DEFAULT_COUNCIL_COMMAND })
    setCouncilPacketRender(null)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(GEMINI_REPAIR_ENQUEUE_METADATA_KEY)
    }
    councilDispatch({ type: 'CLEAR_SESSION', payload: { sessionId: newSessionId() } })
    addSystemMessage('Council transcript cleared. Session counters reset.')
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
  const chatHealthLabel = useMemo(() => {
    if (loading) return 'Working'
    if (currentPacketProviderIssue) return 'Error'
    if (council.councilState === 'provider_error') return 'Error'
    return 'Ready'
  }, [loading, currentPacketProviderIssue, council.councilState])
  const councilContinueStatusLine = useMemo(() => {
    if (currentPacketProviderIssue) return 'Provider issue — see family status badges.'
    if (council.councilState === 'paused') return 'Paused'
    if (council.councilState === 'idle') return 'Idle'
    if (council.councilState === 'waiting_for_rael') return 'Waiting for Ra’el'
    if (council.councilState === 'researching') return 'Researching'
    if (council.councilState === 'active' && council.isAwaitingResponses) return 'Families Responding'
    if (council.councilState === 'active') return 'Council Active'
    return council.councilState
  }, [
    currentPacketProviderIssue,
    council.councilState,
    council.isAwaitingResponses,
  ])
  const providerHealthLabel = coreProviderStates.some(status => status === 'online' || status === 'standby')
    ? 'Ready'
    : 'Degraded'
  const persistenceHealthLabel = persistenceAvailable ? 'Ready' : 'Session only'
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
        <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: uiMode === 'advanced' ? '1px solid #FFD700' : '1px solid #444', color: uiMode === 'advanced' ? '#FFD700' : '#888' }} onClick={() => setUiMode('advanced')}>Advanced</button>
      </div>

      <div className="relative z-10 flex flex-wrap gap-1 border-b border-yellow-900 px-4 py-2" style={{ background: 'rgba(0,0,0,0.45)' }}>
        {OPERATOR_TABS.map(({ id: tab, label }) => (
          <button
            key={tab}
            type="button"
            className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
            style={{
              border: operatorTab === tab ? '1px solid #FFD700' : '1px solid #333',
              color: operatorTab === tab ? '#FFD700' : '#888',
            }}
            onClick={() => setOperatorTab(tab)}
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

      {standingPermissionStrip}

      {memoryNotification && (
        <div className="fixed right-6 top-28 z-30 message-fade-in rounded px-3 py-2 text-xs font-bold tracking-widest"
          style={{ background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.35)', color: '#34D399' }}>
          {memoryNotification}
        </div>
      )}

      <div className="relative z-10 flex flex-col">
        <WriteApprovalBanner />
        {operatorNav}
        {operatorTab === 'command' && (
        <section data-testid="live-council-chat-card" className="mx-4 mt-4 overflow-hidden rounded border border-yellow-900/50" style={{ background: 'rgba(10,8,4,0.58)' }}>
        <div
          className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-yellow-900/60 px-6 py-2"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          {!councilPaused ? (
            <button type="button" onClick={() => startTransition(pauseCouncil)}
              className="text-xs px-3 py-1 rounded tracking-widest"
              style={{ border: '1px solid #333', color: '#888' }}>
              Pause Council
            </button>
          ) : (
            <button type="button" onClick={() => startTransition(resumeCouncil)}
              className="text-xs px-3 py-1 rounded tracking-widest"
              style={{ background: '#34D399', color: '#000', fontWeight: 'bold' }}>
              Resume Council
            </button>
          )}
          <button type="button" onClick={() => startTransition(endCouncilSession)}
            className="text-xs px-3 py-1 rounded tracking-widest"
            style={{ border: '1px solid #EF4444', color: '#EF4444' }}>
            End Session
          </button>
          <button type="button" onClick={() => startTransition(clearCouncilSession)}
            className="text-xs px-3 py-1 rounded tracking-widest"
            style={{ border: '1px solid #666', color: '#888' }}>
            Clear Session
          </button>
          <button type="button" onClick={() => startTransition(toggleDeepDiscussion)}
            className="text-xs px-3 py-1 rounded tracking-widest"
            style={{
              border: council.deepDiscussionMode ? '1px solid #34D399' : '1px solid #333',
              color: council.deepDiscussionMode ? '#34D399' : '#888',
            }}>
            Deep discussion: {council.deepDiscussionMode ? 'ON' : 'OFF'}
          </button>
          {(currentPacketProviderIssue || council.councilState === 'provider_error') && (
            <button type="button" onClick={() => startTransition(retryProvider)}
              className="text-xs px-3 py-1 rounded tracking-widest"
              style={{ background: '#F97316', color: '#000', fontWeight: 'bold' }}>
              Retry provider
            </button>
          )}
          {council.deepDiscussionMode && (
            <span className="text-[10px] font-bold tracking-widest px-2 py-0.5 rounded"
              style={{ border: '1px solid rgba(52,211,153,0.35)', color: '#34D399' }}>
              DEEP MODE
            </span>
          )}
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
          <div className="mt-1">
            <RuntimeContinuityIndicator
              mode={continuityMode}
              lastRecoveredAt={continuityRecoverAt}
              recoverBanner={recoverRuntimeBanner}
            />
          </div>
          <CouncilCommandBadges cmd={councilUiCommand} packet={councilPacketRender} />
          {continuationRequests.some(c => c.status === 'pending') ? (
            <div
              className="mt-2 rounded border border-amber-900/40 px-3 py-2"
              style={{ background: 'rgba(0,0,0,0.35)' }}
            >
              <p className="mb-1 text-[9px] font-bold tracking-widest" style={{ color: '#EAB308' }}>
                CONTINUATION REQUESTS (local approval only)
              </p>
              <ul className="space-y-2 text-[9px] tracking-wide" style={{ color: '#a8a29e' }}>
                {continuationRequests
                  .filter(c => c.status === 'pending')
                  .map(cr => (
                    <li key={cr.id} className="flex flex-wrap items-center gap-2">
                      <span className="max-w-[min(100%,22rem)]">
                        {(COUNCIL_ROSTER.find(r => r.id === cr.family)?.label ?? cr.family)} · {cr.kind}
                      </span>
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-[8px] font-bold tracking-widest"
                        style={{ border: '1px solid #34D399', color: '#34D399' }}
                        onClick={() => {
                          setContinuationRequests(prev =>
                            prev.map(p => (p.id === cr.id ? { ...p, status: 'approved' } : p)),
                          )
                          void postLiveCouncilMessage({
                            role: 'system',
                            content: `Ra’el approved continuation request (${cr.family} · ${cr.kind}).`,
                            family: 'SYSTEM',
                          })
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-[8px] font-bold tracking-widest"
                        style={{ border: '1px solid #888', color: '#888' }}
                        onClick={() => {
                          setContinuationRequests(prev =>
                            prev.map(p => (p.id === cr.id ? { ...p, status: 'rejected' } : p)),
                          )
                          void postLiveCouncilMessage({
                            role: 'system',
                            content: `Ra’el rejected continuation request (${cr.family} · ${cr.kind}).`,
                            family: 'SYSTEM',
                          })
                        }}
                      >
                        Reject
                      </button>
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
          <CouncilMessageRows messages={messages} />

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
              <button type="button" onClick={() => startTransition(() => void handleSummarize())}
                className="text-xs px-3 py-1 rounded tracking-widest"
                style={{ border: '1px solid #FFD700', color: '#FFD700' }}>
                Summarize
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="flex-shrink-0 border-t border-yellow-900 px-6 py-3" style={{ background: 'rgba(255,215,0,0.07)' }}>
          <p className="mb-2 text-[9px] tracking-widest" style={{ color: '#888' }}>Command console</p>
          <form
            className="flex items-start gap-3 rounded p-3"
            style={{ background: 'rgba(255,215,0,0.04)', border: '1px solid #3a2e00' }}
            onSubmit={handleDecree}
          >
            <span className="mt-1 shrink-0" style={{ color: '#FFD700' }}>⚔</span>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (!loading) void handleDecree()
                }
              }}
              rows={3}
              placeholder="Speak to War Room…"
              className="min-h-[3rem] flex-1 resize-y bg-transparent text-sm tracking-widest outline-none"
              style={{ color: '#FFD700', caretColor: '#FFD700' }}
              disabled={loading}
            />
            <button type="submit" disabled={loading}
              className="mt-0.5 shrink-0 px-4 py-1.5 text-xs tracking-widest rounded disabled:opacity-30"
              style={{ border: '1px solid #FFD700', color: '#FFD700', background: 'transparent' }}>
              {loading ? '…' : 'Send'}
            </button>
          </form>
          <p className="mt-2 text-[9px] tracking-widest" style={{ color: '#555' }}>
            Messages persist to Supabase when configured; otherwise this tab uses sessionStorage. Cloud order: ChatGPT → Claude → Grok → Gemini (Income Operations: Grok → Gemini → ChatGPT → Claude).
          </p>
        </div>
        </section>
        )}

        {uiMode === 'operator' && operatorTab === 'command' && activeFamiliesSection}
        {uiMode === 'operator' && operatorTab === 'command' && pendingNeedsRael && (
          <NeedsRaelPanel actions={raelActions} opportunities={incomeOpportunities} onRespond={respondToRaelAction} onNotify={notifyRaelAction} />
        )}
        {uiMode === 'operator' && operatorTab === 'command' && activeOrdersStrip}
        {uiMode === 'operator' && (
          <div className="hidden" style={{ background: 'rgba(0,0,0,0.35)' }}>
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

        <div className="hidden" style={{ background: 'rgba(0,0,0,0.35)' }}>
          <span className="text-[10px] tracking-widest" style={{ color: '#888' }}>UI mode</span>
          <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: uiMode === 'operator' ? '1px solid #FFD700' : '1px solid #444', color: uiMode === 'operator' ? '#FFD700' : '#888' }} onClick={() => setUiMode('operator')}>Operator</button>
          <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: uiMode === 'advanced' ? '1px solid #FFD700' : '1px solid #444', color: uiMode === 'advanced' ? '#FFD700' : '#888' }} onClick={() => setUiMode('advanced')}>Advanced</button>
        </div>

        <div className="hidden" style={{ background: 'rgba(0,0,0,0.45)' }}>
          {OPERATOR_TABS.map(({ id: tab, label }) => (
            <button
              key={tab}
              type="button"
              className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
              style={{
                border: operatorTab === tab ? '1px solid #FFD700' : '1px solid #333',
                color: operatorTab === tab ? '#FFD700' : '#888',
              }}
              onClick={() => setOperatorTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

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
            {operatorTab === 'agents' && (
              <>
                <div className="mb-3 border-b border-yellow-900/40 pb-2">
                  <h2 className="text-xs font-bold tracking-widest" style={{ color: '#FBBF24' }}>AGENTS / BRIDGE</h2>
                  <p className="mt-1 text-[9px] tracking-widest" style={{ color: '#666' }}>Local engines and bridge agents refresh only when requested.</p>
                </div>
                <BridgeArchitectPanel engines={engineList} />
                <LocalCodeAgentBridgePanel bridge={localAgentBridge} onRefresh={() => void loadLocalAgentBridge()} />
                <LocalFamilyAgentsPanel families={localFamilyAgents} onRefresh={() => void loadLocalFamilyAgents()} />
                <CapabilityRouterPanel />
                <CodexAgentPlaceholder />
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
                <div className="mb-3">
                  <RuntimeContinuityIndicator
                    mode={continuityMode}
                    lastRecoveredAt={continuityRecoverAt}
                    recoverBanner={recoverRuntimeBanner}
                  />
                </div>
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
                  <div className="mb-3 rounded border border-white/10 px-3 py-2 text-[10px]" style={{ color: '#a8a29e' }}>
                    <div className="font-bold tracking-widest text-white/70">LAST ATTENDANCE SUMMARY (HISTORICAL)</div>
                    <div className="mt-1 text-white/55">
                      Captured {new Date(recoveredAttendanceSummary.capturedAt).toLocaleString()}
                    </div>
                    <pre className="mt-1 max-h-28 overflow-auto text-[9px] text-white/60">
                      {JSON.stringify(recoveredAttendanceSummary.providerRuntimeStates, null, 2)}
                    </pre>
                  </div>
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
                  <details className="mb-3 rounded border border-white/10 px-3 py-2 text-[10px]" style={{ color: '#a8a29e' }}>
                    <summary className="cursor-pointer font-bold tracking-widest text-white/70">
                      Historical runtime integrity snapshot (from storage)
                    </summary>
                    <div className="mt-1 text-white/50">
                      Generated {new Date(recoveredIntegrityPartial.generatedAt).toLocaleString()} — superseded after live
                      integrity refresh.
                    </div>
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
                <ProviderSetupChecklistPanel />
                <KernelStatusPanel />
                <UnifiedEngineControlPanel />
                <CommandRouterPanel />
                <InternetAccessPanel internet={internetStatus} onRefresh={() => void loadInternetStatus()} />
                <RepoAwarenessPanel repo={repoAwareness} onScan={scanRepo} />
                <LocalCodeAgentBridgePanel bridge={localAgentBridge} onRefresh={() => void loadLocalAgentBridge()} />
                <RepoAccessPanel repo={repoStatus} onRefresh={() => void loadRepoStatus()} />
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
                <BridgeArchitectPanel engines={engineList} />
                <LocalFamilyAgentsPanel families={localFamilyAgents} onRefresh={() => void loadLocalFamilyAgents()} />
                <CapabilityRouterPanel />
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
