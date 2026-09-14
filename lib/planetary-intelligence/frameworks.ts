/**
 * Evaluated mechanisms — none adopted wholesale. War Room remains the orchestration architecture.
 * AGPL components stay behind replaceable adapters.
 */
export const FRAMEWORK_DECISIONS = [
  { name: 'LangGraph', decision: 'REJECT_WHOLESALE', use: 'None at P0. Graph orchestration ideas already exist in scout-swarm phases.', license: 'MIT' },
  { name: 'Haystack', decision: 'REJECT_WHOLESALE', use: 'None at P0.', license: 'Apache-2.0' },
  { name: 'LlamaIndex', decision: 'REJECT_WHOLESALE', use: 'None at P0. Vector index may be a later projection, not authority.', license: 'MIT' },
  { name: 'GraphRAG', decision: 'REJECT_WHOLESALE', use: 'No Neo4j. Relational ledger is canonical.', license: 'MIT' },
  { name: 'DSPy', decision: 'REJECT_WHOLESALE', use: 'None at P0.', license: 'MIT' },
  { name: 'AutoGen Core / AG2', decision: 'REJECT_WHOLESALE', use: 'None. Do not replace Council.', license: 'CC-BY-4.0 / MIT variants — not adopted' },
  { name: 'CAMEL', decision: 'REJECT_WHOLESALE', use: 'None.', license: 'Apache-2.0' },
  { name: 'CrewAI', decision: 'REJECT_WHOLESALE', use: 'None. Agent chat theater rejected.', license: 'MIT / enterprise' },
  { name: 'smolagents', decision: 'REJECT_WHOLESALE', use: 'None.', license: 'Apache-2.0' },
  { name: 'Mixture-of-Agents', decision: 'IDEA_ONLY', use: 'Serial shared-backend seats already exist; no parallel 14B copies.', license: 'n/a' },
  { name: 'datasketch', decision: 'MECHANISM_REUSED', use: 'MinHash/SimHash implemented locally in syndication.ts. No new dependency.', license: 'MIT if later added' },
  { name: 'DuckDB', decision: 'DEFER', use: 'Optional analytics projection later. Not required for P0 ledger.', license: 'MIT' },
  { name: 'PostgreSQL/PostGIS', decision: 'SCHEMA_READY', use: 'Canonical relational store via additive Supabase SQL. PostGIS not required at P0.', license: 'PostgreSQL' },
  { name: 'pgvector', decision: 'DEFER', use: 'Vector index is a projection, not authority.', license: 'PostgreSQL' },
  { name: 'H3', decision: 'DEFER', use: 'Geo indexes designed; H3 not a P0 dependency.', license: 'Apache-2.0' },
  { name: 'SearXNG', decision: 'ADAPTER_ONLY', use: 'Existing War Room SearXNG adapter. AGPL isolated. Not a foundation.', license: 'AGPL-3.0' },
  { name: 'GDELT', decision: 'NOT_INTEGRATED', use: 'Discovery/enrichment adapter candidate. Terms must be re-verified before use.', license: 'GDELT terms / dataset license ≠ code license' },
  { name: 'Media Cloud', decision: 'NOT_INTEGRATED', use: 'AGPL backend — isolate or skip unless Commander accepts obligations.', license: 'AGPL-3.0' },
  { name: 'Common Crawl', decision: 'NOT_INTEGRATED', use: 'Not a brute-force crawl foundation.', license: 'Common Crawl terms' },
  { name: 'Wikidata', decision: 'ADAPTER_CANDIDATE', use: 'Existing Research Engine Wikidata provider may enrich registry.', license: 'CC0' },
] as const

export function noWholesaleFrameworkTakeover(): boolean {
  return FRAMEWORK_DECISIONS.every(item => item.decision !== 'ADOPT_WHOLESALE')
}

export function agplRemainsIsolated(): boolean {
  return FRAMEWORK_DECISIONS
    .filter(item => item.license.includes('AGPL'))
    .every(item => item.decision === 'ADAPTER_ONLY' || item.decision === 'NOT_INTEGRATED')
}
