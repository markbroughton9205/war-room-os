# Earth Knowledge Master Registry Reconciliation

Analysis mode only. No provider implementation, source code wiring, config changes, staging, commits, pushes, deployments, SQL, credentials, or live upstream calls were performed by this report generation.

## Integrity Verification

- Registry path: `docs\research\earth-knowledge\earth_knowledge_source_registry.md`
- Registry size: `956891` bytes
- Registry SHA-256: `39476753D6DADE4A269DFEC739DED2A71476DFABF7CE10DC64329B104E5FDCD4`
- Expected SHA-256: `39476753D6DADE4A269DFEC739DED2A71476DFABF7CE10DC64329B104E5FDCD4`
- Hash verdict: `PASS`

## Existing War Room Research Architecture Verified

- `lib/research-engine/config/providerEnv.ts` contains `29` registered provider descriptors.
- `lib/research-engine/config/providerEnv.ts` marks `22` implemented and `7` blocked/not implemented.
- `lib/research-engine/providers/registry.ts` exposes `22` callable adapters.
- `docs/RESEARCH_PROVIDER_MATRIX.md`, `docs/RESEARCH_ENGINE_ARCHITECTURE.md`, and `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md` document the same 29/22/7 foundation and the current “env-presence is not live health” rule.
- Existing routes: `/api/research/providers`, `/api/research/search`, and `/api/research/providers/[provider]/health` are Commander/session protected and consume the research-engine registry; no Research Console UI is documented as live.

### Current Provider Descriptor Inventory

| State | Count | Provider IDs |
|---|---:|---|
| Registered descriptors | 29 | `exa, github, sam_gov, fmcsa, ncbi, fred, semantic_scholar, arxiv, crossref, nasa, nasa_gibs, uspto, courtlistener, internet_archive, wayback, world_bank_indicators, world_bank_data_catalog, world_bank_projects, world_bank_finances, world_bank_climate, imf_sdmx, usgs_water, usgs_earthquake, usgs_earthquake_feed, usgs_national_map, usgs_sciencebase, library_of_congress, wikidata, common_crawl` |
| Implemented adapters | 22 | `github, arxiv, crossref, fred, world_bank_indicators, usgs_earthquake, wikidata, ncbi, exa, library_of_congress, nasa_gibs, usgs_water, usgs_earthquake_feed, usgs_sciencebase, semantic_scholar, courtlistener, internet_archive, wayback, common_crawl, sam_gov, nasa, fmcsa` |
| Registered but blocked/not implemented | 7 | `uspto, world_bank_data_catalog, world_bank_projects, world_bank_finances, world_bank_climate, imf_sdmx, usgs_national_map` |

## Registry Accounting

- Categories parsed: `25`
- Declared category placements: `521`
- Parsed category placements: `521`
- Full 34-field-style source blocks (>=30 detected field labels): `476`
- Compressed/abbreviated/cross-reference-style placements: `45`
- Unique normalized source identities from placement titles: `514`
- Multi-category / repeated normalized identities: `7`
- Malformed blocks: `0`. Note: compressed rows are intentional registry records, not malformed 34-field blocks.
- Unaccounted placements: `0`

### Category Accounting

| Category | Name | Declared | Accounted | Unaccounted |
|---|---|---:|---:|---:|
| 01 | GENERAL WEB KNOWLEDGE & REFERENCE | 37 | 37 | 0 |
| 02 | SOFTWARE & CODING | 24 | 24 | 0 |
| 03 | BUGS, PATCHES & SOFTWARE HISTORY | 18 | 18 | 0 |
| 04 | CYBERSECURITY / CVE / MALWARE / THREAT INTEL | 27 | 27 | 0 |
| 05 | HUMAN ANATOMY & TERMINOLOGIES | 7 | 7 | 0 |
| 06 | DISEASES & CLINICAL KNOWLEDGE | 15 | 15 | 0 |
| 07 | PHARMACEUTICALS & MEDICINES | 16 | 16 | 0 |
| 08 | TRADITIONAL & INDIGENOUS MEDICINE | 21 | 21 | 0 |
| 09 | GENETICS & MOLECULAR BIOLOGY | 20 | 20 | 0 |
| 10 | BIOLOGY & BIODIVERSITY | 21 | 21 | 0 |
| 11 | EARTH & ENVIRONMENTAL | 11 | 11 | 0 |
| 12 | HUMAN ORIGINS & ARCHAEOLOGY | 15 | 15 | 0 |
| 13 | WORLD HISTORY & PRIMARY SOURCES | 13 | 13 | 0 |
| 14 | GOVERNMENT & LAW | 32 | 32 | 0 |
| 15 | ECONOMICS & FINANCE | 12 | 12 | 0 |
| 16 | ACADEMIC RESEARCH | 32 | 32 | 0 |
| 17 | PATENTS & INTELLECTUAL PROPERTY | 13 | 13 | 0 |
| 18 | MAPS / GIS / SATELLITE / EARTH OBSERVATION | 16 | 16 | 0 |
| 19 | SPACE & ASTRONOMY | 14 | 14 | 0 |
| 20 | ENGINEERING & TECHNOLOGY (incl. standards & materials) | 14 | 14 | 0 |
| 21 | ARCHIVES / LIBRARIES / MUSEUMS | 37 | 37 | 0 |
| 22 | NEWS & HISTORICAL NEWS | 4 | 4 | 0 |
| 23 | STATISTICS / CENSUS / DEMOGRAPHICS | 46 | 46 | 0 |
| 24 | INTERNATIONAL ORGANIZATIONS | 13 | 13 | 0 |
| 25 | SPECIALIZED & RARE + REGIONAL SOURCES | 43 | 43 | 0 |

### Registry Internal Count Note

The 25 category headers declare 521 category placements. The registry’s later `REGISTRY SUMMARY` table states `Total unique sources: 509` and lists a separate summary-by-category table. This report treats 521 as the category-placement reconciliation ledger and treats 509 as a registry-authored unique-source summary; it does not delete or merge placements to force those numbers to match.

## Primary Integration State Counts

| Primary state | Count |
|---|---:|
| `CREDENTIAL_REQUIRED` | 156 |
| `DEGRADED` | 19 |
| `DISCONTINUED_NO_REPLACEMENT` | 16 |
| `DISCONTINUED_WITH_REPLACEMENT` | 4 |
| `EXISTING_BLOCKED` | 7 |
| `EXISTING_IMPLEMENTED` | 144 |
| `EXISTING_PARTIAL` | 51 |
| `NEW_API` | 8 |
| `NEW_BULK` | 39 |
| `NEW_FEED` | 10 |
| `NEW_GRAPHQL` | 1 |
| `NEW_OGC` | 1 |
| `NEW_REPOSITORY` | 8 |
| `NEW_SEARCH_INTERFACE` | 8 |
| `NEW_SPARQL` | 5 |
| `NEW_STAC` | 2 |
| `OTHER` | 3 |
| `PARTNERSHIP_OR_CONTRACT_REQUIRED` | 39 |

## Capability Tag Counts

| Capability tag | Count |
|---|---:|
| `BULK` | 326 |
| `FEED` | 73 |
| `GRAPHQL` | 11 |
| `OGC` | 6 |
| `REPOSITORY` | 153 |
| `SDMX` | 18 |
| `SEARCH_INTERFACE` | 111 |
| `SPARQL` | 28 |
| `STAC` | 17 |
| `TAXII_STIX` | 4 |

## Overlap Map

No registry source is recommended for deletion. Overlap is treated as routing, fallback, licensing, or evidence-quality context.

| Existing War Room provider area | Registry overlap examples | Recommendation |
|---|---|---|
| `wikidata` | Wikidata, Wikimedia-linked authority systems, DBpedia/YAGO/FactGrid overlaps | Extend knowledge-graph routing; keep DBpedia/YAGO as separate SPARQL candidates, not aliases. |
| `common_crawl`, `internet_archive`, `wayback` | Common Crawl, Internet Archive, Wayback, web archives | Preserve separate semantics: crawl corpus vs archive metadata vs capture history. |
| `github`, package/code providers | GitHub, GitLab, Codeberg, package registries | Reuse code-search/package descriptor conventions; do not route package registry calls through GitHub. |
| `sam_gov`, legal/government providers | SAM.gov, USAspending, TED, OCDS, sanctions, legislation | Reuse bounded official-API adapters and procurement metadata patterns. |
| `world_bank_indicators`, blocked World Bank descriptors | World Bank, IMF, OECD, SDMX sources | Build shared SDMX/time-series protocol layer before adding many one-off adapters. |
| `usgs_*`, `nasa_gibs`, `nasa` | USGS water/earthquake/sciencebase, NASA Earthdata/GIBS/CMR, STAC/OGC sources | Reuse safety gates and geospatial typed result models; add STAC/OGC protocol modules. |
| `library_of_congress`, `courtlistener` | Cultural heritage, legal, archives/museums | Extend current search-only citation contract; avoid full-content assumptions when source returns metadata only. |

## Implementation Waves

| Wave | Objective | Notes |
|---|---|---|
| Wave 0 | No deletion / registry normalization | Keep all 521 placements in the ledger; add no providers. Produce descriptor backlog and dependency flags. |
| Wave 1 | Reuse current Research Engine | Wire new descriptors only for sources matching existing adapter classes: REST search, OAI-PMH-like harvest, feed, bulk index, SDMX/STAC/OGC wrappers as design specs. |
| Wave 2 | Open/no-key official APIs | Implement read-only adapters for sources with no credentials and clear docs; prioritize government/science Tier A/B and high-utility source overlap. |
| Wave 3 | Credential-required self-service | Add env descriptors and health checks for key/account sources; do not call until configured. |
| Wave 4 | Protocol families | Build shared protocol adapters for SPARQL, SDMX, STAC, OGC, TAXII/STIX, OAI-PMH, IIIF, RSS/Atom/CSAF/MISP feeds. |
| Wave 5 | Bulk/local-index sources | Download/index architecture only; separate licensing, attribution, retention, and storage plans. |
| Wave 6 | Search-interface / partnership / discontinued | Keep truthful unavailable cards; do not scrape or simulate. Route to manual/contract follow-up or replacement provider. |

## Safety / Boundary Findings

- Africa registry is present only as `docs/research/source-registries/war_room_africa_api_registry.pdf`; it remains reserved for future reconciliation and is not counted as part of this Earth Knowledge ledger.
- The report preserves status vocabulary such as `OPERATIONAL`, `DEGRADED`, `DISCONTINUED`, `SEARCH INTERFACE`, `BULK DOWNLOAD`, and `FEED` by deriving tags from registry text rather than flattening them into one “API” bucket.
- Credential-required and partnership-required sources are explicitly tagged; no fake availability is inferred.
- Existing blocked providers remain blocked; this report does not resolve or bypass their documented blockers.
- 34-field schema is preserved conceptually. Compressed placements are marked as compressed instead of rewritten into fake full schema rows.

## Recommended Consolidation Targets

- Extend `lib/research-engine/config/providerEnv.ts` for new descriptors only after a source has a precise provider-owned contract.
- Extend `lib/research-engine/providers/registry.ts` only when a real adapter exists.
- Add protocol-family adapters under `lib/research-engine/providers/` or a new `lib/research-engine/protocols/` layer for SPARQL, SDMX, STAC, OGC, TAXII/STIX, OAI-PMH, IIIF, and feed harvesters.
- Keep `/api/research/providers` truthful: descriptor visibility is not provider health.
- Keep source-specific credential names server-side and do not expose keys in browser-safe status rows.

## Master Ledger

| # | Cat | Line | Source / placement | Primary state | Capability tags | Field count | Schema note | Match / blocker evidence |
|---:|---|---:|---|---|---|---:|---|---|
| 1 | 01 | 85 | Wikidata | `EXISTING_IMPLEMENTED` | SPARQL, BULK | 34 | 34-field-style row | wikidata |
| 2 | 01 | 88 | Wikipedia REST API (+ MediaWiki Action API — covers Wiktionary, Wikispecies, Wikivoyage, Wikiquote, Wikibooks, Wikinews) | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 3 | 01 | 91 | Wikimedia Commons | `EXISTING_PARTIAL` | BULK, REPOSITORY | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 4 | 01 | 94 | Wikidata/Wikimedia dumps (dumps.wikimedia.org) | `EXISTING_IMPLEMENTED` | FEED, BULK | 34 | 34-field-style row | wikidata |
| 5 | 01 | 97 | DBpedia | `EXISTING_IMPLEMENTED` | SPARQL, BULK | 34 | 34-field-style row | wikidata |
| 6 | 01 | 100 | YAGO | `EXISTING_IMPLEMENTED` | SPARQL, BULK | 34 | 34-field-style row | wikidata |
| 7 | 01 | 103 | ConceptNet | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 8 | 01 | 106 | Data Commons | `EXISTING_PARTIAL` | SDMX, BULK, REPOSITORY | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 9 | 01 | 109 | Google Knowledge Graph Search API | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | wikidata |
| 10 | 01 | 112 | BabelNet | `EXISTING_IMPLEMENTED` | SPARQL, BULK | 34 | 34-field-style row | wikidata |
| 11 | 01 | 119 | Common Crawl | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | exa,internet_archive,common_crawl |
| 12 | 01 | 122 | Internet Archive (full detail; cross-ref Africa registry general listing) | `EXISTING_IMPLEMENTED` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | internet_archive,wayback,common_crawl |
| 13 | 01 | 129 | Kaikki.org (machine-readable Wiktionary) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | github |
| 14 | 01 | 132 | Princeton WordNet / Open English WordNet | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 15 | 01 | 135 | FrameNet | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 16 | 01 | 138 | Merriam-Webster Dictionary APIs | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 17 | 01 | 141 | Glosbe | `DEGRADED` | none detected | 34 | 34-field-style row | registry status text |
| 18 | 01 | 144 | JMdict / EDRDG dictionary files (Japanese) | `EXISTING_IMPLEMENTED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | exa |
| 19 | 01 | 147 | CC-CEDICT (Chinese) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 20 | 01 | 154 | VIAF | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | wikidata |
| 21 | 01 | 157 | ISNI | `DEGRADED` | SPARQL, FEED, BULK | 34 | 34-field-style row | registry status text |
| 22 | 01 | 160 | ORCID | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | wikidata |
| 23 | 01 | 163 | ROR | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | crossref,wikidata |
| 24 | 01 | 166 | lobid — GND (German National Library) | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | wikidata |
| 25 | 01 | 169 | MusicBrainz | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK | 34 | 34-field-style row | license/sales/institutional language |
| 26 | 01 | 172 | Open Library | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | library_of_congress,internet_archive |
| 27 | 01 | 175 | DBLP | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | semantic_scholar |
| 28 | 01 | 178 | GeoNames (cross-ref — full detail owned by geo agent; brief block) | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | wikidata |
| 29 | 01 | 185 | Brave Search API | `DISCONTINUED_NO_REPLACEMENT` | none detected | 34 | 34-field-style row | registry status text |
| 30 | 01 | 188 | Mojeek | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 31 | 01 | 191 | Bing Search APIs — DISCONTINUED | `DISCONTINUED_WITH_REPLACEMENT` | none detected | 34 | 34-field-style row | registry status text |
| 32 | 01 | 198 | Reddit Data API (paid status 2026) | `DEGRADED` | STAC | 34 | 34-field-style row | registry status text |
| 33 | 01 | 201 | Diffbot Knowledge Graph (commercial) | `EXISTING_IMPLEMENTED` | none detected | 34 | 34-field-style row | wikidata |
| 34 | 01 | 204 | Golden (commercial — brief) | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 35 | 01 | 211 | Kiwix / ZIM files | `EXISTING_PARTIAL` | STAC, FEED, BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 36 | 01 | 214 | Wikibase Cloud | `EXISTING_IMPLEMENTED` | SPARQL, REPOSITORY | 34 | 34-field-style row | wikidata |
| 37 | 01 | 217 | FactGrid (cross-check brief) | `EXISTING_IMPLEMENTED` | SPARQL, BULK | 34 | 34-field-style row | wikidata |
| 38 | 02 | 260 | PyPI (Python Package Index) | `CREDENTIAL_REQUIRED` | FEED, BULK | 33 | 34-field-style row | credential/account/key language |
| 39 | 02 | 263 | npm Registry | `EXISTING_IMPLEMENTED` | FEED, BULK, REPOSITORY | 33 | 34-field-style row | github |
| 40 | 02 | 266 | crates.io | `EXISTING_IMPLEMENTED` | FEED, BULK, REPOSITORY | 33 | 34-field-style row | github |
| 41 | 02 | 269 | Maven Central (Sonatype/Maven search) | `NEW_BULK` | BULK, REPOSITORY | 33 | 34-field-style row | protocol tag |
| 42 | 02 | 272 | MetaCPAN (CPAN Perl) | `EXISTING_IMPLEMENTED` | REPOSITORY | 33 | 34-field-style row | github |
| 43 | 02 | 275 | RubyGems.org | `CREDENTIAL_REQUIRED` | none detected | 33 | 34-field-style row | credential/account/key language |
| 44 | 02 | 278 | ecosyste.ms (Packages/Repos/Issues/Commits services) | `CREDENTIAL_REQUIRED` | BULK | 33 | 34-field-style row | credential/account/key language |
| 45 | 02 | 281 | deps.dev (Google Open Source Insights) — PRIMARY BLOCK (cross-referenced from Category 03) | `CREDENTIAL_REQUIRED` | none detected | 33 | 34-field-style row | credential/account/key language |
| 46 | 02 | 284 | Homebrew Formulae API | `NEW_BULK` | BULK, REPOSITORY | 33 | 34-field-style row | protocol tag |
| 47 | 02 | 287 | Debian Package Metadata (apt/UDD) | `CREDENTIAL_REQUIRED` | BULK | 33 | 34-field-style row | credential/account/key language |
| 48 | 02 | 292 | GitHub REST/GraphQL API — PRIMARY BLOCK (cross-referenced from Category 03) | `EXISTING_IMPLEMENTED` | GRAPHQL, REPOSITORY | 33 | 34-field-style row | github |
| 49 | 02 | 295 | GitLab API — PRIMARY BLOCK (cross-referenced from Category 03) | `EXISTING_IMPLEMENTED` | GRAPHQL, BULK, REPOSITORY | 33 | 34-field-style row | github |
| 50 | 02 | 298 | Codeberg (Forgejo) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 33 | 34-field-style row | github |
| 51 | 02 | 301 | Software Heritage Archive (flagship) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 33 | 34-field-style row | github |
| 52 | 02 | 304 | grep.app | `EXISTING_IMPLEMENTED` | REPOSITORY | 33 | 34-field-style row | github |
| 53 | 02 | 307 | Sourcegraph (status note — effectively CLOSED for free use) | `EXISTING_IMPLEMENTED` | GRAPHQL, REPOSITORY | 34 | 34-field-style row | github |
| 54 | 02 | 312 | Stack Exchange API | `EXISTING_IMPLEMENTED` | STAC, BULK, REPOSITORY | 33 | 34-field-style row | github |
| 55 | 02 | 317 | IETF Datatracker + RFC Editor | `CREDENTIAL_REQUIRED` | BULK | 33 | 34-field-style row | credential/account/key language |
| 56 | 02 | 320 | W3C API + TR index | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY, SEARCH_INTERFACE | 33 | 34-field-style row | github |
| 57 | 02 | 323 | MDN Web Docs (content repository) | `EXISTING_IMPLEMENTED` | REPOSITORY, SEARCH_INTERFACE | 33 | 34-field-style row | github |
| 58 | 02 | 328 | kernel.org / lore.kernel.org | `EXISTING_IMPLEMENTED` | FEED, BULK, REPOSITORY | 33 | 34-field-style row | github |
| 59 | 02 | 331 | endoflife.date | `NEW_API` | none detected | 0 | compressed or partial registry row | REST/API access in registry |
| 60 | 02 | 336 | Rosetta Code | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github,exa |
| 61 | 02 | 339 | DevDocs | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 33 | 34-field-style row | github |
| 62 | 03 | 369 | OSV.dev | `EXISTING_IMPLEMENTED` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | github |
| 63 | 03 | 372 | NVD API 2.0 (National Vulnerability Database) | `NEW_API` | none detected | 1 | compressed or partial registry row | REST/API access in registry |
| 64 | 03 | 375 | GitHub Advisory Database (GHSA) | `EXISTING_IMPLEMENTED` | GRAPHQL, REPOSITORY | 34 | 34-field-style row | github,exa |
| 65 | 03 | 378 | deps.dev (Open Source Insights) | `NEW_API` | none detected | 0 | compressed or partial registry row | REST/API access in registry |
| 66 | 03 | 381 | GitLab Advisory Database (GLAD) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | GRAPHQL, FEED, REPOSITORY | 34 | 34-field-style row | license/sales/institutional language |
| 67 | 03 | 388 | CISA Known Exploited Vulnerabilities (KEV) Catalog | `OTHER` | none detected | 0 | compressed or partial registry row | manual review needed |
| 68 | 03 | 391 | Go Vulnerability Database | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 69 | 03 | 398 | endoflife.date — PRIMARY BLOCK (cross-referenced from Category 02) | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 70 | 03 | 405 | MSRC Security Update Guide / CVRF API 3.0 | `NEW_API` | none detected | 34 | 34-field-style row | REST/API access in registry |
| 71 | 03 | 408 | Ubuntu Security API + OVAL | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 72 | 03 | 411 | Debian Security Tracker | `NEW_BULK` | BULK, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 73 | 03 | 414 | Red Hat Security Data API (Hydra) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 74 | 03 | 421 | GitHub REST API (Issues/PRs/Releases) | `EXISTING_IMPLEMENTED` | GRAPHQL, REPOSITORY | 0 | compressed or partial registry row | github |
| 75 | 03 | 424 | GitLab REST API | `EXISTING_IMPLEMENTED` | GRAPHQL, REPOSITORY | 0 | compressed or partial registry row | github |
| 76 | 03 | 427 | Mozilla Bugzilla REST API (BMO) | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | exa |
| 77 | 03 | 430 | Launchpad API | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | exa |
| 78 | 03 | 433 | Apache Jira (issues.apache.org) REST | `DEGRADED` | BULK | 34 | 34-field-style row | registry status text |
| 79 | 03 | 440 | Libraries.io | `DEGRADED` | BULK | 34 | 34-field-style row | registry status text |
| 80 | 04 | 468 | NVD API 2.0 — PRIMARY BLOCK (cross-referenced from Category 03) | `DISCONTINUED_NO_REPLACEMENT` | FEED, BULK | 34 | 34-field-style row | registry status text |
| 81 | 04 | 471 | CVE Services API (cveawg) / CVE.org | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 82 | 04 | 474 | CISA KEV Catalog — PRIMARY BLOCK (cross-referenced from Category 03) | `CREDENTIAL_REQUIRED` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 83 | 04 | 477 | FIRST EPSS API | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK | 34 | 34-field-style row | license/sales/institutional language |
| 84 | 04 | 480 | VulDB | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | none detected | 34 | 34-field-style row | license/sales/institutional language |
| 85 | 04 | 485 | MITRE ATT&CK | `EXISTING_IMPLEMENTED` | TAXII_STIX, BULK, REPOSITORY | 34 | 34-field-style row | github |
| 86 | 04 | 488 | MITRE ATLAS | `EXISTING_IMPLEMENTED` | TAXII_STIX, BULK, REPOSITORY | 34 | 34-field-style row | github |
| 87 | 04 | 491 | CWE / CAPEC | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 88 | 04 | 494 | Exploit-DB | `CREDENTIAL_REQUIRED` | BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 89 | 04 | 499 | MalwareBazaar (abuse.ch) | `CREDENTIAL_REQUIRED` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 90 | 04 | 502 | ThreatFox (abuse.ch) | `CREDENTIAL_REQUIRED` | FEED | 34 | 34-field-style row | credential/account/key language |
| 91 | 04 | 505 | URLhaus (abuse.ch) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 92 | 04 | 508 | VirusTotal API v3 | `CREDENTIAL_REQUIRED` | FEED | 34 | 34-field-style row | credential/account/key language |
| 93 | 04 | 511 | Hybrid Analysis (Falcon Sandbox) | `DEGRADED` | none detected | 34 | 34-field-style row | registry status text |
| 94 | 04 | 514 | ANY.RUN (Sandbox + TI) | `CREDENTIAL_REQUIRED` | TAXII_STIX, FEED | 34 | 34-field-style row | credential/account/key language |
| 95 | 04 | 519 | AlienVault OTX | `DEGRADED` | TAXII_STIX, FEED | 34 | 34-field-style row | registry status text |
| 96 | 04 | 522 | AbuseIPDB | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 97 | 04 | 525 | GreyNoise | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK | 34 | 34-field-style row | license/sales/institutional language |
| 98 | 04 | 528 | Shodan | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK | 34 | 34-field-style row | license/sales/institutional language |
| 99 | 04 | 531 | Censys Platform API | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | none detected | 34 | 34-field-style row | license/sales/institutional language |
| 100 | 04 | 536 | PhishStats | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | none detected | 34 | 34-field-style row | license/sales/institutional language |
| 101 | 04 | 539 | ransomware.live | `DEGRADED` | none detected | 34 | 34-field-style row | registry status text |
| 102 | 04 | 544 | MISP default feeds + CIRCL OSINT feed | `CREDENTIAL_REQUIRED` | FEED | 34 | 34-field-style row | credential/account/key language |
| 103 | 04 | 547 | CERT-FR (ANSSI) | `NEW_FEED` | FEED, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 104 | 04 | 550 | JVN / JVN iPedia (IPA + JPCERT/CC) | `DEGRADED` | FEED, SEARCH_INTERFACE | 34 | 34-field-style row | registry status text |
| 105 | 04 | 553 | BSI CERT-Bund WID | `NEW_FEED` | FEED, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 106 | 04 | 556 | NCSC-NL Security Advisories (CSAF) — bonus regional | `NEW_FEED` | FEED | 34 | 34-field-style row | protocol tag |
| 107 | 05 | 609 | WHO ICD API (ICD-10 & ICD-11) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 108 | 05 | 612 | UMLS REST API (Metathesaurus, SNOMED, RxNorm, MeSH, ICD… ) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 109 | 05 | 615 | SNOMED CT — SNOMED International (Snowstorm / FHIR terminology) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 110 | 05 | 618 | LOINC Terminology Service (FHIR) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 111 | 05 | 621 | NCBO BioPortal API | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK, REPOSITORY | 34 | 34-field-style row | license/sales/institutional language |
| 112 | 05 | 624 | EBI Ontology Lookup Service (OLS4) | `NEW_FEED` | FEED, BULK | 34 | 34-field-style row | protocol tag |
| 113 | 05 | 627 | Ontobee (OBO linked-data server) + HeGroup SPARQL endpoint | `NEW_SPARQL` | SPARQL, FEED, BULK | 34 | 34-field-style row | protocol tag |
| 114 | 06 | 640 | NCBI E-utilities (PubMed / MEDLINE / PMC) | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | ncbi |
| 115 | 06 | 643 | Europe PMC (Articles REST API + OAI-PMH + FTP) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | ncbi |
| 116 | 06 | 646 | PMC Open Access Subset — bulk (FTP/AWS) + OA Web Service + OAI-PMH + BioC API | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | ncbi |
| 117 | 06 | 651 | ClinicalTrials.gov API v2 | `DISCONTINUED_NO_REPLACEMENT` | BULK | 34 | 34-field-style row | registry status text |
| 118 | 06 | 654 | WHO ICTRP Search Portal | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 119 | 06 | 657 | EU Clinical Trials — CTIS (successor to EU CTR/EudraCT) | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 120 | 06 | 662 | Orphanet / Orphadata + ORPHAcodes API | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 121 | 06 | 667 | MedlinePlus Web Service + MedlinePlus Connect + XML files | `NEW_FEED` | FEED, BULK | 34 | 34-field-style row | protocol tag |
| 122 | 06 | 670 | NICE Syndication Service (UK guidelines) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK | 34 | 34-field-style row | license/sales/institutional language |
| 123 | 06 | 673 | Open Targets Platform GraphQL API | `NEW_GRAPHQL` | GRAPHQL | 34 | 34-field-style row | protocol tag |
| 124 | 06 | 678 | WHO Global Health Observatory OData API | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 125 | 06 | 681 | IHME Global Burden of Disease (GBD) / GHDx | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 126 | 06 | 684 | GISAID EpiCoV | `EXISTING_IMPLEMENTED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | ncbi |
| 127 | 06 | 687 | ProMED (Program for Monitoring Emerging Diseases) | `CREDENTIAL_REQUIRED` | FEED, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 128 | 06 | 690 | HealthMap | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 129 | 07 | 722 | openFDA (drug + device endpoints) | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | exa |
| 130 | 07 | 725 | RxNorm / RxNav (incl. RxClass + Drug Interaction API) | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 131 | 07 | 728 | DailyMed SPL Web Services | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 132 | 07 | 731 | AccessGUDID (GUDID API) | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 133 | 07 | 734 | PubChem PUG-REST | `EXISTING_IMPLEMENTED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | ncbi |
| 134 | 07 | 737 | ChEMBL Web Services | `CREDENTIAL_REQUIRED` | REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 135 | 07 | 740 | Guide to Pharmacology (IUPHAR/BPS GtoPdb) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 136 | 07 | 743 | PharmGKB API (+ CPIC linkage) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 137 | 07 | 746 | Health Canada Drug Product Database (DPD) API | `NEW_FEED` | FEED, BULK | 34 | 34-field-style row | protocol tag |
| 138 | 07 | 749 | BindingDB | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 139 | 07 | 752 | DrugCentral | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 140 | 07 | 757 | FDA Orange Book / Purple Book + FAERS raw files | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 141 | 07 | 760 | EMA medicines data + SPOR (IDMP) APIs | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 142 | 07 | 763 | VAERS (Vaccine Adverse Event Reporting System) | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 143 | 07 | 768 | DrugBank | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK | 34 | 34-field-style row | license/sales/institutional language |
| 144 | 07 | 771 | WHO VigiAccess (VigiBase public interface) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 145 | 08 | 800 | Natural Products Atlas (NPAtlas) 2.0 | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 146 | 08 | 803 | COCONUT 2.0 (COlleCtion of Open Natural prodUcTs) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 147 | 08 | 806 | LOTUS Initiative → Wikidata natural products | `EXISTING_IMPLEMENTED` | SPARQL, REPOSITORY | 34 | 34-field-style row | github,wikidata,exa |
| 148 | 08 | 809 | ChEBI 2.0 (EMBL-EBI) | `DISCONTINUED_NO_REPLACEMENT` | BULK | 34 | 34-field-style row | registry status text |
| 149 | 08 | 814 | TCMSP (Traditional Chinese Medicine Systems Pharmacology) | `DISCONTINUED_NO_REPLACEMENT` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | registry status text |
| 150 | 08 | 817 | TCMID 2.0 (Traditional Chinese Medicine Integrated Database) | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 151 | 08 | 820 | SymMap | `DISCONTINUED_NO_REPLACEMENT` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | registry status text |
| 152 | 08 | 823 | ETCM 2.0 (Encyclopedia of Traditional Chinese Medicine) | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 153 | 08 | 826 | IMPPAT 2.0 (Indian Medicinal Plants, Phytochemistry And Therapeutics) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | github,exa |
| 154 | 08 | 829 | TKDL (Traditional Knowledge Digital Library) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 155 | 08 | 832 | Dr. Duke's Phytochemical and Ethnobotanical Databases (USDA) | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 156 | 08 | 835 | Native American Ethnobotany Database (NAEB) | `EXISTING_IMPLEMENTED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | exa |
| 157 | 08 | 838 | Kew MPNS (Medicinal Plant Names Services) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 158 | 08 | 841 | PROTA (Plant Resources of Tropical Africa) → PROTA4U | `DISCONTINUED_NO_REPLACEMENT` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | registry status text |
| 159 | 08 | 844 | Useful Tropical Plants Database (Ken Fern / The Ferns) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 160 | 08 | 847 | Plants For A Future (PFAF) | `CREDENTIAL_REQUIRED` | SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 161 | 08 | 852 | SANCDB (South African Natural Compounds Database) | `CREDENTIAL_REQUIRED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 162 | 08 | 857 | WHO Traditional Medicine infrastructure (WHO IRIS + GCTM) | `NEW_REPOSITORY` | REPOSITORY | 34 | 34-field-style row | protocol tag |
| 163 | 08 | 862 | Biodiversity Heritage Library (BHL) | `NEW_REPOSITORY` | REPOSITORY | 0 | compressed or partial registry row | protocol tag |
| 164 | 08 | 864 | Wellcome Collection | `NEW_BULK` | BULK, SEARCH_INTERFACE | 0 | compressed or partial registry row | protocol tag |
| 165 | 08 | 866 | KNApSAcK Family | `OTHER` | none detected | 0 | compressed or partial registry row | manual review needed |
| 166 | 09 | 898 | NCBI E-utilities (Entrez Programming Utilities) — covers GenBank, ClinVar, dbSNP, GEO, SRA, Gene, Protein, Taxonomy | `EXISTING_IMPLEMENTED` | none detected | 34 | 34-field-style row | ncbi |
| 167 | 09 | 901 | NCBI Datasets API v2 | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | ncbi |
| 168 | 09 | 904 | Ensembl REST API (+ Ensembl Genomes component sites) | `EXISTING_IMPLEMENTED` | none detected | 34 | 34-field-style row | ncbi |
| 169 | 09 | 907 | UniProt REST API (+ ID Mapping + SPARQL) | `EXISTING_IMPLEMENTED` | SPARQL, BULK | 34 | 34-field-style row | ncbi |
| 170 | 09 | 912 | RCSB Protein Data Bank APIs | `DISCONTINUED_NO_REPLACEMENT` | GRAPHQL, BULK | 34 | 34-field-style row | registry status text |
| 171 | 09 | 915 | AlphaFold Protein Structure Database | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 172 | 09 | 920 | KEGG REST API ⚠ LICENSE | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK | 34 | 34-field-style row | license/sales/institutional language |
| 173 | 09 | 923 | Reactome Content & Analysis Services | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 174 | 09 | 926 | WikiPathways | `NEW_SPARQL` | SPARQL | 34 | 34-field-style row | protocol tag |
| 175 | 09 | 931 | STRING | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 176 | 09 | 934 | BioGRID (+ ORCS CRISPR screens) | `CREDENTIAL_REQUIRED` | BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 177 | 09 | 937 | IntAct (IMEx) | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 178 | 09 | 942 | EMBL-EBI Ontology Lookup Service (OLS4) | `OTHER` | none detected | 0 | compressed or partial registry row | manual review needed |
| 179 | 09 | 946 | European Nucleotide Archive (ENA) Portal & Browser APIs | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | ncbi |
| 180 | 09 | 949 | DDBJ (DNA Data Bank of Japan) — getentry/ARSA/DDBJ Search, WABI legacy | `EXISTING_IMPLEMENTED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | ncbi |
| 181 | 09 | 954 | Cellosaurus | `NEW_SPARQL` | SPARQL, BULK, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 182 | 09 | 957 | Metabolomics Workbench | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | exa |
| 183 | 09 | 960 | MetaboLights | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 184 | 09 | 963 | PRIDE Archive / ProteomeXchange | `NEW_FEED` | FEED, BULK | 34 | 34-field-style row | protocol tag |
| 185 | 09 | 966 | gnomAD GraphQL API ✓ verified live | `EXISTING_IMPLEMENTED` | GRAPHQL, BULK | 34 | 34-field-style row | exa |
| 186 | 10 | 999 | GBIF API | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 187 | 10 | 1002 | iNaturalist API | `CREDENTIAL_REQUIRED` | FEED, BULK | 34 | 34-field-style row | credential/account/key language |
| 188 | 10 | 1005 | eBird API 2.0 | `CREDENTIAL_REQUIRED` | FEED, BULK | 34 | 34-field-style row | credential/account/key language |
| 189 | 10 | 1010 | Catalogue of Life via ChecklistBank API | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 190 | 10 | 1013 | NCBI Taxonomy (E-utilities) | `EXISTING_IMPLEMENTED` | none detected | 34 | 34-field-style row | ncbi |
| 191 | 10 | 1016 | WoRMS Aphia REST API | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 192 | 10 | 1019 | ITIS Web Services | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK | 34 | 34-field-style row | license/sales/institutional language |
| 193 | 10 | 1022 | POWO — Plants of the World Online (unofficial API) | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 194 | 10 | 1025 | Index Fungorum / Species Fungorum — status | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 195 | 10 | 1030 | IUCN Red List API v4 | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | exa |
| 196 | 10 | 1033 | BirdLife International Data Zone — status | `CREDENTIAL_REQUIRED` | SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 197 | 10 | 1038 | BOLD Systems API v4 | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | ncbi |
| 198 | 10 | 1041 | TRY Plant Trait Database — access model | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 199 | 10 | 1044 | Encyclopedia of Life (EOL) API + TraitBank — status verified ALIVE | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 200 | 10 | 1047 | Global Biotic Interactions (GloBI) API | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github,ncbi |
| 201 | 10 | 1052 | Paleobiology Database (PBDB) API 1.2 — global fossil record confirmed | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 202 | 10 | 1055 | OBIS API v3 | `CREDENTIAL_REQUIRED` | FEED | 34 | 34-field-style row | credential/account/key language |
| 203 | 10 | 1058 | GRIIS — Global Register of Introduced and Invasive Species | `CREDENTIAL_REQUIRED` | FEED, BULK | 34 | 34-field-style row | credential/account/key language |
| 204 | 10 | 1061 | ICTV — virus taxonomy | `EXISTING_IMPLEMENTED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | ncbi |
| 205 | 10 | 1064 | DSMZ microbial services: BacDive API v2 + LPSN API | `EXISTING_IMPLEMENTED` | FEED, BULK | 34 | 34-field-style row | ncbi |
| 206 | 10 | 1067 | GlobalTreeSearch (BGCI) | `CREDENTIAL_REQUIRED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 207 | 11 | 1102 | Open-Meteo | `CREDENTIAL_REQUIRED` | REPOSITORY | 33 | 34-field-style row | credential/account/key language |
| 208 | 11 | 1105 | OpenWeatherMap (One Call / Current API) | `CREDENTIAL_REQUIRED` | BULK | 33 | 34-field-style row | credential/account/key language |
| 209 | 11 | 1108 | ECMWF Copernicus Climate Data Store (CDS) + ADS | `DISCONTINUED_NO_REPLACEMENT` | BULK | 33 | 34-field-style row | registry status text |
| 210 | 11 | 1111 | NOAA NCEI Climate Data Online (CDO) API + Access Data Service | `CREDENTIAL_REQUIRED` | none detected | 33 | 34-field-style row | credential/account/key language |
| 211 | 11 | 1114 | NOAA/NWS api.weather.gov | `CREDENTIAL_REQUIRED` | FEED | 33 | 34-field-style row | credential/account/key language |
| 212 | 11 | 1117 | Met.no Locationforecast API (Norway) | `EXISTING_IMPLEMENTED` | none detected | 33 | 34-field-style row | exa |
| 213 | 11 | 1120 | DWD Open Data (Germany) | `NEW_OGC` | OGC, BULK | 33 | 34-field-style row | protocol tag |
| 214 | 11 | 1123 | Met Office Weather DataHub (UK) — DataPoint DISCONTINUED | `DISCONTINUED_WITH_REPLACEMENT` | REPOSITORY | 34 | 34-field-style row | registry status text |
| 215 | 11 | 1126 | JMA Disaster Information XML (Japan) — PULL feed | `EXISTING_PARTIAL` | FEED | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 216 | 11 | 1131 | OpenTopography API | `EXISTING_PARTIAL` | none detected | 33 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 217 | 11 | 1134 | GEBCO Bathymetry | `CREDENTIAL_REQUIRED` | OGC, BULK | 33 | 34-field-style row | credential/account/key language |
| 218 | 12 | 1174 | Open Context | `EXISTING_IMPLEMENTED` | FEED, REPOSITORY | 34 | 34-field-style row | exa |
| 219 | 12 | 1177 | tDAR (the Digital Archaeological Record) | `DISCONTINUED_NO_REPLACEMENT` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | registry status text |
| 220 | 12 | 1180 | ARIADNE (ARIADNEplus portal) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 221 | 12 | 1183 | EDH — Epigraphic Database Heidelberg | `EXISTING_IMPLEMENTED` | SPARQL, BULK, REPOSITORY | 34 | 34-field-style row | github |
| 222 | 12 | 1186 | iDAI.gazetteer | `EXISTING_IMPLEMENTED` | none detected | 34 | 34-field-style row | wikidata |
| 223 | 12 | 1189 | CDLI — Cuneiform Digital Library Initiative | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 224 | 12 | 1192 | eBL — electronic Babylonian Library | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 225 | 12 | 1195 | WHG — World Historical Gazetteer | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | wikidata |
| 226 | 12 | 1198 | Nomisma.org | `EXISTING_IMPLEMENTED` | SPARQL, STAC, REPOSITORY | 34 | 34-field-style row | github |
| 227 | 12 | 1201 | Pleiades (+ nightly dumps) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | github |
| 228 | 12 | 1204 | PeriodO | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | github,wikidata |
| 229 | 12 | 1209 | ADS — Archaeology Data Service (UK) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | SPARQL, FEED, BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 230 | 12 | 1212 | PANGAEA | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | fred |
| 231 | 12 | 1217 | Cliopatria (Seshat spatial dataset) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github,wikidata |
| 232 | 12 | 1220 | D-PLACE (+ Pulotu) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 233 | 13 | 1262 | OpenHistoricalMap (OHM) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 234 | 13 | 1265 | Seshat: Global History Databank | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 235 | 13 | 1268 | Chinese Text Project (ctext.org) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | SPARQL, BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 236 | 13 | 1271 | BDRC — Buddhist Digital Resource Center | `NEW_BULK` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 237 | 13 | 1274 | EHRI — European Holocaust Research Infrastructure | `NEW_REPOSITORY` | REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 238 | 13 | 1279 | Qatar Digital Library (QDL) | `NEW_BULK` | BULK, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 239 | 13 | 1282 | e-periodica (ETH Library) | `NEW_STAC` | STAC, BULK | 34 | 34-field-style row | protocol tag |
| 240 | 13 | 1285 | Perseus / Open Greek and Latin corpora | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | github |
| 241 | 13 | 1288 | papyri.info / idp.data | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 242 | 13 | 1291 | OpenITI corpus | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | github |
| 243 | 13 | 1294 | CBETA (Chinese Buddhist canon) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 244 | 13 | 1297 | Kanripo / Kanseki Repository | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 245 | 13 | 1300 | GRETIL — Göttingen Register of Electronic Texts in Indian Languages | `DEGRADED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | registry status text |
| 246 | 14 | 1339 | EUR-Lex / CELLAR (SPARQL + REST webservice) | `CREDENTIAL_REQUIRED` | SPARQL, BULK | 34 | 34-field-style row | credential/account/key language |
| 247 | 14 | 1342 | US Congress.gov API | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github,library_of_congress |
| 248 | 14 | 1345 | US GovInfo API | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 249 | 14 | 1348 | US Federal Register API | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 250 | 14 | 1351 | UK legislation.gov.uk | `CREDENTIAL_REQUIRED` | SPARQL, FEED, BULK | 34 | 34-field-style row | credential/account/key language |
| 251 | 14 | 1354 | Japan e-Gov Hourei (法令) API | `NEW_BULK` | BULK, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 252 | 14 | 1357 | Australia Federal Register of Legislation OData API | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 253 | 14 | 1360 | UK The Gazette API | `CREDENTIAL_REQUIRED` | FEED, BULK | 34 | 34-field-style row | credential/account/key language |
| 254 | 14 | 1363 | CourtListener (Free Law Project) | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | courtlistener |
| 255 | 14 | 1366 | Canada Justice Laws (structured documents, no formal API) | `CREDENTIAL_REQUIRED` | SPARQL, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 256 | 14 | 1371 | Germany Gesetze im Internet (XML corpus, no API) | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 257 | 14 | 1374 | WIPO Lex (no official API — scrapeable search interface) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 258 | 14 | 1377 | UN Treaty Collection (no API) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 259 | 14 | 1380 | ILO NORMLEX / NATLEX (search interfaces) | `CREDENTIAL_REQUIRED` | SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 260 | 14 | 1383 | FAOLEX (search interface) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 261 | 14 | 1386 | India eGazette — NO OFFICIAL API (status note) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 262 | 14 | 1391 | OFAC Sanctions Lists (SDN + consolidated) + Sanctions List Service | `NEW_FEED` | FEED, BULK | 34 | 34-field-style row | protocol tag |
| 263 | 14 | 1394 | EU Financial Sanctions Database (FSD) — Consolidated List | `CREDENTIAL_REQUIRED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 264 | 14 | 1397 | UN Security Council Consolidated Sanctions List | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 265 | 14 | 1400 | UK OFSI Consolidated List / UK Sanctions List | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 266 | 14 | 1403 | OpenSanctions | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK | 34 | 34-field-style row | license/sales/institutional language |
| 267 | 14 | 1406 | EU BRIS — NO API (status note) | `CREDENTIAL_REQUIRED` | REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 268 | 14 | 1409 | Interpol Notices API (unofficial public JSON — degraded) | `DEGRADED` | none detected | 34 | 34-field-style row | registry status text |
| 269 | 14 | 1414 | USAspending API | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | sam_gov |
| 270 | 14 | 1417 | Brazil Portal da Transparência API | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 271 | 14 | 1420 | Open Contracting Partnership / OCDS ecosystem | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK | 34 | 34-field-style row | license/sales/institutional language |
| 272 | 14 | 1423 | EU Tenders Electronic Daily (TED) API | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | SPARQL, BULK | 34 | 34-field-style row | license/sales/institutional language |
| 273 | 14 | 1426 | EU Financial Transparency System (FTS) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 274 | 14 | 1429 | Chile Mercado Público (ChileCompra) API | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 275 | 14 | 1432 | OpenSpending (OKFN) — DEGRADED | `DISCONTINUED_WITH_REPLACEMENT` | none detected | 34 | 34-field-style row | registry status text |
| 276 | 14 | 1437 | IFES ElectionGuide API | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 277 | 14 | 1440 | International IDEA Voter Turnout Database | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 278 | 15 | 1488 | GLEIF LEI API | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 279 | 15 | 1491 | OpenCorporates | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK | 34 | 34-field-style row | license/sales/institutional language |
| 280 | 15 | 1494 | UK Companies House API | `CREDENTIAL_REQUIRED` | FEED, BULK | 34 | 34-field-style row | credential/account/key language |
| 281 | 15 | 1497 | SEC EDGAR | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | exa |
| 282 | 15 | 1500 | FRED (Federal Reserve Economic Data) | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | fred |
| 283 | 15 | 1503 | ECB Statistical Data Warehouse (SDW) SDMX API | `EXISTING_IMPLEMENTED` | SDMX | 34 | 34-field-style row | fred |
| 284 | 15 | 1506 | Bank of England Statistical Interactive Database (IADB) | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | fred |
| 285 | 15 | 1509 | Bank of Canada Valet API | `EXISTING_IMPLEMENTED` | none detected | 34 | 34-field-style row | fred |
| 286 | 15 | 1512 | BIS Data Portal API | `EXISTING_IMPLEMENTED` | SDMX | 34 | 34-field-style row | fred |
| 287 | 15 | 1515 | WTO APIs (Timeseries + Quantitative Restrictions) | `EXISTING_PARTIAL` | SDMX | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 288 | 15 | 1518 | Bank of Japan — NO API (status note) | `EXISTING_IMPLEMENTED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | fred |
| 289 | 15 | 1521 | Japan e-Stat API (government statistics portal) | `EXISTING_PARTIAL` | SDMX | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 290 | 16 | 1557 | OpenAIRE Graph API | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | crossref |
| 291 | 16 | 1560 | OpenCitations Index API (COCI et al.) | `EXISTING_IMPLEMENTED` | SPARQL, BULK | 34 | 34-field-style row | crossref |
| 292 | 16 | 1563 | bioRxiv / medRxiv API | `EXISTING_IMPLEMENTED` | FEED | 34 | 34-field-style row | semantic_scholar |
| 293 | 16 | 1566 | HAL API (France) | `CREDENTIAL_REQUIRED` | REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 294 | 16 | 1569 | J-STAGE WebAPI (Japan) | `EXISTING_PARTIAL` | FEED, BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 295 | 16 | 1572 | CiNii Research / CiNii APIs (Japan) | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 296 | 16 | 1575 | RePEc / IDEAS API | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 297 | 16 | 1578 | EconStor OAI-PMH | `CREDENTIAL_REQUIRED` | REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 298 | 16 | 1581 | SciELO network (OAI-PMH + Books OAI/OPDS) | `EXISTING_IMPLEMENTED` | STAC, REPOSITORY | 34 | 34-field-style row | github |
| 299 | 16 | 1584 | Redalyc Journal API | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 300 | 16 | 1587 | CyberLeninka (OAI-PMH) | `EXISTING_PARTIAL` | REPOSITORY | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 301 | 16 | 1590 | BASE (Bielefeld Academic Search Engine) | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 302 | 16 | 1593 | OAI-PMH institutional-repository ecosystem (summary entry) | `DISCONTINUED_NO_REPLACEMENT` | REPOSITORY | 34 | 34-field-style row | registry status text |
| 303 | 16 | 1596 | KISTI ScienceON / NDSL Open Service (Korea) — STATUS: MIGRATED/DEGRADED | `EXISTING_PARTIAL` | SEARCH_INTERFACE | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 304 | 16 | 1601 | Scopus (Elsevier) — OPERATIONAL, PAID | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | none detected | 0 | compressed or partial registry row | license/sales/institutional language |
| 305 | 16 | 1604 | Web of Science (Clarivate) — OPERATIONAL, PAID | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | none detected | 0 | compressed or partial registry row | license/sales/institutional language |
| 306 | 16 | 1607 | Lens.org Scholarly API — OPERATIONAL, FREEMIUM/PAID | `EXISTING_PARTIAL` | none detected | 0 | compressed or partial registry row | overlaps current provider family or planned blocked descriptor |
| 307 | 16 | 1610 | CNKI (China) — NO OPEN API | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | none detected | 0 | compressed or partial registry row | license/sales/institutional language |
| 308 | 16 | 1613 | DBpia / RISS (Korea) — NO OPEN API | `CREDENTIAL_REQUIRED` | none detected | 0 | compressed or partial registry row | credential/account/key language |
| 309 | 16 | 1616 | Airiti Library (Taiwan) — NO OPEN API | `CREDENTIAL_REQUIRED` | none detected | 0 | compressed or partial registry row | credential/account/key language |
| 310 | 16 | 1619 | eLibrary.ru / RSCI — PAID API ONLY | `CREDENTIAL_REQUIRED` | none detected | 0 | compressed or partial registry row | credential/account/key language |
| 311 | 16 | 1622 | SSRN (Elsevier) — NO PUBLIC API | `EXISTING_IMPLEMENTED` | FEED | 0 | compressed or partial registry row | crossref |
| 312 | 16 | 1625 | Paperity — NO OPEN API (custom extracts) | `NEW_FEED` | FEED | 0 | compressed or partial registry row | protocol tag |
| 313 | 16 | 1628 | Latindex — SEARCH INTERFACE ONLY | `NEW_SEARCH_INTERFACE` | SEARCH_INTERFACE | 0 | compressed or partial registry row | registry says no public machine API/search interface |
| 314 | 16 | 1631 | arXiv API + OAI-PMH + S3 Bulk | `EXISTING_IMPLEMENTED` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | arxiv,semantic_scholar |
| 315 | 16 | 1634 | INSPIRE-HEP REST API | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github,arxiv |
| 316 | 16 | 1637 | NASA ADS (Astrophysics Data System) API | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github,arxiv,semantic_scholar |
| 317 | 16 | 1640 | CERN Repository (CDS successor) REST + OAI-PMH | `DEGRADED` | STAC, REPOSITORY | 34 | 34-field-style row | registry status text |
| 318 | 16 | 1643 | HEPData | `NEW_BULK` | BULK, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 319 | 16 | 1646 | zbMATH Open API (mathematics) | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | arxiv,crossref |
| 320 | 16 | 1649 | OEIS (On-Line Encyclopedia of Integer Sequences) | `DEGRADED` | BULK | 34 | 34-field-style row | registry status text |
| 321 | 16 | 1654 | PDG API (Particle Data Group) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 322 | 17 | 1699 | EPO OPS (Open Patent Services) | `EXISTING_BLOCKED` | BULK | 34 | 34-field-style row | uspto |
| 323 | 17 | 1702 | USPTO Open Data Portal (ODP) API — | `EXISTING_BLOCKED` | BULK | 34 | 34-field-style row | uspto |
| 324 | 17 | 1705 | PatentsView — | `EXISTING_BLOCKED` | BULK | 34 | 34-field-style row | uspto |
| 325 | 17 | 1708 | USPTO TSDR (Trademark Status & Document Retrieval) API | `EXISTING_BLOCKED` | BULK | 34 | 34-field-style row | uspto |
| 326 | 17 | 1711 | WIPO PATENTSCOPE — NO FREE API (paid bulk only) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 327 | 17 | 1714 | KIPRIS Plus Open API (Korea) | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 328 | 17 | 1717 | J-PlatPat (JPO, Japan) — NO PUBLIC API | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 329 | 17 | 1720 | CNIPA (China) — NO PUBLIC API | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 330 | 17 | 1723 | Google Patents Public Datasets (BigQuery) + Google Patents | `EXISTING_BLOCKED` | BULK | 34 | 34-field-style row | uspto |
| 331 | 17 | 1726 | Lens.org Patent & Scholarly API | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 332 | 17 | 1729 | INPI France — data.inpi.fr + open datasets | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 333 | 17 | 1732 | IP Australia (Australian Trade Mark Search API + open data) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 334 | 17 | 1735 | EUIPO TMview / eSearch — unofficial JSON endpoint | `EXISTING_BLOCKED` | none detected | 34 | 34-field-style row | uspto |
| 335 | 18 | 1770 | OpenStreetMap Overpass API | `NEW_API` | none detected | 34 | 34-field-style row | REST/API access in registry |
| 336 | 18 | 1773 | Nominatim (OSM Geocoding) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 337 | 18 | 1776 | OSM Planet Dumps + Geofabrik Extracts | `NEW_FEED` | FEED, BULK | 34 | 34-field-style row | protocol tag |
| 338 | 18 | 1779 | GeoNames | `EXISTING_IMPLEMENTED` | BULK | 33 | 34-field-style row | exa |
| 339 | 18 | 1782 | Natural Earth | `CREDENTIAL_REQUIRED` | BULK | 33 | 34-field-style row | credential/account/key language |
| 340 | 18 | 1785 | Overture Maps Foundation (incl. GERS) | `CREDENTIAL_REQUIRED` | STAC, OGC, BULK | 33 | 34-field-style row | credential/account/key language |
| 341 | 18 | 1788 | Mapillary (street-level imagery) | `CREDENTIAL_REQUIRED` | none detected | 33 | 34-field-style row | credential/account/key language |
| 342 | 18 | 1791 | Copernicus Data Space Ecosystem (CDSE) — Sentinel data | `EXISTING_PARTIAL` | STAC, BULK | 33 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 343 | 18 | 1794 | USGS EarthExplorer Machine-to-Machine (M2M) API + Landsat on AWS | `EXISTING_PARTIAL` | STAC, BULK | 33 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 344 | 18 | 1797 | NASA Earthdata — CMR API (cross-ref: registered) | `EXISTING_PARTIAL` | STAC, BULK | 33 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 345 | 18 | 1800 | JAXA G-Portal | `DISCONTINUED_NO_REPLACEMENT` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | registry status text |
| 346 | 18 | 1803 | INPE — Brazil CBERS/Amazonia-1 STAC (CDSR) | `EXISTING_PARTIAL` | STAC, FEED, BULK | 33 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 347 | 18 | 1806 | ISRO Bhuvan | `EXISTING_PARTIAL` | STAC, OGC, BULK | 33 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 348 | 18 | 1809 | OpenTopography API | `EXISTING_PARTIAL` | none detected | 33 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 349 | 18 | 1812 | GEBCO Bathymetry | `CREDENTIAL_REQUIRED` | OGC, BULK | 33 | 34-field-style row | credential/account/key language |
| 350 | 18 | 1815 | National mapping agency OGC services (grouped) | `EXISTING_BLOCKED` | OGC, BULK | 33 | 34-field-style row | usgs_national_map |
| 351 | 19 | 1842 | CelesTrak GP/TLE data | `NEW_BULK` | BULK, REPOSITORY | 33 | 34-field-style row | protocol tag |
| 352 | 19 | 1845 | Space-Track.org | `CREDENTIAL_REQUIRED` | BULK | 33 | 34-field-style row | credential/account/key language |
| 353 | 19 | 1848 | ESA DISCOSweb API | `CREDENTIAL_REQUIRED` | none detected | 33 | 34-field-style row | credential/account/key language |
| 354 | 19 | 1851 | N2YO Satellite Tracking API | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 33 | 34-field-style row | credential/account/key language |
| 355 | 19 | 1854 | NOAA Space Weather Prediction Center (SWPC) JSON services | `NEW_API` | none detected | 33 | 34-field-style row | REST/API access in registry |
| 356 | 19 | 1857 | JPL Horizons API | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 357 | 19 | 1860 | JPL Small-Body Database (SBDB) API | `NEW_API` | none detected | 33 | 34-field-style row | REST/API access in registry |
| 358 | 19 | 1863 | IAU Minor Planet Center APIs | `NEW_BULK` | BULK | 33 | 34-field-style row | protocol tag |
| 359 | 19 | 1866 | NASA Open APIs (api.nasa.gov) | `EXISTING_IMPLEMENTED` | FEED | 33 | 34-field-style row | nasa |
| 360 | 19 | 1869 | NASA Exoplanet Archive (TAP) | `DEGRADED` | BULK | 33 | 34-field-style row | registry status text |
| 361 | 19 | 1872 | CDS — SIMBAD + VizieR (TAP/cone/script) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | none detected | 33 | 34-field-style row | license/sales/institutional language |
| 362 | 19 | 1875 | ESA Gaia Archive (TAP+) | `CREDENTIAL_REQUIRED` | BULK | 33 | 34-field-style row | credential/account/key language |
| 363 | 19 | 1878 | MAST — Mikulski Archive for Space Telescopes (STScI) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK | 33 | 34-field-style row | license/sales/institutional language |
| 364 | 19 | 1881 | SDSS SkyServer / SciServer CasJobs | `CREDENTIAL_REQUIRED` | REPOSITORY | 33 | 34-field-style row | credential/account/key language |
| 365 | 20 | 1904 | IEEE Xplore Metadata API | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | crossref |
| 366 | 20 | 1907 | ETSI Standards Portal | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 367 | 20 | 1910 | ITU-T Recommendations | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 368 | 20 | 1913 | ISO / IEC / ASTM / DIN / JIS / GB standards — STATUS NOTE (no APIs) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | SEARCH_INTERFACE | 0 | compressed or partial registry row | license/sales/institutional language |
| 369 | 20 | 1916 | NIST Chemistry WebBook / SRD web databases — NO API | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | license/sales/institutional language |
| 370 | 20 | 1919 | NIST CODATA Fundamental Physical Constants (SRD 121) | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 371 | 20 | 1922 | NIST JARVIS (JARVIS-DFT/QC/ML + REST + Figshare) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 372 | 20 | 1925 | Materials Project API (mp-api) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 373 | 20 | 1928 | NOMAD Repository & Archive (FAIRmat) | `CREDENTIAL_REQUIRED` | BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 374 | 20 | 1931 | OQMD (Open Quantum Materials Database) | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 375 | 20 | 1934 | AFLOW (AFLUX REST API) | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 376 | 20 | 1937 | MPDS (Materials Platform for Data Science) — Russia | `CREDENTIAL_REQUIRED` | FEED, BULK | 34 | 34-field-style row | credential/account/key language |
| 377 | 20 | 1940 | CCDC CSD (Cambridge Structural Database) — COMMERCIAL | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | none detected | 34 | 34-field-style row | license/sales/institutional language |
| 378 | 20 | 1943 | NIMS MatNavi (AtomWork / SuperCon) — Japan — SEARCH ONLY | `CREDENTIAL_REQUIRED` | FEED, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 379 | 21 | 1964 | Trove API v3 (Australia) | `DISCONTINUED_WITH_REPLACEMENT` | BULK, REPOSITORY | 34 | 34-field-style row | registry status text |
| 380 | 21 | 1967 | DigitalNZ API v3 | `CREDENTIAL_REQUIRED` | REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 381 | 21 | 1970 | Deutsche Digitale Bibliothek (DDB) REST API | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | REPOSITORY | 34 | 34-field-style row | license/sales/institutional language |
| 382 | 21 | 1973 | NDL Search API (National Diet Library, Japan) | `CREDENTIAL_REQUIRED` | REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 383 | 21 | 1976 | NDL Digital Collections — IIIF API (Japan) | `NEW_BULK` | BULK, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 384 | 21 | 1979 | Japan Search (ジャパンサーチ) | `NEW_SPARQL` | SPARQL, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 385 | 21 | 1982 | LIBRIS XL APIs (Sweden) | `CREDENTIAL_REQUIRED` | SPARQL, BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 386 | 21 | 1985 | Finna API (Finland) | `CREDENTIAL_REQUIRED` | SPARQL | 34 | 34-field-style row | credential/account/key language |
| 387 | 21 | 1988 | Nasjonalbiblioteket API (Norway) | `CREDENTIAL_REQUIRED` | REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 388 | 21 | 1991 | KB Netherlands / Delpher APIs | `CREDENTIAL_REQUIRED` | BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 389 | 21 | 1994 | datos.bne.es — BNE Linked Data (Spain) | `EXISTING_PARTIAL` | SPARQL, BULK | 33 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 390 | 21 | 1997 | CulturaItalia / Internet Culturale (Italy) | `CREDENTIAL_REQUIRED` | SPARQL, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 391 | 21 | 2000 | Polona (Poland) — DEGRADED/UNDOCUMENTED API | `DEGRADED` | BULK, REPOSITORY | 34 | 34-field-style row | registry status text |
| 392 | 21 | 2003 | NARA Catalog API v2 (USA) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 393 | 21 | 2006 | Archivportal-D (Germany) | `CREDENTIAL_REQUIRED` | REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 394 | 21 | 2009 | AtoM-based archives (Access to Memory) — ecosystem entry | `CREDENTIAL_REQUIRED` | FEED, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 395 | 21 | 2012 | JACAR (Japan) — NO PUBLIC API | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 396 | 21 | 2015 | RecordSearch — National Archives of Australia — DEGRADED (NO API) | `DISCONTINUED_NO_REPLACEMENT` | REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | registry status text |
| 397 | 21 | 2018 | Other national archives — status flags (no full blocks) | `NEW_BULK` | BULK, SEARCH_INTERFACE | 0 | compressed or partial registry row | protocol tag |
| 398 | 21 | 2033 | Art Institute of Chicago API | `NEW_REPOSITORY` | REPOSITORY | 34 | 34-field-style row | protocol tag |
| 399 | 21 | 2036 | Cleveland Museum of Art Open Access API | `NEW_REPOSITORY` | REPOSITORY | 34 | 34-field-style row | protocol tag |
| 400 | 21 | 2039 | V&A API (Victoria and Albert Museum) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 401 | 21 | 2042 | SMK API (National Gallery of Denmark) | `NEW_REPOSITORY` | REPOSITORY | 34 | 34-field-style row | protocol tag |
| 402 | 21 | 2045 | Harvard Art Museums API | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | github |
| 403 | 21 | 2048 | Cooper Hewitt Smithsonian Design Museum API | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 404 | 21 | 2051 | Paris Musées Collections API | `CREDENTIAL_REQUIRED` | GRAPHQL, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 405 | 21 | 2054 | Finnish National Gallery API | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 406 | 21 | 2057 | Nasjonalmuseet Collection API (Norway) | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 407 | 21 | 2060 | Te Papa Collections API (New Zealand) | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 408 | 21 | 2063 | Wellcome Collection API | `EXISTING_IMPLEMENTED` | BULK | 34 | 34-field-style row | internet_archive |
| 409 | 21 | 2066 | National Gallery (London) NG Data API | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 410 | 21 | 2069 | ColBase (National Museums Japan) — NO API; use Japan Search (B6) | `CREDENTIAL_REQUIRED` | SPARQL, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 411 | 21 | 2072 | JSTOR / Artstor — STATUS: RETIRED/MERGED; Constellate DISCONTINUED | `EXISTING_PARTIAL` | SEARCH_INTERFACE | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 412 | 21 | 2075 | Google Arts & Culture — NO PUBLIC API (confirmed) | `NEW_BULK` | BULK | 0 | compressed or partial registry row | protocol tag |
| 413 | 21 | 2078 | e-Museum (Japan) — UI ONLY | `NEW_SEARCH_INTERFACE` | SEARCH_INTERFACE | 0 | compressed or partial registry row | registry says no public machine API/search interface |
| 414 | 21 | 2081 | Walters Art Museum — NO API (open content via website/GitHub CC0) | `EXISTING_IMPLEMENTED` | REPOSITORY, SEARCH_INTERFACE | 0 | compressed or partial registry row | github |
| 415 | 21 | 2084 | Brooklyn Museum API — REGISTRATION-GATED, LOW ACTIVITY | `EXISTING_IMPLEMENTED` | REPOSITORY | 0 | compressed or partial registry row | github |
| 416 | 22 | 2115 | impresso — Media Monitoring of the Past | `CREDENTIAL_REQUIRED` | STAC, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 417 | 22 | 2118 | National Library of Israel (NLI) APIs | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | internet_archive |
| 418 | 22 | 2121 | e-periodica (ETH Library) | `NEW_STAC` | STAC, BULK | 34 | 34-field-style row | protocol tag |
| 419 | 22 | 2124 | ANNO — AustriaN Newspapers Online (ÖNB) | `NEW_BULK` | BULK | 34 | 34-field-style row | protocol tag |
| 420 | 23 | 2151 | EUROSTAT Dissemination API — SDMX+REST+BULK / Tier A / EASY | `EXISTING_PARTIAL` | SDMX, BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 421 | 23 | 2154 | OECD Data Explorer API (new SDMX) — SDMX / Tier A / MODERATE | `EXISTING_IMPLEMENTED` | SDMX, BULK, REPOSITORY | 34 | 34-field-style row | exa |
| 422 | 23 | 2157 | UN SDG Global Database API — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 423 | 23 | 2160 | UN DESA Population Division Data Portal API (World Population Prospects) — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 424 | 23 | 2163 | UNESCO UIS Data API + BDDS — REST+BULK / Tier A / EASY | `EXISTING_PARTIAL` | SDMX, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 425 | 23 | 2166 | IDB "Numbers for Development" (mydata.iadb.org) — REST (Socrata SODA) / Tier A / EASY | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 426 | 23 | 2169 | AidData — BULK ONLY / Tier B / EASY | `EXISTING_PARTIAL` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 427 | 23 | 2172 | UK ONS Website API — REST / Tier A / EASY | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 428 | 23 | 2175 | Nomis API (UK labour market) — REST+SDMX / Tier A/B / EASY | `CREDENTIAL_REQUIRED` | SDMX, BULK | 34 | 34-field-style row | credential/account/key language |
| 429 | 23 | 2178 | Destatis GENESIS-Online API — REST / Tier A / MODERATE | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 430 | 23 | 2181 | INSEE BDM API — SDMX / Tier A / MODERATE | `EXISTING_PARTIAL` | SDMX, BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 431 | 23 | 2184 | Istat I.Stat SDMX — SDMX / Tier A / EASY | `EXISTING_PARTIAL` | SDMX | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 432 | 23 | 2187 | INE Spain Tempus3 API — REST / Tier A / EASY | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 433 | 23 | 2190 | CBS Netherlands StatLine Open Data — OData v3/v4 + FEED / Tier A / EASY | `EXISTING_PARTIAL` | FEED, BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 434 | 23 | 2193 | Statistics Sweden (SCB) PxWeb API — PXWEB (v1+v2) / Tier A / EASY | `EXISTING_PARTIAL` | SDMX, STAC | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 435 | 23 | 2196 | Statistics Norway (SSB) PxWeb API — PXWEB / Tier A / EASY | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 436 | 23 | 2199 | Danmarks Statistik API — REST / Tier A / EASY | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 437 | 23 | 2202 | Statistics Finland PxWeb API — PXWEB / Tier A / EASY | `EXISTING_PARTIAL` | SDMX | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 438 | 23 | 2205 | GUS BDL API (Poland) — REST / Tier A / EASY | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 439 | 23 | 2208 | Czech CZSO Open Data (VDB CKAN) — CKAN REST / Tier A / EASY | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 440 | 23 | 2211 | Rosstat / EMISS fedstat Open Data API — REST (key) / Tier A / HARD | `EXISTING_PARTIAL` | none detected | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 441 | 23 | 2214 | e-Stat Japan API — REST / Tier A / EASY | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 442 | 23 | 2217 | KOSIS Open API (Korea) — REST / Tier A / EASY | `EXISTING_PARTIAL` | SDMX, BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 443 | 23 | 2220 | China NBS National Data (data.stats.gov.cn) — SEARCH INTERFACE (undocumented JSON) / Tier A / HARD | `EXISTING_PARTIAL` | SEARCH_INTERFACE | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 444 | 23 | 2223 | India: eSankhyiki + OGD data.gov.in — internal JSON + REST (key) / Tier A / MODERATE | `CREDENTIAL_REQUIRED` | BULK | 29 | field-count below full schema | credential/account/key language |
| 445 | 23 | 2227 | Indonesia BPS WebAPI — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 446 | 23 | 2230 | SingStat Table Builder API (Singapore) — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 447 | 23 | 2233 | Malaysia: data.gov.my Data Catalogue API (DOSM) — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 448 | 23 | 2236 | Philippines PSA OpenSTAT — PXWEB / Tier A / EASY | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 449 | 23 | 2239 | ABS Data API (Australia) — SDMX / Tier A / MODERATE | `EXISTING_PARTIAL` | SDMX | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 450 | 23 | 2242 | Stats NZ Aotearoa Data Explorer API — SDMX / Tier A / MODERATE | `EXISTING_PARTIAL` | SDMX | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 451 | 23 | 2245 | US Census Bureau Data API — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 452 | 23 | 2248 | Statistics Canada Web Data Service (WDS) — REST (POST) / Tier A / MODERATE | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 453 | 23 | 2251 | Brazil IBGE SIDRA API — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 454 | 23 | 2254 | Argentina datos.gob.ar Series API — REST / Tier A / EASY | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 455 | 23 | 2257 | Mexico INEGI APIs (BIE/BISE/DENUE) — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 456 | 23 | 2260 | Colombia datos.gov.co (DANE datasets) — REST (Socrata SODA) / Tier A / EASY | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 457 | 23 | 2263 | US EIA Open Data API v2 — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 458 | 23 | 2266 | Israel CBS APIs — REST / Tier A / MODERATE | `EXISTING_PARTIAL` | BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 459 | 23 | 2269 | TurkStat (TÜİK) — SEARCH INTERFACE + BULK / Tier A / HARD | `EXISTING_PARTIAL` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 460 | 23 | 2272 | Saudi Arabia GASTAT / National Open Data — CKAN REST (national portal) / Tier A / MODERATE | `EXISTING_IMPLEMENTED` | SEARCH_INTERFACE | 34 | 34-field-style row | exa |
| 461 | 23 | 2275 | Gapminder Data — BULK + REPOSITORY / Tier C / EASY | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 462 | 23 | 2278 | GADM — BULK DOWNLOAD / Tier B/C / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 463 | 23 | 2281 | Taiwan DGBAS National Statistics — SEARCH INTERFACE + national open-data API / Tier A / MODERATE | `NEW_SEARCH_INTERFACE` | SEARCH_INTERFACE | 0 | compressed or partial registry row | registry says no public machine API/search interface |
| 464 | 23 | 2284 | Thailand NSO statbbi — SEARCH INTERFACE (+ unverified API) / Tier A / MODERATE | `DEGRADED` | BULK, SEARCH_INTERFACE | 0 | compressed or partial registry row | registry status text |
| 465 | 23 | 2287 | Vietnam GSO PX-Web — PXWEB interface (API endpoint unverified) / Tier A / MODERATE | `DEGRADED` | BULK, SEARCH_INTERFACE | 0 | compressed or partial registry row | registry status text |
| 466 | 24 | 2323 | UNHCR Refugee Data API — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 467 | 24 | 2326 | IOM DTM (Displacement Tracking Matrix) API — REST (Azure APIM) / Tier A / MODERATE | `EXISTING_IMPLEMENTED` | none detected | 34 | 34-field-style row | exa |
| 468 | 24 | 2329 | WTO Stats / Timeseries API — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 469 | 24 | 2332 | ADB Key Indicators Database SDMX API — SDMX / Tier A / MODERATE | `EXISTING_PARTIAL` | SDMX, BULK | 34 | 34-field-style row | overlaps current provider family or planned blocked descriptor |
| 470 | 24 | 2335 | ECLAC CEPALSTAT Open Data API — REST / Tier A / MODERATE | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 471 | 24 | 2338 | IEA Data & Statistics API — REST (commercial) / Tier A / HARD | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 472 | 24 | 2341 | UN Data (data.un.org) — LEGACY SDMX + BULK / Tier A / MODERATE | `CREDENTIAL_REQUIRED` | SDMX, STAC, BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 473 | 24 | 2344 | ReliefWeb API v2 — REST / Tier A / EASY | `DISCONTINUED_NO_REPLACEMENT` | none detected | 34 | 34-field-style row | registry status text |
| 474 | 24 | 2347 | OCHA Financial Tracking Service (FTS) API — REST / Tier A / EASY | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 475 | 24 | 2350 | IATI Datastore API (new) — REST / Tier A (initiative) / E (community) / MODERATE | `EXISTING_IMPLEMENTED` | none detected | 34 | 34-field-style row | exa |
| 476 | 24 | 2353 | WIPO IP Statistics Data Center — SEARCH INTERFACE + BULK / Tier A / HARD | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 0 | compressed or partial registry row | credential/account/key language |
| 477 | 24 | 2356 | ITU DataHub — SEARCH INTERFACE (+ bulk) / Tier A / MODERATE | `NEW_BULK` | BULK, SEARCH_INTERFACE | 0 | compressed or partial registry row | protocol tag |
| 478 | 24 | 2359 | UNIDO Statistics Data Portal — SEARCH INTERFACE / Tier A / MODERATE | `CREDENTIAL_REQUIRED` | SEARCH_INTERFACE | 0 | compressed or partial registry row | credential/account/key language |
| 479 | 25 | 2382 | China Biographical Database (CBDB) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 480 | 25 | 2385 | Japan Search (ジャパンサーチ) | `NEW_SPARQL` | SPARQL | 34 | 34-field-style row | protocol tag |
| 481 | 25 | 2388 | Korea Public Data Portal (data.go.kr) | `CREDENTIAL_REQUIRED` | BULK | 34 | 34-field-style row | credential/account/key language |
| 482 | 25 | 2391 | Local Contexts Hub | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 483 | 25 | 2394 | OpenSky Network | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 484 | 25 | 2397 | xeno-canto | `DISCONTINUED_NO_REPLACEMENT` | BULK | 34 | 34-field-style row | registry status text |
| 485 | 25 | 2400 | Movebank | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 486 | 25 | 2403 | SatNOGS Network | `NEW_API` | none detected | 34 | 34-field-style row | REST/API access in registry |
| 487 | 25 | 2406 | Mushroom Observer | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 488 | 25 | 2409 | Ocean Networks Canada (Oceans 3.0) | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | github |
| 489 | 25 | 2412 | LibriVox | `EXISTING_IMPLEMENTED` | FEED | 34 | 34-field-style row | internet_archive |
| 490 | 25 | 2415 | Project Gutenberg (+Gutendex) | `EXISTING_IMPLEMENTED` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | github |
| 491 | 25 | 2418 | Standard Ebooks | `EXISTING_IMPLEMENTED` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | github |
| 492 | 25 | 2421 | DigitalNZ API (Papers Past metadata) | `NEW_BULK` | BULK, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 493 | 25 | 2424 | India OGD Platform (data.gov.in) | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 494 | 25 | 2427 | Arctic Data Center (DataONE MN) | `CREDENTIAL_REQUIRED` | none detected | 34 | 34-field-style row | credential/account/key language |
| 495 | 25 | 2430 | LA Referencia | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | REPOSITORY | 34 | 34-field-style row | license/sales/institutional language |
| 496 | 25 | 2433 | CLACSO Digital Repository | `DEGRADED` | REPOSITORY | 34 | 34-field-style row | registry status text |
| 497 | 25 | 2436 | Shodhganga | `CREDENTIAL_REQUIRED` | REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 498 | 25 | 2439 | DOAB (Directory of Open Access Books) | `CREDENTIAL_REQUIRED` | FEED, BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 499 | 25 | 2442 | PARADISEC | `NEW_REPOSITORY` | REPOSITORY | 34 | 34-field-style row | protocol tag |
| 500 | 25 | 2445 | OLAC (Open Language Archives Community) | `DEGRADED` | FEED, BULK, REPOSITORY, SEARCH_INTERFACE | 34 | 34-field-style row | registry status text |
| 501 | 25 | 2448 | Pangloss Collection (CoCoon platform) | `CREDENTIAL_REQUIRED` | BULK, REPOSITORY | 34 | 34-field-style row | credential/account/key language |
| 502 | 25 | 2451 | AILLA | `EXISTING_IMPLEMENTED` | REPOSITORY | 34 | 34-field-style row | exa |
| 503 | 25 | 2454 | CHGIS (China Historical GIS) | `CREDENTIAL_REQUIRED` | FEED, BULK | 34 | 34-field-style row | credential/account/key language |
| 504 | 25 | 2457 | Aozora Bunko (青空文庫) | `NEW_BULK` | BULK, REPOSITORY | 34 | 34-field-style row | protocol tag |
| 505 | 25 | 2460 | GRETIL | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 506 | 25 | 2463 | OurAirports | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 507 | 25 | 2466 | Smithsonian Global Volcanism Program | `NEW_BULK` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | protocol tag |
| 508 | 25 | 2469 | Wildlife Insights | `CREDENTIAL_REQUIRED` | BULK, SEARCH_INTERFACE | 34 | 34-field-style row | credential/account/key language |
| 509 | 25 | 2472 | al-Maktaba al-Shamela (المكتبة الشاملة) | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 34 | 34-field-style row | github |
| 510 | 25 | 2475 | CNKI (中国知网) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | SEARCH_INTERFACE | 19 | compressed or partial registry row | license/sales/institutional language |
| 511 | 25 | 2477 | NCPSSD / NSSD (国家哲学社会科学文献中心) | `CREDENTIAL_REQUIRED` | SEARCH_INTERFACE | 20 | field-count below full schema | credential/account/key language |
| 512 | 25 | 2479 | Wanfang Data (万方数据) | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | SEARCH_INTERFACE | 13 | compressed or partial registry row | license/sales/institutional language |
| 513 | 25 | 2481 | Korean Classics DB (고전종합DB, db.itkc.or.kr) | `NEW_SEARCH_INTERFACE` | SEARCH_INTERFACE | 14 | compressed or partial registry row | registry says no public machine API/search interface |
| 514 | 25 | 2483 | Korean History DB (역사정보통합시스템) | `NEW_SEARCH_INTERFACE` | SEARCH_INTERFACE | 11 | compressed or partial registry row | registry says no public machine API/search interface |
| 515 | 25 | 2485 | EncyKorea (한국민족문화대백과) | `NEW_SEARCH_INTERFACE` | SEARCH_INTERFACE | 10 | compressed or partial registry row | registry says no public machine API/search interface |
| 516 | 25 | 2487 | CyberLeninka (КиберЛенинка) | `NEW_SEARCH_INTERFACE` | SEARCH_INTERFACE | 12 | compressed or partial registry row | registry says no public machine API/search interface |
| 517 | 25 | 2489 | eLibrary.ru | `NEW_SEARCH_INTERFACE` | SEARCH_INTERFACE | 10 | compressed or partial registry row | registry says no public machine API/search interface |
| 518 | 25 | 2491 | Dialnet | `PARTNERSHIP_OR_CONTRACT_REQUIRED` | SEARCH_INTERFACE | 11 | compressed or partial registry row | license/sales/institutional language |
| 519 | 25 | 2493 | Qatar Digital Library | `NEW_REPOSITORY` | REPOSITORY, SEARCH_INTERFACE | 10 | compressed or partial registry row | protocol tag |
| 520 | 25 | 2495 | OpenFlights | `EXISTING_IMPLEMENTED` | BULK, REPOSITORY | 10 | compressed or partial registry row | github |
| 521 | 25 | 2497 | Find a Grave | `DISCONTINUED_NO_REPLACEMENT` | SEARCH_INTERFACE | 11 | compressed or partial registry row | registry status text |

## Wave 1 Amendment — Existing GitHub Provider Capability Closure

Wave 1 changed no registry source records and removed no ledger placements. The all-521 master ledger remains traceable with unaccounted count `0`.

| Registry placement | Previous classification | Provider ID | Verified capability | Implementation action | Authoritative evidence | Tests/probes | Resulting state | Remaining gap | Affected categories |
|---|---|---|---|---|---|---|---|---|---|
| GitHub REST/GraphQL API — PRIMARY BLOCK | `EXISTING_IMPLEMENTED` | `github` | Explicit issue and pull-request search using GitHub REST Search API `/search/issues` with `is:issue` / `is:pr` qualifiers | Extended existing `github` adapter only; default repository search remains unchanged; no new provider ID | GitHub REST search documentation: `/search/issues`, query qualifiers, 1,000-result search limit, query-length rules, and search rate limits | Mocked tests `re_403`–`re_405`; controlled live API requests: 0; product/download requests: 0 | `EXISTING_IMPLEMENTED` with explicit Wave 1 issue/PR prefix support | No code search, commit search, release search, GraphQL, write path, or repository-specific release listing in Wave 1 | 02, 03 |
| GitHub REST API (Issues/PRs/Releases) | `EXISTING_IMPLEMENTED` | `github` | Issues and PRs portion only; releases remain blocked for this wave because no global release-search endpoint was selected | Added explicit `github issues:` and `github prs:` prefixes; no release implementation | GitHub REST search docs identify issues/PRs as searchable through `/search/issues`; release listing is repository-specific and not equivalent to global search | Mocked tests `re_403`–`re_405`; controlled live API requests: 0; product/download requests: 0 | `EXISTING_IMPLEMENTED` for issue/PR search sub-capability | Release search/listing remains later-wave/manual design because it requires repo-specific targeting and a separate dispatch contract | 03 |

Wave 1 false-positive note: many `EXISTING_IMPLEMENTED` rows in the initial reconciliation are overlap markers rather than proof of callable support. This amendment only treats the two GitHub placements above as modified. Rows that merely mention a GitHub-hosted repository, Wikidata overlap, NCBI overlap, or Exa-web discoverability are not treated as implemented adapters without a direct provider contract.

## Validation Plan Executed After Report Creation

The command results below reflect the Wave 1 Targeted Repair pass (H-1 mode-qualifier fix, M-1 generic-search compatibility restore, and the associated `re_406`/`re_407` regression coverage in `lib/research-engine/diagnostics/validation.ts`). No live network calls, staging, commits, or pushes were performed to produce these results.

- `npm run validate:research-engine`: PASS — 491/491 (up from 489; adds `re_406_github_issues_mode_strips_conflicting_pr_discriminator` and `re_407_github_pr_mode_strips_conflicting_issue_discriminator`)
- `npx tsc --noEmit`: PASS — exit 0, no errors
- `npm run lint`: PASS — exit 0, no errors
- `npm run build`: PASS — exit 0, production build completed

## Final Inventory Verdict

All 521 declared Earth Knowledge category placements are accounted for in this report. No source is deleted, merged away, or treated as implemented without existing code evidence.
