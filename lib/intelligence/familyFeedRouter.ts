import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  buildIntelligenceGroundingBlock,
  type IntelligencePacket,
} from '@/lib/intelligence/intelligencePacket'

export type FamilyIntelligenceFrame = {
  family: CouncilOrchestrationFamily
  packet: IntelligencePacket
  framing: string
  expansion_lane: string
  prompt_block: string
}

const FAMILY_FRAMING: Partial<Record<CouncilOrchestrationFamily, string>> = {
  chatgpt: 'Executive lane: brief prioritized meaning, what matters first, and source-backed operational interpretation only when useful.',
  claude: 'Systems lane: infrastructure, public services, feasibility, civic/structural implications, and practical constraints.',
  grok: 'Signal lane: breaking movement, local chatter, weak signals, social velocity, and emerging narratives with uncertainty labels.',
  gemini: 'Pattern lane: cross-source patterns, event clustering, historical/contextual relationships, and ecosystem mapping.',
  red_team: 'Risk lane: contradictions, unsupported claims, manipulation risk, source weakness, public safety concerns, and narrative inflation.',
  baby: 'Observe pattern drift, tone, unresolved loops, and whether the packet suggests a memory proposal.',
  kimi: 'Decompose the packet into task sequence, dependencies, and retrieval gaps.',
  bridge_architect: 'Map packet implications across systems, interfaces, handoffs, and integration risk.',
}

const FAMILY_EXPANSION_LANES: Partial<Record<CouncilOrchestrationFamily, string>> = {
  chatgpt: 'May request source-backed executive prioritization follow-up; do not request broad recrawls.',
  claude: 'May request source-backed public systems / city infrastructure follow-up.',
  grok: 'May request source-backed weak signal / social chatter follow-up.',
  gemini: 'May request source-backed historical or cross-reference follow-up.',
  red_team: 'May request source-backed contradiction, reliability, or manipulation-risk follow-up.',
}

export function buildFamilyIntelligenceFrame(
  packet: IntelligencePacket,
  family: CouncilOrchestrationFamily,
): FamilyIntelligenceFrame {
  const framing = FAMILY_FRAMING[family] ?? 'Analyze this shared intelligence packet through the family role.'
  return {
    family,
    packet,
    framing,
    expansion_lane: FAMILY_EXPANSION_LANES[family] ?? 'No specialized expansion lane configured.',
    prompt_block: [
      buildIntelligenceGroundingBlock(packet, family),
      '',
      `### ${family} analysis frame`,
      `- ${framing}`,
      `- Specialized expansion lane: ${FAMILY_EXPANSION_LANES[family] ?? 'Use the shared packet only.'}`,
      '- Do not repeat the same event list as other families; add value from your lane.',
      '- If Commander environment context is supplied, use weather, local alerts, headlines, or source health only when relevant to the decree.',
      '- Do not claim private live awareness. Use only the packet plus explicitly provided thread context.',
      '- Keep visible provenance compact when answering: source count, freshness, confidence, and a short source preview when available.',
      '- Separate evidence from inference. Do not treat weak signals as operational truth.',
      '- For local questions, distinguish Verified, Emerging, Local chatter, Contradictions, and Unknowns. Never invent neighborhood facts, live crime, or current events not present in the packet.',
      '- If mandatory retrieval failed or has gaps, disclose that before synthesis and do not fill current/live facts from training memory.',
      '- Do not answer current facts unless present in packet evidence.',
      '- Avoid Commander mission/business/philosophy framing unless the decree explicitly asks for it.',
    ].join('\n'),
  }
}

export function routeIntelligenceToFamilies(
  packet: IntelligencePacket,
  families: CouncilOrchestrationFamily[],
): FamilyIntelligenceFrame[] {
  return families.map(family => buildFamilyIntelligenceFrame(packet, family))
}
