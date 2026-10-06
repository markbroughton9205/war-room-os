/**
 * Evidence-Board mission classifier.
 * Composes existing classifyCouncilTurn + classifyMission + classifyAstraIntent.
 * Deterministic-first. Does not invent a competing keyword engine.
 */
import { classifyMission } from '@/lib/council/adaptive-assembly/missionClassification'
import type { MissionClassificationKind } from '@/lib/council/adaptive-assembly/types'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { classifyAstraIntent, type AstraIntent } from '@/lib/council/nebula/roundFlow'
import { isWarRoomRuntimeStatusDecree } from '@/lib/council/nebula/runtimeStatus'
import { selectAgentsForMission } from '@/lib/council/gi/agentSelectionPolicy'
import {
  DEFAULT_PHOENIX_HARD_PASSES,
  type AssemblyPlanV1,
  type EbcAgentId,
  type EbcCapability,
  type EbcMissionClass,
  type EbcParticipationPreset,
  type EvidenceRequirementLayer,
  type MissionClassifierOutput,
} from './types'

const SYSTEM_STATUS_PROMPT =
  /(?:status\s+on\s+(?:the\s+)?war\s*room|(?:war\s*room|runtime)\s+status|system\s+health|status\s+summary\s+of\s+(?:the\s+)?war\s*room)/i

const INCIDENT =
  /\b(outage|incident|down|degraded|on fire|p[0-9]\s*incident|sev[0-9]|rollback|failed health|not responding)\b/i

const ARCHITECTURE =
  /\b(architecture review|system design|data model|interface contract|module boundary|repo architecture)\b/i

const DOCUMENT =
  /\b(document analysis|analyze (?:this|the) (?:pdf|doc|document|file|schema)|normalize (?:this|the) (?:table|json|csv))\b/i

const ENGINEERING_EXECUTE =
  /\b(implement|build|ship|commit|push|deploy|foundry|write code|make the change)\b/i

const CONVERSATIONAL_COUNCIL =
  /\b(what can you help|what can you do|how are you functioning|summarize what we|current operational status)\b/i

let missionSeq = 0

export function createMissionId(now = Date.now()): string {
  missionSeq += 1
  return `ebc-${now.toString(36)}-${missionSeq.toString(36)}`
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

const NEWS_INTEL =
  /\b(headlines?|breaking|world news|current events?|going on with the world|live news)\b/i
const STRUCTURED_RESEARCH =
  /\b(research|investigate|primary sources?|documentation|official docs?|playwright|browsercontext|cite)\b/i

function isDeepResearchAsk(
  text: string,
  turn: ReturnType<typeof classifyCouncilTurn>,
  adaptiveKind: MissionClassificationKind,
): boolean {
  if (NEWS_INTEL.test(text)) return false
  if (!STRUCTURED_RESEARCH.test(text)) return false
  return turn.shouldResearch || turn.intent === 'RESEARCH_REQUEST' || turn.intent === 'FRESHNESS_SENSITIVE' || adaptiveKind === 'research'
}

function mapAdaptiveToEbc(kind: MissionClassificationKind, astra: AstraIntent, text: string): EbcMissionClass | null {
  if (kind === 'current_intelligence') return 'CURRENT_INTEL'
  if (kind === 'engineering' && ARCHITECTURE.test(text)) return 'ARCHITECTURE_REVIEW'
  if (kind === 'engineering') return 'ENGINEERING'
  if (kind === 'research') return 'DEEP_RESEARCH'
  if (astra === 'ENGINEERING') return 'ENGINEERING'
  if (astra === 'RESEARCH' || astra === 'VERIFICATION') return 'DEEP_RESEARCH'
  return null
}

export function classifyEvidenceBoardMission(input: {
  commanderMessage: string
  missionId?: string
  now?: number
}): MissionClassifierOutput {
  const text = typeof input.commanderMessage === 'string' ? input.commanderMessage.trim() : ''
  const turn = classifyCouncilTurn(text)
  const adaptive = classifyMission({ commanderMessage: text })
  const astra = classifyAstraIntent(text)
  const mission_id = input.missionId ?? createMissionId(input.now ?? Date.now())
  const uncertainty_flags = [...adaptive.uncertaintyFlags]
  let mission_class: EbcMissionClass
  let confidence = 0.72
  let llm_classification_used = false

  if (turn.intent === 'SOCIAL_CHECKIN' || (turn.intent === 'GREETING' && turn.depth === 'FAST' && text.length < 80 && !SYSTEM_STATUS_PROMPT.test(text))) {
    mission_class = 'SOCIAL_CHECKIN'
    confidence = turn.intent === 'SOCIAL_CHECKIN' ? 0.97 : 0.9
  } else if (
    turn.intent === 'STATUS_CHECK'
    || astra === 'STATUS_CHECK'
    || SYSTEM_STATUS_PROMPT.test(text)
    || isWarRoomRuntimeStatusDecree(text)
  ) {
    mission_class = 'SYSTEM_STATUS'
    confidence = 0.93
  } else if (
    CONVERSATIONAL_COUNCIL.test(text)
    && !STRUCTURED_RESEARCH.test(text)
    && !SYSTEM_STATUS_PROMPT.test(text)
    && !isWarRoomRuntimeStatusDecree(text)
  ) {
    mission_class = 'SOCIAL_CHECKIN'
    confidence = 0.88
    uncertainty_flags.push('conversational_council_turn')
  } else if (INCIDENT.test(text)) {
    mission_class = 'INCIDENT_RESPONSE'
    confidence = 0.88
  } else if (DOCUMENT.test(text)) {
    mission_class = 'DOCUMENT_ANALYSIS'
    confidence = 0.86
  } else if (ARCHITECTURE.test(text) || (adaptive.missionClassification === 'engineering' && /\barchitecture\b/i.test(text) && !ENGINEERING_EXECUTE.test(text))) {
    mission_class = 'ARCHITECTURE_REVIEW'
    confidence = 0.84
  } else if (isDeepResearchAsk(text, turn, adaptive.missionClassification)) {
    mission_class = 'DEEP_RESEARCH'
    confidence = 0.82
  } else if (turn.intent === 'TIME_SENSITIVE' || turn.intent === 'FRESHNESS_SENSITIVE' || adaptive.missionClassification === 'current_intelligence') {
    mission_class = 'CURRENT_INTEL'
    confidence = 0.86
  } else if (turn.shouldResearch || turn.intent === 'RESEARCH_REQUEST' || adaptive.missionClassification === 'research') {
    mission_class = 'DEEP_RESEARCH'
    confidence = 0.82
  } else if (adaptive.missionClassification === 'engineering' || astra === 'ENGINEERING' || ENGINEERING_EXECUTE.test(text)) {
    mission_class = 'ENGINEERING'
    confidence = 0.84
    } else {
      const mapped = mapAdaptiveToEbc(adaptive.missionClassification, astra, text)
      if (mapped) {
        mission_class = mapped
        confidence = 0.7
        uncertainty_flags.push('composed_from_adaptive_kind')
      } else if (
        !turn.shouldResearch
        && (
          turn.intent === 'GREETING'
          || turn.intent === 'FOLLOW_UP'
          || (turn.intent === 'KNOWLEDGE_QUESTION' && turn.depth === 'FAST')
          || CONVERSATIONAL_COUNCIL.test(text)
        )
      ) {
        mission_class = 'SOCIAL_CHECKIN'
        confidence = 0.78
        uncertainty_flags.push('conversational_council_turn')
      } else {
        mission_class = turn.depth === 'FAST' ? 'SOCIAL_CHECKIN' : 'DEEP_RESEARCH'
        confidence = 0.55
        uncertainty_flags.push('low_signal_ebc_class')
        // Deterministic conservative default — LLM classification is authorized only if
        // still ambiguous AND a caller injects it. This path does not call providers.
        llm_classification_used = false
      }
    }

  const assembly = assemblyForClass(mission_class, mission_id, text, uncertainty_flags)
  return Object.freeze({
    ...assembly,
    confidence,
    source: 'composed_existing',
    turn_intent: turn.intent,
    adaptive_kind: adaptive.missionClassification,
    astra_intent: astra,
    llm_classification_used,
  })
}

/** EBC is the Council source of truth. Scout swarm may gather for DEEP_RESEARCH but cannot be SoT. */
export function shouldDispatchEvidenceBoardCouncil(missionClass: EbcMissionClass): boolean {
  return (
    missionClass === 'SYSTEM_STATUS'
    || missionClass === 'SOCIAL_CHECKIN'
    || missionClass === 'INCIDENT_RESPONSE'
    || missionClass === 'ENGINEERING'
    || missionClass === 'ARCHITECTURE_REVIEW'
    || missionClass === 'DOCUMENT_ANALYSIS'
    || missionClass === 'CURRENT_INTEL'
    || missionClass === 'DEEP_RESEARCH'
  )
}

/**
 * Home always asks for family deliberation. Status and deep research still
 * finish through the existing Evidence Board mission, then one Aurora final.
 * Other classes keep the seat loop.
 */
export function evidenceBoardTerminatesFamilyRequest(missionClass: EbcMissionClass): boolean {
  return missionClass === 'SYSTEM_STATUS' || missionClass === 'DEEP_RESEARCH'
}

export function assemblyForClass(
  mission_class: EbcMissionClass,
  mission_id: string,
  text: string,
  extraFlags: readonly string[] = [],
): AssemblyPlanV1 {
  const wantsInventory = /\b(inventory|normalize|tabulate|schema|ports dump|entity resolve)\b/i.test(text)
  const wantsExternal = /\b(browser|web|external|internet|terra live|news|today)\b/i.test(text)
  const uncertainty_flags = [...extraFlags]
  let selected_agents: EbcAgentId[]
  let required_tools: string[]
  let optional_tools: string[] = []
  let required_capabilities: EbcCapability[]
  let evidence_requirement: EvidenceRequirementLayer
  let ttl_seconds = 300
  let participation_preset: EbcParticipationPreset = 'standard'
  let budget_tokens = 80_000
  let budget_ms = 90_000
  let phoenix_required = true
  let aurora_required = true

  switch (mission_class) {
    case 'SOCIAL_CHECKIN':
      selected_agents = ['AURORA']
      required_tools = []
      required_capabilities = ['presence']
      evidence_requirement = 'NONE'
      ttl_seconds = 30
      participation_preset = 'focused'
      budget_tokens = 4_000
      budget_ms = 12_000
      phoenix_required = false
      aurora_required = false
      break
    case 'SYSTEM_STATUS':
      selected_agents = ['ORION', 'LUMEN', 'PHOENIX', 'AURORA']
      if (wantsInventory) selected_agents.splice(2, 0, 'NOVA')
      if (wantsExternal) selected_agents.splice(1, 0, 'PULSAR')
      required_tools = ['wr.core.health', 'wr.ui.health', 'wr.ports.list', 'wr.council.backend']
      if (wantsExternal) required_tools.push('wr.broker.status')
      optional_tools = ['wr.git.branch', 'wr.broker.status']
      required_capabilities = ['ops_probe', 'verification', 'adversarial_review', 'synthesis']
      evidence_requirement = 'CURRENT_LIVE'
      ttl_seconds = 120
      participation_preset = 'focused'
      budget_tokens = 50_000
      budget_ms = 45_000
      break
    case 'CURRENT_INTEL':
      selected_agents = ['PULSAR', 'LUMEN', 'AURORA']
      if (wantsInventory) selected_agents.splice(2, 0, 'NOVA')
      selected_agents.splice(selected_agents.indexOf('AURORA'), 0, 'PHOENIX')
      required_tools = ['broker.fetch']
      optional_tools = ['wr.broker.status']
      required_capabilities = ['live_intel', 'verification', 'synthesis']
      evidence_requirement = 'CURRENT_LIVE'
      ttl_seconds = 180
      participation_preset = 'standard'
      budget_tokens = 120_000
      budget_ms = 120_000
      break
    case 'DEEP_RESEARCH':
      selected_agents = ['ORION', 'PULSAR', 'LUMEN', 'PHOENIX', 'AURORA']
      required_tools = ['broker.fetch']
      required_capabilities = ['live_intel', 'planning', 'verification', 'adversarial_review', 'synthesis']
      evidence_requirement = 'CURRENT_LIVE'
      ttl_seconds = 600
      participation_preset = 'comprehensive'
      budget_tokens = 220_000
      budget_ms = 180_000
      break
    case 'ARCHITECTURE_REVIEW':
      selected_agents = ['ORION', 'NOVA', 'PHOENIX', 'AURORA']
      required_tools = ['wr.git.branch']
      optional_tools = ['wr.core.health']
      required_capabilities = ['planning', 'structure', 'adversarial_review', 'synthesis']
      evidence_requirement = 'LAST_VERIFIED'
      ttl_seconds = 300
      break
    case 'INCIDENT_RESPONSE':
      selected_agents = ['ORION', 'LUMEN', 'PHOENIX', 'AURORA']
      if (wantsExternal) selected_agents.splice(1, 0, 'PULSAR')
      required_tools = ['wr.core.health', 'wr.ui.health', 'wr.ports.list', 'wr.council.backend']
      required_capabilities = ['ops_probe', 'verification', 'adversarial_review', 'synthesis']
      evidence_requirement = 'CURRENT_LIVE'
      ttl_seconds = 90
      participation_preset = 'focused'
      budget_ms = 40_000
      break
    case 'ENGINEERING':
      selected_agents = ['ORION', 'NOVA', 'PHOENIX', 'AURORA']
      required_tools = ['wr.git.branch']
      required_capabilities = ['planning', 'structure', 'adversarial_review', 'synthesis']
      evidence_requirement = 'LAST_VERIFIED'
      ttl_seconds = 300
      break
    case 'DOCUMENT_ANALYSIS':
      selected_agents = ['NOVA', 'LUMEN', 'PHOENIX', 'AURORA']
      required_tools = []
      required_capabilities = ['structure', 'document_analysis', 'verification', 'synthesis']
      evidence_requirement = 'LAST_VERIFIED'
      ttl_seconds = 300
      break
  }

  if (mission_class !== 'SYSTEM_STATUS' && mission_class !== 'INCIDENT_RESPONSE' && mission_class !== 'SOCIAL_CHECKIN') {
    const selection = selectAgentsForMission({
      mission_class,
      text,
      structured_data: wantsInventory,
      source_freshness: evidence_requirement === 'CURRENT_LIVE' ? 'live' : 'stale_ok',
      conflict_probability: phoenix_required ? 'med' : 'low',
    })
    selected_agents = selection.selected_agents
    phoenix_required = selection.phoenix_required
    aurora_required = selection.aurora_required
  }

  return Object.freeze({
    mission_id,
    mission_class,
    selected_agents: unique(selected_agents),
    required_tools,
    optional_tools,
    evidence_requirement,
    ttl_seconds,
    participation_preset,
    budget_tokens,
    budget_ms,
    phoenix_required,
    aurora_required,
    phoenix_max_hard_passes: phoenix_required ? DEFAULT_PHOENIX_HARD_PASSES : 0,
    max_substantive_rounds: 2,
    required_capabilities,
    uncertainty_flags: unique(uncertainty_flags),
  })
}
