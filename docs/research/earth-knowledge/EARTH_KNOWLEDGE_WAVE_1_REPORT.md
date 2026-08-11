# Earth Knowledge Wave 1 Build Report

Builder: Codex. This is a builder report only; Claude Code independent validation is still required before Commander approval. No staging, commit, push, merge, deploy, SQL execution, credential exposure, background work, or live provider call was performed.

## 1. Preflight State

- Repository: `C:\Users\markb\warroom`
- Branch: `main`
- HEAD at preflight: `06e9cc2c49189f760c827b9ca9d2e75102b68ee3`
- Canonical registry exists: YES
- Reconciliation ledger exists: YES
- Canonical registry SHA-256: `39476753D6DADE4A269DFEC739DED2A71476DFABF7CE10DC64329B104E5FDCD4`
- Pre-existing unrelated worktree items observed and not touched: `.gitignore`, `lib/native-builder/__fixtures__/knownIssueFixture.ts`, `.cursor/settings.json`, `CLAUDE.md`, `supabase/.temp/`.

## 2. Provider Counts Before Wave 1

| Count | Value | Evidence |
|---|---:|---|
| Provider descriptors | 29 | `lib/research-engine/config/providerEnv.ts` |
| Implemented descriptors | 22 | `implemented: true` descriptors and `IMPLEMENTED_PROVIDER_ADAPTERS` |
| Blocked/not implemented descriptors | 7 | `implemented: false` descriptors |
| Callable registry entries | 22 | `lib/research-engine/providers/registry.ts` |

## 3. Existing Implemented Identities Reviewed

Reviewed the 22 existing provider identities: `exa`, `github`, `sam_gov`, `fmcsa`, `ncbi`, `fred`, `semantic_scholar`, `arxiv`, `crossref`, `nasa`, `nasa_gibs`, `courtlistener`, `internet_archive`, `wayback`, `world_bank_indicators`, `usgs_water`, `usgs_earthquake`, `usgs_earthquake_feed`, `usgs_sciencebase`, `library_of_congress`, `wikidata`, `common_crawl`.

The approved reconciliation ledger contained 144 `EXISTING_IMPLEMENTED` placements, but many are overlap classifications rather than callable provider support. Wave 1 treated provider identity, not placement count, as the implementation unit.

## 4. Existing Partial Placements Reviewed

Reviewed all 51 `EXISTING_PARTIAL` placements as candidate overlaps. None were implemented in this pass because each either requires a separate provider identity/protocol family, credentialed service, bulk/local index design, or later Wave 2+ source integration. No partial placement was promoted without a direct first-party contract and an existing-provider dispatch model.

## 5. Candidate Decision Table

| Provider | Provider ID | Current behavior | Missing capability from ledger | Access mechanism | Files likely affected | Verification requirement | Risk | Decision |
|---|---|---|---|---|---|---|---|---|
| GitHub | `github` | Repository search via `GET /search/repositories` | Issue and PR search from Category 03 GitHub Issues/PRs/Releases row | GitHub REST Search API `GET /search/issues` with `is:issue` / `is:pr` qualifiers | GitHub adapter, descriptor notes, validation, provider matrix, Earth Knowledge docs | First-party GitHub REST Search docs | Low/medium: preserve default repo search and make issue/PR mode explicit | MODIFY |
| GitHub releases | `github` | No release dispatch | Release search/listing | Repository-specific releases endpoints, not global search | none | Requires separate repo-target syntax and contract decision | Medium: easy to overstate global release support | BLOCKED/LATER WAVE |
| Wikidata/SPARQL family | `wikidata` | Entity search + enrichment; no arbitrary SPARQL | SPARQL access for Wikidata/DBpedia/YAGO/etc. | SPARQL endpoints | none | Needs protocol-family design and query safety model | High: arbitrary SPARQL exposure | LATER WAVE |
| NCBI broader bio-family | `ncbi` | PubMed/MEDLINE search and top abstract | Taxonomy, datasets, gene/protein, PMC bulk/OAI | Multiple E-utilities/db-specific endpoints | none | Needs database selection contract | Medium/high | LATER WAVE |
| Web archive family | `internet_archive`, `wayback`, `common_crawl` | Metadata/capture lookup only; no content download | Bulk file/media/WARC/ZIM access | Bulk/download paths | none | Storage/licensing/download policy needed | High | LATER WAVE |
| Existing blocked providers | `uspto`, `world_bank_*`, `imf_sdmx`, `usgs_national_map` | Registered but no adapter | Blocked source families | varies | none | Existing blocker review required | High | BLOCKED |

## 6. Providers Requiring No Change

No code change was made to `exa`, `sam_gov`, `fmcsa`, `ncbi`, `fred`, `semantic_scholar`, `arxiv`, `crossref`, `nasa`, `nasa_gibs`, `courtlistener`, `internet_archive`, `wayback`, `world_bank_indicators`, `usgs_water`, `usgs_earthquake`, `usgs_earthquake_feed`, `usgs_sciencebase`, `library_of_congress`, `wikidata`, or `common_crawl`.

## 7. Providers Selected and Modified

- Selected: `github`
- Actually modified: `github`
- New provider IDs: none
- Blocked providers reopened: none
- Descriptor count changed: no
- Implemented count changed: no

## 8. Capability Gaps Implemented

Implemented explicit GitHub issue and pull-request search within the existing `github` provider. Default text continues to use repository search. New explicit modes:

- `github issues: <query>` → `GET https://api.github.com/search/issues?q=<query> is:issue`
- `github prs: <query>` → `GET https://api.github.com/search/issues?q=<query> is:pr`

Normalized output uses existing `ResearchDocument` shape with `contentType` of `code_issue` or `code_pull_request`, stable issue identifiers, repository identifier when supplied by GitHub, author login, state subject, and canonical/source URL. No writes, GraphQL, code search, commit search, release search, or arbitrary endpoint path was added.

## 9. Gaps Blocked by Incomplete or Unsuitable Contract Evidence

- GitHub release search/listing: later wave. The selected first-party search contract covers repositories/issues/PRs; release endpoints are repository-scoped and need a separate typed dispatch contract.
- Arbitrary GitHub GraphQL: not added; existing provider uses REST and no GraphQL safety model exists for this provider.
- GitHub code search: not added; different rate limits and query behavior, and not required for the issue/PR gap selected.
- Wikidata/DBpedia/YAGO arbitrary SPARQL: later protocol wave; no arbitrary query surface added.
- Bulk/download/feed/repository sources: later waves; no product/download requests were introduced.

## 10. Reconciliation False Positives Found

The initial reconciliation intentionally used broad overlap heuristics. Wave 1 found that many rows classified `EXISTING_IMPLEMENTED` are not directly callable by an existing adapter. Examples: sources matched to GitHub merely because they are hosted in a repository, sources matched to Wikidata because of identifier overlap, and sources matched to Exa because general web search could discover them. These remain traceable but are not treated as implemented provider capabilities.

## 11. Authoritative Documentation Used

- GitHub REST Search documentation, `REST API endpoints for search`: documents search endpoints, `/search/issues`, query construction, 1,000 search-result cap, query-length limits, search rate limits, and text-match metadata. URL: https://github.com/github/docs/blob/main/content/rest/search/search.md
- GitHub REST Issues documentation: documents that GitHub REST treats pull requests as issues and distinguishes PRs by the `pull_request` key. URL: https://docs.github.com/en/rest/issues/issues

## 12. Exact Files Changed

- `lib/research-engine/providers/github.ts`
- `lib/research-engine/config/providerEnv.ts`
- `lib/research-engine/diagnostics/validation.ts`
- `docs/RESEARCH_PROVIDER_MATRIX.md`
- `docs/research/earth-knowledge/EARTH_KNOWLEDGE_RECONCILIATION.md`
- `docs/research/earth-knowledge/EARTH_KNOWLEDGE_WAVE_1_REPORT.md`

## 13. Tests Added or Changed

- Added `re_403_github_issue_prefix_uses_official_issue_search_endpoint`.
- Added `re_404_github_pr_prefix_uses_issue_search_with_pr_qualifier`.
- Added `re_405_github_default_search_remains_repository_search`.
- Existing GitHub tests `re_42` and `re_43` remain intact.

## 14. Controlled API Request Count

- Controlled live provider API requests: 0
- Product/download requests: 0
- Test requests: mocked only through `__setResearchFetchForTests`; no live upstream fetch was performed.

## 15. Provider Counts After Wave 1

| Count | Value |
|---|---:|
| Provider descriptors | 29 |
| Implemented descriptors | 22 |
| Blocked/not implemented descriptors | 7 |
| Callable registry entries | 22 |

## 16. Remaining Backlog

- Release search/listing requires a separate repository-targeted contract.
- GitHub code search remains out of scope.
- Broad package registry, repository, feed, bulk, SPARQL, SDMX, STAC, OGC, TAXII/STIX, OAI-PMH, and IIIF protocols remain later-wave work.
- Existing blocked providers remain blocked.

## 17. Recommended Wave 2 Boundary

Wave 2 should focus on open/no-key official APIs with precise first-party contracts and no bulk storage requirement. It should not begin protocol-family bulk ingestion or credentialed/partnership sources until the descriptor/backlog shape is approved.

## 18. All-521 Traceability Confirmation

All 521 declared Earth Knowledge category placements remain in the reconciliation ledger. The canonical registry was not modified. The Wave 1 amendment records the touched GitHub placements without deleting, merging, or silently deduplicating any source. Unaccounted count remains `0`.

## 19. Validation Results

- `npx tsc --noEmit`: PASS after adapter/test changes.
- `node scripts/run-research-engine-validation.mjs`: FAIL before tests due missing `@/lib` alias resolution when run without the repo loader.
- `npm run validate:research-engine`: PASS, `489/489`.
- Final `npm run lint`, `npm run build`, and final git safety checks are recorded in the Codex final response after they are run.

## 20. Builder Verdict

BUILDER PASS pending final repository-wide validation commands. This is not final production approval; Claude Code must independently validate the diff.
