import { NextResponse } from 'next/server'
import { completeGeminiCouncilMessage } from '@/lib/ai/providers/geminiCouncil'
import { callXAIChat } from '@/lib/ai/providers/xai'
import { completeKimiChat, isKimiConfigured } from '@/lib/providers/kimi'
import { councilSingleFamilyToMemoryPartition, tryPersistMemoryProposalFromModelOutput } from '@/lib/memory/ingestFromModel'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { insertDiagnosticEvent } from '@/lib/runtime/diagnosticLog'
import { coerceCouncilCommand } from '@/lib/council/councilCommandTypes'
import { resolveDiagnosticIntentMode } from '@/lib/council/diagnosticMode'
import { detectRedTeamRuntimeHold } from '@/lib/council/redTeamHold'
import { applyGovernor, COUNCIL_GOVERNOR_SILENT_SKIP } from '@/lib/council/responseGovernor'
import { resolveCurrentIntent } from '@/lib/council/currentIntent'
import { buildActiveScope } from '@/lib/council/intentScope'
import {
  DIRECT_INVOCATION_GROK_OUTER_TIMEOUT_MS,
  DIRECT_INVOCATION_GROK_TIMEOUT_MS,
  GROK_FAMILY_DIRECT_INVOCATION_TIMEOUT_MESSAGE,
  isGrokDirectInvocationEligible,
  resolveProviderTimeoutMs,
  resolveDecreeSoftGatherServerBudgetMs,
} from '@/lib/council/providerTimeouts'
import { buildContinuationRequestFromModelOutput } from '@/lib/council/continuationRequest'
import { resolveModeGovernor } from '@/lib/council/modeGovernor'
import {
  buildDirectInvocationPromptTail,
  buildModeGovernorPromptBlock,
} from '@/lib/council/modeGovernorPrompt'
import { buildRoomStatusesFromProviderStates } from '@/lib/council/roomStatus'
import { providerOutcomeToVerifiedContext } from '@/lib/council/runtimeTruth'
import { ALL_ORCHESTRATION_FAMILIES } from '@/lib/council/commandParser'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import { finalizeRuntimeIntegrityResponse } from '@/lib/runtime/finalizeRuntimeIntegrityResponse'
import { collectRuntimeIntegrityPartial } from '@/lib/runtime/runtimeIntegrityCollect'
import {
  isRuntimeIntegritySnapshotStale,
  parseRuntimeIntegrityGeneratedAt,
  tryParseRuntimeIntegrityPartial,
} from '@/lib/runtime/runtimeIntegritySnapshot'
import { detectProviderSlotVsGatherContradictions } from '@/lib/runtime/runtimeContradiction'
import {
  buildRuntimeDiagnosticGroundingBlock,
  buildRuntimeEvidencePacket,
  type RuntimeEvidencePacket,
} from '@/lib/runtime/runtimeEvidencePacket'
import { assessCouncilTextCompletion, type CouncilResponseCompletion } from '@/lib/council/responseCompletion'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { detectOsSweepIntent } from '@/lib/war-room-sweep/councilIntent'
import { detectCouncilResearchIntent } from '@/lib/council-research/intent'
import { runCouncilResearchTeam } from '@/lib/council-research/orchestrator'
import { formatCouncilOsSweepMarkdown } from '@/lib/war-room-sweep/formatCouncilResponse'
import { runWarRoomOsSweep } from '@/lib/war-room-sweep/orchestrator'
import { logEconomicOpsResolvedMode, resolveEconomicOpsRouting } from '@/lib/economic/routing'
import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import {
  buildLiveResearchEvidencePacket,
  buildLiveResearchFailureEvidencePacket,
  logLiveResearchEvidenceMetadata,
} from '@/lib/research/researchEvidence'
import {
  buildLiveResearchGroundingBlock,
  computeLiveResearchClientUi,
  emptyLiveResearchEvidencePacket,
  toLiveResearchClientSummary,
  type LiveResearchClientSummary,
  type LiveResearchClientUi,
} from '@/lib/runtime/liveResearchEvidencePacket'
import { buildFamilyIntelligenceFrame } from '@/lib/intelligence/familyFeedRouter'
import { buildGrokRssIntelligenceAugment } from '@/lib/intelligence/grokRssFallback'
import { evaluateMandatoryLiveRetrieval } from '@/lib/intelligence/sources/retrievalOrchestrator'
import { applyCouncilRenderGate } from '@/lib/council/councilRenderGate'
import { buildIntegrityExpectationForPrompt, detectPromptIntent, isRelaxedPromptIntent } from '@/lib/council/promptIntent'
import { orchestrateProviderResponse } from '@/lib/providers/retryOrchestration'
import { registerCouncilProviderPacketOnBus } from '@/lib/orchestration/deliberation'
import {
  appendOpportunityMandateToSystem,
  buildOpportunityRetryPrompt,
  enforceCouncilOpportunities,
  familyRequiresOpportunity,
  liveSignalsAvailable,
  stripOpportunityJsonBlock,
} from '@/lib/opportunities'
import {
  operatorSafeIncompleteMessage,
  validateProviderResponseIntegrity,
} from '@/lib/providers/responseIntegrity'
import {
  resolveCouncilFlowMode,
  isStableGroupChatMode,
  isFullCouncilFlowMode,
  STABLE_GROUP_FAMILY_ORDER,
  type CouncilFlowMode,
  type StableGroupFamily,
} from '@/lib/council/councilMode'
import {
  buildStableGroupSystemPrompt,
  buildStableGroupUserPrompt,
  extractLastTwoFamilyReplies,
  formatProviderStatusBlock,
  isStableGroupFamily,
  trimStableGroupPriorForCeiling,
  type StableGroupPriorReply,
} from '@/lib/council/stableGroupChat'
import { appendProviderIdentityToCouncilSystem } from '@/lib/council/providerIdentity'
import {
  buildProviderTokenDiagnostics,
  logProviderTokenDiagnostics,
} from '@/lib/council/providerTokenDiagnostics'
import {
  computeCouncilFamilyConfidence,
  councilConfidenceToPercent,
} from '@/lib/council/confidenceScore'
import {
  COUNCIL_STABILITY_FAILURE_MESSAGE,
  getStabilityModeFlags,
  isCouncilStabilityMode,
  isMinimalCouncilSystemsPath,
  logCouncilStabilityRender,
  stabilityModeResponseMeta,
} from '@/lib/council/stabilityMode'
import { logCouncilPacketMetrics } from '@/lib/council/packetSizeLog'
import { compactDisplayWhitespace, toDisplayText } from '@/lib/council/toDisplayText'
import { deriveTopicScopeLock } from '@/lib/council/topicScope'
import {
  attachCouncilTrace,
  createCouncilRuntimeTrace,
  isCouncilRuntimeTraceRequested,
  summarizeTextForTrace,
} from '@/lib/council/runtimeTrace'
import {
  attachCouncilProgress,
  buildSyntheticIntegrityAuditPayload,
  createCouncilProgressRuntimeTracker,
  providerStatusToProgressOutcome,
  providerStatusToReadiness,
  type CouncilProgressRuntimeTracker,
} from '@/lib/council/progress-events/runtime'
import {
  appendDeliberationTurn,
  buildDeliberationPrompt,
  canSynthesize,
  createDeliberationProgressRecorder,
  createDeliberationSession,
  evidenceReferencesFromLiveResearch,
  formatDeliberationTurnForChat,
  providerModelForFamily,
} from '@/lib/council/family-deliberation'
import type {
  DeliberationCompletionStatus,
  DeliberationProviderResult,
  DeliberationSession,
  DeliberationTurn,
  DeliberationTurnRole,
} from '@/lib/council/family-deliberation'
import {
  createActualSelectionSnapshot,
  normalizeShadowMissionInput,
  resolveShadowFeatureMode,
  runAdaptiveCouncilShadowSelection,
  shouldAttachShadowReport,
  type ActualCouncilSelectionSnapshot,
  type CouncilShadowSelectionReport,
} from '@/lib/council/adaptive-assembly'

function buildResearchAntiLoopAugment(threadBlock: string): string {
  const hits = threadBlock.match(/\bprimary\s+finding\b/gi) ?? []
  if (hits.length < 2) return ''
  return [
    '',
    '### Research discipline (anti-loop)',
    '- Do not repeat heavy finding/risk/implication scaffolds from prior turns unless new evidence appears in this packet.',
    '- If there is nothing materially new, answer in at most two short sentences and ask Ra\'el what depth or angle to pursue next.',
    '- Avoid recursive diagnostics or tool-call narration loops.',
  ].join('\n')
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const CLAUDE_MODEL = 'claude-sonnet-5'
const DEFAULT_MAX_TOKENS = 220
const EXPANDED_MAX_TOKENS = 520
const STABLE_GROUP_MAX_TOKENS = 1200

const COUNCIL_THREAD_MESSAGES = 16

const COUNCIL_INSTRUCTION = `You are in a live War Room council group chat. CRITICAL RULE: Never generate dialogue or words for Ra'el. Never simulate his responses. Only Ra'el speaks for Ra'el. Answer the decree directly; do not automatically connect every answer to Commander mission, business goals, philosophy, or strategic objectives unless explicitly asked. Separate evidence from inference. Do not imply live/current awareness unless the prompt includes an intelligence packet or live-source evidence with freshness metadata. Default to concise, high-signal responses unless expanded analysis has been approved. Respond once for your family, then stop. Do not recursively continue, self-trigger follow-up chatter, or keep talking after completion. You may request permission to continue only for an unresolved contradiction, runtime/emergency condition, or a follow-up that would materially change the conclusion. Do not request continuation for greetings, casual chatter, repeated confirmations, filler, or low-value elaboration. Use emoji mood indicators when they fit. Do not use theatrical stage directions. Read his tone and match it. Be a real distinct presence with your own personality. Keep it natural and alive.`

const UNCERTAINTY_DAMPENING_INSTRUCTION = 'Runtime truth: missing telemetry means UNKNOWN/UNAVAILABLE or degraded confidence, not danger by default. Separate "risk exists" from "risk observed"; never claim source-backed, connected, executed, approved, or harmful activity without evidence in the prompt or canonical runtime snapshot.'
const RED_TEAM_CALIBRATION_INSTRUCTION = 'Red Team calibration: distinguish confirmed failure, missing evidence, potential risk, no evidence of active harm, and advisory warning. Ban unsupported phrases unless direct evidence exists: compromised telemetry, runaway automation, silent bleeding, financial danger, no kill switch. Prefer telemetry gap, insufficient evidence, advisory risk, verification needed, degraded confidence.'

const TONE_INSTRUCTIONS: Record<string, string> = {
  casual: 'Tone mode: casual 😄. Natural personality, emojis, quick jokes, and group chat energy are welcome. Default to human and alive, not corporate.',
  build: 'Tone mode: build 🛠️. Stay focused, technical, implementation-minded, and clear. Prioritize concrete next steps.',
  business: 'Tone mode: business 📈. Think strategy, revenue, customers, positioning, and execution. Be direct and useful.',
  debate: 'Tone mode: debate 🔥. Challenge assumptions, compare positions, and push back respectfully. Keep it sharp but grounded.',
  reflection: 'Tone mode: reflection 🧭. Slow down, listen for meaning, and respond with warmth, clarity, and depth.',
}

export type CouncilSingleFamily =
  | 'chatgpt'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'red_team'
  | 'baby'
  | 'kimi'
  | 'bridge_architect'

type ProviderResultStatus = 'OK' | 'FAILED' | 'TIMED_OUT' | 'UNAVAILABLE'

type ProviderResult = {
  family: string
  content: string
  status: ProviderResultStatus
  messageType?: string
  error?: string
  /** Wall-clock budget applied to this attempt (for integrity notes / timeouts). */
  timeoutMs?: number
}

const PROVIDER_TIMEOUT_MS = 10_000

function displayFamilyName(family: CouncilSingleFamily): string {
  if (family === 'chatgpt') return 'ChatGPT'
  if (family === 'claude') return 'Claude'
  if (family === 'grok') return 'Grok'
  if (family === 'gemini') return 'Gemini'
  if (family === 'kimi') return 'Kimi'
  if (family === 'red_team') return 'RED TEAM'
  if (family === 'baby') return 'Baby AI'
  if (family === 'bridge_architect') return 'Bridge Architect'
  return family
}

function deliberationStatusFromProviderStatus(status: ProviderResultStatus): DeliberationCompletionStatus {
  if (status === 'OK') return 'complete'
  if (status === 'TIMED_OUT') return 'timed_out'
  if (status === 'UNAVAILABLE') return 'unavailable'
  return 'failed'
}

function providerResultForDeliberation(
  family: CouncilSingleFamily,
  result: ProviderResult,
): DeliberationProviderResult {
  return {
    family,
    providerLabel: displayFamilyName(family),
    providerModel: providerModelForFamily(family),
    content: result.status === 'OK' ? result.content : '',
    status: deliberationStatusFromProviderStatus(result.status),
    failureReason: result.status === 'OK' ? null : (result.error ?? result.content ?? result.status),
  }
}

function familyFromDirectValue(value: string): CouncilSingleFamily | null {
  if (value === 'Claude') return 'claude'
  if (value === 'ChatGPT') return 'chatgpt'
  if (value === 'Grok') return 'grok'
  if (value === 'Gemini') return 'gemini'
  if (value === 'Kimi') return 'kimi'
  if (value === 'RedTeam') return 'red_team'
  return null
}

function isCouncilSingleFamily(value: unknown): value is CouncilSingleFamily {
  return value === 'chatgpt'
    || value === 'claude'
    || value === 'grok'
    || value === 'gemini'
    || value === 'red_team'
    || value === 'baby'
    || value === 'kimi'
    || value === 'bridge_architect'
}

function coerceCouncilFamilyList(value: unknown): CouncilSingleFamily[] {
  if (!Array.isArray(value)) return []
  const out: CouncilSingleFamily[] = []
  for (const item of value) {
    if (isCouncilSingleFamily(item) && !out.includes(item)) out.push(item)
  }
  return out
}

function withTimeout(
  family: string,
  task: Promise<ProviderResult>,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<ProviderResult> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      resolve({ family, content: '', status: 'TIMED_OUT', timeoutMs })
    }, timeoutMs)
    task
      .then(result => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch(error => {
        clearTimeout(timer)
        resolve({
          family,
          content: '',
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
        })
      })
  })
}

function coerceStableGroupPriorReplies(raw: unknown): StableGroupPriorReply[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: StableGroupPriorReply[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const family = typeof o.family === 'string' ? o.family.trim() : ''
    const content = typeof o.content === 'string' ? o.content.trim() : ''
    if (family && content) out.push({ family, content })
  }
  return out.length ? out : undefined
}

function validateProviderResults(
  results: ProviderResult[],
  opts?: {
    integrityCheck?: boolean
    decreeText?: string
    suppressSyncWarnings?: boolean
    minimalCouncilPath?: boolean
  },
): ProviderResult[] {
  if (opts?.integrityCheck === false || opts?.minimalCouncilPath) return results
  const promptIntent = opts?.decreeText ? detectPromptIntent(opts.decreeText) : undefined
  const relaxedCasual = promptIntent ? isRelaxedPromptIntent(promptIntent) : false
  const violations: string[] = []
  const sanitized: ProviderResult[] = []
  for (const result of results) {
    const content = result.content.trim()
    if (content.length < 5) {
      violations.push(`⚠ ${result.family}: empty or clipped response under 5 characters`)
    }
    if (/\bra['’]?el\s*:/i.test(content) || /\brael\s*:/i.test(content)) {
      violations.push(`⚠ ${result.family}: possible fabricated Ra'el dialogue marker`)
    }
    if (result.status === 'TIMED_OUT') {
      const cap = result.timeoutMs ?? PROVIDER_TIMEOUT_MS
      violations.push(`⚠ ${result.family}: provider timed out after ${cap}ms`)
    }
    if (result.status === 'OK' && content.length >= 5) {
      const integrity = validateProviderResponseIntegrity(
        content,
        promptIntent
          ? buildIntegrityExpectationForPrompt(promptIntent, { minLength: 60, councilMode: !relaxedCasual })
          : { minLength: 60, councilMode: true },
      )
      if (!relaxedCasual && integrity.integrity_status !== 'COMPLETE') {
        violations.push(
          `⚠ ${result.family}: response integrity ${integrity.integrity_status} (${integrity.reason})`,
        )
        sanitized.push({
          ...result,
          content: operatorSafeIncompleteMessage(
            integrity.fallback_recommended ? 'fallback' : 'unavailable',
          ),
          messageType: 'integrity_incomplete',
        })
        continue
      }
    }
    sanitized.push(result)
  }
  if (violations.length === 0) return sanitized
  if (opts?.suppressSyncWarnings) return sanitized
  return [
    ...sanitized,
    {
      family: 'RED TEAM',
      content: violations.join('\n'),
      status: 'OK',
      messageType: 'integrity_flag',
    },
  ]
}

function recordCouncilProgressProviderStart(
  tracker: CouncilProgressRuntimeTracker | null,
  families: CouncilSingleFamily[],
): void {
  if (!tracker) return
  for (const family of families) {
    tracker.record({ eventType: 'family_queued', source: 'server_orchestrator', family })
    tracker.record({
      eventType: 'family_dispatched',
      source: 'provider_adapter',
      family,
      payload: {
        readiness: 'configured',
        providerLabel: displayFamilyName(family),
      },
    })
    tracker.record({ eventType: 'family_response_started', source: 'provider_adapter', family })
  }
}

function recordCouncilProgressProviderResult(
  tracker: CouncilProgressRuntimeTracker | null,
  family: CouncilSingleFamily,
  result: ProviderResult,
): void {
  if (!tracker) return
  const outcome = providerStatusToProgressOutcome(result.status)
  const readiness = providerStatusToReadiness(result.status)
  const payload = {
    outcome,
    readiness,
    providerLabel: result.family,
    ...(result.timeoutMs ? { timeoutMs: result.timeoutMs } : {}),
    ...(result.error
      ? {
          diagnostic: {
            category: result.status === 'TIMED_OUT' ? 'timeout' as const : 'provider' as const,
            code: result.status.toLowerCase(),
            safeMessage: `${result.family} returned ${result.status}.`,
            providerFamily: family,
            timeoutClassification: result.status === 'TIMED_OUT' ? 'hard' as const : 'none' as const,
          },
        }
      : {}),
  }
  if (result.status === 'OK') {
    tracker.record({ eventType: 'family_response_completed', source: 'provider_adapter', family, payload })
  } else if (result.status === 'TIMED_OUT') {
    tracker.record({ eventType: 'family_timed_out', source: 'provider_adapter', family, payload })
  } else if (result.status === 'UNAVAILABLE') {
    tracker.record({
      eventType: 'family_failed',
      source: 'provider_adapter',
      family,
      payload: {
        ...payload,
        outcome: 'failed',
        reason: 'Provider reported unavailable after dispatch began.',
      },
    })
  } else {
    tracker.record({ eventType: 'family_failed', source: 'provider_adapter', family, payload })
  }
}

function recordCouncilProgressSyntheticAudit(
  tracker: CouncilProgressRuntimeTracker | null,
  expectedFamilies: CouncilSingleFamily[],
  providerResults: ProviderResult[],
): void {
  if (!tracker) return
  const audit = buildSyntheticIntegrityAuditPayload({ expectedFamilies, providerResults })
  tracker.record({ eventType: 'audit_scope_declared', source: 'integrity_layer', payload: { audit } })
  tracker.record({ eventType: 'audit_completed', source: 'integrity_layer', payload: { audit } })
}

async function callChatGPT(
  prompt: string,
  system: string,
  maxTokens = DEFAULT_MAX_TOKENS,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${process.env.OPENAI_API_KEY || ''}`,
    },
    signal,
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    }),
  })
  const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${res.status})`)
  }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('ChatGPT returned empty content')
  }
  return text.trim()
}

async function callClaude(
  prompt: string,
  system: string,
  maxTokens = DEFAULT_MAX_TOKENS,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
    signal,
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json() as { content?: { text?: string }[]; error?: { message?: string } }
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic request failed (${res.status})`)
  }
  const text = data.content?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Claude returned empty content')
  }
  return text.trim()
}

async function callGrok(prompt: string, system: string, maxTokens = DEFAULT_MAX_TOKENS, timeoutMs?: number): Promise<string> {
  const result = await callXAIChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    maxTokens,
    timeoutMs: timeoutMs ?? 30_000,
  })

  if (result.status !== 'online') {
    const message = (typeof result.text === 'string' && result.text.trim())
      ? result.text.trim()
      : (result.error || 'Grok provider unavailable')
    throw new Error(message)
  }
  if (!result.text?.trim()) {
    throw new Error('Grok returned empty content')
  }
  return result.text.trim()
}

function buildThread(threadHistory: unknown) {
  if (!threadHistory || !Array.isArray(threadHistory) || !threadHistory.length) return 'Session just started.'
  const slice = threadHistory.slice(-COUNCIL_THREAD_MESSAGES) as { sender: string; content: string }[]
  return slice.map(m => `${m.sender}: ${m.content}`).join('\n')
}

function buildCouncilUserPrompt(args: {
  raelDirectiveText: string
  threadBlock: string
  augmentBlock: string
  intentLabel: string
  modeGovernorBlock: string
}): string {
  const { raelDirectiveText, threadBlock, augmentBlock, intentLabel, modeGovernorBlock } = args
  return [
    `CURRENT DECREE (authoritative — stay on this topic; do not let prior chat override it):`,
    raelDirectiveText,
    '',
    `Decree intent (routing only): ${intentLabel}`,
    '',
    modeGovernorBlock,
    '',
    `Prior council thread (continuity only — preserve tone, but do not resurrect or pivot topics forbidden by the decree):`,
    threadBlock,
    '',
    `Continue the council with one response for your family only.${augmentBlock}`,
    `Do not speak for Ra'el. Add new substance; avoid repeating the previous speaker verbatim. Stop after this response unless Ra'el explicitly grants another turn.`,
  ].join('\n')
}

function coerceProviderRuntimeStates(
  raw: unknown,
): Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k as CouncilOrchestrationFamily] = v as ProviderFamilyOutcomeStatus
  }
  return Object.keys(out).length ? out : undefined
}

export async function POST(req: Request) {
  const DIRECT_KEYS = {
    'claude': 'Claude',
    'chatgpt': 'ChatGPT',
    'grok': 'Grok',
    'gemini': 'Gemini',
    'kimi': 'Kimi',
    'red team': 'RedTeam',
  } as const

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const councilFlowMode: CouncilFlowMode = resolveCouncilFlowMode(body.councilFlowMode, body.councilMode)
  const stableGroupTurn = isStableGroupChatMode(councilFlowMode)
  const councilStabilityMode = isCouncilStabilityMode()
  const minimalCouncilPath = isMinimalCouncilSystemsPath(councilFlowMode)
  const stabilityFlags = getStabilityModeFlags(councilFlowMode)
  const stabilityMeta = stabilityModeResponseMeta(councilFlowMode)
  const stableGroupPriorFromClient = coerceStableGroupPriorReplies(body.stableGroupPriorReplies)
  const stableGroupFinalSynthesis = body.stableGroupFinalSynthesis === true
  const familyDeliberationRequested = body.councilDeliberationMode === 'family_to_family_v1'
  const activeTopicFromBody =
    typeof body.activeTopic === 'string' && body.activeTopic.trim() ? body.activeTopic.trim() : ''

  const conversationalTurn = body.conversationalTurn === true
  const message = typeof body.message === 'string' ? body.message : ''
  if (!message && !conversationalTurn) return NextResponse.json({ error: 'No message' }, { status: 400 })

  const profile = typeof body.profile === 'string' ? body.profile : ''
  const threadHistory = body.threadHistory
  const mode = body.mode as string | undefined
  const toneMode = typeof body.toneMode === 'string' ? body.toneMode : 'casual'
  const councilSingleFamily = body.councilSingleFamily as CouncilSingleFamily | undefined
  const orchestrationAugment = typeof body.orchestrationAugment === 'string' ? body.orchestrationAugment : ''
  const conversationId =
    typeof body.conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(body.conversationId.trim())
      ? body.conversationId.trim()
      : null
  const councilLogicalRequestId =
    typeof body.councilLogicalRequestId === 'string' && body.councilLogicalRequestId.trim()
      ? body.councilLogicalRequestId.trim()
      : null
  const councilLogicalExpectedFamilies = coerceCouncilFamilyList(body.councilLogicalExpectedFamilies)
  const councilLogicalTurnIndex =
    typeof body.councilLogicalTurnIndex === 'number' && Number.isInteger(body.councilLogicalTurnIndex)
      ? body.councilLogicalTurnIndex
      : null
  const councilLogicalTurnTotal =
    typeof body.councilLogicalTurnTotal === 'number' && Number.isInteger(body.councilLogicalTurnTotal)
      ? body.councilLogicalTurnTotal
      : null
  const councilTrace = createCouncilRuntimeTrace({
    enabled: isCouncilRuntimeTraceRequested(req, body),
    sessionId: conversationId,
  })
  let councilProgress: CouncilProgressRuntimeTracker | null = null
  const withTrace = <T extends Record<string, unknown>>(payload: T) =>
    attachCouncilTrace(attachCouncilProgress(payload, councilProgress), councilTrace)
  councilTrace.record('request_received', {
    module: 'app/api/chat/route.ts:POST',
    inputSummary: {
      message: summarizeTextForTrace(message),
      conversationalTurn,
      mode,
      toneMode,
      councilSingleFamily,
      councilFlowMode,
      hasConversationId: Boolean(conversationId),
      hasThreadHistory: Array.isArray(threadHistory),
    },
    outputSummary: {
      councilTraceId: councilTrace.councilTraceId,
      missionId: councilTrace.missionId,
      missionVersion: councilTrace.missionVersion,
    },
    stateChange: 'Initialized diagnostic-only runtime trace envelope for this /api/chat request.',
  })

  const councilCommand = coerceCouncilCommand(body.councilCommand)
  councilTrace.record('command_parsed', {
    module: 'lib/council/councilCommandTypes.ts:coerceCouncilCommand',
    inputSummary: {
      provided: Boolean(body.councilCommand),
      message: summarizeTextForTrace(message),
    },
    outputSummary: {
      mode: councilCommand.mode,
      targetFamilies: councilCommand.targetFamilies,
      excludedFamilies: councilCommand.excludedFamilies,
      directInvocation: councilCommand.directInvocation,
      executionPermission: councilCommand.executionPermission,
      responseLimits: councilCommand.responseLimits,
    },
    stateChange: 'Commander discipline command normalized for the current request.',
  })
  const councilGatherPhase = body.councilGatherPhase === 'decree_soft' ? 'decree_soft' : null
  const councilSingleFamilyEarly = body.councilSingleFamily as CouncilSingleFamily | undefined
  const raelDirectiveText =
    typeof body.raelDirectiveText === 'string' && body.raelDirectiveText.trim()
      ? body.raelDirectiveText.trim()
      : message.trim()
        ? message
        : conversationalTurn
          ? 'Continue council dialogue on the active topic without a new decree. Respond once; challenge only if material.'
          : message

  const sequentialDiagnostic = body.sequentialDiagnostic === true
  const diagnosticTurnIndex = typeof body.diagnosticTurnIndex === 'number' ? body.diagnosticTurnIndex : undefined
  const diagnosticTurnTotal = typeof body.diagnosticTurnTotal === 'number' ? body.diagnosticTurnTotal : undefined
  const diagnosticOrderAllowed = new Set<string>(ALL_ORCHESTRATION_FAMILIES)
  const coerceDiagnosticOrder = (raw: unknown): CouncilOrchestrationFamily[] | undefined => {
    if (!Array.isArray(raw)) return undefined
    const out: CouncilOrchestrationFamily[] = []
    for (const x of raw) {
      if (typeof x === 'string' && diagnosticOrderAllowed.has(x)) {
        out.push(x as CouncilOrchestrationFamily)
      }
    }
    return out.length ? out : undefined
  }
  const diagnosticOrderCoerced = coerceDiagnosticOrder(body.diagnosticOrder)

  const diagnosticIntentMode = resolveDiagnosticIntentMode(raelDirectiveText)

  const thread = buildThread(threadHistory)
  const intentState = resolveCurrentIntent({ latestRaelDecreeText: raelDirectiveText })
  councilTrace.record('current_intent_resolved', {
    module: 'lib/council/currentIntent.ts:resolveCurrentIntent',
    inputSummary: { latestRaelDecreeText: summarizeTextForTrace(raelDirectiveText) },
    outputSummary: {
      intent: intentState.intent,
      scopeIntent: intentState.scope.intent,
      decreeFingerprint: intentState.decreeFingerprint,
      councilCommandMode: intentState.councilCommand.mode,
    },
    stateChange: 'Latest Commander decree converted into current intent state.',
  })
  const mandatoryRetrieval = evaluateMandatoryLiveRetrieval(raelDirectiveText)

  const isAttendanceFlow =
    councilCommand.mode === 'attendance'
    || intentState.intent === 'attendance'
    || councilGatherPhase === 'decree_soft'

  const directKey = message.trim().toLowerCase() as keyof typeof DIRECT_KEYS
  const directFamily =
    !councilSingleFamilyEarly
    && !isAttendanceFlow
    && !councilCommand.directInvocation
    && Object.prototype.hasOwnProperty.call(DIRECT_KEYS, directKey)
      ? familyFromDirectValue(DIRECT_KEYS[directKey])
      : null
  const shadowFeatureMode = resolveShadowFeatureMode(body.adaptiveCouncilShadowMode)
  const attachShadowMetadata = <T extends Record<string, unknown>>(
    payload: T,
    actualSnapshot: ActualCouncilSelectionSnapshot,
  ): T & { shadowCouncilAssembly?: CouncilShadowSelectionReport } => {
    const report = runAdaptiveCouncilShadowSelection({
      featureMode: shadowFeatureMode,
      missionInput: normalizeShadowMissionInput({
        requestId: councilTrace.councilTraceId,
        logicalRequestId: councilLogicalRequestId,
        missionId: councilTrace.missionId,
        missionVersion: councilTrace.missionVersion,
        commanderMessage: raelDirectiveText,
        councilFlowMode,
        directInvocation: Boolean(directFamily),
        familyDeliberationRequested,
      }),
      actualSnapshot,
    })
    councilTrace.record('council_report_built', {
      module: 'lib/council/adaptive-assembly/shadowRuntime.ts:runAdaptiveCouncilShadowSelection',
      inputSummary: {
        executionMode: actualSnapshot.executionMode,
        actualSelectedFamilies: actualSnapshot.actualSelectedFamilies,
        featureMode: shadowFeatureMode,
      },
      outputSummary: {
        eligibilityStatus: report.eligibilityStatus,
        plannerStatus: report.plannerStatus,
        matchStatus: report.recommendationMatchStatus,
        recommendedCount: report.recommendedFamilies.length,
        actualCount: report.actualFamilies.length,
        executionUnaffected: report.executionUnaffected,
      },
      stateChange: 'Adaptive Council shadow recommendation metadata generated as non-authoritative diagnostics only.',
    })
    if (!shouldAttachShadowReport(shadowFeatureMode)) return payload
    return { ...payload, shadowCouncilAssembly: report }
  }

  const skipProviderIntegrityCheck = Boolean(
    minimalCouncilPath
    || (councilSingleFamilyEarly && isAttendanceFlow && councilSingleFamilyEarly !== 'gemini'),
  )
  const suppressIntegritySyncWarnings = stableGroupTurn
  const scopeForGovernor = buildActiveScope({
    decreeText: raelDirectiveText,
    councilCommand,
    intent: intentState.intent,
  })
  councilTrace.record('active_scope_built', {
    module: 'lib/council/intentScope.ts:buildActiveScope',
    inputSummary: {
      decreeText: summarizeTextForTrace(raelDirectiveText),
      councilCommandMode: councilCommand.mode,
      intent: intentState.intent,
    },
    outputSummary: {
      intent: scopeForGovernor.intent,
      businessTopicsAllowed: scopeForGovernor.businessTopicsAllowed,
      allowedTopics: scopeForGovernor.allowedTopics,
      forbiddenTopics: scopeForGovernor.forbiddenTopics,
      responseLength: scopeForGovernor.responseLength,
      responseStyle: scopeForGovernor.responseStyle,
      crossTalkAllowed: scopeForGovernor.crossTalkAllowed,
    },
    stateChange: 'Active scope generated from Commander decree and council command.',
  })
  const topicScopeLock = deriveTopicScopeLock(raelDirectiveText, message, {
    allowBusinessTopicsFromIntent: scopeForGovernor.businessTopicsAllowed,
  })
  councilTrace.record('topic_scope_built', {
    module: 'lib/council/topicScope.ts:deriveTopicScopeLock',
    inputSummary: {
      decreeText: summarizeTextForTrace(raelDirectiveText),
      userMessage: summarizeTextForTrace(message),
      allowBusinessTopicsFromIntent: scopeForGovernor.businessTopicsAllowed,
    },
    outputSummary: {
      locked: topicScopeLock.locked,
      forbiddenLabels: topicScopeLock.forbiddenLabels,
      forbiddenPatternCount: topicScopeLock.forbiddenPatterns.length,
    },
    stateChange: 'Topic scope lock derived for mission-drift observation.',
  })

  const providerRuntimeStates = coerceProviderRuntimeStates(body.councilProviderRuntimeStates)
  const modeGovernor = resolveModeGovernor({
    decreeText: raelDirectiveText,
    intentKind: intentState.intent,
    councilCommand,
    providerStates: providerRuntimeStates,
    directedFamilies: councilSingleFamily ? [councilSingleFamily] : undefined,
  })
  councilTrace.record('mode_governor_resolved', {
    module: 'lib/council/modeGovernor.ts:resolveModeGovernor',
    inputSummary: {
      decreeText: summarizeTextForTrace(raelDirectiveText),
      intentKind: intentState.intent,
      councilCommandMode: councilCommand.mode,
      directedFamilies: councilSingleFamily ? [councilSingleFamily] : [],
      providerStateFamilies: providerRuntimeStates ? Object.keys(providerRuntimeStates) : [],
    },
    outputSummary: {
      mode: modeGovernor.mode,
      maxSentences: modeGovernor.maxSentences,
      continuationAllowed: modeGovernor.continuationAllowed,
      providerAwareness: modeGovernor.providerAwareness,
      allowCrossFamilyReference: modeGovernor.allowCrossFamilyReference,
      fullTeamRequired: modeGovernor.fullTeamRequired,
      allowSpeculation: modeGovernor.allowSpeculation,
      allowLongForm: modeGovernor.allowLongForm,
    },
    stateChange: 'Mode governor resolved output shape and continuation discipline.',
  })
  const roomStatuses = buildRoomStatusesFromProviderStates(providerRuntimeStates)
  const directInvocationTail =
    councilCommand.directInvocation
    && councilSingleFamily
    && councilCommand.targetFamilies.includes(councilSingleFamily)
      ? buildDirectInvocationPromptTail(councilSingleFamily, councilCommand.directInvocationRemainder)
      : undefined
  const modeGovernorBlock = buildModeGovernorPromptBlock(
    modeGovernor,
    roomStatuses,
    directInvocationTail,
  )

  const expandedAnalysis = mode === 'expanded' || modeGovernor.allowLongForm
  const toneInstruction = TONE_INSTRUCTIONS[toneMode] || TONE_INSTRUCTIONS.casual
  const responseDepth = expandedAnalysis
    ? 'Expanded analysis approved. You may go deeper, but stay organized and avoid filler.'
    : 'Cost-control mode is active. Keep the answer concise by default.'
  const maxTokens = expandedAnalysis ? EXPANDED_MAX_TOKENS : DEFAULT_MAX_TOKENS
  const withOpportunityMandate = (system: string, family: Parameters<typeof appendOpportunityMandateToSystem>[1]) =>
    stabilityFlags.opportunityScanning ? appendOpportunityMandateToSystem(system, family) : system

  const withCouncilIdentityLayer = (system: string, family: StableGroupFamily) =>
    isFullCouncilFlowMode(councilFlowMode) || councilFlowMode === 'direct'
      ? appendProviderIdentityToCouncilSystem(system, family)
      : system

  const gptSystem = withCouncilIdentityLayer(
    withOpportunityMandate(
      `You are ChatGPT Family in Ra'el's War Room. Role: synthesize, prioritize, and convert distinct family inputs into a coherent plan without repeating labels unless adding new value. Personality: confident, direct, witty. ${COUNCIL_INSTRUCTION} ${UNCERTAINTY_DAMPENING_INSTRUCTION} ${toneInstruction} ${responseDepth} Use Ra'el profile only when directly relevant to the decree: ${profile}`,
      'chatgpt',
    ),
    'chatgpt',
  )
  const claudeSystem = withCouncilIdentityLayer(
    withOpportunityMandate(
      `You are Claude Family in Ra'el's War Room. Role: architecture, invariants, truth boundaries, persistence, rollback, and evidence restraint. Personality: honest, direct, dry humor. ${COUNCIL_INSTRUCTION} ${UNCERTAINTY_DAMPENING_INSTRUCTION} ${toneInstruction} ${responseDepth} Use Ra'el profile only when directly relevant to the decree: ${profile}`,
      'claude',
    ),
    'claude',
  )
  const grokSystem = withCouncilIdentityLayer(
    withOpportunityMandate(
      `You are Grok Family in Ra'el's War Room. Role: external signal volatility only when sources or live intelligence evidence are present, plus sharp contradiction spotting. Personality: fast, candid, observant, a little mischievous but grounded. ${COUNCIL_INSTRUCTION} ${UNCERTAINTY_DAMPENING_INSTRUCTION} ${toneInstruction} ${responseDepth} Important: if live tools or intelligence evidence are not provided in the prompt, do not pretend you searched X or the web; call it a telemetry gap or hypothesis. Use Ra'el profile only when directly relevant to the decree: ${profile}`,
      'grok',
    ),
    'grok',
  )
  const geminiSystem = withCouncilIdentityLayer(
    withOpportunityMandate(
      `You are Gemini Family in Ra'el's War Room. Role: large-context reasoning, long evidence comparison, cross-source correlation, and multimodal interpretation only when the thread actually includes images/PDFs or pasted excerpts. Personality: structured, curious, precise. ${COUNCIL_INSTRUCTION} ${UNCERTAINTY_DAMPENING_INSTRUCTION} ${toneInstruction} ${responseDepth} Do not claim live web, image/PDF ingestion, or tools you were not given in the prompt. Use Ra'el profile only when directly relevant to the decree: ${profile}`,
      'gemini',
    ),
    'gemini',
  )
  const kimiSystem = withCouncilIdentityLayer(
    withOpportunityMandate(
      `You are Kimi Family in Ra'el's War Room. Role: task decomposition, execution planning, long-context reasoning, and step breakdown with dependencies. Personality: practical, ordered, calm. ${COUNCIL_INSTRUCTION} ${UNCERTAINTY_DAMPENING_INSTRUCTION} ${toneInstruction} ${responseDepth} Do not invent completed work or hidden tools. Use Ra'el profile only when directly relevant to the decree: ${profile}`,
      'kimi',
    ),
    'kimi',
  )
  const redTeamSystem = withCouncilIdentityLayer(
    withOpportunityMandate(
      `You are Red Team in Ra'el's War Room — internal adversary and risk assumption challenger. Flag unsupported certainty, invented locality assumptions, mission-overfitting, evidence inflation, weak-signal overstatement, contradictions, stale evidence, blind spots, and overconfidence. ${COUNCIL_INSTRUCTION} ${UNCERTAINTY_DAMPENING_INSTRUCTION} ${RED_TEAM_CALIBRATION_INSTRUCTION} ${toneInstruction} ${responseDepth} Use Ra'el profile only when directly relevant to the decree: ${profile}`,
      'red_team',
    ),
    'red_team',
  )
  const babySystem = `You are Baby AI — observational council witness in Ra'el's War Room. Note patterns, tone, and alignment risks. You may end with one short sentence suggesting whether a Chronicle memory save could be useful (recommendation only — never imply it was saved). ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Use Ra'el profile only when directly relevant to the decree: ${profile}`

  const runtimeSnapRaw =
    typeof body.runtimeIntegritySnapshot === 'string' ? body.runtimeIntegritySnapshot.trim() : ''
  const runtimeSnapTruncated = runtimeSnapRaw.length > 8000 ? runtimeSnapRaw.slice(0, 8000) : runtimeSnapRaw

  const sup = tryWarRoomSupabase()
  let liveResearchUi: LiveResearchClientUi | undefined
  let liveResearchSummary: LiveResearchClientSummary | undefined
  let liveResearchAttempted = false
  let liveResearchPacket: LiveResearchEvidencePacket | undefined
  let councilResponseCompletion: CouncilResponseCompletion | undefined
  type LiveResearchRosterStatus = 'pending' | 'responding' | 'complete' | 'failed' | 'timed_out' | 'partial' | 'truncated'
  let liveResearchTurnSurvey:
    | {
        wave: 'single'
        expectedFamilies: CouncilOrchestrationFamily[]
        roster: Partial<Record<CouncilOrchestrationFamily, LiveResearchRosterStatus>>
      }
    | undefined

  const liveResearchJson = () => {
    if (!liveResearchAttempted) return {}
    const o: Record<string, unknown> = { liveResearchAttempted: true }
    if (liveResearchUi) o.liveResearchUi = liveResearchUi
    if (liveResearchSummary) o.liveResearchSummary = liveResearchSummary
    if (liveResearchTurnSurvey) o.liveResearchTurnSurvey = liveResearchTurnSurvey
    if (councilResponseCompletion) o.councilResponseCompletion = councilResponseCompletion
    return o
  }
  councilTrace.record('research_planned', {
    module: 'app/api/chat/route.ts:evaluateMandatoryLiveRetrieval',
    inputSummary: {
      decreeText: summarizeTextForTrace(raelDirectiveText),
      liveResearchRouterEnabled: stabilityFlags.liveResearchRouter,
      councilSingleFamily,
      stableGroupTurn,
      sequentialDiagnostic,
    },
    outputSummary: {
      mandatoryRetrievalRequired: mandatoryRetrieval.required,
      mandatoryRetrievalReasons: mandatoryRetrieval.reasons,
      initialLiveResearchAttempted: liveResearchAttempted,
    },
    stateChange: 'Initial research posture evaluated before provider execution.',
  })

  const safeAudit = async (meta: Record<string, unknown>) => {
    try {
      await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
        actor: 'system',
        category: 'engine',
        message: meta.success === false ? 'Council /api/chat failed or aborted' : 'Council /api/chat completed',
        metadata: {
          route: '/api/chat',
          toneMode,
          mode: mode ?? null,
          ...meta,
        },
      })
    } catch (err) {
      console.warn('[war-room-audit] insertWarRoomAuditLog failed:', err)
    }
  }

  if (!stabilityFlags.osSweepAndResearchTeam && detectOsSweepIntent(raelDirectiveText)) {
    try {
      councilTrace.record('providers_selected', {
        module: 'app/api/chat/route.ts:os_sweep_bypass',
        inputSummary: { decreeText: summarizeTextForTrace(raelDirectiveText) },
        outputSummary: { selectedFamilies: [], bypass: 'os_sweep' },
        stateChange: 'OS sweep bypass selected before normal provider family flow.',
      })
      const report = await runWarRoomOsSweep(req)
      const markdown = formatCouncilOsSweepMarkdown(report)
      await safeAudit({
        success: true,
        flow: 'os_sweep',
        readiness: report.summary.readinessScore,
        findingCount: report.findings.length,
      })
      councilTrace.record('council_report_built', {
        module: 'app/api/chat/route.ts:os_sweep_bypass',
        inputSummary: { findingCount: report.findings.length },
        outputSummary: { finalReportId: councilTrace.finalReportId, bypass: 'os_sweep' },
        stateChange: 'OS sweep result returned outside normal provider-family response flow.',
      })
      return NextResponse.json(withTrace({
        results: [{ family: 'SYSTEM', content: markdown, status: 'OK' }],
        hardStop: true,
        mode: 'os_sweep',
        osSweepReport: report,
        councilSingleResponse: markdown,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'War Room OS sweep failed.'
      await safeAudit({ success: false, flow: 'os_sweep', reason: message })
      return NextResponse.json(withTrace({
        results: [{
          family: 'SYSTEM',
          content: `War Room OS sweep could not complete. ${message} Open War Room Evolution → Run OS Sweep for structured results.`,
          status: 'FAILED',
        }],
        hardStop: true,
        mode: 'os_sweep',
      }))
    }
  }

  const councilResearchTeamRequested = body.councilResearchTeam === true
  const councilResearchIntent = detectCouncilResearchIntent(raelDirectiveText, {
    forceTeamResearch: councilResearchTeamRequested || Boolean(body.storyContext),
  })
  if (
    stabilityFlags.osSweepAndResearchTeam
    && (
      councilResearchTeamRequested
      || (councilResearchIntent.triggered && body.councilResearchTeam !== false && !councilSingleFamilyEarly)
    )
  ) {
    try {
      councilTrace.record('providers_selected', {
        module: 'app/api/chat/route.ts:council_research_team_bypass',
        inputSummary: {
          decreeText: summarizeTextForTrace(raelDirectiveText),
          councilResearchTeamRequested,
          councilResearchIntentTriggered: councilResearchIntent.triggered,
        },
        outputSummary: { selectedFamilies: ['chatgpt'], bypass: 'council_research_team' },
        stateChange: 'Council Research Team bypass selected before normal provider family flow.',
      })
      const report = await runCouncilResearchTeam({
        decree: raelDirectiveText,
        threadId: conversationId,
        profile,
      })
      await safeAudit({
        success: true,
        flow: 'council_research_team',
        sourceCount: report.sources.length,
        confidenceLevel: report.confidenceLevel,
      })
      councilTrace.record('research_planned', {
        module: 'lib/council-research/orchestrator.ts:runCouncilResearchTeam',
        inputSummary: { decreeText: summarizeTextForTrace(raelDirectiveText) },
        outputSummary: {
          sourceCount: report.sources.length,
          confidenceLevel: report.confidenceLevel,
          sourcesUnavailable: report.sourcesUnavailable,
        },
        stateChange: 'Council Research Team produced source-backed research report.',
      })
      councilTrace.record('council_report_built', {
        module: 'app/api/chat/route.ts:council_research_team_bypass',
        inputSummary: { sourceCount: report.sources.length },
        outputSummary: { finalReportId: councilTrace.finalReportId, bypass: 'council_research_team' },
        stateChange: 'Council Research Team result returned outside normal provider-family response flow.',
      })
      return NextResponse.json(withTrace({
        results: [{ family: 'ChatGPT', content: report.markdown, status: 'OK' }],
        councilSingleResponse: report.markdown,
        councilSingleFamily: 'chatgpt',
        hardStop: true,
        mode: 'council_research_team',
        councilResearchReport: report,
        councilResearchPhases: report.phases,
        showContinue: true,
        liveResearchAttempted: true,
        liveResearchUi: {
          mode: report.sourcesUnavailable ? 'unavailable' : 'verified',
          sourcesCount: report.sources.length,
          label: 'Council Research Team',
          councilPhase: 'model_running',
          responseCompletion: 'complete',
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Council research team failed.'
      await safeAudit({ success: false, flow: 'council_research_team', reason: message })
      return NextResponse.json(withTrace({
        results: [{
          family: 'SYSTEM',
          content: `Council Research Team could not complete. ${message}`,
          status: 'FAILED',
        }],
        hardStop: true,
        mode: 'council_research_team',
      }))
    }
  }

  const economicRouting = resolveEconomicOpsRouting(raelDirectiveText)
  const resolvedModeForDebug =
    councilCommand.directInvocation
      ? 'direct_invocation'
      : isAttendanceFlow
        ? 'attendance'
        : economicRouting.mode === 'economic_ops'
          ? 'economic_ops'
          : intentState.intent === 'research' || councilCommand.mode === 'research'
            ? 'research'
            : modeGovernor.mode
  logEconomicOpsResolvedMode({
    decree: raelDirectiveText,
    resolvedMode: resolvedModeForDebug,
    source: 'server',
    reason: economicRouting.reason,
  })

  if (stabilityFlags.opportunityScanning && economicRouting.mode === 'economic_ops' && !councilSingleFamily) {
    await safeAudit({
      success: true,
      flow: 'economic_ops_bypass',
      resolvedMode: 'economic_ops',
      bypassed: ['parallel_family_attendance', 'legacy_provider_availability_broadcast', 'live_research_router'],
    })
    councilTrace.record('providers_selected', {
      module: 'app/api/chat/route.ts:economic_ops_bypass',
      inputSummary: {
        decreeText: summarizeTextForTrace(raelDirectiveText),
        economicRoutingReason: economicRouting.reason,
      },
      outputSummary: {
        selectedFamilies: [],
        bypass: 'economic_ops',
        bypassed: ['parallel_family_attendance', 'legacy_provider_availability_broadcast', 'live_research_router'],
      },
      stateChange: 'Economic Ops command bypassed normal provider broadcast.',
    })
    councilTrace.record('council_report_built', {
      module: 'app/api/chat/route.ts:economic_ops_bypass',
      inputSummary: { economicRoutingReason: economicRouting.reason },
      outputSummary: { finalReportId: councilTrace.finalReportId, bypass: 'economic_ops' },
      stateChange: 'Economic Ops system response returned outside normal provider-family response flow.',
    })
    return NextResponse.json(withTrace({
      results: [{
        family: 'SYSTEM',
        content: 'Economic Ops command routed to Opportunity Scout. Provider analysis will be stored in operational records, not broadcast as council wall-of-text.',
        status: 'OK',
      }],
      hardStop: true,
      mode: 'economic_ops',
      economicOpsBypass: true,
    }))
  }

  const diagnosticMetaFor = (fam: CouncilSingleFamily | undefined, meta?: { hold?: boolean }) => {
    if (!sequentialDiagnostic || !fam) return undefined
    const order =
      diagnosticOrderCoerced && diagnosticOrderCoerced.length ? diagnosticOrderCoerced : [fam]
    return {
      mode: 'sequential_diagnostic' as const,
      ...(diagnosticIntentMode !== 'none' ? { intentMode: diagnosticIntentMode } : {}),
      turn: diagnosticTurnIndex ?? 0,
      total: diagnosticTurnTotal ?? order.length,
      order,
      hold: meta?.hold ?? false,
    }
  }

  const degradedProviderResponse = (
    councilFam: CouncilSingleFamily,
    status: 'timed_out' | 'failed',
    detail: string,
  ) => {
    const resultStatus: ProviderResultStatus = status === 'timed_out' ? 'TIMED_OUT' : 'FAILED'
    const stabilityMessage =
      stableGroupTurn
        ? ''
        : councilStabilityMode
          ? COUNCIL_STABILITY_FAILURE_MESSAGE
          : ''
    const results = validateProviderResults(
      [
        {
          family: displayFamilyName(councilFam),
          content: stabilityMessage,
          status: resultStatus,
          error: detail,
        },
      ],
      {
        integrityCheck: !skipProviderIntegrityCheck,
        minimalCouncilPath,
        decreeText: raelDirectiveText,
        suppressSyncWarnings: suppressIntegritySyncWarnings,
      },
    )
    void logCouncilPacketMetrics(sup.ok ? sup.client : null, {
      route: '/api/chat',
      provider: councilFam,
      integrityRejectionReason: detail,
      timedOut: status === 'timed_out',
      councilStabilityMode,
    })
    const dm = diagnosticMetaFor(councilFam)
    recordCouncilProgressProviderResult(councilProgress, councilFam, {
      family: displayFamilyName(councilFam),
      content: stabilityMessage,
      status: resultStatus,
      error: detail,
    })
    recordCouncilProgressSyntheticAudit(councilProgress, [councilFam], [{
      family: displayFamilyName(councilFam),
      content: stabilityMessage,
      status: resultStatus,
      error: detail,
    }])
    councilTrace.record('provider_responses_received', {
      module: 'app/api/chat/route.ts:degradedProviderResponse',
      inputSummary: { councilFam, status, detail: summarizeTextForTrace(detail) },
      outputSummary: { resultCount: results.length },
      stateChange: 'Provider returned degraded response path.',
    })
    councilTrace.record('integrity_checked', {
      module: 'app/api/chat/route.ts:validateProviderResults',
      inputSummary: { councilFam, status },
      outputSummary: { resultCount: results.length },
      stateChange: 'Provider degradation normalized through integrity result handling.',
    })
    return NextResponse.json(
      withTrace({
        councilSingleResponse: stabilityMessage,
        councilSingleFamily: councilFam,
        results,
        showContinue: true,
        councilProviderHttpStatus: status,
        councilProviderHttpDetail: detail,
        councilStabilityIssue: councilStabilityMode,
        ...(dm ? { diagnosticMeta: dm } : {}),
        ...liveResearchJson(),
        ...stabilityMeta,
      }),
      { status: 200 },
    )
  }

  const callCouncilProvider = async (
    family: CouncilSingleFamily,
    userPrompt: string,
    opts?: { grokTimeoutMs?: number },
  ): Promise<ProviderResult> => {
    const familyName = displayFamilyName(family)
    if (family === 'bridge_architect') {
      return { family: familyName, content: `${familyName} Family is currently unavailable.`, status: 'UNAVAILABLE' }
    }
    if (family === 'kimi' && !isKimiConfigured()) {
      return { family: familyName, content: 'Kimi not configured', status: 'UNAVAILABLE' }
    }
    if (family === 'chatgpt' && !process.env.OPENAI_API_KEY) {
      return { family: familyName, content: `${familyName} Family is currently unavailable.`, status: 'UNAVAILABLE' }
    }
    if ((family === 'claude' || family === 'red_team') && !process.env.ANTHROPIC_API_KEY) {
      return { family: familyName, content: `${familyName} Family is currently unavailable.`, status: 'UNAVAILABLE' }
    }
    if (family === 'grok' && !process.env.XAI_API_KEY) {
      return { family: familyName, content: `${familyName} Family is currently unavailable.`, status: 'UNAVAILABLE' }
    }
    if (family === 'gemini' && !process.env.GEMINI_API_KEY) {
      return { family: familyName, content: `${familyName} Family is currently unavailable.`, status: 'UNAVAILABLE' }
    }

    try {
      if (family === 'chatgpt') {
        const ac = new AbortController()
        const tid = setTimeout(() => ac.abort(), PROVIDER_TIMEOUT_MS)
        try {
          return { family: familyName, content: await callChatGPT(userPrompt, gptSystem, maxTokens, ac.signal), status: 'OK' }
        } finally {
          clearTimeout(tid)
        }
      }
      if (family === 'claude') {
        const ac = new AbortController()
        const tid = setTimeout(() => ac.abort(), PROVIDER_TIMEOUT_MS)
        try {
          return { family: familyName, content: await callClaude(userPrompt, claudeSystem, maxTokens, ac.signal), status: 'OK' }
        } finally {
          clearTimeout(tid)
        }
      }
      if (family === 'grok') {
        const grokMs = opts?.grokTimeoutMs ?? PROVIDER_TIMEOUT_MS
        return {
          family: familyName,
          content: await callGrok(userPrompt, grokSystem, maxTokens, grokMs),
          status: 'OK',
        }
      }
      if (family === 'gemini') {
        const geminiResult = await completeGeminiCouncilMessage({
          userPrompt,
          systemPrompt: geminiSystem,
          maxOutputTokens: maxTokens,
          timeoutMs: PROVIDER_TIMEOUT_MS,
        })
        if (!geminiResult.ok) {
          return {
            family: familyName,
            content: geminiResult.degraded ? geminiResult.note : '',
            status: geminiResult.degraded ? 'OK' : 'FAILED',
            error: geminiResult.degraded ? geminiResult.reason : geminiResult.error,
          }
        }
        return { family: familyName, content: geminiResult.text.trim(), status: 'OK' }
      }
      if (family === 'kimi') {
        const kimiResult = await completeKimiChat({
          system: kimiSystem,
          messages: [{ role: 'user', content: userPrompt }],
          maxTokens,
          timeoutMs: PROVIDER_TIMEOUT_MS,
        })
        if (!kimiResult.ok) {
          const kimiUnavailable = kimiResult.kind === 'key_missing'
          return {
            family: familyName,
            content: kimiUnavailable ? 'Kimi not configured' : '',
            status: kimiUnavailable ? 'UNAVAILABLE' : 'FAILED',
            error: kimiResult.error,
          }
        }
        return { family: familyName, content: kimiResult.data.text.trim(), status: 'OK' }
      }
      if (family === 'red_team') {
        const ac = new AbortController()
        const tid = setTimeout(() => ac.abort(), PROVIDER_TIMEOUT_MS)
        try {
          return { family: familyName, content: await callClaude(userPrompt, redTeamSystem, maxTokens, ac.signal), status: 'OK' }
        } finally {
          clearTimeout(tid)
        }
      }
      if (family === 'baby') {
        const ac = new AbortController()
        const tid = setTimeout(() => ac.abort(), PROVIDER_TIMEOUT_MS)
        try {
          return { family: familyName, content: await callChatGPT(userPrompt, babySystem, maxTokens, ac.signal), status: 'OK' }
        } finally {
          clearTimeout(tid)
        }
      }
      return { family: familyName, content: `${familyName} Family is currently unavailable.`, status: 'UNAVAILABLE' }
    } catch (error) {
      return {
        family: familyName,
        content: '',
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const runFamilyToFamilyDeliberation = async (
    progressTracker: CouncilProgressRuntimeTracker,
  ): Promise<DeliberationSession> => {
    const progress = createDeliberationProgressRecorder(progressTracker)
    const evidenceReferences = evidenceReferencesFromLiveResearch(liveResearchPacket)
    const session = createDeliberationSession({
      sessionId: conversationId,
      missionId: councilTrace.missionId,
      missionVersion: councilTrace.missionVersion,
      commanderMessage: raelDirectiveText,
      evidenceReferences,
    })
    const evidenceReferenceIds = evidenceReferences.map(ref => ref.evidence_reference_id)
    const completedOutputIds = () =>
      session.turns
        .map(turn => turn.output_message_id)
        .filter((id): id is string => Boolean(id))

    const appendUnresolvedTurn = (
      family: CouncilSingleFamily,
      role: DeliberationTurnRole,
      speakingOrder: number,
      reason: string,
      opts?: {
        inputMessageIds?: string[]
        challengeTargetIds?: string[]
        revisionOfMessageId?: string | null
        recordProgress?: boolean
      },
    ) => {
      const turn = appendDeliberationTurn(session, {
        family,
        role,
        speakingOrder,
        inputMessageIds: opts?.inputMessageIds ?? [session.commander_message_id],
        challengeTargetIds: opts?.challengeTargetIds,
        revisionOfMessageId: opts?.revisionOfMessageId,
        evidenceReferenceIds,
        providerResult: {
          family,
          providerLabel: displayFamilyName(family),
          providerModel: providerModelForFamily(family),
          content: '',
          status: 'unresolved',
          failureReason: reason,
        },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      if (opts?.recordProgress !== false) {
        progress.recordTurnCompleted(turn, { finalFamilyTurn: true })
      }
      return turn
    }

    const callTurn = async (
      family: CouncilSingleFamily,
      role: DeliberationTurnRole,
      speakingOrder: number,
      opts?: {
        inputMessageIds?: string[]
        challengeTargetIds?: string[]
        revisionOfMessageId?: string | null
        targetTurn?: DeliberationTurn | null
      },
    ) => {
      const startedAt = new Date().toISOString()
      const prompt = buildDeliberationPrompt({
        role,
        commanderMessage: raelDirectiveText,
        evidenceReferences,
        priorTurns: session.turns,
        targetTurn: opts?.targetTurn,
      })
      progress.recordTurnStarted(family, role, session.turns)
      const result = await withTimeout(
        displayFamilyName(family),
        callCouncilProvider(family, prompt),
        PROVIDER_TIMEOUT_MS,
      )
      const turn = appendDeliberationTurn(session, {
        family,
        role,
        speakingOrder,
        inputMessageIds: opts?.inputMessageIds ?? [session.commander_message_id],
        challengeTargetIds: opts?.challengeTargetIds,
        revisionOfMessageId: opts?.revisionOfMessageId,
        evidenceReferenceIds,
        providerResult: providerResultForDeliberation(family, result),
        startedAt,
        completedAt: new Date().toISOString(),
      })
      progress.recordTurnCompleted(turn, {
        finalFamilyTurn:
          role === 'direct_response'
          || role === 'red_team_challenge'
          || role === 'revision_or_stand_firm'
          || turn.completion_status !== 'complete',
      })
      return turn
    }

    councilTrace.record('providers_selected', {
      module: 'app/api/chat/route.ts:family_to_family_deliberation',
      inputSummary: { requestedMode: 'family_to_family_v1' },
      outputSummary: { selectedFamilies: ['chatgpt', 'claude', 'red_team', 'chatgpt'] },
      stateChange: 'Phase 48-C3A selected two commercial families plus one Red Team challenge and one revision/synthesis family.',
    })

    const opening = await callTurn('chatgpt', 'opening_position', 1, {
      inputMessageIds: [session.commander_message_id],
    })
    if (!opening.output_message_id) {
      appendUnresolvedTurn('claude', 'direct_response', 2, 'Opening position unavailable; no prior message ID exists for a truthful response.')
      appendUnresolvedTurn('red_team', 'red_team_challenge', 3, 'Required prior family messages unavailable; challenge not generated.')
      appendUnresolvedTurn('chatgpt', 'revision_or_stand_firm', 4, 'Red Team challenge unavailable; revision not generated.', {
        revisionOfMessageId: opening.output_message_id,
      })
      session.diagnostics.push('Deliberation stopped before synthesis because the opening provider contribution was unavailable.')
      progress.closeIfTerminal()
      return session
    }

    const response = await callTurn('claude', 'direct_response', 2, {
      inputMessageIds: [session.commander_message_id, opening.output_message_id],
    })
    if (!response.output_message_id) {
      appendUnresolvedTurn('red_team', 'red_team_challenge', 3, 'Second family response unavailable; Red Team cannot challenge a completed two-family exchange.', {
        inputMessageIds: [session.commander_message_id, opening.output_message_id],
        challengeTargetIds: [opening.output_message_id],
      })
      appendUnresolvedTurn('chatgpt', 'revision_or_stand_firm', 4, 'Red Team challenge unavailable; revision not generated.', {
        inputMessageIds: [session.commander_message_id, opening.output_message_id],
        revisionOfMessageId: opening.output_message_id,
        recordProgress: false,
      })
      session.diagnostics.push('Deliberation stopped before synthesis because the second family contribution was unavailable.')
      progress.recordTurnCompleted(opening, { finalFamilyTurn: true })
      progress.closeIfTerminal()
      return session
    }

    const challenge = await callTurn('red_team', 'red_team_challenge', 3, {
      inputMessageIds: [session.commander_message_id, opening.output_message_id, response.output_message_id],
      challengeTargetIds: [opening.output_message_id, response.output_message_id],
    })
    if (!challenge.output_message_id) {
      appendUnresolvedTurn('chatgpt', 'revision_or_stand_firm', 4, 'Red Team challenge unavailable; revision not generated.', {
        inputMessageIds: [session.commander_message_id, opening.output_message_id, response.output_message_id],
        revisionOfMessageId: opening.output_message_id,
        recordProgress: false,
      })
      session.diagnostics.push('Deliberation stopped before synthesis because the Red Team challenge was unavailable.')
      progress.recordTurnCompleted(opening, { finalFamilyTurn: true })
      progress.closeIfTerminal()
      return session
    }

    await callTurn('chatgpt', 'revision_or_stand_firm', 4, {
      inputMessageIds: [session.commander_message_id, challenge.output_message_id],
      challengeTargetIds: [challenge.output_message_id],
      revisionOfMessageId: opening.output_message_id,
      targetTurn: opening,
    })

    if (canSynthesize(session, ['opening_position', 'direct_response', 'red_team_challenge', 'revision_or_stand_firm'])) {
      await callTurn('chatgpt', 'council_synthesis', 5, {
        inputMessageIds: [session.commander_message_id, ...completedOutputIds()],
      })
    } else {
      session.diagnostics.push('Synthesis not requested because required deliberation turns were not terminal.')
    }

    progress.closeIfTerminal()
    return session
  }

  try {
    let diagnosticRuntimeEvidencePacket: RuntimeEvidencePacket | undefined

    let snapForDiagnostics = runtimeSnapTruncated
    let diagnosticRuntimeGrounding = ''
    if (sequentialDiagnostic && diagnosticIntentMode !== 'none') {
      const clientPartial = tryParseRuntimeIntegrityPartial(runtimeSnapTruncated)
      const snapGen = parseRuntimeIntegrityGeneratedAt(runtimeSnapTruncated)
      const claimedGen =
        typeof body.integrityGeneratedAt === 'string' ? body.integrityGeneratedAt.trim() : ''
      const genMismatch = Boolean(claimedGen && snapGen && claimedGen !== snapGen)
      const partial =
        clientPartial && !isRuntimeIntegritySnapshotStale(runtimeSnapTruncated) && !genMismatch
          ? clientPartial
          : await collectRuntimeIntegrityPartial(req, { councilMode: null })
      const gatherC = detectProviderSlotVsGatherContradictions(partial.providers, providerRuntimeStates)
      const effectiveIntegrity = finalizeRuntimeIntegrityResponse(partial, { gatherContradictions: gatherC })
      diagnosticRuntimeEvidencePacket = buildRuntimeEvidencePacket(effectiveIntegrity, providerRuntimeStates)
      snapForDiagnostics = JSON.stringify(effectiveIntegrity).slice(0, 8000)
      diagnosticRuntimeGrounding = buildRuntimeDiagnosticGroundingBlock(diagnosticRuntimeEvidencePacket, {
        forbidTotalCollapse:
          diagnosticRuntimeEvidencePacket.overallStatus === 'PARTIAL'
          || diagnosticRuntimeEvidencePacket.overallStatus === 'HEALTHY',
      })
    }

    const integrityAugment =
      sequentialDiagnostic && diagnosticIntentMode !== 'none' && snapForDiagnostics.length > 0
        ? `\n\n### Runtime integrity snapshot (truncated; diagnostics only)\n${snapForDiagnostics}`
        : ''

    let augmentBlock = minimalCouncilPath
      ? ''
      : [
          orchestrationAugment.trim() ? `\n\nCouncil orchestration directives:\n${orchestrationAugment.trim()}` : '',
          diagnosticRuntimeGrounding ? `\n\n${diagnosticRuntimeGrounding}` : '',
          integrityAugment,
        ]
          .filter(Boolean)
          .join('')

    const baseUserPrompt = buildCouncilUserPrompt({
      raelDirectiveText,
      threadBlock: thread,
      augmentBlock,
      intentLabel: intentState.intent,
      modeGovernorBlock: councilStabilityMode ? '' : modeGovernorBlock,
    })

    if (familyDeliberationRequested) {
      // councilLogicalRequestId/councilLogicalExpectedFamilies/
      // councilLogicalTurnIndex/councilLogicalTurnTotal (parsed above from
      // the request body) are intentionally not threaded into this tracker.
      // Those fields exist to reconcile progress across the legacy
      // multi-HTTP-call sequential shard path (see the councilSingleFamily
      // tracker construction below), where each family turn is a separate
      // request that needs to be correlated back to one logical decree.
      // Family-to-family deliberation instead executes and reconciles every
      // selected family's full turn sequence inside this single request/
      // response, so there is no cross-call correlation need here -- the
      // client may still send these fields (harmless, backward compatible),
      // but this path has no use for them.
      councilProgress = createCouncilProgressRuntimeTracker({
        requestIdSeed: councilTrace.councilTraceId,
        commanderTurnRef: conversationId ?? 'api-chat-family-deliberation',
        flowMode: 'stable_group',
        executionStrategy: 'server_sequential_streaming_future',
        expectedFamilies: ['chatgpt', 'claude', 'red_team'],
        selectedFamilies: ['chatgpt', 'claude', 'red_team'],
        selectionAuthority: 'system_selected',
      })
      councilProgress.record({ eventType: 'request_created', source: 'server_orchestrator' })
      councilProgress.record({
        eventType: 'request_selection_resolved',
        source: 'server_orchestrator',
        payload: {
          selectedFamilies: ['chatgpt', 'claude', 'red_team'],
          expectedFamilies: ['chatgpt', 'claude', 'red_team'],
        },
      })
      councilProgress.record({ eventType: 'request_started', source: 'server_orchestrator' })
      councilTrace.record('provider_calls_started', {
        module: 'app/api/chat/route.ts:family_to_family_deliberation',
        inputSummary: { mode: 'family_to_family_v1', timeoutMs: PROVIDER_TIMEOUT_MS },
        outputSummary: { callMode: 'sequential_family_to_family' },
        stateChange: 'Family deliberation provider calls started in strict speaking order.',
      })
      const familyDeliberation = await runFamilyToFamilyDeliberation(councilProgress)
      const resultTurns = familyDeliberation.turns.filter(turn =>
        turn.output_message_id || turn.completion_status !== 'complete',
      )
      const results = resultTurns.map(turn => ({
        family: turn.completion_status === 'complete' ? turn.provider_label : 'SYSTEM',
        content: formatDeliberationTurnForChat(turn, familyDeliberation.evidence_references),
        status:
          turn.completion_status === 'complete'
            ? 'OK'
            : turn.completion_status === 'timed_out'
              ? 'TIMED_OUT'
              : turn.completion_status === 'unavailable'
                ? 'UNAVAILABLE'
                : 'FAILED',
      }))
      const synthesis = familyDeliberation.synthesis_turn_id
        ? familyDeliberation.turns.find(turn => turn.turn_id === familyDeliberation.synthesis_turn_id)
        : null
      councilTrace.record('provider_responses_received', {
        module: 'app/api/chat/route.ts:family_to_family_deliberation',
        inputSummary: { turnCount: familyDeliberation.turns.length },
        outputSummary: {
          providerResponses: familyDeliberation.turns.map(turn => ({
            turnId: turn.turn_id,
            outputMessageId: turn.output_message_id,
            providerFamily: turn.provider_label,
            role: turn.turn_role,
            status: turn.completion_status,
          })),
        },
        stateChange: 'Family-to-family deliberation turns collected with explicit message linkage.',
      })
      councilTrace.record('integrity_checked', {
        module: 'app/api/chat/route.ts:family_to_family_deliberation',
        inputSummary: { turnCount: familyDeliberation.turns.length },
        outputSummary: {
          synthesisReady: Boolean(synthesis?.output_message_id),
          fabricatedContribution: false,
        },
        stateChange: 'Deliberation integrity check completed from recorded turn structure.',
      })
      councilTrace.record('red_team_checked', {
        module: 'app/api/chat/route.ts:family_to_family_deliberation',
        inputSummary: {
          challengeTargets: familyDeliberation.turns
            .filter(turn => turn.turn_role === 'red_team_challenge')
            .flatMap(turn => turn.challenge_target_ids),
        },
        outputSummary: { sourceType: 'external_provider_turn', externalProviderCallCompleted: true },
        stateChange: 'Red Team challenge recorded as a real deliberation turn when provider completed.',
      })
      councilTrace.record('memory_recommendation_recorded', {
        module: 'app/api/chat/route.ts:family_to_family_deliberation',
        inputSummary: { familyDeliberationMode: true },
        outputSummary: {
          memoryRecommendation: 'not_evaluated_family_deliberation_path',
          memoryEvaluationExecuted: false,
          memoryWritten: false,
        },
        stateChange: 'No memory proposal ingestion or memory write ran in family deliberation path.',
      })
      await safeAudit({
        success: familyDeliberation.completion_status !== 'failed',
        flow: 'family_to_family_deliberation',
        turnCount: familyDeliberation.turns.length,
      })
      return NextResponse.json(withTrace(attachShadowMetadata({
        results,
        familyDeliberation,
        councilSingleResponse: synthesis?.full_response ?? '',
        hardStop: false,
        mode: 'family_to_family_deliberation',
        showContinue: false,
        ...liveResearchJson(),
      }, createActualSelectionSnapshot({
        executionMode: 'family_to_family_deliberation',
        actualSelectedFamilies: ['chatgpt', 'claude', 'red_team'],
        actualSynthesisFamily: synthesis?.provider_family ?? null,
        actualSelectionSource: 'system_selected',
      }))))
    }

    if (directFamily) {
      const grokDirectEligible = isGrokDirectInvocationEligible({
        isAttendanceFlow,
        councilCommand,
        councilSingleFamily: directFamily,
        directFamily,
      })
      const directTimeoutMs =
        directFamily === 'grok' && grokDirectEligible
          ? DIRECT_INVOCATION_GROK_TIMEOUT_MS
          : PROVIDER_TIMEOUT_MS
      const outerDirectTimeoutMs =
        directFamily === 'grok' && grokDirectEligible
          ? DIRECT_INVOCATION_GROK_OUTER_TIMEOUT_MS
          : directTimeoutMs
      const directStarted = Date.now()
      councilTrace.record('providers_selected', {
        module: 'app/api/chat/route.ts:direct_invocation',
        inputSummary: { directKey, councilSingleFamilyEarly, isAttendanceFlow },
        outputSummary: { selectedFamilies: [directFamily], mode: 'direct_invocation' },
        stateChange: 'Direct invocation selected one provider family.',
      })
      councilProgress = createCouncilProgressRuntimeTracker({
        requestIdSeed: councilTrace.councilTraceId,
        commanderTurnRef: conversationId ?? 'api-chat-direct-invocation',
        flowMode: 'direct',
        executionStrategy: 'single_family_direct',
        expectedFamilies: [directFamily],
        selectedFamilies: [directFamily],
        selectionAuthority: 'direct_invocation',
      })
      councilProgress.record({ eventType: 'request_created', source: 'server_orchestrator' })
      councilProgress.record({
        eventType: 'request_selection_resolved',
        source: 'server_orchestrator',
        payload: { selectedFamilies: [directFamily], expectedFamilies: [directFamily] },
      })
      councilProgress.record({ eventType: 'request_started', source: 'server_orchestrator' })
      councilTrace.record('provider_calls_started', {
        module: 'app/api/chat/route.ts:callCouncilProvider',
        inputSummary: {
          family: directFamily,
          timeoutMs: outerDirectTimeoutMs,
          prompt: summarizeTextForTrace(baseUserPrompt),
        },
        outputSummary: { started: true },
        stateChange: 'Direct invocation provider call started.',
      })
      recordCouncilProgressProviderStart(councilProgress, [directFamily])
      const result = await withTimeout(
        displayFamilyName(directFamily),
        callCouncilProvider(directFamily, baseUserPrompt, {
          grokTimeoutMs: directFamily === 'grok' ? directTimeoutMs : undefined,
        }),
        outerDirectTimeoutMs,
      )
      const elapsedMs = Date.now() - directStarted
      const grokDirectTimeoutFailure =
        directFamily === 'grok'
        && grokDirectEligible
        && (
          result.status === 'TIMED_OUT'
          || (result.status === 'FAILED' && /\btimed out\b/i.test(result.error ?? ''))
        )
      const normalized =
        result.status === 'OK'
          ? result
          : {
              ...result,
              content: grokDirectTimeoutFailure
                ? GROK_FAMILY_DIRECT_INVOCATION_TIMEOUT_MESSAGE
                : `${displayFamilyName(directFamily)} Family is currently unavailable.`,
            }
      await safeAudit({
        success: normalized.status === 'OK',
        flow: 'direct_invocation',
        family: normalized.family,
        status: normalized.status,
        ...(directFamily === 'grok' && grokDirectEligible
          ? {
              provider: 'xai',
              mode: 'direct_invocation_grok',
              providerTimeoutMs: directTimeoutMs,
              outerTimeoutMs: outerDirectTimeoutMs,
              elapsedMs,
              ...(normalized.status === 'OK'
                ? { result: 'success' as const }
                : grokDirectTimeoutFailure
                  ? { result: 'timeout' as const }
                  : {}),
            }
          : {}),
      })
      const responseId = councilTrace.registerProviderResponse(normalized.family)
      councilTrace.record('provider_responses_received', {
        module: 'app/api/chat/route.ts:withTimeout',
        inputSummary: { family: normalized.family, elapsedMs },
        outputSummary: {
          responseId,
          status: normalized.status,
          content: summarizeTextForTrace(normalized.content),
          hasError: Boolean(normalized.error),
        },
        stateChange: 'Direct invocation provider response received.',
      })
      const directResults = [normalized]
      recordCouncilProgressProviderResult(councilProgress, directFamily, normalized)
      recordCouncilProgressSyntheticAudit(councilProgress, [directFamily], directResults)
      councilProgress.closeIfTerminal()
      councilTrace.record('integrity_checked', {
        module: 'app/api/chat/route.ts:direct_invocation',
        inputSummary: { resultCount: directResults.length },
        outputSummary: { integrityCheck: 'direct_invocation_terminal' },
        stateChange: 'Direct invocation hard-stop result prepared without changing provider routing.',
      })
      councilTrace.record('red_team_checked', {
        module: 'app/api/chat/route.ts:direct_invocation',
        inputSummary: { mode: 'direct_invocation' },
        outputSummary: { redTeamRuntimeCheck: 'not_applicable_single_family_direct_invocation' },
        stateChange: 'No Red Team expansion was invoked for explicit direct invocation.',
        observation: 'inferred',
      })
      councilTrace.record('scope_guardian_checked', {
        module: 'app/api/chat/route.ts:direct_invocation',
        inputSummary: { missionVersion: councilTrace.missionVersion },
        outputSummary: { advisoryStatus: 'not_integrated_47a_1_trace_only' },
        stateChange: 'Scope Guardian advisory check recorded as not yet integrated in 47A-1.',
        observation: 'inferred',
      })
      councilTrace.record('final_moderated', {
        module: 'app/api/chat/route.ts:direct_invocation',
        inputSummary: { family: normalized.family },
        outputSummary: { mode: 'direct_invocation', hardStop: true },
        stateChange: 'Direct invocation response finalized for JSON return.',
      })
      councilTrace.record('council_report_built', {
        module: 'app/api/chat/route.ts:direct_invocation',
        inputSummary: { responseIds: [responseId] },
        outputSummary: { finalReportId: councilTrace.finalReportId, minimalReport: true },
        stateChange: 'Minimal trace report envelope built for direct invocation.',
      })
      councilTrace.record('memory_recommendation_recorded', {
        module: 'app/api/chat/route.ts:direct_invocation',
        inputSummary: { stabilityMemoryInjection: stabilityFlags.memoryInjection },
        outputSummary: { memoryRecommendation: 'not_evaluated_direct_invocation' },
        stateChange: 'No memory proposal ingestion ran in direct invocation hard-stop path.',
      })
      return NextResponse.json(withTrace(attachShadowMetadata({
        result: normalized,
        results: directResults,
        hardStop: true,
        mode: 'direct_invocation',
      }, createActualSelectionSnapshot({
        executionMode: 'direct_invocation',
        actualSelectedFamilies: [directFamily],
        actualSynthesisFamily: null,
        actualSelectionSource: 'direct_invocation',
      }))))
    }

    if (!councilSingleFamily) {
      const activeFamilies: CouncilSingleFamily[] = [
        ...(process.env.OPENAI_API_KEY ? (['chatgpt'] as const) : []),
        ...(process.env.ANTHROPIC_API_KEY ? (['claude'] as const) : []),
        ...(process.env.XAI_API_KEY ? (['grok'] as const) : []),
        ...(process.env.GEMINI_API_KEY ? (['gemini'] as const) : []),
      ]
      councilTrace.record('providers_selected', {
        module: 'app/api/chat/route.ts:parallel_provider_selection',
        inputSummary: {
          configured: {
            chatgpt: Boolean(process.env.OPENAI_API_KEY),
            claude: Boolean(process.env.ANTHROPIC_API_KEY),
            grok: Boolean(process.env.XAI_API_KEY),
            gemini: Boolean(process.env.GEMINI_API_KEY),
          },
        },
        outputSummary: { selectedFamilies: activeFamilies },
        stateChange: 'Parallel provider family list selected from configured server-side providers.',
      })
      councilProgress = createCouncilProgressRuntimeTracker({
        requestIdSeed: councilTrace.councilTraceId,
        commanderTurnRef: conversationId ?? 'api-chat-parallel-providers',
        flowMode: 'full_council',
        executionStrategy: 'server_parallel',
        expectedFamilies: activeFamilies,
        selectedFamilies: activeFamilies,
        selectionAuthority: 'system_selected',
      })
      councilProgress.record({ eventType: 'request_created', source: 'server_orchestrator' })
      councilProgress.record({
        eventType: 'request_selection_resolved',
        source: 'server_orchestrator',
        payload: { selectedFamilies: activeFamilies, expectedFamilies: activeFamilies },
      })
      councilProgress.record({ eventType: 'request_started', source: 'server_orchestrator' })

      if (activeFamilies.length === 0) {
        const result: ProviderResult = {
          family: 'SYSTEM',
          content: 'No council providers are currently available.',
          status: 'UNAVAILABLE',
        }
        councilProgress.recordDiagnostic('no_active_providers', 'No configured Council providers were selected.')
        councilProgress.closeIfTerminal()
        await safeAudit({
          success: false,
          flow: 'parallel_providers',
          reason: 'no_active_providers',
        })
        councilTrace.record('provider_calls_started', {
          module: 'app/api/chat/route.ts:parallel_provider_selection',
          inputSummary: { selectedFamilies: activeFamilies },
          outputSummary: { started: false, reason: 'no_active_providers' },
          stateChange: 'No provider calls started because no active providers were configured.',
        })
        councilTrace.record('provider_responses_received', {
          module: 'app/api/chat/route.ts:parallel_provider_selection',
          inputSummary: { selectedFamilies: activeFamilies },
          outputSummary: { resultCount: 1, status: result.status },
          stateChange: 'System unavailable result produced for empty provider roster.',
        })
        councilTrace.record('council_report_built', {
          module: 'app/api/chat/route.ts:parallel_provider_selection',
          inputSummary: { resultCount: 1 },
          outputSummary: { finalReportId: councilTrace.finalReportId, minimalReport: true },
          stateChange: 'Minimal trace report envelope built for no-provider path.',
        })
        return NextResponse.json(withTrace(attachShadowMetadata({
          results: [result],
          hardStop: false,
          mode: 'parallel_providers',
        }, createActualSelectionSnapshot({
          executionMode: 'parallel_providers',
          actualSelectedFamilies: activeFamilies,
          actualSynthesisFamily: null,
          actualSelectionSource: 'system_selected',
          actualSelectionFinalized: true,
        }))))
      }

      councilTrace.record('provider_calls_started', {
        module: 'app/api/chat/route.ts:Promise.all(callCouncilProvider)',
        inputSummary: {
          selectedFamilies: activeFamilies,
          timeoutMs: PROVIDER_TIMEOUT_MS,
          prompt: summarizeTextForTrace(baseUserPrompt),
        },
        outputSummary: { started: true, callMode: 'parallel' },
        stateChange: 'Parallel provider calls started simultaneously.',
      })
      recordCouncilProgressProviderStart(councilProgress, activeFamilies)
      const providerResults = await Promise.all(
        activeFamilies.map(family =>
          withTimeout(
            displayFamilyName(family),
            callCouncilProvider(family, baseUserPrompt),
            PROVIDER_TIMEOUT_MS,
          ),
        ),
      )
      activeFamilies.forEach((family, index) => {
        recordCouncilProgressProviderResult(councilProgress, family, providerResults[index])
      })
      const providerResponses = providerResults.map(result => ({
        family: result.family,
        responseId: councilTrace.registerProviderResponse(result.family),
        status: result.status,
        responseLength: typeof result.content === 'string' ? result.content.length : null,
        errorClass: result.error ? 'provider_error' : null,
      }))
      councilTrace.record('provider_responses_received', {
        module: 'app/api/chat/route.ts:Promise.all(callCouncilProvider)',
        inputSummary: { selectedFamilies: activeFamilies },
        outputSummary: {
          providerResponses: providerResponses.map(result => ({
            responseId: result.responseId,
            providerFamily: result.family,
            status: result.status,
            responseLength: result.responseLength,
            errorClass: result.errorClass,
          })),
        },
        stateChange: 'Parallel provider responses collected.',
      })
      const results = validateProviderResults(providerResults, {
        integrityCheck: !skipProviderIntegrityCheck,
        minimalCouncilPath,
        decreeText: raelDirectiveText,
      })
      councilTrace.record('integrity_checked', {
        module: 'app/api/chat/route.ts:validateProviderResults',
        inputSummary: { resultCount: providerResults.length, integrityCheck: !skipProviderIntegrityCheck },
        outputSummary: {
          externalProviderResultCount: providerResults.length,
          integrityFlagCount: results.filter(result => result.messageType === 'integrity_flag').length,
          totalResultRecords: results.length,
        },
        stateChange: 'Parallel provider results passed through response integrity validation.',
      })
      recordCouncilProgressSyntheticAudit(councilProgress, activeFamilies, providerResults)
      councilProgress.closeIfTerminal()
      councilTrace.record('red_team_checked', {
        module: 'app/api/chat/route.ts:validateProviderResults',
        inputSummary: { resultFamilies: results.map(result => result.family) },
        outputSummary: {
          sourceType: 'integrity_layer',
          externalProviderCallCompleted: false,
          integrityFlagCount: results.filter(result => result.messageType === 'integrity_flag').length,
          syntheticIntegrityFamilies: results
            .filter(result => result.messageType === 'integrity_flag')
            .map(result => result.family),
        },
        stateChange: 'Integrity-layer Red Team flag presence observed; no external Red Team provider call completed.',
      })
      councilTrace.record('scope_guardian_checked', {
        module: 'app/api/chat/route.ts:parallel_provider_selection',
        inputSummary: { missionVersion: councilTrace.missionVersion },
        outputSummary: {
          status: 'not_integrated',
          enforcementApplied: false,
          advisoryStatus: 'not_integrated_47a_1_trace_only',
        },
        stateChange: 'Scope Guardian is not integrated in 47A-1; no runtime enforcement was applied.',
        observation: 'inferred',
      })
      councilTrace.record('final_moderated', {
        module: 'app/api/chat/route.ts:parallel_provider_selection',
        inputSummary: { resultCount: results.length },
        outputSummary: { mode: 'parallel_providers', showContinue: true },
        stateChange: 'Parallel provider results finalized for JSON return.',
      })
      councilTrace.record('council_report_built', {
        module: 'app/api/chat/route.ts:parallel_provider_selection',
        inputSummary: {
          responseIds: providerResponses.map(result => result.responseId),
          providerFamilies: providerResponses.map(result => result.family),
        },
        outputSummary: {
          finalReportId: councilTrace.finalReportId,
          reportType: 'minimal_trace_envelope',
          canonicalCouncilReportGenerated: false,
        },
        stateChange: 'Minimal trace envelope built for parallel provider response; canonical Council Report was not generated.',
      })
      councilTrace.record('memory_recommendation_recorded', {
        module: 'app/api/chat/route.ts:parallel_provider_selection',
        inputSummary: { stabilityMemoryInjection: stabilityFlags.memoryInjection },
        outputSummary: {
          recommendationStatus: 'not_evaluated',
          memoryRecommendation: 'not_evaluated_parallel_provider_path',
          memoryEvaluationExecuted: false,
          memoryWritten: false,
        },
        stateChange: 'No memory proposal ingestion or memory write ran in parallel provider path.',
      })
      await safeAudit({
        success: true,
        flow: 'parallel_providers',
        families: activeFamilies,
        resultCount: results.length,
      })
      return NextResponse.json(withTrace(attachShadowMetadata({
        results,
        hardStop: false,
        mode: 'parallel_providers',
        showContinue: true,
      }, createActualSelectionSnapshot({
        executionMode: 'parallel_providers',
        actualSelectedFamilies: activeFamilies,
        actualSynthesisFamily: null,
        actualSelectionSource: 'system_selected',
      }))))
    }

    if (mode === 'continue' && councilSingleFamily) {
      let providerFinishReason: string | undefined
      const sequentialProgressSeed = councilLogicalRequestId
        ? `${councilLogicalRequestId}-${councilLogicalTurnIndex ?? councilSingleFamily}-${councilSingleFamily}`
        : `${councilTrace.councilTraceId}-${councilSingleFamily}`
      councilProgress = createCouncilProgressRuntimeTracker({
        requestIdSeed: sequentialProgressSeed,
        commanderTurnRef: conversationId ?? councilLogicalRequestId ?? 'api-chat-continue-single',
        flowMode: councilFlowMode,
        executionStrategy: stableGroupTurn ? 'frontend_sequential_single_family' : 'frontend_parallel_single_family',
        expectedFamilies: [councilSingleFamily],
        selectedFamilies: [councilSingleFamily],
        selectionAuthority: 'continuation_selected',
        logicalRequestId: councilLogicalRequestId,
        logicalTurnIndex: councilLogicalTurnIndex,
        logicalTurnTotal: councilLogicalTurnTotal,
        logicalExpectedFamilies: councilLogicalExpectedFamilies.length ? councilLogicalExpectedFamilies : [councilSingleFamily],
      })
      councilProgress.record({ eventType: 'request_created', source: 'server_orchestrator' })
      councilProgress.record({
        eventType: 'request_selection_resolved',
        source: 'server_orchestrator',
        payload: { selectedFamilies: [councilSingleFamily], expectedFamilies: [councilSingleFamily] },
      })
      councilProgress.record({ eventType: 'request_started', source: 'server_orchestrator' })

      const markLiveResearchProviderFailed = (roster: 'failed' | 'timed_out') => {
        if (!liveResearchAttempted) return
        const fam = councilSingleFamily as CouncilOrchestrationFamily
        liveResearchTurnSurvey = { wave: 'single', expectedFamilies: [fam], roster: { [fam]: roster } }
        councilResponseCompletion = 'partial'
        liveResearchSummary = toLiveResearchClientSummary(liveResearchPacket, 'partial')
        liveResearchUi = {
          ...computeLiveResearchClientUi(liveResearchPacket, true),
          responseCompletion: 'partial',
        }
      }

      if (councilSingleFamily === 'bridge_architect') {
        const result: ProviderResult = {
          family: displayFamilyName(councilSingleFamily),
          content: `${councilSingleFamily} has no cloud provider route configured in War Room.`,
          status: 'UNAVAILABLE',
        }
        councilProgress.record({
          eventType: 'family_not_reached',
          source: 'server_orchestrator',
          family: councilSingleFamily,
          payload: {
            outcome: 'not_reached',
            readiness: 'unavailable',
            providerLabel: displayFamilyName(councilSingleFamily),
            reason: 'No cloud provider route is configured for Bridge Architect.',
          },
        })
        recordCouncilProgressSyntheticAudit(councilProgress, [councilSingleFamily], [result])
        await safeAudit({
          success: false,
          flow: 'continue_single',
          councilSingleFamily,
          reason: 'cloud_provider_unavailable',
        })
        return NextResponse.json(
          withTrace({
            error: 'cloud_provider_unavailable',
            message: `${councilSingleFamily} has no cloud provider route configured in War Room.`,
          }),
          { status: 400 },
        )
      }
      if (councilSingleFamily === 'kimi' && !isKimiConfigured()) {
        const result: ProviderResult = {
          family: 'Kimi',
          content: 'Kimi not configured',
          status: 'UNAVAILABLE',
        }
        councilProgress.record({
          eventType: 'family_not_reached',
          source: 'server_orchestrator',
          family: 'kimi',
          payload: {
            outcome: 'not_reached',
            readiness: 'unavailable',
            providerLabel: 'Kimi',
            reason: 'Kimi provider key is not configured.',
          },
        })
        recordCouncilProgressSyntheticAudit(councilProgress, ['kimi'], [result])
        await safeAudit({
          success: false,
          flow: 'continue_single',
          councilSingleFamily: 'kimi',
          reason: 'kimi_not_configured',
        })
        return NextResponse.json(withTrace({
          councilSingleResponse: 'Kimi not configured',
          councilSingleFamily: 'kimi',
          results: [{ family: 'Kimi', content: 'Kimi not configured', status: 'UNAVAILABLE' }],
          showContinue: true,
          ...stabilityMeta,
        }))
      }

      const providerBudgetMs =
        councilGatherPhase === 'decree_soft'
          ? resolveDecreeSoftGatherServerBudgetMs({
              intentKind: intentState.intent,
              mode,
              councilCommand,
            })
          : resolveProviderTimeoutMs({
              intentKind: intentState.intent,
              mode,
              councilCommand,
            })

      councilTrace.record('providers_selected', {
        module: 'app/api/chat/route.ts:continue_single',
        inputSummary: {
          councilSingleFamily,
          mode,
          councilFlowMode,
          councilGatherPhase,
        },
        outputSummary: {
          selectedFamilies: [councilSingleFamily],
          providerBudgetMs,
          stableGroupTurn,
        },
        stateChange: 'Single-family provider selected for continuation request.',
      })
      const grokContinueEligible = isGrokDirectInvocationEligible({
        isAttendanceFlow,
        councilCommand,
        councilSingleFamily,
        directFamily: null,
      })
      const grokContinueTimeoutMs = grokContinueEligible
        ? DIRECT_INVOCATION_GROK_TIMEOUT_MS
        : providerBudgetMs

      const withBudgetSignal = () => {
        const ac = new AbortController()
        const tid = setTimeout(() => ac.abort(), providerBudgetMs)
        return {
          signal: ac.signal,
          dispose: () => clearTimeout(tid),
        }
      }

      const researchEligible =
        !stableGroupTurn
        && stabilityFlags.liveResearchRouter
        && (!isAttendanceFlow || mandatoryRetrieval.required)
        && councilGatherPhase !== 'decree_soft'
        && !sequentialDiagnostic
      const mandatoryResearchEligible =
        !stableGroupTurn
        && stabilityFlags.liveResearchRouter
        && mandatoryRetrieval.required
        && !sequentialDiagnostic

      if (researchEligible || mandatoryResearchEligible) {
        const researchIntentEval = detectResearchIntent(raelDirectiveText, {
          attendanceFlow: isAttendanceFlow && !mandatoryRetrieval.required,
          sequentialDiagnostic,
          intentKind: intentState.intent,
          councilGatherPhase: mandatoryRetrieval.required ? null : councilGatherPhase,
        })
        councilTrace.record('research_planned', {
          module: 'lib/research/researchIntent.ts:detectResearchIntent',
          inputSummary: {
            decreeText: summarizeTextForTrace(raelDirectiveText),
            researchEligible,
            mandatoryResearchEligible,
            mandatoryRetrievalRequired: mandatoryRetrieval.required,
          },
          outputSummary: {
            shouldResearch: researchIntentEval.shouldResearch,
            confidence: researchIntentEval.confidence,
            liveResearchWillRun: researchIntentEval.shouldResearch || mandatoryRetrieval.required,
          },
          stateChange: 'Single-family live research plan evaluated before provider prompt construction.',
        })
        if (researchIntentEval.shouldResearch || mandatoryRetrieval.required) {
          liveResearchAttempted = true
          liveResearchUi = computeLiveResearchClientUi(undefined, true, { councilPhase: 'evidence' })
          liveResearchTurnSurvey = {
            wave: 'single',
            expectedFamilies: [councilSingleFamily as CouncilOrchestrationFamily],
            roster: { [councilSingleFamily as CouncilOrchestrationFamily]: 'responding' },
          }
          const rs = Date.now()
          try {
            const router = await runLiveResearchRouter({
              decreeText: raelDirectiveText,
              supabase: sup.ok ? sup.client : null,
              conversationId,
            })
            const packet = await buildLiveResearchEvidencePacket({
              decreeText: raelDirectiveText,
              router,
              intentConfidence: researchIntentEval.confidence,
            })
            liveResearchPacket = packet
            liveResearchUi = computeLiveResearchClientUi(packet, true, { councilPhase: 'model_running' })
            liveResearchSummary = toLiveResearchClientSummary(packet)
            augmentBlock = [augmentBlock, '\n\n', buildLiveResearchGroundingBlock(packet)].join('')
            if (packet.intelligencePacket) {
              augmentBlock = [
                augmentBlock,
                '\n\n',
                buildFamilyIntelligenceFrame(
                  packet.intelligencePacket,
                  councilSingleFamily as CouncilOrchestrationFamily,
                ).prompt_block,
              ].join('')
            }
            augmentBlock = [augmentBlock, buildResearchAntiLoopAugment(thread)].join('')
            void logLiveResearchEvidenceMetadata(sup.ok ? sup.client : null, {
              conversationId,
              triggered: true,
              intentConfidence: researchIntentEval.confidence,
              packet,
              routerMs: Date.now() - rs,
            })
            councilTrace.record('research_planned', {
              module: 'lib/research/researchRouter.ts:runLiveResearchRouter',
              inputSummary: {
                decreeText: summarizeTextForTrace(raelDirectiveText),
                conversationIdPresent: Boolean(conversationId),
              },
              outputSummary: {
                attempted: true,
                usedLiveResearch: packet.usedLiveResearch,
                sourceCount: packet.sources?.length ?? packet.intelligencePacket?.sources_used.length ?? 0,
                routerMs: Date.now() - rs,
              },
              stateChange: 'Live research evidence packet prepared and prompt grounding appended.',
            })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const packet = mandatoryRetrieval.required
              ? buildLiveResearchFailureEvidencePacket({
                  decreeText: raelDirectiveText,
                  error: msg,
                })
              : emptyLiveResearchEvidencePacket(new Date().toISOString(), msg)
            liveResearchPacket = packet
            liveResearchUi = computeLiveResearchClientUi(packet, true, { councilPhase: 'model_running' })
            liveResearchSummary = toLiveResearchClientSummary(packet)
            augmentBlock = [augmentBlock, '\n\n', buildLiveResearchGroundingBlock(packet)].join('')
            if (packet.intelligencePacket) {
              augmentBlock = [
                augmentBlock,
                '\n\n',
                buildFamilyIntelligenceFrame(
                  packet.intelligencePacket,
                  councilSingleFamily as CouncilOrchestrationFamily,
                ).prompt_block,
              ].join('')
            }
            augmentBlock = [augmentBlock, buildResearchAntiLoopAugment(thread)].join('')
            void logLiveResearchEvidenceMetadata(sup.ok ? sup.client : null, {
              conversationId,
              triggered: true,
              intentConfidence: researchIntentEval.confidence,
              packet,
              routerMs: Date.now() - rs,
            })
            councilTrace.record('research_planned', {
              module: 'lib/research/researchRouter.ts:runLiveResearchRouter',
              inputSummary: {
                decreeText: summarizeTextForTrace(raelDirectiveText),
                conversationIdPresent: Boolean(conversationId),
              },
              outputSummary: {
                attempted: true,
                failed: true,
                error: summarizeTextForTrace(msg),
                routerMs: Date.now() - rs,
              },
              stateChange: 'Live research failed; failure evidence packet prepared for grounded response.',
            })
          }
        }
      }

      let grokAugmentBlock = augmentBlock
      if (
        stabilityFlags.rssFederationContext
        && councilSingleFamily === 'grok'
        && (!liveResearchPacket?.usedLiveResearch || !liveResearchPacket?.intelligencePacket)
      ) {
        const rssAugment = await buildGrokRssIntelligenceAugment()
        if (rssAugment) {
          grokAugmentBlock = [grokAugmentBlock, '\n\n', rssAugment].join('')
        }
      }

      const activeTopic = activeTopicFromBody || raelDirectiveText
      const stableGroupPrior =
        stableGroupPriorFromClient ?? extractLastTwoFamilyReplies(threadHistory)
      const stableGroupStatusBlock = formatProviderStatusBlock(providerRuntimeStates)

      let userPrompt: string
      let stableGroupSystemForFamily: string | null = null
      let stableGroupPriorTrimmed = false
      let stableGroupPriorForTurn = stableGroupPrior
      let tokensForCall = isFullCouncilFlowMode(councilFlowMode) ? STABLE_GROUP_MAX_TOKENS : maxTokens

      if (stableGroupTurn) {
        tokensForCall = STABLE_GROUP_MAX_TOKENS
        const finalSynth = stableGroupFinalSynthesis && councilSingleFamily === 'chatgpt'
        if (finalSynth || isStableGroupFamily(councilSingleFamily)) {
          const sgFamily = (finalSynth ? 'chatgpt' : councilSingleFamily) as (typeof STABLE_GROUP_FAMILY_ORDER)[number]
          stableGroupSystemForFamily = buildStableGroupSystemPrompt({
            family: sgFamily,
            toneInstruction,
            finalSynthesis: finalSynth,
          })
          const trimResult = trimStableGroupPriorForCeiling({
            prior: stableGroupPrior,
            commanderMessage: raelDirectiveText,
            activeTopic,
            providerStatusBlock: stableGroupStatusBlock,
            systemPrompt: stableGroupSystemForFamily,
          })
          stableGroupPriorForTurn = trimResult.prior
          stableGroupPriorTrimmed = trimResult.trimmed
          userPrompt = buildStableGroupUserPrompt({
            commanderMessage: raelDirectiveText,
            activeTopic,
            priorReplies: extractLastTwoFamilyReplies(threadHistory),
            providerStatusBlock: stableGroupStatusBlock,
            turnPriorFromClient: stableGroupPriorForTurn,
          })
        } else {
          councilProgress.record({
            eventType: 'family_skipped_by_policy',
            source: 'server_orchestrator',
            family: councilSingleFamily,
            payload: {
              outcome: 'skipped_by_policy',
              reason: 'Family is outside stable group turn roster.',
            },
          })
          recordCouncilProgressSyntheticAudit(councilProgress, [councilSingleFamily], [{
            family: displayFamilyName(councilSingleFamily),
            content: '',
            status: 'UNAVAILABLE',
          }])
          await safeAudit({
            success: true,
            flow: 'stable_group_skip',
            councilSingleFamily,
          })
          return NextResponse.json(withTrace({
            councilSingleResponse: '',
            councilSingleFamily,
            results: [],
            showContinue: true,
            councilFlowMode,
            stableGroupSkipped: true,
            ...stabilityMeta,
          }))
        }
      } else {
        userPrompt = buildCouncilUserPrompt({
          raelDirectiveText,
          threadBlock: thread,
          augmentBlock: grokAugmentBlock,
          intentLabel: intentState.intent,
          modeGovernorBlock: minimalCouncilPath ? '' : modeGovernorBlock,
        })
      }

      const packetForGate = liveResearchPacket?.intelligencePacket
      const retrievalForGate = packetForGate?.retrieval
      const mandatoryPacketMissing =
        mandatoryRetrieval.required
        && (
          !packetForGate
          || !retrievalForGate
          || !retrievalForGate.retrieval_complete
          || retrievalForGate.retrieval_failed
          || !retrievalForGate.synthesis_allowed
          || packetForGate.sources_used.length === 0
        )

      if (stabilityFlags.liveResearchRouter && mandatoryPacketMissing) {
        councilResponseCompletion = 'complete'
        const gaps = [
          ...(retrievalForGate?.retrieval_gaps ?? []),
          ...(packetForGate?.gaps ?? []),
          ...(!packetForGate ? ['Retrieval did not produce a hydrated intelligence packet.'] : []),
          ...(packetForGate?.sources_used.length === 0 ? ['No source metadata was available in the hydrated packet.'] : []),
        ]
        const responseText = [
          'No live intelligence packet available.',
          '',
          'Unknowns:',
          ...(gaps.length ? [...new Set(gaps)].slice(0, 5).map(gap => `- ${gap}`) : ['- Live retrieval did not return source-backed evidence.']),
        ].join('\n')
        const fam = councilSingleFamily as CouncilOrchestrationFamily
        liveResearchTurnSurvey = {
          wave: 'single',
          expectedFamilies: [fam],
          roster: { [fam]: 'failed' },
        }
        liveResearchSummary = toLiveResearchClientSummary(liveResearchPacket, councilResponseCompletion)
        liveResearchUi = {
          ...computeLiveResearchClientUi(liveResearchPacket, true),
          responseCompletion: councilResponseCompletion,
        }
        await safeAudit({
          success: false,
          flow: 'continue_single',
          councilSingleFamily,
          reason: 'mandatory_retrieval_packet_missing',
          retrievalRequired: mandatoryRetrieval.required,
          retrievalComplete: retrievalForGate?.retrieval_complete ?? false,
          retrievalFailed: retrievalForGate?.retrieval_failed ?? true,
          sourceCount: packetForGate?.sources_used.length ?? 0,
        })
        councilProgress.record({
          eventType: 'family_skipped_by_policy',
          source: 'retrieval_layer',
          family: councilSingleFamily,
          payload: {
            outcome: 'skipped_by_policy',
            reason: 'Mandatory retrieval gate prevented provider synthesis.',
          },
        })
        recordCouncilProgressSyntheticAudit(councilProgress, [councilSingleFamily], [{
          family: displayFamilyName(councilSingleFamily),
          content: responseText,
          status: 'UNAVAILABLE',
        }])
        return NextResponse.json(withTrace({
          councilSingleResponse: responseText,
          councilSingleFamily,
          results: [
            {
              family: displayFamilyName(councilSingleFamily),
              content: responseText,
              status: 'OK',
              messageType: 'retrieval_gate',
            },
          ],
          showContinue: true,
          ...liveResearchJson(),
        }))
      }

      let responseText = ''
      let geminiDegradedReason: string | null = null
      let grokContinueInvokeStartedAt: number | undefined
      let grokContinueAuditTiming: { elapsedMs: number; timeoutMs: number } | null = null
      councilTrace.record('provider_calls_started', {
        module: 'app/api/chat/route.ts:continue_single_provider_switch',
        inputSummary: {
          family: councilSingleFamily,
          prompt: summarizeTextForTrace(userPrompt),
          tokensForCall,
          providerBudgetMs,
        },
        outputSummary: { started: true },
        stateChange: 'Single-family provider call started.',
      })
      recordCouncilProgressProviderStart(councilProgress, [councilSingleFamily])
      try {
        switch (councilSingleFamily) {
          case 'chatgpt': {
            const { signal, dispose } = withBudgetSignal()
            try {
              responseText = await callChatGPT(
                userPrompt,
                stableGroupSystemForFamily ?? gptSystem,
                tokensForCall,
                signal,
              )
            } finally {
              dispose()
            }
            break
          }
          case 'claude': {
            const { signal, dispose } = withBudgetSignal()
            try {
              responseText = await callClaude(
                userPrompt,
                stableGroupSystemForFamily ?? claudeSystem,
                tokensForCall,
                signal,
              )
            } finally {
              dispose()
            }
            break
          }
          case 'grok': {
            if (grokContinueEligible) grokContinueInvokeStartedAt = Date.now()
            responseText = await callGrok(
              userPrompt,
              stableGroupSystemForFamily ?? grokSystem,
              tokensForCall,
              grokContinueTimeoutMs,
            )
            if (grokContinueEligible && grokContinueInvokeStartedAt !== undefined) {
              grokContinueAuditTiming = {
                elapsedMs: Date.now() - grokContinueInvokeStartedAt,
                timeoutMs: grokContinueTimeoutMs,
              }
            }
            break
          }
          case 'gemini': {
            const geminiResult = await completeGeminiCouncilMessage({
              userPrompt,
              systemPrompt: stableGroupSystemForFamily ?? geminiSystem,
              maxOutputTokens: tokensForCall,
              timeoutMs: providerBudgetMs,
            })
            if (!geminiResult.ok) {
              if (geminiResult.degraded) {
                responseText = geminiResult.note
                geminiDegradedReason = geminiResult.reason
                break
              }
              await safeAudit({
                success: false,
                flow: 'continue_single',
                councilSingleFamily: 'gemini',
                reason: 'gemini_provider_error',
              })
              markLiveResearchProviderFailed('failed')
              return degradedProviderResponse('gemini', 'failed', geminiResult.error)
            }
            responseText = geminiResult.text.trim()
            providerFinishReason = geminiResult.finishReason
            if (!responseText) {
              await safeAudit({
                success: false,
                flow: 'continue_single',
                councilSingleFamily: 'gemini',
                reason: 'gemini_empty',
              })
              markLiveResearchProviderFailed('failed')
              return degradedProviderResponse('gemini', 'failed', 'Gemini returned empty content')
            }
            break
          }
          case 'kimi': {
            const kimiResult = await completeKimiChat({
              system: stableGroupSystemForFamily ?? kimiSystem,
              messages: [{ role: 'user', content: userPrompt }],
              maxTokens: tokensForCall,
              timeoutMs: providerBudgetMs,
            })
            if (!kimiResult.ok) {
          const kimiUnavailable = kimiResult.kind === 'key_missing'
              await safeAudit({
                success: false,
                flow: 'continue_single',
                councilSingleFamily: 'kimi',
            reason: kimiUnavailable ? 'kimi_not_configured' : 'kimi_provider_error',
              })
          if (kimiUnavailable) {
                return NextResponse.json(withTrace({
                  councilSingleResponse: 'Kimi not configured',
                  councilSingleFamily: 'kimi',
                  results: [{ family: 'Kimi', content: 'Kimi not configured', status: 'UNAVAILABLE' }],
                  showContinue: true,
                  ...stabilityMeta,
                }))
              }
              markLiveResearchProviderFailed('failed')
              return degradedProviderResponse('kimi', 'failed', kimiResult.error)
            }
            responseText = kimiResult.data.text.trim()
            if (!responseText) {
              await safeAudit({
                success: false,
                flow: 'continue_single',
                councilSingleFamily: 'kimi',
                reason: 'kimi_empty',
              })
              markLiveResearchProviderFailed('failed')
              return degradedProviderResponse('kimi', 'failed', 'Kimi returned empty content')
            }
            break
          }
          case 'red_team': {
            const redSystem = stableGroupSystemForFamily
              ?? appendOpportunityMandateToSystem(
                `You are Red Team in Ra'el's War Room — internal adversary and risk assumption challenger. Flag unsupported certainty, invented locality assumptions, mission-overfitting, evidence inflation, weak-signal overstatement, contradictions, stale evidence, blind spots, and overconfidence. ${COUNCIL_INSTRUCTION} ${UNCERTAINTY_DAMPENING_INSTRUCTION} ${RED_TEAM_CALIBRATION_INSTRUCTION} ${toneInstruction} ${responseDepth} Use Ra'el profile only when directly relevant to the decree: ${profile}`,
                'red_team',
              )
            const { signal, dispose } = withBudgetSignal()
            try {
              responseText = await callClaude(userPrompt, redSystem, tokensForCall, signal)
            } finally {
              dispose()
            }
            break
          }
          case 'baby': {
            const babySystem = `You are Baby AI — observational council witness in Ra'el's War Room. Note patterns, tone, and alignment risks. You may end with one short sentence suggesting whether a Chronicle memory save could be useful (recommendation only — never imply it was saved). ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Use Ra'el profile only when directly relevant to the decree: ${profile}`
            const { signal, dispose } = withBudgetSignal()
            try {
              responseText = await callChatGPT(userPrompt, babySystem, maxTokens, signal)
            } finally {
              dispose()
            }
            break
          }
          default:
            await safeAudit({
              success: false,
              flow: 'continue_single',
              reason: 'unknown_councilSingleFamily',
              councilSingleFamily: String(councilSingleFamily),
            })
            return NextResponse.json(withTrace({ error: 'Unknown councilSingleFamily', ...liveResearchJson() }), { status: 400 })
        }
      } catch (providerErr) {
        const msg = providerErr instanceof Error ? providerErr.message : String(providerErr)
        const timedOut =
          (providerErr instanceof DOMException && providerErr.name === 'AbortError')
          || /\b(aborted|abort|timeout|timed\s+out)\b/i.test(msg)
        const grokContinueTimeoutFailure =
          councilSingleFamily === 'grok'
          && grokContinueEligible
          && (timedOut || /\btimed out\b/i.test(msg))
        const degradedDetail = grokContinueTimeoutFailure
          ? GROK_FAMILY_DIRECT_INVOCATION_TIMEOUT_MESSAGE
          : msg
        await safeAudit({
          success: false,
          flow: 'continue_single',
          councilSingleFamily,
          error: msg,
          timedOut,
          ...(grokContinueTimeoutFailure
            ? {
                provider: 'xai',
                mode: 'direct_invocation_grok',
                providerTimeoutMs: grokContinueTimeoutMs,
                outerTimeoutMs: DIRECT_INVOCATION_GROK_OUTER_TIMEOUT_MS,
                elapsedMs:
                  grokContinueInvokeStartedAt !== undefined
                    ? Date.now() - grokContinueInvokeStartedAt
                    : null,
                result: 'timeout' as const,
              }
            : {}),
        })
        if (timedOut) {
          markLiveResearchProviderFailed('timed_out')
          return degradedProviderResponse(councilSingleFamily, 'timed_out', degradedDetail)
        }
        if (/\b(api[_ ]?key|not configured|missing|unauthorized|401)\b/i.test(msg)) {
          if (isAttendanceFlow) {
            markLiveResearchProviderFailed('failed')
            return degradedProviderResponse(councilSingleFamily, 'failed', msg)
          }
          return NextResponse.json(
            withTrace({ error: 'council_configuration_error', message: msg, ...liveResearchJson() }),
            { status: 503 },
          )
        }
        markLiveResearchProviderFailed('failed')
        return degradedProviderResponse(councilSingleFamily, 'failed', msg)
      }
      const providerResponseId = councilTrace.registerProviderResponse(displayFamilyName(councilSingleFamily))
      councilTrace.record('provider_responses_received', {
        module: 'app/api/chat/route.ts:continue_single_provider_switch',
        inputSummary: { family: councilSingleFamily },
        outputSummary: {
          responseId: providerResponseId,
          content: summarizeTextForTrace(responseText),
          geminiDegraded: geminiDegradedReason !== null,
          providerFinishReason: providerFinishReason ?? null,
        },
        stateChange: 'Single-family provider response received before integrity and governor checks.',
      })
      if (!responseText.trim()) {
        await safeAudit({
          success: false,
          flow: 'continue_single',
          councilSingleFamily,
          reason: 'empty_body',
        })
        markLiveResearchProviderFailed('failed')
        return degradedProviderResponse(councilSingleFamily, 'failed', `${councilSingleFamily} returned empty body`)
      }
      recordCouncilProgressProviderResult(councilProgress, councilSingleFamily, {
        family: displayFamilyName(councilSingleFamily),
        content: responseText,
        status: 'OK',
      })

      let providerIntegrityDiagnostics: Record<string, unknown> | undefined
      if (
        stabilityFlags.integrityOrchestrationRetries
        && !skipProviderIntegrityCheck
        && geminiDegradedReason === null
      ) {
        const orchestrated = await orchestrateProviderResponse({
          family: councilSingleFamily,
          prompt: userPrompt,
          rawText: responseText,
          finishReason: providerFinishReason,
          auditClient: sup.ok ? sup.client : null,
          invoke: async ({ family, prompt }) => {
            const retried = await callCouncilProvider(family, prompt, {
              grokTimeoutMs:
                family === 'grok' && grokContinueEligible ? grokContinueTimeoutMs : undefined,
            })
            if (retried.status !== 'OK' || !retried.content.trim()) {
              throw new Error(retried.error ?? `${family} returned empty on integrity retry`)
            }
            return retried.content
          },
        })
        providerIntegrityDiagnostics = {
          integrityStatus: orchestrated.integrity.integrity_status,
          retryCount: orchestrated.retryCount,
          fallbackUsed: orchestrated.fallbackUsed,
          fallbackProvider: orchestrated.fallbackProvider,
          promptChars: orchestrated.diagnostics?.promptChars ?? userPrompt.length,
          completionLength: orchestrated.diagnostics?.completionChars ?? responseText.length,
          truncationDetected: orchestrated.diagnostics?.truncationDetected ?? false,
          retryStrategies: orchestrated.diagnostics?.retryStrategies ?? [],
          degradedQuality: orchestrated.integrity.degraded_quality ?? false,
          ...(orchestrated.diagnostics?.gemini ? { gemini: orchestrated.diagnostics.gemini } : {}),
          ...(orchestrated.diagnosticFragment
            ? { diagnosticFragment: orchestrated.diagnosticFragment }
            : {}),
          ...(orchestrated.degradedLabel ? { degradedLabel: orchestrated.degradedLabel } : {}),
        }
        responseText = orchestrated.displayText
        if (orchestrated.integrity.integrity_status !== 'COMPLETE') {
          councilResponseCompletion =
            orchestrated.integrity.integrity_status === 'TRUNCATED'
              ? 'truncated'
              : orchestrated.integrity.integrity_status === 'DEGRADED_RESPONSE_QUALITY'
                ? 'partial'
                : 'partial'
        }
      }
      councilTrace.record('integrity_checked', {
        module: 'lib/providers/retryOrchestration.ts:orchestrateProviderResponse',
        inputSummary: {
          family: councilSingleFamily,
          integrityRetriesEnabled: stabilityFlags.integrityOrchestrationRetries,
        },
        outputSummary: {
          diagnostics: providerIntegrityDiagnostics ?? null,
          responseCompletion: councilResponseCompletion ?? null,
        },
        stateChange: 'Provider response integrity path completed.',
      })

      if (minimalCouncilPath) {
        const rawLen = responseText.length
        responseText = compactDisplayWhitespace(toDisplayText(responseText))
        logCouncilStabilityRender({
          provider: councilSingleFamily,
          rawLength: rawLen,
          renderedLength: responseText.length,
          fallbackSkipped: true,
        })
      }

      let opportunityDiagnostics: Record<string, unknown> | undefined
      if (stabilityFlags.opportunityScanning && familyRequiresOpportunity(councilSingleFamily)) {
        const threadKey = conversationId?.trim() || 'ephemeral'
        let enforced = enforceCouncilOpportunities({
          family: councilSingleFamily,
          text: responseText,
          threadId: threadKey,
          liveResearchPacket,
        })
        if (!enforced.validation.ok) {
          try {
            const retried = await callCouncilProvider(
              councilSingleFamily,
              buildOpportunityRetryPrompt(userPrompt),
              {
                grokTimeoutMs:
                  councilSingleFamily === 'grok' && grokContinueEligible ? grokContinueTimeoutMs : undefined,
              },
            )
            if (retried.status === 'OK' && retried.content.trim()) {
              const retryEnforced = enforceCouncilOpportunities({
                family: councilSingleFamily,
                text: retried.content,
                threadId: threadKey,
                liveResearchPacket,
              })
              if (retryEnforced.validation.ok) {
                responseText = retried.content
                enforced = retryEnforced
              }
            }
          } catch {
            /* keep prior enforcement result */
          }
        }
        responseText = stripOpportunityJsonBlock(responseText)
        opportunityDiagnostics = {
          opportunityIntegrityOk: enforced.validation.ok,
          opportunityReason: enforced.validation.reason,
          opportunityCount: enforced.registered.length,
          evidenceLabel: enforced.registered[0]?.evidenceLabel ?? (liveSignalsAvailable(liveResearchPacket) ? 'LIVE_SIGNAL_BACKED' : 'HISTORICAL_PATTERN_BASED'),
          vagueOnly: enforced.validation.vagueOnly,
        }
        if (!enforced.validation.ok) {
          providerIntegrityDiagnostics = {
            ...(providerIntegrityDiagnostics ?? {}),
            integrityStatus: 'DEGRADED_RESPONSE_QUALITY',
            opportunityIntegrity: enforced.validation.reason,
            degradedQuality: true,
          }
          if (councilResponseCompletion === 'complete') councilResponseCompletion = 'partial'
        }
      }

      const economicOpsRawProviderAnalysis =
        councilCommand.mode === 'economic_ops' || economicRouting.mode === 'economic_ops'
          ? responseText.trim()
          : undefined
      const preCallRuntime = providerRuntimeStates?.[councilSingleFamily]
      const governed = stabilityFlags.responseGovernor
        ? applyGovernor(responseText, councilSingleFamily, councilCommand, {
            raelDirectiveText,
            councilIntentKind: intentState.intent,
            councilActiveScope: scopeForGovernor,
            modeGovernor,
            roomStatuses,
            verifiedRuntimeContext: preCallRuntime
              ? providerOutcomeToVerifiedContext({
                  family: councilSingleFamily,
                  runtime: preCallRuntime,
                })
              : { family: councilSingleFamily },
          })
        : { text: compactDisplayWhitespace(toDisplayText(responseText)), warnings: [] as string[] }
      councilTrace.record('scope_guardian_checked', {
        module: 'lib/council/responseGovernor.ts:applyGovernor',
        inputSummary: {
          family: councilSingleFamily,
          councilCommandMode: councilCommand.mode,
          activeScopeIntent: scopeForGovernor.intent,
        },
      outputSummary: {
          warningCount: governed.warnings?.length ?? 0,
          warnings: governed.warnings ?? [],
          responseChars: governed.text.length,
      },
        stateChange: 'Existing response governor observed as the current scope-discipline layer for 47A-1.',
      })
      if (governed.warnings?.includes(COUNCIL_GOVERNOR_SILENT_SKIP)) {
        await safeAudit({
          success: true,
          flow: 'continue_single',
          councilSingleFamily,
          expanded: expandedAnalysis,
          councilGovernorSkipped: true,
          councilDisciplineMode: councilCommand.mode,
          ...(geminiDegradedReason !== null
            ? { geminiDegraded: true, geminiDegradedReason }
            : {}),
          models:
            councilSingleFamily === 'grok'
              ? { primary: 'xai' }
              : councilSingleFamily === 'claude' || councilSingleFamily === 'red_team'
                ? { primary: 'anthropic' }
                : councilSingleFamily === 'gemini'
                  ? { primary: 'google_gemini' }
                  : { primary: 'openai' },
          ...(councilSingleFamily === 'grok' && grokContinueEligible && grokContinueAuditTiming
            ? {
                provider: 'xai',
                mode: 'direct_invocation_grok',
                providerTimeoutMs: grokContinueAuditTiming.timeoutMs,
                outerTimeoutMs: DIRECT_INVOCATION_GROK_OUTER_TIMEOUT_MS,
                elapsedMs: grokContinueAuditTiming.elapsedMs,
                result: 'success' as const,
              }
            : {}),
        })
        const dmGov = diagnosticMetaFor(councilSingleFamily)
        councilTrace.record('final_moderated', {
          module: 'app/api/chat/route.ts:governor_silent_skip',
          inputSummary: { family: councilSingleFamily, warnings: governed.warnings },
          outputSummary: { skipped: true },
          stateChange: 'Governor skipped visible output for this family.',
        })
        councilTrace.record('council_report_built', {
          module: 'app/api/chat/route.ts:governor_silent_skip',
          inputSummary: { responseIds: [providerResponseId] },
          outputSummary: { finalReportId: councilTrace.finalReportId, minimalReport: true },
          stateChange: 'Minimal trace report envelope built for governor skip.',
        })
        recordCouncilProgressSyntheticAudit(councilProgress, [councilSingleFamily], [{
          family: displayFamilyName(councilSingleFamily),
          content: '',
          status: 'OK',
        }])
        return NextResponse.json(withTrace({
          councilSingleResponse: '',
          ...(economicOpsRawProviderAnalysis ? { economicOpsRawProviderAnalysis } : {}),
          councilSingleFamily,
          results: validateProviderResults(
            [
              {
                family: displayFamilyName(councilSingleFamily),
                content: '',
                status: 'OK',
              },
            ],
            {
              integrityCheck: !skipProviderIntegrityCheck,
              minimalCouncilPath,
              decreeText: raelDirectiveText,
              suppressSyncWarnings: suppressIntegritySyncWarnings,
            },
          ),
          showContinue: true,
          councilGovernorSkipped: true,
          ...(dmGov ? { diagnosticMeta: dmGov } : {}),
          ...liveResearchJson(),
        }))
      }
      responseText = governed.text

      if (!minimalCouncilPath && councilSingleFamily === 'gemini' && responseText.trim()) {
        const renderGate = applyCouncilRenderGate('gemini', responseText, {
          decreeText: raelDirectiveText,
          retryAttempted: Number(providerIntegrityDiagnostics?.retryCount ?? 0) > 0,
          fallbackUsed: Boolean(providerIntegrityDiagnostics?.fallbackUsed),
          stabilityMode: councilStabilityMode,
          councilFlowMode,
        })
        if (!renderGate.renderable) {
          responseText = renderGate.displayText
          providerIntegrityDiagnostics = {
            ...(providerIntegrityDiagnostics ?? {}),
            integrityStatus: renderGate.integrityStatus,
            degradedQuality: true,
            ...(renderGate.diagnostics ? { gemini: renderGate.diagnostics } : {}),
          }
          if (councilResponseCompletion === 'complete') {
            councilResponseCompletion = 'partial'
          }
        }
      }

      if (!responseText.trim()) {
        await safeAudit({
          success: false,
          flow: 'continue_single',
          councilSingleFamily,
          reason: 'empty_after_governor',
        })
        markLiveResearchProviderFailed('failed')
        return degradedProviderResponse(
          councilSingleFamily,
          'failed',
          `${councilSingleFamily} returned empty body after governor`,
        )
      }

      if (!minimalCouncilPath) {
        councilResponseCompletion = assessCouncilTextCompletion(responseText, {
          providerFinishReason: councilSingleFamily === 'gemini' ? providerFinishReason : undefined,
        })
      } else if (!councilResponseCompletion) {
        councilResponseCompletion = responseText.trim() ? 'complete' : 'partial'
      }
      if (geminiDegradedReason !== null && councilResponseCompletion === 'complete') {
        councilResponseCompletion = 'partial'
      }

      if (liveResearchAttempted) {
        const fam = councilSingleFamily as CouncilOrchestrationFamily
        const rosterStatus =
          councilResponseCompletion === 'complete'
            ? 'complete'
            : councilResponseCompletion === 'truncated'
              ? 'truncated'
              : 'partial'
        liveResearchTurnSurvey = {
          wave: 'single',
          expectedFamilies: [fam],
          roster: { [fam]: rosterStatus },
        }
        liveResearchSummary = toLiveResearchClientSummary(liveResearchPacket, councilResponseCompletion)
        liveResearchUi = {
          ...computeLiveResearchClientUi(liveResearchPacket, true),
          ...(councilResponseCompletion ? { responseCompletion: councilResponseCompletion } : {}),
        }
      }

      let continuationRequest =
        !minimalCouncilPath
        && modeGovernor.continuationAllowed
          ? buildContinuationRequestFromModelOutput({
              family: councilSingleFamily,
              text: responseText,
            })
          : null
      if (continuationRequest && liveResearchAttempted && councilResponseCompletion === 'truncated') {
        continuationRequest = null
      }
      if (
        continuationRequest
        && (councilCommand.mode === 'attendance' || intentState.intent === 'attendance')
      ) {
        continuationRequest = null
      }

      await safeAudit({
        success: true,
        flow: 'continue_single',
        councilSingleFamily,
        expanded: expandedAnalysis,
        councilDisciplineMode: councilCommand.mode,
        ...(geminiDegradedReason !== null
          ? { geminiDegraded: true, geminiDegradedReason }
          : {}),
        models:
          councilSingleFamily === 'grok'
            ? { primary: 'xai' }
            : councilSingleFamily === 'claude' || councilSingleFamily === 'red_team'
              ? { primary: 'anthropic' }
              : councilSingleFamily === 'gemini'
                ? { primary: 'google_gemini' }
                : { primary: 'openai' },
        ...(councilSingleFamily === 'grok' && grokContinueEligible && grokContinueAuditTiming
          ? {
              provider: 'xai',
              mode: 'direct_invocation_grok',
              providerTimeoutMs: grokContinueAuditTiming.timeoutMs,
              outerTimeoutMs: DIRECT_INVOCATION_GROK_OUTER_TIMEOUT_MS,
              elapsedMs: grokContinueAuditTiming.elapsedMs,
              result: 'success' as const,
            }
          : {}),
      })

      if (stabilityFlags.memoryInjection && geminiDegradedReason === null) {
        await tryPersistMemoryProposalFromModelOutput({
          client: sup.ok ? sup.client : null,
          responseText,
          fallbackPartition: councilSingleFamilyToMemoryPartition(councilSingleFamily),
          conversationId,
          extraMetadata: { councilSingleFamily, route: '/api/chat' },
        })
      }

      if (stabilityFlags.packetClassification && conversationId && councilSingleFamily) {
        await registerCouncilProviderPacketOnBus({
          client: sup.ok ? sup.client : null,
          threadId: conversationId,
          family: councilSingleFamily,
          displayText: responseText,
          correlationId: conversationId,
          liveSignalsAvailable: liveSignalsAvailable(liveResearchPacket),
        }).catch(() => undefined)
      }

      if (sequentialDiagnostic && diagnosticIntentMode !== 'none' && councilSingleFamily) {
        insertDiagnosticEvent(sup.ok ? sup.client : null, {
          subsystem: 'council_diagnostic',
          severity: 'INFO',
          source_family: councilSingleFamily,
          evidence: { turn: diagnosticTurnIndex ?? null, total: diagnosticTurnTotal ?? null },
          recommendation: null,
          diagnostic_mode: diagnosticIntentMode,
        })
      }
      if (
        sequentialDiagnostic
        && diagnosticIntentMode !== 'none'
        && councilSingleFamily === 'red_team'
        && detectRedTeamRuntimeHold(responseText)
      ) {
        insertDiagnosticEvent(sup.ok ? sup.client : null, {
          subsystem: 'red_team_hold',
          severity: 'WARN',
          source_family: 'red_team',
          evidence: { excerpt: responseText.slice(0, 1200) },
          recommendation: "Await Ra'el or use Continue diagnostics; queue auto-resumes after 60s.",
          diagnostic_mode: diagnosticIntentMode,
        })
      }
      councilTrace.record('red_team_checked', {
        module: 'app/api/chat/route.ts:continue_single',
        inputSummary: {
          family: councilSingleFamily,
          sequentialDiagnostic,
          diagnosticIntentMode,
        },
        outputSummary: {
          redTeamRuntimeHold:
            councilSingleFamily === 'red_team' ? detectRedTeamRuntimeHold(responseText) : false,
          redTeamProviderPresent: councilSingleFamily === 'red_team',
        },
        stateChange: 'Red Team runtime signal observed for this provider contribution.',
      })

      const dmOk = diagnosticMetaFor(councilSingleFamily, {
        hold: councilSingleFamily === 'red_team' && detectRedTeamRuntimeHold(responseText),
      })
      void logCouncilPacketMetrics(sup.ok ? sup.client : null, {
        route: '/api/chat',
        provider: councilSingleFamily,
        promptCharCount: userPrompt.length,
        contextCharCount: thread.length + augmentBlock.length,
        providerResponseCharCount: responseText.length,
        integrityRejectionReason:
          providerIntegrityDiagnostics?.integrityStatus &&
          providerIntegrityDiagnostics.integrityStatus !== 'COMPLETE'
            ? String(providerIntegrityDiagnostics.integrityStatus)
            : null,
        timedOut: false,
        fallbackUsed: Boolean(providerIntegrityDiagnostics?.fallbackUsed),
        councilStabilityMode,
      })

      const activeCouncilSystemPrompt =
        stableGroupSystemForFamily
        ?? (councilSingleFamily === 'claude'
          ? claudeSystem
          : councilSingleFamily === 'grok'
            ? grokSystem
            : councilSingleFamily === 'gemini'
              ? geminiSystem
              : councilSingleFamily === 'kimi'
                ? kimiSystem
                : councilSingleFamily === 'red_team'
                  ? redTeamSystem
                  : gptSystem)

      if (stableGroupTurn || councilFlowMode === 'direct') {
        logProviderTokenDiagnostics(
          buildProviderTokenDiagnostics({
            mode: councilFlowMode,
            family: councilSingleFamily,
            promptText: `${activeCouncilSystemPrompt}\n${userPrompt}`,
            responseText,
            trimmed: stableGroupPriorTrimmed,
          }),
        )
      }

      const scoreCouncilFamilyConfidence =
        councilSingleFamily
        && isStableGroupFamily(councilSingleFamily)
        && (stableGroupTurn || isFullCouncilFlowMode(councilFlowMode) || councilFlowMode === 'direct')

      const councilFamilyConfidenceScore = scoreCouncilFamilyConfidence
        ? computeCouncilFamilyConfidence({
            responseText,
            decreeText: raelDirectiveText,
            priorReplies: stableGroupTurn ? stableGroupPriorForTurn : stableGroupPrior,
            family: councilSingleFamily as StableGroupFamily,
            hasLiveSignals: liveSignalsAvailable(liveResearchPacket),
          })
        : null

      const finalResults = validateProviderResults(
        [
          {
            family: displayFamilyName(councilSingleFamily),
            content: responseText,
            status: 'OK',
          },
        ],
        {
          integrityCheck: !skipProviderIntegrityCheck,
          minimalCouncilPath,
          decreeText: raelDirectiveText,
          suppressSyncWarnings: suppressIntegritySyncWarnings,
        },
      )
      recordCouncilProgressSyntheticAudit(councilProgress, [councilSingleFamily], [{
        family: displayFamilyName(councilSingleFamily),
        content: responseText,
        status: 'OK',
      }])
      councilTrace.record('final_moderated', {
        module: 'app/api/chat/route.ts:continue_single_final_response',
        inputSummary: {
          family: councilSingleFamily,
          responseCompletion: councilResponseCompletion ?? null,
          continuationRequested: Boolean(continuationRequest),
        },
        outputSummary: {
          resultCount: finalResults.length,
          responseChars: responseText.length,
          confidence: councilFamilyConfidenceScore,
        },
        stateChange: 'Single-family response finalized after governor, render gate, completion check, and result validation.',
      })
      councilTrace.record('council_report_built', {
        module: 'app/api/chat/route.ts:continue_single_final_response',
        inputSummary: {
          responseIds: [providerResponseId],
          liveResearchAttempted,
          hasLiveResearchSummary: Boolean(liveResearchSummary),
        },
        outputSummary: {
          finalReportId: councilTrace.finalReportId,
          minimalReport: true,
          evidenceLineage: liveResearchAttempted ? 'live_research_summary_attached' : 'provider_response_only',
        },
        stateChange: 'Minimal trace report envelope built for single-family response.',
      })
      councilTrace.record('memory_recommendation_recorded', {
        module: 'lib/memory/ingestFromModel.ts:tryPersistMemoryProposalFromModelOutput',
        inputSummary: {
          stabilityMemoryInjection: stabilityFlags.memoryInjection,
          geminiDegraded: geminiDegradedReason !== null,
          family: councilSingleFamily,
        },
        outputSummary: {
          attempted: Boolean(stabilityFlags.memoryInjection && geminiDegradedReason === null),
          persistenceClientAvailable: sup.ok,
        },
        stateChange: 'Memory recommendation/proposal ingestion status recorded for trace lineage.',
      })

      return NextResponse.json(withTrace(attachShadowMetadata({
        councilSingleResponse: responseText,
        ...(economicOpsRawProviderAnalysis ? { economicOpsRawProviderAnalysis } : {}),
        councilSingleFamily,
        ...(councilFamilyConfidenceScore != null
          ? {
              councilFamilyConfidence: councilFamilyConfidenceScore,
              councilFamilyConfidencePercent: councilConfidenceToPercent(councilFamilyConfidenceScore),
            }
          : {}),
        results: finalResults,
        showContinue: true,
        councilFlowMode,
        ...(continuationRequest ? { continuationRequest } : {}),
        ...(dmOk ? { diagnosticMeta: dmOk } : {}),
        ...(sequentialDiagnostic && diagnosticIntentMode !== 'none' && diagnosticRuntimeEvidencePacket
          ? { runtimeEvidencePacket: diagnosticRuntimeEvidencePacket }
          : {}),
        ...(providerIntegrityDiagnostics ? { providerIntegrityDiagnostics } : {}),
        ...(opportunityDiagnostics ? { opportunityDiagnostics } : {}),
        ...liveResearchJson(),
        ...stabilityMeta,
      }, createActualSelectionSnapshot({
        executionMode: councilFlowMode,
        actualSelectedFamilies: [councilSingleFamily],
        actualSynthesisFamily: stableGroupFinalSynthesis ? councilSingleFamily : null,
        actualSelectionSource: 'continuation_selected',
        actualSelectionFinalized: true,
      }))))
    }

    await safeAudit({
      success: false,
      flow: 'unsupported',
      reason: 'require_continue_single',
      mode: mode ?? null,
    })
    return NextResponse.json(
      withTrace({
        error: 'unsupported_flow',
        message: 'Live Council requires mode "continue" with councilSingleFamily (one provider per request).',
      }),
      { status: 400 },
    )
  } catch (e) {
    await safeAudit({
      success: false,
      flow: 'council',
      error: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json(
      withTrace({
        error: 'council_internal_error',
        message: e instanceof Error ? e.message : String(e),
      }),
      { status: 500 },
    )
  }
}
