import type { CouncilSessionIntelligenceV1 } from './types'
import { COUNCIL_SESSION_INTELLIGENCE_VERSION } from './types'

export function parseSessionIntelligence(raw: unknown): CouncilSessionIntelligenceV1 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== COUNCIL_SESSION_INTELLIGENCE_VERSION) return null
  if (typeof obj.conversationId !== 'string' || !obj.conversationId.trim()) return null
  if (!Array.isArray(obj.rounds)) return null
  return obj as unknown as CouncilSessionIntelligenceV1
}

export function readSessionIntelligenceFromMetadata(
  metadata: unknown,
): CouncilSessionIntelligenceV1 | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const council = (metadata as Record<string, unknown>).council
  if (!council || typeof council !== 'object' || Array.isArray(council)) return null
  const raw = (council as Record<string, unknown>).sessionIntelligence
  return parseSessionIntelligence(raw)
}

export function embedSessionIntelligenceInMetadata(
  existingMetadata: Record<string, unknown> | null | undefined,
  intelligence: CouncilSessionIntelligenceV1,
): Record<string, unknown> {
  const prev = existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)
    ? { ...existingMetadata }
    : {}
  const prevCouncil = prev.council && typeof prev.council === 'object' && !Array.isArray(prev.council)
    ? { ...(prev.council as Record<string, unknown>) }
    : {}
  return {
    ...prev,
    council: {
      ...prevCouncil,
      sessionIntelligence: intelligence,
    },
  }
}
