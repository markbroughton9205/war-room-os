/**
 * Minimal, deterministic domain classifier for live research queries (Build #4A item 4).
 *
 * This exists so the live research path can prefer a genuinely relevant bridged
 * lib/research-engine/ provider (see researchEngineBridge.ts) over generic public RSS when one is
 * available for the query's subject — RSS remains the fallback for everything else, never the
 * first choice for a domain that has a real, credential-checked provider covering it.
 *
 * Deliberately keyword/regex based, not a model call: the routing decision must be reproducible
 * and auditable, not subject to LLM variance, and the domain set is small and stable enough that a
 * fixed table is the honest, minimal implementation the mission calls for.
 */

export type ResearchDomain =
  | 'TRANSPORTATION_LOGISTICS'
  | 'GOVERNMENT_REGULATORY'
  | 'ECONOMIC_FINANCIAL'
  | 'SCIENCE_ACADEMIC'
  | 'GENERAL_CURRENT'
  | 'HYBRID'

const DOMAIN_PATTERNS: Record<Exclude<ResearchDomain, 'GENERAL_CURRENT' | 'HYBRID'>, RegExp> = {
  TRANSPORTATION_LOGISTICS:
    /\b(freight|logistics|trucking|carrier|shipp(?:ing|er)|supply chain|warehous|cargo|intermodal|brokerage|fleet|haulage)\b/i,
  GOVERNMENT_REGULATORY:
    /\b(regulat\w*|compliance|federal register|agency rule|statute|legislation|govern(?:ment|ance)|policy mandate|sec filing)\b/i,
  ECONOMIC_FINANCIAL:
    /\b(economy|economic|gdp|inflation|interest rate|market(?:s)?|stock|earnings|financ(?:e|ial)|investment|fiscal|monetary)\b/i,
  SCIENCE_ACADEMIC:
    /\b(research paper|study shows|scientists?|scientific|peer.?reviewed?|journal|preprint|clinical trial|biomedical|academic|arxiv|pubmed)\b/i,
}

/**
 * `queryDecompose.ts`'s casual-round "world brief" expansion appends generic multi-topic
 * boilerplate to a decree — "...? \n\nCover distinct current-event areas without repeating the same
 * search:\n1. current geopolitics ...\n2. global economics and markets ..." — before it ever reaches
 * this classifier or the research router (whitespace gets collapsed further downstream, so by the
 * time it's here the marker may no longer sit on its own line). That boilerplate's own keywords
 * ("markets", "policy", etc.) must never drive domain routing or the query text bridged providers
 * search on — only the Commander's actual leading question should. Deliberately NOT a generic
 * sentence splitter: naive splitting on `. ` breaks on ordinary abbreviations (e.g. "U.S."), which a
 * real regression caught — cutting at this one known, literal marker is narrower but correct.
 * Both this classifier and the bridge's query text (researchEngineBridge.ts) key off this same
 * extraction so routing and retrieval always agree on what the "real" query was.
 */
const WORLD_BRIEF_EXPANSION_MARKER = 'Cover distinct current-event areas'

export function extractPrimaryQuerySentence(text: string): string {
  const markerIndex = text.indexOf(WORLD_BRIEF_EXPANSION_MARKER)
  const trimmed = markerIndex === -1 ? text : text.slice(0, markerIndex)
  return trimmed.trim() || text.trim()
}

/**
 * Classifies free-text decree/query text into zero or more research domains. Returns
 * `GENERAL_CURRENT` when nothing matches (no bridged provider is a better fit than generic
 * live-web search), a single domain when exactly one matches, and `HYBRID` when more than one
 * domain's pattern matches the same text.
 */
export function classifyResearchDomain(text: string): ResearchDomain {
  const matches = matchedDomains(text)
  if (matches.length === 0) return 'GENERAL_CURRENT'
  if (matches.length === 1) return matches[0]!
  return 'HYBRID'
}

export function matchedDomains(text: string): Exclude<ResearchDomain, 'GENERAL_CURRENT' | 'HYBRID'>[] {
  const primary = extractPrimaryQuerySentence(text)
  return (Object.keys(DOMAIN_PATTERNS) as (keyof typeof DOMAIN_PATTERNS)[])
    .filter(domain => DOMAIN_PATTERNS[domain].test(primary))
}
