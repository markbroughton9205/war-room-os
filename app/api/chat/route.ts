import { NextResponse } from 'next/server'
import { completeGeminiCouncilMessage } from '@/lib/ai/providers/geminiCouncil'
import { callXAIChat } from '@/lib/ai/providers/xai'
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
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_MAX_TOKENS = 220
const EXPANDED_MAX_TOKENS = 520
const STABLE_GROUP_MAX_TOKENS = 200

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

function familyFromDirectValue(value: string): CouncilSingleFamily | null {
  if (value === 'Claude') return 'claude'
  if (value === 'ChatGPT') return 'chatgpt'
  if (value === 'Grok') return 'grok'
  if (value === 'Gemini') return 'gemini'
  if (value === 'Kimi') return 'kimi'
  if (value === 'RedTeam') return 'red_team'
  return null
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

  const councilCommand = coerceCouncilCommand(body.councilCommand)
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

  const providerRuntimeStates = coerceProviderRuntimeStates(body.councilProviderRuntimeStates)
  const modeGovernor = resolveModeGovernor({
    decreeText: raelDirectiveText,
    intentKind: intentState.intent,
    councilCommand,
    providerStates: providerRuntimeStates,
    directedFamilies: councilSingleFamily ? [councilSingleFamily] : undefined,
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
      const report = await runWarRoomOsSweep(req)
      const markdown = formatCouncilOsSweepMarkdown(report)
      await safeAudit({
        success: true,
        flow: 'os_sweep',
        readiness: report.summary.readinessScore,
        findingCount: report.findings.length,
      })
      return NextResponse.json({
        results: [{ family: 'SYSTEM', content: markdown, status: 'OK' }],
        hardStop: true,
        mode: 'os_sweep',
        osSweepReport: report,
        councilSingleResponse: markdown,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'War Room OS sweep failed.'
      await safeAudit({ success: false, flow: 'os_sweep', reason: message })
      return NextResponse.json({
        results: [{
          family: 'SYSTEM',
          content: `War Room OS sweep could not complete. ${message} Open War Room Evolution → Run OS Sweep for structured results.`,
          status: 'FAILED',
        }],
        hardStop: true,
        mode: 'os_sweep',
      })
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
      return NextResponse.json({
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
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Council research team failed.'
      await safeAudit({ success: false, flow: 'council_research_team', reason: message })
      return NextResponse.json({
        results: [{
          family: 'SYSTEM',
          content: `Council Research Team could not complete. ${message}`,
          status: 'FAILED',
        }],
        hardStop: true,
        mode: 'council_research_team',
      })
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
    return NextResponse.json({
      results: [{
        family: 'SYSTEM',
        content: 'Economic Ops command routed to Opportunity Scout. Provider analysis will be stored in operational records, not broadcast as council wall-of-text.',
        status: 'OK',
      }],
      hardStop: true,
      mode: 'economic_ops',
      economicOpsBypass: true,
    })
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
    return NextResponse.json(
      {
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
      },
      { status: 200 },
    )
  }

  const callCouncilProvider = async (
    family: CouncilSingleFamily,
    userPrompt: string,
    opts?: { grokTimeoutMs?: number },
  ): Promise<ProviderResult> => {
    const familyName = displayFamilyName(family)
    if (family === 'kimi' || family === 'bridge_architect') {
      return { family: familyName, content: `${familyName} Family is currently unavailable.`, status: 'UNAVAILABLE' }
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
      return NextResponse.json({
        result: normalized,
        results: [normalized],
        hardStop: true,
        mode: 'direct_invocation',
      })
    }

    if (!councilSingleFamily) {
      const activeFamilies: CouncilSingleFamily[] = [
        ...(process.env.OPENAI_API_KEY ? (['chatgpt'] as const) : []),
        ...(process.env.ANTHROPIC_API_KEY ? (['claude'] as const) : []),
        ...(process.env.XAI_API_KEY ? (['grok'] as const) : []),
        ...(process.env.GEMINI_API_KEY ? (['gemini'] as const) : []),
      ]

      if (activeFamilies.length === 0) {
        const result: ProviderResult = {
          family: 'SYSTEM',
          content: 'No council providers are currently available.',
          status: 'UNAVAILABLE',
        }
        await safeAudit({
          success: false,
          flow: 'parallel_providers',
          reason: 'no_active_providers',
        })
        return NextResponse.json({
          results: [result],
          hardStop: false,
          mode: 'parallel_providers',
        })
      }

      const providerResults = await Promise.all(
        activeFamilies.map(family =>
          withTimeout(
            displayFamilyName(family),
            callCouncilProvider(family, baseUserPrompt),
            PROVIDER_TIMEOUT_MS,
          ),
        ),
      )
      const results = validateProviderResults(providerResults, {
        integrityCheck: !skipProviderIntegrityCheck,
        minimalCouncilPath,
        decreeText: raelDirectiveText,
      })
      await safeAudit({
        success: true,
        flow: 'parallel_providers',
        families: activeFamilies,
        resultCount: results.length,
      })
      return NextResponse.json({
        results,
        hardStop: false,
        mode: 'parallel_providers',
        showContinue: true,
      })
    }

    if (mode === 'continue' && councilSingleFamily) {
      let providerFinishReason: string | undefined

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

      if (councilSingleFamily === 'kimi' || councilSingleFamily === 'bridge_architect') {
        await safeAudit({
          success: false,
          flow: 'continue_single',
          councilSingleFamily,
          reason: 'cloud_provider_unavailable',
        })
        return NextResponse.json(
          {
            error: 'cloud_provider_unavailable',
            message: `${councilSingleFamily} has no cloud provider route configured in War Room.`,
          },
          { status: 400 },
        )
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
      let tokensForCall = maxTokens

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
          await safeAudit({
            success: true,
            flow: 'stable_group_skip',
            councilSingleFamily,
          })
          return NextResponse.json({
            councilSingleResponse: '',
            councilSingleFamily,
            results: [],
            showContinue: true,
            councilFlowMode,
            stableGroupSkipped: true,
            ...stabilityMeta,
          })
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
        return NextResponse.json({
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
        })
      }

      let responseText = ''
      let geminiDegradedReason: string | null = null
      let grokContinueInvokeStartedAt: number | undefined
      let grokContinueAuditTiming: { elapsedMs: number; timeoutMs: number } | null = null
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
            return NextResponse.json({ error: 'Unknown councilSingleFamily', ...liveResearchJson() }, { status: 400 })
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
            { error: 'council_configuration_error', message: msg, ...liveResearchJson() },
            { status: 503 },
          )
        }
        markLiveResearchProviderFailed('failed')
        return degradedProviderResponse(councilSingleFamily, 'failed', msg)
      }

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
        return NextResponse.json({
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
        })
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

      return NextResponse.json({
        councilSingleResponse: responseText,
        ...(economicOpsRawProviderAnalysis ? { economicOpsRawProviderAnalysis } : {}),
        councilSingleFamily,
        ...(councilFamilyConfidenceScore != null
          ? {
              councilFamilyConfidence: councilFamilyConfidenceScore,
              councilFamilyConfidencePercent: councilConfidenceToPercent(councilFamilyConfidenceScore),
            }
          : {}),
        results: validateProviderResults(
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
        ),
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
      })
    }

    await safeAudit({
      success: false,
      flow: 'unsupported',
      reason: 'require_continue_single',
      mode: mode ?? null,
    })
    return NextResponse.json(
      {
        error: 'unsupported_flow',
        message: 'Live Council requires mode "continue" with councilSingleFamily (one provider per request).',
      },
      { status: 400 },
    )
  } catch (e) {
    await safeAudit({
      success: false,
      flow: 'council',
      error: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json(
      {
        error: 'council_internal_error',
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    )
  }
}
