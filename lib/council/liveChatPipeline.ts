/**
 * ## Live Council chat pipeline (canonical)
 *
 * **Duplicate paths found (sweep):**
 * - `app/page.tsx`: two direct `fetch('/api/chat')` — autonomous orchestration + decree family loop.
 * - `components/war-room/phase3/Phase3WarRoomPanels.tsx`: separate Supabase thread composer (`POST /api/conversations/.../messages`) — DB thread only, not council LLM; keep distinct.
 *
 * **Unified:** all council `/api/chat` traffic from `app/page.tsx` goes through `postCouncilChat`.
 *
 * **Remains:** engine status refresh and `postLiveCouncilMessage` for dual-write.
 *
 * **Throne send:** `sendLiveCouncilThroneMessage` sequences expansion gate → caller-provided append + council round.
 */
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DiagnosticIntentMode } from '@/lib/council/diagnosticMode'
import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import type { ContinuationRequest } from '@/lib/council/continuationRequest'
import type { IntentKind } from '@/lib/council/intentClassifier'
import type { ActiveScope } from '@/lib/council/intentScope'
import type { ModeGovernor } from '@/lib/council/modeGovernor'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import type { RuntimeEvidencePacket } from '@/lib/runtime/runtimeEvidencePacket'
import type { LiveResearchClientSummary, LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { CouncilResponseCompletion } from '@/lib/council/responseCompletion'
import type { CouncilFlowMode } from '@/lib/council/councilMode'
import type { StableGroupPriorReply } from '@/lib/council/stableGroupChat'
import type { CouncilRuntimeTraceSnapshot } from '@/lib/council/runtimeTrace'
import type { DeliberationSession } from '@/lib/council/family-deliberation'
import type { CouncilShadowSelectionReport, ShadowFeatureMode } from '@/lib/council/adaptive-assembly'

export type CouncilChatRequestBody = {
  message: string
  profile: string
  threadHistory: { sender: string; content: string }[]
  mode: string
  toneMode: string
  councilSingleFamily: CouncilOrchestrationFamily
  orchestrationAugment: string
  conversationId?: string
  /** When true with `councilSingleFamily`, chat route echoes diagnostic meta (sequential diagnostics). */
  sequentialDiagnostic?: boolean
  diagnosticTurnIndex?: number
  diagnosticTurnTotal?: number
  diagnosticOrder?: CouncilOrchestrationFamily[]
  /** Truncated JSON string from GET /api/runtime/integrity (diagnostic modes only; server re-validates). */
  runtimeIntegritySnapshot?: string
  /** Optional client echo of `generatedAt` inside the snapshot — mismatch forces a server refetch. */
  integrityGeneratedAt?: string
  /** Client echo of decree-derived diagnostic intent (server recomputes from `raelDirectiveText`). */
  diagnosticIntentMode?: DiagnosticIntentMode
  /** Structured discipline from latest Ra’el directive (client-authored). */
  councilCommand?: CouncilCommand
  /** Latest Ra’el decree text — used for silent-mode checks when `message` is a synthetic continue line. */
  raelDirectiveText?: string
  /** Decree-derived intent (echoed for parity; server recomputes from `raelDirectiveText`). */
  councilIntentKind?: IntentKind
  /** Serialized active scope — server recomputes from decree when omitted. */
  councilActiveScope?: ActiveScope
  /** Soft decree gather: server uses a long provider budget; client does not mirror short packet aborts. */
  councilGatherPhase?: 'decree_soft'
  /** Phase 3 mode governor snapshot (server recomputes when omitted). */
  councilModeGovernor?: ModeGovernor
  /** Per-family runtime outcomes for prompt room-status block. */
  councilProviderRuntimeStates?: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>
  /** Live Council flow: direct | stable_group | full_council */
  councilFlowMode?: CouncilFlowMode
  /** Stable per-Commander-decree correlation ID reused across per-family continuation calls. */
  councilLogicalRequestId?: string
  /** Full logical family roster for this decree when the client is driving sequential calls. */
  councilLogicalExpectedFamilies?: CouncilOrchestrationFamily[]
  /** Zero-based family turn index inside the logical decree. */
  councilLogicalTurnIndex?: number
  /** Total number of family turns expected for the logical decree. */
  councilLogicalTurnTotal?: number
  /** Conversation-runtime active topic (stable group slim context). */
  activeTopic?: string
  /** Prior replies in the current stable-group turn (server builds prompts from these). */
  stableGroupPriorReplies?: StableGroupPriorReply[]
  /** Optional closing ChatGPT synthesis after Red Team in stable group mode. */
  stableGroupFinalSynthesis?: boolean
  /** Phase 48-C3A: real family-to-family deliberation runtime slice. */
  councilDeliberationMode?: 'family_to_family_v1'
  /** Phase 48-C3B2: advisory-only adaptive Council shadow diagnostics. */
  adaptiveCouncilShadowMode?: ShadowFeatureMode
}

export type CouncilChatJson = {
  councilSingleResponse?: string
  economicOpsRawProviderAnalysis?: string
  councilSingleFamily?: CouncilOrchestrationFamily
  councilGovernorSkipped?: boolean
  error?: string
  message?: string
  results?: { family?: string; content?: string; status?: string; error?: string }[]
  /** Present on HTTP 200 when the route degraded instead of failing the batch. */
  councilProviderHttpStatus?: 'timed_out' | 'failed'
  councilProviderHttpDetail?: string
  /** Server-detected continuation pressure without permission framing — requires UI approval before acting. */
  continuationRequest?: ContinuationRequest
  diagnosticMeta?: {
    mode: 'sequential_diagnostic'
    intentMode?: DiagnosticIntentMode
    turn: number
    total: number
    order: CouncilOrchestrationFamily[]
    hold: boolean
  }
  /** Structured runtime evidence for diagnostics (server-built). */
  runtimeEvidencePacket?: RuntimeEvidencePacket
  /** Phase 5 — compact client-visible live research HUD. */
  liveResearchUi?: LiveResearchClientUi
  liveResearchSummary?: LiveResearchClientSummary
  /** True when this `/api/chat` call ran the live research router (Phase 6). */
  liveResearchAttempted?: boolean
  /** Model output boundary assessment for this turn (Phase 6). */
  councilResponseCompletion?: CouncilResponseCompletion
  councilStabilityMode?: boolean
  councilStabilityIssue?: boolean
  councilFlowMode?: CouncilFlowMode
  stableGroupSkipped?: boolean
  /** Lightweight per-family confidence (0–1) from Phase 40 scoring. */
  councilFamilyConfidence?: number
  /** Same score as 0–100 for UI meters. */
  councilFamilyConfidencePercent?: number
  /** Single-family research accounting for this response (Phase 6). */
  liveResearchTurnSurvey?: {
    wave: 'single'
    expectedFamilies: CouncilOrchestrationFamily[]
    roster: Partial<
      Record<
        CouncilOrchestrationFamily,
        'pending' | 'responding' | 'complete' | 'failed' | 'timed_out' | 'partial' | 'truncated'
      >
    >
  }
  /** Commander diagnostic runtime trace. Present only when explicitly requested. */
  councilTrace?: CouncilRuntimeTraceSnapshot
  /** Phase 48-C3A: real family-to-family deliberation artifact. */
  familyDeliberation?: DeliberationSession
  /** Phase 48-C3B2: advisory-only shadow recommendation metadata, never used for execution. */
  shadowCouncilAssembly?: CouncilShadowSelectionReport
}

export async function postCouncilChat(
  body: CouncilChatRequestBody,
  signal?: AbortSignal,
): Promise<{ res: Response; data: CouncilChatJson }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  let data: CouncilChatJson = {}
  try {
    data = (await res.json()) as CouncilChatJson
  } catch {
    data = {}
  }
  return { res, data }
}

/** Expansion / cost-guard branch before a council round (matches home `ExpansionPrompt`). */
export type LiveCouncilExpansionPayload = {
  decree: string
  extraCost: number
  reason: string
  urgent: boolean
}

export async function sendLiveCouncilThroneMessage(args: {
  rawInput: string
  isBusy: () => boolean
  clearDraft: () => void
  detectExpansion: (decree: string) => LiveCouncilExpansionPayload | null
  onExpansionQueued: (decree: string, expansion: LiveCouncilExpansionPayload) => void
  sendDecree: (decree: string) => Promise<void>
}): Promise<void> {
  const decree = args.rawInput.trim()
  if (!decree || args.isBusy()) return
  args.clearDraft()
  const expansion = args.detectExpansion(decree)
  if (expansion) {
    args.onExpansionQueued(decree, expansion)
    return
  }
  await args.sendDecree(decree)
}
