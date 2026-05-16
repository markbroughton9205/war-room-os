import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  buildIntelligenceGroundingBlock,
  type IntelligencePacket,
} from '@/lib/intelligence/intelligencePacket'

export type FamilyIntelligenceFrame = {
  family: CouncilOrchestrationFamily
  packet: IntelligencePacket
  framing: string
  prompt_block: string
}

const FAMILY_FRAMING: Partial<Record<CouncilOrchestrationFamily, string>> = {
  chatgpt: 'Synthesize the answer directly from evidence. For local questions, summarize verified vs emerging local layers before any requested strategic interpretation.',
  claude: 'Check structural plausibility, feasibility, local infrastructure constraints, and evidence gaps without expanding beyond the decree.',
  grok: 'Read signal velocity, trend acceleration, and emerging local radar, but label social velocity and realtime interpretation as unverified unless packet evidence supports it.',
  gemini: 'Cross-reference local ecosystem relationships, categories, source overlap, and corroboration patterns while separating evidence from inference.',
  red_team: 'Flag rumor risk, manipulation, unsupported certainty, invented locality assumptions, mission-overfitting, evidence inflation, weak-signal overstatement, stale evidence, contradictions, and narrative inflation.',
  baby: 'Observe pattern drift, tone, unresolved loops, and whether the packet suggests a memory proposal.',
  kimi: 'Decompose the packet into task sequence, dependencies, and retrieval gaps.',
  bridge_architect: 'Map packet implications across systems, interfaces, handoffs, and integration risk.',
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
    prompt_block: [
      buildIntelligenceGroundingBlock(packet, family),
      '',
      `### ${family} analysis frame`,
      `- ${framing}`,
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
