/**
 * Cognitive strategy selector. Not every mission uses the same reasoning shape.
 * Does not grant authority. Does not replace EBC classification.
 */

import type { EbcMissionClass } from '@/lib/council/evidence-board/types'
import type { IntelligenceMissionClass } from './types'
import type { CognitiveStrategy, CognitiveStrategyId, DeliberationPolicy, MissionBudget } from './orchestrationTypes'

const EXPLAIN = /^(explain|what is|what's|define|how does)\b|\bexplain (http|this)\b/i
const DIAGNOSE = /\b(crash|crashing|failing|broken|why (?:are|is|does)|investigate the likely cause|root cause|diagnose)\b/i
const RESEARCH = /\bresearch\b|\bprimary sources?\b|\bcurrent (?:mixture|sparse|playwright|docs)\b/i
const COMPARE = /\b(should (?:we|war room|council|i)|compare|versus|\bvs\.?\b|or hybrid|option a|option b)\b/i
const DESIGN = /\bdesign\b|\bsparse experts\b|\bsovereign inference\b|\bbest way for wrim\b/i
const REVIEW = /\b(audit|review this|consequences of letting|risk review|review of council)\b/i
const PLAN = /\bplan how\b|\bwithout changing code\b|\bengineering plan\b|\bplan atlas\b|\bplan a foundry\b/i
const THANKS = /^(thanks|thank you|good morning|hello|hi\b|that is all)\b/i
const IDENTITY = /\bwhat install\b|\bowns 3847\b|\bruntime owns\b/i
const INCIDENT = /\bincident\b|\bproduction (?:down|outage)\b/i
const DOCUMENT = /\b(spreadsheet|csv|normalize this document|tabulate)\b/i
const DATA = /\b(quant|compute|decision matrix|ports dump)\b/i
const VERIFY = /\bverify\b|\bprove\b|\bacceptance\b/i
const DEBATE = /\bdisagree\b|\bconflicting evidence\b|\badversarial\b/i
const SIMULATE = /\bsimulat|\bcounterfactual\b|\bwhat if\b/i
const HTTP_SIMPLE = /\bexplain http\b/i

export function parseCommanderBudget(text: string): MissionBudget {
  if (/\b(exhaustive|maximum|max budget|go as deep as needed)\b/i.test(text)) return 'MAXIMUM'
  if (/\b(deep|thorough|in-depth|research thoroughly)\b/i.test(text)) return 'DEEP'
  if (/\b(quick|fast|cheap|briefly|\bbrief\b)\b/i.test(text)) return 'FAST'
  if (/\b(normal|standard)\b/i.test(text)) return 'STANDARD'
  return 'STANDARD'
}

export function selectCognitiveStrategy(input: {
  text: string
  intelligenceClass: IntelligenceMissionClass
  ebcClass: EbcMissionClass
}): CognitiveStrategy {
  const text = input.text.trim()
  const id = strategyId(text, input.intelligenceClass, input.ebcClass)
  return strategyFor(id, text)
}

function strategyId(text: string, intel: IntelligenceMissionClass, ebc: EbcMissionClass): CognitiveStrategyId {
  if (intel === 'SOCIAL_CHECKIN' || ebc === 'SOCIAL_CHECKIN') return 'DIRECT'
  if (intel === 'SYSTEM_STATUS') return 'VERIFY'
  if (THANKS.test(text) || (text.length < 48 && /thanks|that is all|good morning|^hello$/i.test(text))) return 'DIRECT'
  if (IDENTITY.test(text)) return 'VERIFY'
  if (HTTP_SIMPLE.test(text) || (EXPLAIN.test(text) && text.length < 80 && !RESEARCH.test(text) && !DIAGNOSE.test(text))) return 'DIRECT'
  if (DATA.test(text)) return 'DATA_ANALYSIS'
  if (intel === 'DOCUMENT_ANALYSIS' || DOCUMENT.test(text)) return 'DOCUMENT_ANALYSIS'
  if (intel === 'INCIDENT_RESPONSE' || INCIDENT.test(text) || DIAGNOSE.test(text)) {
    return INCIDENT.test(text) && !DIAGNOSE.test(text) ? 'INCIDENT_RESPONSE' : 'DIAGNOSE'
  }
  if (intel === 'DECISION_SUPPORT' || intel === 'ANALYTICAL_COMPARISON' || COMPARE.test(text)) return 'COMPARE'
  if (intel === 'RISK_REVIEW' || (REVIEW.test(text) && !DESIGN.test(text) && !COMPARE.test(text))) return 'REVIEW'
  if (intel === 'ARCHITECTURE_REVIEW' || DESIGN.test(text)) return 'DESIGN'
  if (intel === 'ENGINEERING_MISSION' || PLAN.test(text)) return 'PLAN'
  if (DEBATE.test(text) || /\bconflicting evidence\b|\bdo not invent consensus\b/i.test(text)) return 'DEBATE'
  if (SIMULATE.test(text)) return 'SIMULATE'
  if (/\bdecompose\b/i.test(text)) return 'DECOMPOSE'
  if (intel === 'DEEP_RESEARCH' || intel === 'CURRENT_INTEL' || RESEARCH.test(text)) {
    if (!VERIFY.test(text) || RESEARCH.test(text)) return 'RESEARCH'
  }
  if (VERIFY.test(text)) return 'VERIFY'
  return 'DECOMPOSE'
}

function strategyFor(id: CognitiveStrategyId, text: string): CognitiveStrategy {
  const runtime = /\b(runtime|install|3847|3848|council|war room|ollama|local general)\b/i.test(text)
  const base = (partial: Omit<CognitiveStrategy, 'id' | 'reason'> & { reason?: string }): CognitiveStrategy => ({
    id,
    reason: partial.reason ?? `strategy ${id}`,
    ...partial,
  })

  switch (id) {
    case 'DIRECT':
      return base({
        planning_depth: 'NONE',
        evidence_requirement: 'NONE',
        seat_mix: ['AURORA'],
        tool_expectation: 'NONE',
        verification_depth: 'NONE',
        scenario_requirement: false,
        adversarial_requirement: 'NONE',
        replanning_threshold: 'NEVER',
        runtime_knowledge: false,
        deliberation: 'NONE',
        reason: 'Casual/direct answer. No orchestration explosion.',
      })
    case 'DIAGNOSE':
      return base({
        planning_depth: 'SHALLOW',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'LUMEN', 'AURORA'],
        tool_expectation: 'DIAGNOSTIC',
        verification_depth: 'MATERIAL',
        scenario_requirement: false,
        adversarial_requirement: 'THRESHOLD',
        replanning_threshold: 'ON_CONTRADICTION',
        runtime_knowledge: true,
        deliberation: 'SPECIALIST_REVIEW',
        reason: 'Hypothesis-driven diagnosis. Discriminating probes over shotgun tools.',
      })
    case 'RESEARCH':
      return base({
        planning_depth: 'SHALLOW',
        evidence_requirement: 'MULTI_SOURCE',
        seat_mix: ['PULSAR', 'ORION', 'LUMEN', 'AURORA'],
        tool_expectation: 'RESEARCH',
        verification_depth: 'MATERIAL',
        scenario_requirement: false,
        adversarial_requirement: 'THRESHOLD',
        replanning_threshold: 'ON_FAILURE',
        runtime_knowledge: false,
        deliberation: 'SPECIALIST_REVIEW',
        reason: 'PULSAR-led current sources. PHOENIX only if thin/conflict.',
      })
    case 'COMPARE':
      return base({
        planning_depth: 'FULL',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'LUMEN', 'AURORA'],
        tool_expectation: 'PROBE',
        verification_depth: 'MATERIAL',
        scenario_requirement: true,
        adversarial_requirement: 'THRESHOLD',
        replanning_threshold: 'ON_CONTRADICTION',
        runtime_knowledge: runtime,
        deliberation: 'ADVERSARIAL',
        reason: 'JANUS comparison. Facts need evidence. No unsupported FACT.',
      })
    case 'DESIGN':
      return base({
        planning_depth: 'FULL',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'LUMEN', 'AURORA'],
        tool_expectation: 'PROBE',
        verification_depth: 'MATERIAL',
        scenario_requirement: true,
        adversarial_requirement: 'THRESHOLD',
        replanning_threshold: 'ON_CONTRADICTION',
        runtime_knowledge: runtime,
        deliberation: 'ADVERSARIAL',
        reason: 'Architecture design: ATLAS + JANUS + SENTINEL + AURORA.',
      })
    case 'PLAN':
      return base({
        planning_depth: 'FULL',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'NOVA', 'AURORA'],
        tool_expectation: 'NONE',
        verification_depth: 'MATERIAL',
        scenario_requirement: false,
        adversarial_requirement: 'NONE',
        replanning_threshold: 'ON_FAILURE',
        runtime_knowledge: false,
        deliberation: 'PAIR_CHECK',
        reason: 'Engineering plan. No mutation.',
      })
    case 'REVIEW':
      return base({
        planning_depth: 'SHALLOW',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'PHOENIX', 'AURORA'],
        tool_expectation: 'NONE',
        verification_depth: 'MATERIAL',
        scenario_requirement: false,
        adversarial_requirement: 'ALWAYS',
        replanning_threshold: 'NEVER',
        runtime_knowledge: false,
        deliberation: 'ADVERSARIAL',
        reason: 'SENTINEL-led risk review. PHOENIX challenges claims. Authority preserved.',
      })
    case 'VERIFY':
      return base({
        planning_depth: 'NONE',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'LUMEN', 'AURORA'],
        tool_expectation: 'PROBE',
        verification_depth: 'FULL',
        scenario_requirement: false,
        adversarial_requirement: 'THRESHOLD',
        replanning_threshold: 'ON_FAILURE',
        runtime_knowledge: true,
        deliberation: 'PAIR_CHECK',
        reason: 'Live telemetry verification.',
      })
    case 'INCIDENT_RESPONSE':
      return base({
        planning_depth: 'FULL',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'LUMEN', 'PHOENIX', 'AURORA'],
        tool_expectation: 'DIAGNOSTIC',
        verification_depth: 'MATERIAL',
        scenario_requirement: false,
        adversarial_requirement: 'ALWAYS',
        replanning_threshold: 'ON_CONTRADICTION',
        runtime_knowledge: true,
        deliberation: 'ADVERSARIAL',
      })
    case 'DOCUMENT_ANALYSIS':
      return base({
        planning_depth: 'NONE',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['NOVA', 'LUMEN', 'AURORA'],
        tool_expectation: 'NONE',
        verification_depth: 'MATERIAL',
        scenario_requirement: false,
        adversarial_requirement: 'NONE',
        replanning_threshold: 'NEVER',
        runtime_knowledge: false,
        deliberation: 'PAIR_CHECK',
        reason: 'NOVA + LUMEN. Not a six-agent meeting.',
      })
    case 'DATA_ANALYSIS':
      return base({
        planning_depth: 'NONE',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['NOVA', 'LUMEN', 'AURORA'],
        tool_expectation: 'PROBE',
        verification_depth: 'FULL',
        scenario_requirement: false,
        adversarial_requirement: 'NONE',
        replanning_threshold: 'NEVER',
        runtime_knowledge: false,
        deliberation: 'PAIR_CHECK',
      })
    case 'DEBATE':
      return base({
        planning_depth: 'SHALLOW',
        evidence_requirement: 'MULTI_SOURCE',
        seat_mix: ['ORION', 'LUMEN', 'PHOENIX', 'AURORA'],
        tool_expectation: 'PROBE',
        verification_depth: 'FULL',
        scenario_requirement: false,
        adversarial_requirement: 'ALWAYS',
        replanning_threshold: 'ON_CONTRADICTION',
        runtime_knowledge: false,
        deliberation: 'ADVERSARIAL',
      })
    case 'SIMULATE':
      return base({
        planning_depth: 'FULL',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'AURORA'],
        tool_expectation: 'NONE',
        verification_depth: 'MATERIAL',
        scenario_requirement: true,
        adversarial_requirement: 'THRESHOLD',
        replanning_threshold: 'ON_CONTRADICTION',
        runtime_knowledge: false,
        deliberation: 'SPECIALIST_REVIEW',
      })
    case 'DECOMPOSE':
      return base({
        planning_depth: 'FULL',
        evidence_requirement: 'BOUNDED',
        seat_mix: ['ORION', 'LUMEN', 'AURORA'],
        tool_expectation: 'PROBE',
        verification_depth: 'MATERIAL',
        scenario_requirement: false,
        adversarial_requirement: 'THRESHOLD',
        replanning_threshold: 'ON_FAILURE',
        runtime_knowledge: runtime,
        deliberation: 'SPECIALIST_REVIEW',
      })
  }
}

export function deliberationFor(strategy: CognitiveStrategy): DeliberationPolicy {
  return strategy.deliberation
}
