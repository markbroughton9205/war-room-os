import {
  CHUNKING_VERSION,
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_REVISION,
  RRF_K,
} from './types'

export const RETRIEVAL_PROFILE_VERSION = 'wr-retrieval-v4c.1'

export type SemanticAdmissionStrategy =
  | 'none'
  | 'min_cosine'
  | 'min_cosine_and_margin'
  | 'min_cosine_or_lexical'

export type RetrievalProfile = {
  profileVersion: string
  embeddingModel: string
  embeddingRevision: string
  chunkingVersion: string
  rrfK: number
  semanticAdmissionStrategy: SemanticAdmissionStrategy
  semanticThreshold: number
  semanticMarginThreshold: number | null
}

/**
 * Stage 4C production profile.
 *
 * Measured on BAAI/bge-small-en-v1.5 (xenova-onnx-q8, native ONNX CPU) against
 * labeled fixtures and the current live corpus. Cosine-only cannot keep the
 * mixed-topic fixture (0.545) and reject live biology hard-negative (0.603) at
 * once. 0.61 is the smallest two-decimal threshold above the highest labeled
 * live hard-negative (0.6032) that still admits the critical LIV paraphrase
 * (0.6438) and RFC 2606 (0.7432).
 */
export const PRODUCTION_RETRIEVAL_PROFILE: RetrievalProfile = {
  profileVersion: RETRIEVAL_PROFILE_VERSION,
  embeddingModel: LOCAL_EMBEDDING_MODEL_ID,
  embeddingRevision: LOCAL_EMBEDDING_REVISION,
  chunkingVersion: CHUNKING_VERSION,
  rrfK: RRF_K,
  semanticAdmissionStrategy: 'min_cosine',
  semanticThreshold: 0.61,
  semanticMarginThreshold: null,
}

export const UNGATED_RETRIEVAL_PROFILE: RetrievalProfile = {
  ...PRODUCTION_RETRIEVAL_PROFILE,
  profileVersion: `${RETRIEVAL_PROFILE_VERSION}-ungated`,
  semanticAdmissionStrategy: 'none',
  semanticThreshold: 0,
  semanticMarginThreshold: null,
}

export function getRetrievalProfile(): RetrievalProfile {
  return PRODUCTION_RETRIEVAL_PROFILE
}

export function retrievalProfileSummary(profile: RetrievalProfile = PRODUCTION_RETRIEVAL_PROFILE) {
  return {
    profileVersion: profile.profileVersion,
    embeddingModel: profile.embeddingModel,
    embeddingRevision: profile.embeddingRevision,
    chunkingVersion: profile.chunkingVersion,
    rrfK: profile.rrfK,
    semanticAdmissionStrategy: profile.semanticAdmissionStrategy,
    semanticThreshold: profile.semanticThreshold,
    semanticMarginThreshold: profile.semanticMarginThreshold,
  }
}
