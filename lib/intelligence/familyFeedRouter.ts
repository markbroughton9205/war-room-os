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
  chatgpt: 'Analyze orchestration, synthesis, strategic direction, and operational meaning. Keep uncertainty labels intact.',
  claude: 'Analyze feasibility, architecture, implementation concerns, structural reasoning, and evidence gaps.',
  grok: 'Analyze radar movement, trend velocity, weak/emerging signals, realtime interpretation, and what must be verified next.',
  gemini: 'Analyze cross-reference relationships, ecosystem categorization, synthesis, and corroboration patterns.',
  red_team: 'Verify misinformation risk, contradictions, unsupported claims, overconfidence, stale evidence, and narrative manipulation.',
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
    ].join('\n'),
  }
}

export function routeIntelligenceToFamilies(
  packet: IntelligencePacket,
  families: CouncilOrchestrationFamily[],
): FamilyIntelligenceFrame[] {
  return families.map(family => buildFamilyIntelligenceFrame(packet, family))
}
