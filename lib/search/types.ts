export type SearchCategory =
  | 'conversation' | 'memory' | 'project' | 'open_loop' | 'prompt_artifact'
  | 'world_knowledge' | 'source' | 'claim'

export type SearchScope = {
  projectId?: string | null
  conversationId?: string | null
  global?: boolean
}

export type ScorableCandidate = {
  id: string
  status: string
  createdAt: string
  /** 0..1. Defaults applied by the caller when the underlying table has no natural importance
   * signal (e.g. open loop priority normalized, memory importance_tier mapped to a number). */
  importanceWeight: number
  projectId: string | null
  /** 0..1 — currently derived from whether/how well the row matched the FTS query (a coarse
   * proxy, not a true relevance score). Reserved slot for a future semantic score — see
   * `semanticScore` on SearchResultItem below (Phase 44 forward compatibility). */
  textMatchStrength: number
}

export type SearchResultItem = {
  category: SearchCategory
  id: string
  title: string
  snippet: string
  score: number
  /** Never populated in Wave 2 — no vector/embedding infrastructure exists in this repo yet
   * (checked before building this). Left here so a future retrieval strategy version can add
   * semantic scoring without a breaking interface change. */
  semanticScore?: number
  createdAt: string
  sourceRefs: { type: string; id: string }[]
}

export type SearchInput = {
  query: string
  categories?: SearchCategory[]
  scope?: SearchScope
  limit?: number
  includeInactive?: boolean
}
