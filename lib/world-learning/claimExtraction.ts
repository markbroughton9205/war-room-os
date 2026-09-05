import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { ResearchDocumentLike } from './sourceRegistration'
import type { ClaimRecord, SourceVersion } from './types'

/** Deterministic Wave 3 extraction: split a source-authored summary into bounded declarative
 * sentences. This is deliberately not an LLM judgement. Every candidate retains the exact
 * SourceVersion reference and remains `candidate` until a separate verifier acts. */
export function extractClaimTexts(document: ResearchDocumentLike): string[] {
  const sourceText = (document.summary ?? document.title).trim()
  if (!sourceText) return []
  const sentences = sourceText
    .split(/(?<=[.!?])\s+/)
    .map(value => value.trim())
    .filter(value => value.length >= 20 && value.length <= 800)
    .slice(0, 8)
  return sentences.length ? sentences : [sourceText.slice(0, 800)]
}

export async function extractCandidateClaims(
  document: ResearchDocumentLike,
  sourceVersion: SourceVersion,
  projectId: string | null,
): Promise<ClaimRecord[]> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return []

  const claimTexts = extractClaimTexts(document)
  if (!claimTexts.length) return []

  const { data, error } = await sup.client
    .from('war_room_claim_records')
    .insert(claimTexts.map((claimText, index) => ({
      normalized_claim_text: claimText,
      claim_type: 'research_summary',
      confidence: 0.4,
      observed_at: document.retrievedAt,
      status: 'candidate',
      evidence_refs: [{ sourceVersionId: sourceVersion.id, relation: 'supports', note: 'source document summary' }],
      extraction_metadata: {
        method: 'deterministic_sentence_segmentation_v1',
        sentenceIndex: index,
        reviewed: false,
        sourceDocumentId: document.id,
        provider: document.provider,
      },
      project_id: projectId,
    })))
    .select('*')

  if (error || !data) return []
  return data as ClaimRecord[]
}

/** Compatibility boundary for callers that still expect the strongest first candidate. */
export async function extractCandidateClaim(
  document: ResearchDocumentLike,
  sourceVersion: SourceVersion,
  projectId: string | null,
): Promise<ClaimRecord | null> {
  return (await extractCandidateClaims(document, sourceVersion, projectId))[0] ?? null
}
