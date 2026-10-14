/**
 * Context phase: ONE batched step before the builder's first call.
 *   1. RETRIEVAL  hybrid search over the workspace (exact / definition hits first, embeddings for the rest) -> a small, logged context package per file step;
 *   2. RESEARCH   (only when Foundry's deterministic trigger fires) a bounded brief from the retrieved material.
 * Both are advisory context for the builder. Neither edits files, decides acceptance, or overrides the contract. Implementations live outside the engine
 * (lib/agents/forge/contextRetriever.ts) so the engine depends only on this interface; with no phase configured the workflow is unchanged.
 */
export type RetrievalMethod = 'EXACT' | 'DEFINITION' | 'EMBEDDING'
export type RetrievedItem = { path: string; text: string; method: RetrievalMethod; why: string; score: number }
export type ResearchBrief = { id: string; topic: string; text: string; model: string; sources: string[]; relevance: { relevant: boolean; reason: string }; ms: number; /** file citations the model wrote that no supplied file backs (they are stripped and the true sources attached by Foundry) */ inventedCitations?: number }
/** `known`: files the deterministic context (import graph + files changed in earlier steps) already gives the builder for this step, so retrieval does not spend slots on them */
export type ContextStep = { id: string; path: string; layer: string; title: string; note: string; known?: string[] }
export type ContextPhaseInput = { request: string; acceptance: string[]; steps: ContextStep[]; files: Record<string, string> }
export type ContextPhaseResult = { packages: Record<string, RetrievedItem[]>; brief: ResearchBrief | null; report: Record<string, unknown> }
export interface ContextPhase { prepare(input: ContextPhaseInput): Promise<ContextPhaseResult> }

export const BRIEF_CAP = 1200
export const RETRIEVED_PER_STEP = 5
export const RETRIEVED_CHARS_PER_ITEM = 1800

/** Retrieved items as they appear inside RELATED CODE: the header says what they are, so the model can tell search results from the import-graph context. */
export const asRelated = (items: RetrievedItem[]): { path: string; text: string }[] => items.map((i) => ({ path: `${i.path} (retrieved by ${i.method.toLowerCase()} search: ${i.why})`, text: i.text.slice(0, RETRIEVED_CHARS_PER_ITEM) }))
export const briefText = (b: ResearchBrief | null): string | undefined => (b && b.relevance.relevant ? b.text.slice(0, BRIEF_CAP) : undefined)

export type ContextStats = { builderPromptCalls: number; contextChars: number; filesProvided: Record<string, number>; retrievedProvided: Record<string, number>; briefProvidedCalls: number }
export const emptyContextStats = (): ContextStats => ({ builderPromptCalls: 0, contextChars: 0, filesProvided: {}, retrievedProvided: {}, briefProvidedCalls: 0 })
