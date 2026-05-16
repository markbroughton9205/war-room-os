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
  chatgpt: 'Synthesize the answer directly from evidence. Add strategic interpretation only when the decree asks for it.',
  claude: 'Check feasibility, structure, implementation constraints, and evidence gaps without expanding beyond the decree.',
  grok: 'Read radar movement and weak/emerging signals, but label social velocity and realtime interpretation as unverified unless packet evidence supports it.',
  gemini: 'Cross-reference relationships, categories, and corroboration patterns while separating evidence from inference.',
  red_team: 'Flag unsupported certainty, invented locality assumptions, mission-overfitting, evidence inflation, weak-signal overstatement, stale evidence, contradictions, and narrative manipulation.',
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
