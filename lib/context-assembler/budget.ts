import type { ContextBudget, ContextSectionKind } from './types'

/** Approximate token estimate (chars/4) — this repo has no tokenizer-accurate estimator wired
 * for prompt sizing outside provider SDKs, so this stays a documented heuristic used only for
 * budgeting/inspection, never billed or compared against a real provider token count. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export const RANKING_VERSION = 'v1'

/** AGI Wave 2 — retrieval strategy version persisted on every ContextSnapshot (Phase 3/44).
 * Structured filters + Postgres FTS only; no vector/semantic scoring exists yet. Bump this string
 * when the retrieval algorithm changes so old snapshots remain honestly attributable. */
export const RETRIEVAL_STRATEGY_VERSION = 'v2-fts-structured'

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  totalTokens: 6000,
  sectionCaps: {
    identity: 200,
    directives: 400,
    project: 300,
    open_loops: 600,
    summary: 800,
    memories: 800,
    artifacts: 400,
    recent_messages: 2000,
    terra: 500,
    world_knowledge: 600,
  },
}

/** Lower number = dropped first when the assembled context exceeds the total token budget.
 * 'identity' is never dropped. Order matches Phase 9's instruction to drop low-value retrieved
 * memories before essential active project/open-loop state. World knowledge (externally-derived,
 * often still 'candidate' confidence) is dropped before Commander-authored memory. */
export const SECTION_DROP_PRIORITY: Record<ContextSectionKind, number> = {
  world_knowledge: 1,
  memories: 2,
  artifacts: 3,
  terra: 4,
  summary: 5,
  recent_messages: 6,
  open_loops: 7,
  project: 8,
  directives: 9,
  identity: 10,
}

export function truncateToTokenCap(text: string, capTokens: number): { text: string; truncated: boolean } {
  const capChars = capTokens * 4
  if (text.length <= capChars) return { text, truncated: false }
  return { text: `${text.slice(0, Math.max(0, capChars - 1))}…`, truncated: true }
}
