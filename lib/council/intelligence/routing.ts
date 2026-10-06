/**
 * Mission-class → intelligence-layer routing.
 * SOCIAL_CHECKIN and SYSTEM_STATUS stay cheap. Full stack is for architecture/engineering/research.
 */

import type { EbcMissionClass } from '@/lib/council/evidence-board/types'
import type { IntelligenceMissionClass, IntelligenceRouting } from './types'

const DECISION =
  /\b(should (?:we|council|i|war room)|compare(?: options)?|tradeoff|trade-off|option a|option b|versus|\bvs\.?\b|or keep|or hybrid|do nothing|immutable current-state|temporal records|architectural improvement)\b/i
const ARCHITECTURE_MISSION =
  /\b(architectural improvement|architecture review|system design|temporal records|immutable current-state)\b/i
const RISK_REVIEW =
  /\b(risk review|security review|operational risk|can this (?:plan )?harm|delete production|expose secrets|irreversible)\b/i
const ENGINEERING =
  /\b(implement|repair|restore council|fix|build|patch|engineering mission|startup)\b/i
const COMPLEX_RESEARCH =
  /\b(architecture|migration|provider choice|model architecture|infrastructure|multi-step|decompose)\b/i
const AUTO_DEPLOY = /\b(deploy automatically|automatic deploy|auto-deploy)\b/i
const DIAGNOSE_TEXT = /\b(screenshots? keep crashing|likely cause|root cause)\b/i
const DESIGN_MISSION = /\bdesign\b|\bsparse experts\b|\bsovereign inference\b|\bbest way for wrim\b/i

export function overlayIntelligenceClass(text: string, ebcClass: EbcMissionClass): IntelligenceMissionClass {
  if (ebcClass === 'SOCIAL_CHECKIN') return 'SOCIAL_CHECKIN'
  if (AUTO_DEPLOY.test(text) || (RISK_REVIEW.test(text) && !ENGINEERING.test(text))) return 'RISK_REVIEW'
  if (DIAGNOSE_TEXT.test(text) || ebcClass === 'INCIDENT_RESPONSE') return 'INCIDENT_RESPONSE'
  if (DESIGN_MISSION.test(text) && !DECISION.test(text) && !ENGINEERING.test(text)) return 'ARCHITECTURE_REVIEW'
  if (ARCHITECTURE_MISSION.test(text) || (DECISION.test(text) && /\b(or |versus|compare options|temporal|immutable|hybrid|local general)\b/i.test(text))) {
    return ARCHITECTURE_MISSION.test(text) && !DECISION.test(text) ? 'ARCHITECTURE_REVIEW' : 'DECISION_SUPPORT'
  }
  if (ENGINEERING.test(text)) return 'ENGINEERING_MISSION'
  if (ebcClass === 'SYSTEM_STATUS') return 'SYSTEM_STATUS'
  if (ebcClass === 'DOCUMENT_ANALYSIS') return 'DOCUMENT_ANALYSIS'
  if (ebcClass === 'CURRENT_INTEL') return 'CURRENT_INTEL'
  if (RISK_REVIEW.test(text) && !ENGINEERING.test(text)) return 'RISK_REVIEW'
  if (ebcClass === 'ARCHITECTURE_REVIEW' || (DECISION.test(text) && ebcClass !== 'DEEP_RESEARCH')) {
    if (DECISION.test(text)) return 'DECISION_SUPPORT'
    return 'ARCHITECTURE_REVIEW'
  }
  if (DECISION.test(text) && (ebcClass === 'DEEP_RESEARCH' || ebcClass === 'ENGINEERING')) {
    return ebcClass === 'ENGINEERING' ? 'DECISION_SUPPORT' : 'ANALYTICAL_COMPARISON'
  }
  if (ebcClass === 'ENGINEERING') return 'ENGINEERING_MISSION'
  if (ebcClass === 'DEEP_RESEARCH') return 'DEEP_RESEARCH'
  return 'DEEP_RESEARCH'
}

export function resolveIntelligenceRouting(input: {
  text: string
  ebcClass: EbcMissionClass
}): IntelligenceRouting {
  const intelligence_class = overlayIntelligenceClass(input.text, input.ebcClass)
  const complexResearch = intelligence_class === 'DEEP_RESEARCH' && COMPLEX_RESEARCH.test(input.text)
  const base: IntelligenceRouting = {
    intelligence_class,
    ebc_mission_class: input.ebcClass,
    mission_contract: 'full',
    atlas: false,
    janus: false,
    sentinel: false,
    ebc: true,
    orion: false,
    pulsar: false,
    lumen: false,
    phoenix: false,
    aurora: true,
    knowledge_graph: false,
    memory_gate: false,
    self_awareness: false,
    reason: '',
  }

  switch (intelligence_class) {
    case 'SOCIAL_CHECKIN':
      return Object.freeze({
        ...base,
        mission_contract: 'lightweight',
        ebc: true,
        aurora: true,
        reason: 'Presence only. No ATLAS/JANUS/SENTINEL.',
      })
    case 'SYSTEM_STATUS':
      return Object.freeze({
        ...base,
        mission_contract: 'lightweight',
        orion: true,
        lumen: true,
        phoenix: true,
        self_awareness: true,
        knowledge_graph: true,
        memory_gate: true,
        reason: 'Live telemetry required. No JANUS.',
      })
    case 'DEEP_RESEARCH':
      return Object.freeze({
        ...base,
        atlas: complexResearch,
        orion: true,
        pulsar: true,
        lumen: true,
        phoenix: true,
        knowledge_graph: true,
        memory_gate: true,
        reason: 'EBC research spine. ATLAS only if decomposition is warranted.',
      })
    case 'CURRENT_INTEL':
      return Object.freeze({
        ...base,
        pulsar: true,
        lumen: true,
        phoenix: true,
        memory_gate: true,
        reason: 'Live intel through EBC. No JANUS unless comparison overlay.',
      })
    case 'ENGINEERING_MISSION':
      return Object.freeze({
        ...base,
        atlas: true,
        sentinel: true,
        janus: DECISION.test(input.text),
        orion: true,
        lumen: true,
        phoenix: true,
        knowledge_graph: true,
        memory_gate: true,
        self_awareness: true,
        reason: 'Engineering needs plan + operational risk. JANUS only if alternatives exist.',
      })
    case 'ARCHITECTURE_REVIEW':
    case 'DECISION_SUPPORT':
    case 'ANALYTICAL_COMPARISON':
      return Object.freeze({
        ...base,
        atlas: true,
        janus: true,
        sentinel: true,
        orion: true,
        lumen: true,
        phoenix: true,
        knowledge_graph: true,
        memory_gate: true,
        self_awareness: true,
        reason: 'Decision/architecture comparison requires JANUS + PHOENIX. SENTINEL for operational risk. Bounded runtime snapshot when War Room state is in scope.',
      })
    case 'RISK_REVIEW':
      return Object.freeze({
        ...base,
        atlas: true,
        sentinel: true,
        phoenix: true,
        orion: true,
        knowledge_graph: true,
        memory_gate: true,
        reason: 'Risk review is SENTINEL-led. PHOENIX still challenges claims.',
      })
    case 'INCIDENT_RESPONSE':
      return Object.freeze({
        ...base,
        atlas: true,
        sentinel: true,
        orion: true,
        lumen: true,
        phoenix: true,
        self_awareness: true,
        knowledge_graph: true,
        memory_gate: true,
        reason: 'Incident needs live probes, plan, and operational risk.',
      })
    case 'DOCUMENT_ANALYSIS':
      return Object.freeze({
        ...base,
        lumen: true,
        phoenix: true,
        memory_gate: true,
        reason: 'Document analysis uses EBC structure/verification.',
      })
  }
}

export function isRationaleAsk(text: string): boolean {
  return /\bwhy did council (?:choose|pick|select) this plan\b|\bwhy this plan\b|\bexplain the plan\b/i.test(text)
}
