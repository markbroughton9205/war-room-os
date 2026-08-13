# Academic Literature & Knowledge Graphs — Kimi Report Reconciliation Ledger

**Recovered source:** `docs/research/earth-knowledge/kimi-source-reports/academic_literature_knowledge_graphs.md`
**Original ZIP member:** `19fdea6e-e5b2-8217-8000-0f23f8bc5ee9/academic_literature_knowledge_graphs.md` (from `Kimi_Agent_African History API Request.zip`)
**Recovered file SHA-256:** `a6e26fb978d98b85e1c5fcecf1f3464da80a4e7ce4cfd84210b1ae89b0ed8db6` (byte-identical to ZIP member)
**Size / line count:** 21,765 bytes / 81 lines
**Classification:** DOMAIN_REPORT — orphan/pre-Wave exploratory report, academic literature + knowledge graph focus, with a dedicated Africa-specific scholarly portals section
**Compared against:**
- Master registry — `docs/research/earth-knowledge/earth_knowledge_source_registry.md` (SHA-256 `39476753d6dade4a269dfec739ded2a71476dfabf7ce10dc64329b104e5fdcd4`, unchanged)
- Africa registry — `docs/research/source-registries/war_room_africa_api_registry.md` (SHA-256 `fe6ace3773ac5622e79e09c3172587424bdb77b4e1e0205ab275f892cbae4244`, unchanged)

**Method note:** No web access, no API calls. All comparisons are local, static text comparisons against the two registry files as they currently exist in the repo. No source was silently deduplicated — every substantive entity from the Kimi report gets its own row below even where the relationship is EXACT_DUPLICATE.

**Headline finding:** The Africa registry's `TIER 8 — ACADEMIC LITERATURE` section (`## 8.1`–`## 8.18`, lines 358–412) is a near-verbatim, field-for-field condensation of 18 of this report's 21 sources — same numbering order, same endpoints, same rate limits, same gap notes, same `WARROOM_*` env var names. This strongly indicates the Africa registry's academic tier was built directly from this Kimi report (or an equivalent copy of it), not independently. The master (global) registry, by contrast, only carries a **cross-reference stub** for 9 of these sources (`earth_knowledge_source_registry.md:1547`: *"Already registered by other agents (per file 13 & 11 cross-refs, NOT duplicated): OpenAlex, Crossref, Semantic Scholar, CORE, Unpaywall, DOAJ, Zenodo, Figshare, Dataverse, PubChem, ChEMBL"*) — meaning the master document currently has no inline full entry for those 9, only a placeholder note. That gap is real and is the main residual value of this recovered report.

---

## Ledger

### 1. OpenAlex
- **Org / region:** OurResearch / Global
- **Function:** Global scholarly graph — works, authors, institutions, citation graph
- **Access / protocol:** REST + monthly S3 snapshot; JSON / gzip JSONL
- **Auth:** No key; optional `mailto` for polite pool
- **Cost / restrictions:** Free, CC0
- **Kimi status:** Full 24-field profile, HIGH authority rating, African coverage note (via DOAJ/AJOL/SciELO ingestion)
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — master has only the line-1547 cross-reference stub, no inline entry
- **Master match:** none inline (stub only)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.1 OpenAlex` and table row 85
- **Africa match:** `war_room_africa_api_registry.md:361, 566`
- **Provenance/specificity-loss risk:** Low — Africa registry condensed but preserved the substantive facts; master's narrative "widely adopted in scientometrics" framing is dropped everywhere but here
- **Recommended treatment:** FUTURE_LIVE_INTEGRATION_CANDIDATE

### 2. Crossref REST API
- **Org / region:** Crossref / Global
- **Function:** DOI registration metadata, 160M+ records
- **Access / protocol:** REST; JSON (also XML)
- **Auth:** No key; optional mailto for polite pool
- **Cost / restrictions:** Free (Metadata Plus paid tier separate)
- **Kimi status:** Full 24-field profile, HIGH authority
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — master's only content is the line-1547 stub plus a passing mention at line 227 ("Crossref/DOI/Handle — scholarly identifiers wave")
- **Master match:** none inline (stub + passing mention)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.2 Crossref REST`
- **Africa match:** `war_room_africa_api_registry.md:363-364, 567`
- **Provenance/specificity-loss risk:** Low
- **Recommended treatment:** EXISTING_GLOBAL_OVERLAP — already `IMPLEMENTED_PROVIDER` in Research Engine (`lib/research-engine/providers/crossref.ts`)

### 3. Semantic Scholar Graph API
- **Org / region:** Allen Institute for AI / Global
- **Function:** 214M+ papers, citation-context graph, TLDRs
- **Access / protocol:** REST; JSON
- **Auth:** Optional key (recommended); shared anonymous pool otherwise
- **Cost / restrictions:** Free, ODC-BY
- **Kimi status:** Full 24-field profile, HIGH authority; notes key approval can take weeks
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — line-1547 stub only
- **Master match:** none inline (stub only)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.3 Semantic Scholar`
- **Africa match:** `war_room_africa_api_registry.md:366-368, 568`
- **Provenance/specificity-loss risk:** Low
- **Recommended treatment:** EXISTING_GLOBAL_OVERLAP — already `IMPLEMENTED_PROVIDER` (`lib/research-engine/providers/semanticScholar.ts`)

### 4. CORE API v3
- **Org / region:** CORE / Open University & Jisc (UK) / Global, strong African institutional-repository coverage
- **Function:** 452M+ OA records, 57M+ full texts, largest OA aggregator
- **Access / protocol:** REST + OAI-PMH; JSON
- **Auth:** Optional key (required for full-text field)
- **Cost / restrictions:** Free tier; faster rates for members
- **Kimi status:** Full 24-field profile, HIGH authority — explicitly flagged "excellent for African theses/repository content"
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — line-1547 stub only
- **Master match:** none inline (stub only)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.4 CORE API v3`, explicitly annotated "(strong African IR coverage)"
- **Africa match:** `war_room_africa_api_registry.md:369-370`
- **Provenance/specificity-loss risk:** Low
- **Recommended treatment:** FUTURE_LIVE_INTEGRATION_CANDIDATE

### 5. Unpaywall API
- **Org / region:** OurResearch / Global
- **Function:** OA status + best legal full-text location resolver for 50M+ DOIs
- **Access / protocol:** REST; JSON
- **Auth:** No key; `email` param required
- **Cost / restrictions:** Free, CC-BY 4.0
- **Kimi status:** Full 24-field profile, HIGH authority
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — line-1547 stub only
- **Master match:** none inline (stub only)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.5 Unpaywall`
- **Africa match:** `war_room_africa_api_registry.md:372-373, 570`
- **Provenance/specificity-loss risk:** Low
- **Recommended treatment:** FUTURE_LIVE_INTEGRATION_CANDIDATE — complements the already-implemented Crossref adapter

### 6. arXiv API
- **Org / region:** Cornell University / arXiv / US, global content
- **Function:** Preprints — physics, math, CS, q-bio, econ
- **Access / protocol:** REST (Atom XML) + OAI-PMH + S3 bulk
- **Auth:** None
- **Cost / restrictions:** Free; metadata CC0, e-print redistribution restricted
- **Kimi status:** Full 24-field profile, HIGH authority "for its scope"; notes weak African-humanities coverage
- **Master relationship:** MASTER_HAS_BROADER_SOURCE — master's entry (`earth_knowledge_source_registry.md:1631-1632`) documents the March 2025 OAI-PMH host migration (`oaipmh.arxiv.org`) and the requester-pays S3 bucket detail (`s3://arxiv`, ~9.2 TB), which the Kimi report does not carry
- **Master match:** `earth_knowledge_source_registry.md:1631` ("arXiv API + OAI-PMH + S3 Bulk")
- **Africa registry relationship:** OVERLAPPING (near-duplicate, condensed) — `## 8.6 arXiv`
- **Africa match:** `war_room_africa_api_registry.md:375-376, 2817` (master table row 282)
- **Provenance/specificity-loss risk:** None — master is the richer/more current copy here
- **Recommended treatment:** EXISTING_GLOBAL_OVERLAP — already `IMPLEMENTED_PROVIDER` (`lib/research-engine/providers/arxiv.ts`)

### 7. DOAJ API + OAI-PMH
- **Org / region:** Directory of Open Access Journals / Global, strong Africa representation
- **Function:** Vetted whitelist of 20k+ OA journals, incl. hundreds of African titles (AJOL partners)
- **Access / protocol:** REST + OAI-PMH + bulk CSV/JSON dump
- **Auth:** None (public API); key for premium feed
- **Cost / restrictions:** Free, CC BY-SA
- **Kimi status:** Full 24-field profile, HIGH authority — flagged as "key for African journal discovery"
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — line-1547 stub only
- **Master match:** none inline (stub only)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.7 DOAJ`
- **Africa match:** `war_room_africa_api_registry.md:378-379, 571`
- **Provenance/specificity-loss risk:** Low
- **Recommended treatment:** FUTURE_LIVE_INTEGRATION_CANDIDATE

### 8. BASE (Bielefeld Academic Search Engine)
- **Org / region:** Bielefeld University Library / Germany, global OAI-harvested corpus
- **Function:** 400M+ records from 12k+ OAI-PMH content providers, incl. African institutional repositories
- **Access / protocol:** REST (SRU-style); XML/JSON
- **Auth:** Key required — must apply
- **Cost / restrictions:** Free for non-commercial; commercial restricted
- **Kimi status:** Full 24-field profile, HIGH authority, MODERATE difficulty (key application)
- **Master relationship:** OVERLAPPING — master carries its own full, independently-detailed entry (`earth_knowledge_source_registry.md:1590-1591`), including a live 2026 verification note ("probe without key refused") the Kimi report lacks
- **Master match:** `earth_knowledge_source_registry.md:1590` ("BASE (Bielefeld Academic Search Engine)"), table row 283
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.8 BASE`
- **Africa match:** `war_room_africa_api_registry.md:381-382`
- **Provenance/specificity-loss risk:** None — master's copy is current and richer
- **Recommended treatment:** CREDENTIAL_REQUIRED

### 9. African Journals Online (AJOL)
- **Org / region:** AJOL non-profit / South Africa; content spans 30+ African countries
- **Function:** 500+ African-published journals — TOCs, abstracts, many open full texts; "THE primary African-published journal aggregator"
- **Access / protocol:** OAI-PMH only (per-journal sets); no keyword-search REST API
- **Auth:** None
- **Cost / restrictions:** Free (some articles paywalled)
- **Kimi status:** Full 24-field profile, HIGH authority, MODERATE difficulty (OAI-PMH only)
- **Master relationship:** UNIQUE_TO_ACADEMIC_REPORT / AFRICA_SPECIFIC — no mention of AJOL anywhere in the master registry (confirmed via direct search, zero hits)
- **Master match:** none
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.9 AJOL`, table row 91
- **Africa match:** `war_room_africa_api_registry.md:384-385, 572, 666, 701`
- **Provenance/specificity-loss risk:** Low relative to Africa registry (already captured); **real gap relative to the master/global registry**, which has zero AJOL knowledge
- **Recommended treatment:** PERIODIC_SYNC_CANDIDATE (OAI-PMH bulk harvest is the only viable ingestion path — not a live-search provider)

### 10. SciELO South Africa (SciELO network)
- **Org / region:** SciELO (FAPESP/BIREME) + ASSAf / South Africa, part of 16-country LatAm/Iberia/S.Africa network
- **Function:** Full metadata + open full text of ASSAf-curated SA journals
- **Access / protocol:** REST (Article Meta API) + OAI-PMH; JSON/XML
- **Auth:** None
- **Cost / restrictions:** Free, CC-BY
- **Kimi status:** Full 24-field profile, HIGH authority; flags "API versions in flux — verify current endpoints before production"
- **Master relationship:** COMPLEMENTARY — master's `SciELO network` entry (`earth_knowledge_source_registry.md:1581-1582`, table row 316) describes the pan-network view ("16 countries LatAm/Iberia/S.Africa", per-country OAI pattern) but does **not** carry the SA-specific `articlemeta.scielo.org` REST endpoint or the `scielo.org.za` domain the Kimi report gives; conversely the master entry's network-wide framing (SciELO Books, SciELO Preprints, SciELO Data, GitHub OAI-PMH reference) is broader than the Kimi report's SA-only framing
- **Master match:** `earth_knowledge_source_registry.md:1581` ("SciELO network (OAI-PMH + Books OAI/OPDS)")
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.10 SciELO South Africa`, table row 92
- **Africa match:** `war_room_africa_api_registry.md:387-388, 573`
- **Provenance/specificity-loss risk:** Moderate — the SA-specific REST endpoint detail would be lost if only the master's network-wide entry were consulted; the Africa registry already preserves it
- **Recommended treatment:** AFRICA_SCHOLARLY_SOURCE (periodic sync given "endpoints in migration flux" caveat)

### 11. Sabinet African Journals
- **Org / region:** Sabinet (Pty) Ltd / South Africa
- **Function:** 500+ African journals full text, legal/gazette content — "deepest licensed SA journal backfile"
- **Access / protocol:** Search interface only — no public API
- **Auth:** Institutional subscription
- **Cost / restrictions:** Paid, proprietary license
- **Kimi status:** Full 24-field profile — "HIGH content / LOW accessibility"; flagged as a gap
- **Master relationship:** UNIQUE_TO_ACADEMIC_REPORT / AFRICA_SPECIFIC / NEGATIVE_FINDING — zero mentions of Sabinet in the master registry
- **Master match:** none
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.11 Sabinet`, table row 101, also listed among the Africa registry's own gap notes (line 700: "Sabinet African journals — paywalled, no API")
- **Africa match:** `war_room_africa_api_registry.md:390-391, 582, 700`
- **Provenance/specificity-loss risk:** Low relative to Africa registry; real gap relative to master
- **Recommended treatment:** NO_MACHINE_API (COMMERCIAL_OR_RESTRICTED secondary — negotiate licensed TDM access if ever pursued)

### 12. JSTOR Data for Research / Constellate — DISCONTINUED
- **Org / region:** ITHAKA/JSTOR / Global (incl. African studies journals)
- **Function:** Was text-mining dataset delivery; sunset 2025-07-01
- **Access / protocol:** None — request-based only via JSTOR Text Analysis Support (tdm@ithaka.org)
- **Auth:** N/A
- **Cost / restrictions:** N/A (discontinued)
- **Kimi status:** Negative finding, fully documented replacement path; also flags HathiTrust Research Center (HTRC) sunsetting end-2026
- **Master relationship:** EXACT_DUPLICATE — master independently tracks the same discontinuation (`earth_knowledge_source_registry.md:2072-2073`, "JSTOR / Artstor — STATUS: RETIRED/MERGED; Constellate DISCONTINUED")
- **Master match:** `earth_knowledge_source_registry.md:2072`
- **Africa registry relationship:** EXACT_DUPLICATE — `## 8.12 JSTOR Constellate/DfR`
- **Africa match:** `war_room_africa_api_registry.md:393-394, 706`
- **Provenance/specificity-loss risk:** None
- **Recommended treatment:** NO_MACHINE_API

### 13. Wikidata Query Service (SPARQL)
- **Org / region:** Wikimedia Foundation / Global, extensive Africa coverage
- **Function:** 110M+ entities incl. African kingdoms, heritage sites, ethnic groups; identifier hub
- **Access / protocol:** SPARQL 1.1 + REST entity API
- **Auth:** None
- **Cost / restrictions:** Free, CC0
- **Kimi status:** Full 24-field profile, MEDIUM-HIGH authority; notes uneven African heritage depth, recommends QLever mirror for heavy queries
- **Master relationship:** EXACT_DUPLICATE — master's own `#1 Wikidata` entry (`earth_knowledge_source_registry.md:85`) is the canonical, more heavily cross-referenced version (linked throughout the identifier/bulk-dump sections)
- **Master match:** `earth_knowledge_source_registry.md:85`
- **Africa registry relationship:** EXACT_DUPLICATE — `## Wikidata SPARQL` plus QLever mirror note
- **Africa match:** `war_room_africa_api_registry.md:24, 462, 468-469`
- **Provenance/specificity-loss risk:** None
- **Recommended treatment:** EXISTING_GLOBAL_OVERLAP — already `IMPLEMENTED_PROVIDER` (`lib/research-engine/providers/wikidata.ts`)

### 14. DBpedia SPARQL
- **Org / region:** DBpedia Association / Global
- **Function:** RDF extraction of Wikipedia infoboxes — African history, geography, persons
- **Access / protocol:** SPARQL; RDF/JSON/CSV
- **Auth:** None
- **Cost / restrictions:** Free, CC BY-SA 3.0
- **Kimi status:** Full 24-field profile, MEDIUM authority (update-lag vs Wikipedia)
- **Master relationship:** EXACT_DUPLICATE — master's `#5 DBpedia` entry (`earth_knowledge_source_registry.md:97`)
- **Master match:** `earth_knowledge_source_registry.md:97`
- **Africa registry relationship:** EXACT_DUPLICATE — `## DBpedia SPARQL`
- **Africa match:** `war_room_africa_api_registry.md:471-472`
- **Provenance/specificity-loss risk:** None
- **Recommended treatment:** KNOWLEDGE_GRAPH_SOURCE (secondary to the already-implemented Wikidata adapter)

### 15. OpenStreetMap Overpass API
- **Org / region:** OpenStreetMap Foundation / Global
- **Function:** Geodata incl. African archaeological sites, monuments, heritage tags
- **Access / protocol:** REST (Overpass QL); JSON/XML/GeoJSON
- **Auth:** None
- **Cost / restrictions:** Free, ODbL (share-alike)
- **Kimi status:** Full 24-field profile, MEDIUM-HIGH authority; notes uneven heritage-tag density by country
- **Master relationship:** EXACT_DUPLICATE — master's `### 1. OpenStreetMap Overpass API` (`earth_knowledge_source_registry.md:1770`)
- **Master match:** `earth_knowledge_source_registry.md:1770`
- **Africa registry relationship:** EXACT_DUPLICATE — `## 7.4 OpenStreetMap Overpass API` plus Geofabrik Africa bulk-extract note and table row 72
- **Africa match:** `war_room_africa_api_registry.md:317-318, 553`
- **Provenance/specificity-loss risk:** None
- **Recommended treatment:** FUTURE_LIVE_INTEGRATION_CANDIDATE

### 16. Zenodo API
- **Org / region:** CERN / OpenAIRE / Global
- **Function:** Datasets, papers, software incl. African archaeology/genomics supplements; DOI-minting
- **Access / protocol:** REST + OAI-PMH; JSON
- **Auth:** None for read; token for upload
- **Cost / restrictions:** Free
- **Kimi status:** Full 24-field profile, HIGH authority
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — line-1547 stub only
- **Master match:** none inline (stub only)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.13 Zenodo`, table row 93
- **Africa match:** `war_room_africa_api_registry.md:396-397, 574`
- **Provenance/specificity-loss risk:** Low
- **Recommended treatment:** BULK_INGEST_CANDIDATE

### 17. Figshare API
- **Org / region:** Digital Science (Springer Nature) / Global
- **Function:** Datasets/figures incl. African studies outputs
- **Access / protocol:** REST; JSON
- **Auth:** None for public read; token for private/upload
- **Cost / restrictions:** Free
- **Kimi status:** Full 24-field profile, HIGH authority
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — line-1547 stub only, plus one incidental non-generic mention (DepMap-via-Figshare bulk-download path at `earth_knowledge_source_registry.md:976`) that does not constitute a general Figshare profile
- **Master match:** none inline (stub only; incidental use-case mention at line 976)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.14 Figshare`, table row 94
- **Africa match:** `war_room_africa_api_registry.md:399-400, 575`
- **Provenance/specificity-loss risk:** Low
- **Recommended treatment:** BULK_INGEST_CANDIDATE

### 18. Harvard Dataverse + Dataverse network
- **Org / region:** Harvard IQSS + partner Dataverse instances / Global incl. Africa
- **Function:** Social-science datasets incl. Afrobarometer-related deposits, African election/economic data
- **Access / protocol:** REST (Search/Native/Data Access) + SWORD + OAI-PMH; JSON
- **Auth:** None for public read; token for upload/private
- **Cost / restrictions:** Free
- **Kimi status:** Full 24-field profile, HIGH authority; notes no single pan-African Dataverse instance
- **Master relationship:** ACADEMIC_REPORT_HAS_BROADER_SOURCE — line-1547 stub only, plus a generic ecosystem mention (`earth_knowledge_source_registry.md:1593`, "OAI-PMH institutional-repository ecosystem" lists Dataverse as one of several platforms, not a dedicated profile)
- **Master match:** none inline (stub + generic ecosystem mention)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.15 Harvard Dataverse network`, table row 95
- **Africa match:** `war_room_africa_api_registry.md:402-403, 576`
- **Provenance/specificity-loss risk:** Low
- **Recommended treatment:** BULK_INGEST_CANDIDATE

### 19. OSF API (hosts AfricArXiv)
- **Org / region:** Center for Open Science / Global; hosts AfricArXiv preprints
- **Function:** Projects, registrations, preprints — "AfricArXiv is the key African preprint channel"
- **Access / protocol:** REST (JSON:API)
- **Auth:** None for public read; token for write
- **Cost / restrictions:** Free
- **Kimi status:** Full 24-field profile, HIGH authority
- **Master relationship:** UNIQUE_TO_ACADEMIC_REPORT — OSF does not appear even in the master's line-1547 cross-reference stub list (that list names OpenAlex, Crossref, S2, CORE, Unpaywall, DOAJ, Zenodo, Figshare, Dataverse, PubChem, ChEMBL — no OSF)
- **Master match:** none
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.16 OSF API (hosts AfricArXiv)`, table row 96, and separately referenced at line 706 (AfricArXiv preprint note)
- **Africa match:** `war_room_africa_api_registry.md:405-406, 577`
- **Provenance/specificity-loss risk:** Low relative to Africa registry; real gap relative to master
- **Recommended treatment:** AFRICA_SCHOLARLY_SOURCE / FUTURE_LIVE_INTEGRATION_CANDIDATE

### 20. Dryad API
- **Org / region:** Dryad (CDL partnership) / Global
- **Function:** Curated research datasets — ecology, evolution, genetics incl. African biodiversity/genomics
- **Access / protocol:** REST; JSON
- **Auth:** None for read; OAuth for submission
- **Cost / restrictions:** Free read; deposit publication charge
- **Kimi status:** Full 24-field profile, HIGH authority
- **Master relationship:** UNIQUE_TO_ACADEMIC_REPORT — not in master's cross-reference stub list, no other mention found
- **Master match:** none
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.17 Dryad`, table row 97
- **Africa match:** `war_room_africa_api_registry.md:408-409, 578`
- **Provenance/specificity-loss risk:** Low relative to Africa registry; real gap relative to master
- **Recommended treatment:** BULK_INGEST_CANDIDATE

### 21. OCLC WorldCat APIs (Discovery/Search)
- **Org / region:** OCLC / Global
- **Function:** 500M+ bibliographic records — best for locating Africana print/primary sources
- **Access / protocol:** REST/SRU; JSON, MARCXML, Dublin Core
- **Auth:** wskey + secret, OCLC-membership-gated for most APIs
- **Cost / restrictions:** Paid/subscription-gated (Registry API free non-commercial)
- **Kimi status:** Full 24-field profile, HIGH authority, HARD difficulty; flags OCLC membership as likely blocker
- **Master relationship:** UNIQUE_TO_ACADEMIC_REPORT — the master registry only mentions OCLC as the *operator* of VIAF (`earth_knowledge_source_registry.md:236, 2975`) and ISNI (`earth_knowledge_source_registry.md:2551`); it has no dedicated WorldCat Discovery/Search API profile
- **Master match:** none dedicated (OCLC referenced only via VIAF/ISNI operator field)
- **Africa registry relationship:** OVERLAPPING (near-duplicate) — `## 8.18 OCLC WorldCat`, table row 100
- **Africa match:** `war_room_africa_api_registry.md:411-412, 581, 647, 689`
- **Provenance/specificity-loss risk:** Low relative to Africa registry; real gap relative to master
- **Recommended treatment:** COMMERCIAL_OR_RESTRICTED

---

## Additional negative finding (not a numbered source)

The Kimi report's closing "MAJOR GAPS NOTE" also states Google Scholar has no API at all (recommending OpenAlex/Semantic Scholar as substitutes). This is not a distinct numbered source/entity in the report and is not counted in the 21-source total, but is preserved here since it is a negative finding that could otherwise be lost. No corresponding Google Scholar mention was found in either registry.

---

## Roll-up counts

| Metric | Count |
|---|---|
| Total substantive sources/entities | 21 |
| Exact duplicate vs master | 4 (JSTOR Constellate, Wikidata, DBpedia, Overpass) |
| Overlapping vs master (near-duplicate / master-has-broader) | 2 (BASE, arXiv) |
| Academic-report-has-broader-source vs master (master only has a stub/incidental mention) | 9 (OpenAlex, Crossref, Semantic Scholar, CORE, Unpaywall, DOAJ, Zenodo, Figshare, Harvard Dataverse) |
| Complementary vs master | 1 (SciELO South Africa) |
| Unique to academic report vs master | 5 (AJOL, Sabinet, OSF, Dryad, OCLC WorldCat) |
| Africa-specific sources | 3 (AJOL, SciELO South Africa, Sabinet) |
| Regional-specific note (not separately counted) | SciELO South Africa also sits inside the broader 16-country SciELO network |
| Negative findings (numbered sources) | 2 (Sabinet — no API; JSTOR Constellate — discontinued) |
| Negative findings (aside, not a numbered source) | 1 (Google Scholar — no API, mentioned only in gaps note) |
| Unverified / verify-before-use flags | 1 (SciELO South Africa — "endpoints in migration flux") |
| Credential-required (key mandatory for baseline use) | 2 (BASE, OCLC WorldCat) |
| Commercial/restricted | 3 (Sabinet, OCLC WorldCat, BASE) |
| No-machine-API | 2 (Sabinet, JSTOR Constellate) |

## Research Engine cross-check (read-only; `lib/research-engine/config/providerEnv.ts` + `lib/research-engine/providers/registry.ts`)

| Metric | Count | Sources |
|---|---|---|
| IMPLEMENTED_PROVIDER | 4 | Crossref, Semantic Scholar, arXiv, Wikidata |
| DECLARED_BUT_UNIMPLEMENTED | 0 | none — no remaining source appears in `providerEnv.ts` even as an unimplemented stub |
| NO_PROVIDER | 14 | OpenAlex, CORE, Unpaywall, DOAJ, BASE, AJOL, SciELO South Africa, DBpedia, Overpass, Zenodo, Figshare, Harvard Dataverse, OSF, Dryad |
| NOT_APPROPRIATE_AS_REQUEST_PROVIDER | 3 | Sabinet (no API), JSTOR Constellate (discontinued), OCLC WorldCat (membership-gated) |

Note per the task brief: absence from Research Engine does not by itself imply a source should become a live API provider. AJOL and SciELO South Africa are OAI-PMH bulk-harvest sources better suited to periodic sync than live request/response; Sabinet, JSTOR Constellate, and OCLC WorldCat have no viable machine channel without a paid/institutional relationship War Room does not currently have.

## Information-preservation verdict (Phase 10)

**MINOR COMPLEMENTARY KNOWLEDGE.**

Every one of the 21 sources in this report already has *some* representation in the repo's existing knowledge base:
- 4 are exact duplicates of rich master-registry entries (Wikidata, DBpedia, Overpass, JSTOR Constellate).
- All 21 — including the 5 that are entirely absent from the master registry (AJOL, Sabinet, OSF, Dryad, OCLC WorldCat) — already have a near-verbatim, field-matching entry in the Africa registry's `TIER 8 — ACADEMIC LITERATURE` section.

So no source name, endpoint, or gap-finding in this report is unknown to War Room's existing documentation. What is genuinely missing is narrower: the **master (global) registry** currently holds only a bare cross-reference stub — not a full inline entry — for 9 of these sources (OpenAlex, Crossref, Semantic Scholar, CORE, Unpaywall, DOAJ, Zenodo, Figshare, Harvard Dataverse), and this Kimi report is the most complete local copy of their full profiles (docs URLs, signup flows, authority ratings, worked example requests). That is real but incremental value — filling in a documented gap in one registry, not introducing unknown sources.

## Integrity re-check

- Recovered file SHA-256 after reconciliation: unchanged (`a6e26fb978d98b85e1c5fcecf1f3464da80a4e7ce4cfd84210b1ae89b0ed8db6`)
- Master registry SHA-256: unchanged (`39476753d6dade4a269dfec739ded2a71476dfabf7ce10dc64329b104e5fdcd4`)
- Africa registry SHA-256: unchanged (`fe6ace3773ac5622e79e09c3172587424bdb77b4e1e0205ab275f892cbae4244`)
- No provider code modified.
- No API/network requests made during this reconciliation.
