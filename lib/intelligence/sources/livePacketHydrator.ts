import {
  buildIntelligencePacket,
  type IntelligencePacket,
} from '@/lib/intelligence/intelligencePacket'
import type { RawIntelligenceSourceRecord } from '@/lib/intelligence/sourceNormalizer'
import type { RetrievalOrchestration } from '@/lib/intelligence/sources/retrievalOrchestrator'

export function hydrateLiveIntelligencePacket(args: {
  decree: string
  timestamp: string
  rawSources: RawIntelligenceSourceRecord[]
  unsupportedClaims?: string[]
  retrieval: RetrievalOrchestration
}): IntelligencePacket {
  return buildIntelligencePacket({
    decree: args.decree,
    timestamp: args.timestamp,
    rawSources: args.rawSources,
    unsupportedClaims: [
      ...(args.unsupportedClaims ?? []),
      ...args.retrieval.retrieval_gaps,
    ],
    retrieval: args.retrieval,
  })
}
