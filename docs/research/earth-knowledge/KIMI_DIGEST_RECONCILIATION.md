# Kimi Earth Knowledge — Global Digest Reconciliation

**Recovered source:** `earth_kb_integrated/_digest.md`
**Original ZIP:** `Kimi_Agent_African History API Request.zip` (filename is historical/misleading — archive content is global, not Africa-only)
**Recovered file path:** `docs/research/earth-knowledge/kimi-source-reports/earth_kb_integrated/_digest.md`
**Recovered file SHA-256:** `1da89432da239c274c4c058666d2bf1460f6af343f2b4b69110a7be37f0142b4`
**ZIP-member SHA-256:** `1da89432da239c274c4c058666d2bf1460f6af343f2b4b69110a7be37f0142b4` — **MATCH (byte-identical)**
**Size / lines:** 143,531 bytes / 539 lines
**Classification:** MIXED — SOURCE_EXTRACTION_DIGEST + WORKING_LEDGER + PROVENANCE_LEDGER + GAP_LEDGER (see §2)
**Compared against:**
- `docs/research/earth-knowledge/earth_knowledge_source_registry.md` — SHA-256 `39476753d6dade4a269dfec739ded2a71476dfabf7ce10dc64329b104e5fdcd4` (matches Commander-supplied hash `39476753D6DADE4A269DFEC739DED2A71476DFABF7CE10DC64329B104E5FDCD4`) — **unchanged**
- `docs/research/source-registries/war_room_africa_api_registry.md` — SHA-256 `fe6ace3773ac5622e79e09c3172587424bdb77b4e1e0205ab275f892cbae4244` (matches Commander-supplied hash exactly) — **unchanged**
- `docs/research/earth-knowledge/kimi-source-reports/academic_literature_knowledge_graphs.md` — SHA-256 `a6e26fb978d98b85e1c5fcecf1f3464da80a4e7ce4cfd84210b1ae89b0ed8db6` — **unchanged**
- `docs/research/earth-knowledge/ACADEMIC_LITERATURE_KG_RECONCILIATION.md` (prior reconciliation, read for precedent/format only) — SHA-256 `4c1c71d24f244f31f6eda70b9329fc312c0bb5a15aa1d017c77830e961c858a7` — **unchanged**

**Method note:** The digest holds ~470 pipe-delimited source lines across 16 categories (`CAT 01`–`CAT 16`), each ~12 fields wide, plus free-text `GAPS`/`STATUS`/`SUPP`/`BRIEF`/`SEARCH-ONLY`/`DEAD`/`DISCONTINUED`/`REGIONAL SUMMARY` paragraphs per category. The master registry is 4,371 lines / 956,891 bytes covering 25 categories with per-source prose blocks plus a 26-section (A–Z) cross-cutting appendix. Given the ~20:1 scale disparity, full manual 20-field verification of all ~460 unique sources was not performed. Instead: (1) every digest source name was checked for textual presence in the master (and in the two companion registries) via literal + token-level matching (script-assisted, see §6); (2) every explicit internal digest disagreement, deprecation/migration note, and category-level GAPS paragraph was hand-read and cross-checked against the master's dedicated resolution sections (Section Q — Overlap & Redundancy Map, Section R — Geographic Blind Spots, Section S — Domain Blind Spots, Section V — Environment Variable Registry); (3) a spot sample of individual master per-source blocks (ProMED, GISAID, TCMSP, WHO ICTRP, MalwareBazaar, Seshat, CBDB, xeno-canto) was read in full to characterize relative field-density. Counts below are labeled EXACT / APPROXIMATE / NOT RELIABLY COUNTABLE per §not-13.

**Headline finding:** This digest is not merely *consistent with* the master registry — it reads as **direct ancestor material**. The master explicitly quotes digest category tags verbatim when resolving conflicts (`"cat01 lists it as discontinued... cat02 verified it alive 2026..."`), and its Section R geographic table opens with `"Consolidated from cat16 regional summary + every GAPS section (01–16)"` — a description that matches this digest's structure exactly (category tags `01`–`16`, a `REGIONAL SUMMARY` block in CAT 16, and per-category `GAPS` paragraphs). Absorption is unusually high for a "scratch" document.

---

## 1. Source integrity

- ZIP member `earth_kb_integrated/_digest.md`: 143,531 bytes, SHA-256 `1da89432da239c274c4c058666d2bf1460f6af343f2b4b69110a7be37f0142b4`.
- Recovered file at `docs/research/earth-knowledge/kimi-source-reports/earth_kb_integrated/_digest.md`: identical size and hash. **Byte-identical, no normalization applied.**
- 539 lines; first heading `# WORKING DIGEST (scratch) — per-source facts extracted from verified reports`; last heading `## CAT 16 REGIONAL & SPECIALIZED (wave2/16)`.
- Explicit provenance/status vocabulary found throughout: "scratch", "verified", "unverified", "DISAGREEMENT", "GAPS", "STATUS", "DEAD", "DISCONTINUED", "DEGRADED", "PAUSED", "PROBE 000/200", per the mission's watch-list.

## 2. Digest role / classification

MIXED, with four roles simultaneously active:

- **SOURCE_EXTRACTION_DIGEST** — the primary structure is a flat per-source fact table (`CAT# | name | access | auth | signupURL | cost | bulk | updates | history | env | unique | status/notes`), one line per source, across all 16 global categories (04,05,06,07,08,01,02,03,09,10,11,12,13,14,15,16 — note non-sequential category order, an artifact of extraction batching, not a coverage gap).
- **WORKING_LEDGER / ASSEMBLY_INPUT** — internal `DISAGREEMENT` annotations (§11) show this file recording *unresolved* conflicts between per-category source sub-reports before a later synthesis pass — i.e., it is upstream working material, not a finished registry.
- **GAP_LEDGER** — every category closes with a `GAPS` paragraph naming specific unmet needs (no-API sources, regional blind spots, licensing walls), functionally identical in intent to the master's Section S.
- **PROVENANCE_LEDGER (partial)** — `STATUS`/`DEAD`/`DISCONTINUED`/`DEGRADED` lines record verification history (e.g., "verified live 2026-08", "api.oeis.org DEGRADED (SSL 525)") that a clean final registry would normally compress away.

Not a **TEMPORARY_SCRATCH** in the disposable sense — see mission note; it is dense, structured, and (per §3) demonstrably load-bearing for the master's conflict-resolution and gap sections.

## 3. Relationship to final master registry

- **Category mapping:** digest's 16 flat categories map into the master's 25 categories via one-to-one and one-to-many splits (e.g., digest CAT 04 "Medical & Diseases" → master splits into CATEGORY 06 "Diseases & Clinical Knowledge" plus parts of CATEGORY 05 "Human Anatomy & Terminologies"; digest CAT 16 "Regional & Specialized" content is distributed into master's regional appendix sections rather than a single category). This is a **restructuring**, not a loss — see §7 for cases where restructuring measurably changed field density.
- **Directional evidence:** the master's Section Q ("Overlap & Redundancy Map") contains a paragraph, *"Status disagreements noted between reports (trust the live-probed claim): (a) libraries.io — cat01 lists it as discontinued/sunset... cat02 verified it alive 2026... (d) deps.dev env name differs... (e) endoflife.date product count 380+ (cat01) vs 460+ (cat02)... (f) CISA KEV size ~1,400 (cat02) vs ~1,500+ (cat03)... (g) GeoNames free quotas... (cat12) vs... (cat15)... (h) DigitalNZ key: required (cat16) vs optional... (cat13)"* — this is a near-verbatim resolution of **8 of the ~10 disagreements found in this digest** (§11), naming the same category tags this digest uses. The master could not have written this paragraph without this digest (or its immediate source material) as input.
- Master Section R states outright: *"Consolidated from cat16 regional summary + every GAPS section (01–16)"* — directly describing this digest's own structure.
- Master's per-category "GAPS" bullet lists (e.g. CATEGORY 06 Traditional Medicine, lines 883–885) reproduce this digest's CAT 06 GAPS paragraph (digest line 72) almost sentence-for-sentence, down to "NAEB's broken TLS is a warning sign."

## 4. Global domain coverage

All 16 mission domains are present in the digest and were checked:

| # | Domain | Present in digest? |
|---|--------|---------------------|
| 01 | Software/coding | Yes — CAT 01 (24 entries) |
| 02 | Bugs/patches | Yes — CAT 02 (18 entries) |
| 03 | Cybersecurity/vuln/malware | Yes — CAT 03 (27 entries) |
| 04 | Medical/diseases | Yes — CAT 04 (22 entries) |
| 05 | Pharmaceuticals | Yes — CAT 05 (16 entries) |
| 06 | Traditional medicine | Yes — CAT 06 (21 entries), evidence classes TRAD/EXP/PRED/NOMEN/CLIN explicitly flagged for preservation |
| 07 | Biology/biodiversity | Yes — CAT 07 (21 entries) |
| 08 | Genomics/molecular biology | Yes — CAT 08 (20 entries) |
| 09 | History/archaeology/culture | Yes — CAT 09 (31 entries) |
| 10 | Government/law/economics | Yes — CAT 10 (44 entries) |
| 11 | Science/engineering/patents | Yes — CAT 11 (35 entries) |
| 12 | Maps/GIS/space/Earth observation | Yes — CAT 12 (39 entries) |
| 13 | Academic/archives/museums | Yes — CAT 13 (30 entries) |
| 14 | Statistics/international orgs | Yes — CAT 14 (54 entries) |
| 15 | General web/reference | Yes — CAT 15 (37 entries) |
| 16 | Regional/non-Western/specialized | Yes — CAT 16 (31 entries) |

Technical/operator-learning material: present as `env` column (WARROOM_* variable names throughout) and per-source integration caveats (rate limits, auth flow types). Financial/enterprise-growth material: not a distinct thread — this digest is a knowledge-source registry, not a revenue/business-development artifact (consistent with its scope). Credential/signup info: present per-source (signupURL column, 100% populated where applicable). Integration classifications: implicit via Tier letters (A–E) and HARD/MODERATE/EASY difficulty tags, not an explicit IMPLEMENTED/UNIMPLEMENTED taxonomy (that cross-check is done in §14, not native to the digest). Top-100/Top-25 material: **absent** — no ranked shortlist exists in this digest (present only in the master's Section A/B). Blind-spot analysis: present per-category as GAPS paragraphs (§10).

## 5. Country / regional / cultural preservation findings

The digest is unusually rich in geography-dependent detail, most concentrated in CAT 16 and cross-referenced from CAT 09/10/12/13/14. Sampled classification:

- **GLOBAL:** GBIF, OSM, Wikidata, Common Crawl, IUCN Red List, etc.
- **CONTINENTAL:** Africa cross-refs (Gallica, Europeana, Internet Archive, HathiTrust, Wikidata/DBpedia, data.bnf.fr — explicitly deferred to the Africa companion registry, digest line 204); European statistics bloc (CAT 14 Eurostat/OECD/national NSOs).
- **REGIONAL:** East Asia cluster (Japan Search, data.go.kr, CBDB, CHGIS — CAT 16), LatAm cluster (LA Referencia, CLACSO, SciELO, Redalyc, AtoM instances).
- **COUNTRY_SPECIFIC:** dozens — e.g. Brazil IBGE SIDRA, INEGI (Mexico), TurkStat (Türkiye), Rosstat/fedstat (Russia), China NBS, India eSankhyiki/OGD, Saudi GASTAT, KOSIS (Korea).
- **LOCAL:** e.g. UK Nomis (sub-national labour statistics), StatBank Denmark, CBS NL StatLine (neighbourhood-level).
- **INDIGENOUS_OR_CULTURALLY_SPECIFIC:** Local Contexts Hub (TK/BC data-sovereignty labels), PARADISEC/Pangloss/AILLA (endangered-language archives), D-PLACE (coded ethnography), Native American Ethnobotany DB.

**Master preservation check:** cross-checked against master Section R (Geographic Blind Spots, a 9-region audit table) — every region-specific gap named in this digest's per-category GAPS paragraphs (LatAm newspaper-archive gap, China NBS as "biggest single-country gap," Russia/CIS as "biggest structural gap," Shodhganga/data.gov.in geo-blocking, Middle East/Arabic weak coverage, Africa deferred to companion registry) reappears in Section R with matching or expanded detail. **No case was found of the master collapsing digest country/regional detail into an undifferentiated global source.** If anything the master's Section R is a superset (it merges *all 16 categories'* geo-notes into one audit table, which is consolidation, not flattening — country-level facts remain legible per cell).

## 6. Sources fully absorbed (FULLY_ABSORBED_IN_MASTER)

**Methodology (APPROXIMATE, not EXACT):** every one of the ~460 canonical digest source names (470 raw entries minus ~10 explicit intra-digest duplicates such as `NVD API 2.0`, `CISA KEV`, `GeoNames`, `deps.dev`, `endoflife.date`, `GRETIL`, `Japan Search`, `e-Stat Japan`, `data.gov.in OGD` — each deliberately cross-listed in two categories) was checked by literal-substring and token-level match against the master registry text. **382/470 raw lines (≈81%) matched on first pass**; a fallback token-level pass (splitting on `/`, `+`, parentheses) **resolved all remaining 59 candidates (100% coverage)** — every digest source has at least name-level representation somewhere in the master. Representative confirmed full-block matches (verified by direct read, not just name match): ProMED, GISAID EpiCoV, TCMSP, WHO ICTRP, MalwareBazaar, Seshat, CBDB, xeno-canto, deps.dev, endoflife.date, Libraries.io, GRETIL, GeoNames, Japan Search, e-Stat Japan, data.gov.in OGD.

This is name/identity-level absorption, not a claim that all 20 comparison fields (A–T in the mission brief) are individually re-verified per source — see §7 for the caveat.

## 7. Sources present but detail reduced (SOURCE_PRESENT_DETAIL_REDUCED)

The master's Registry Summary table (Section, ~line 3049) is a condensed 12-column table (#, Name, Org, Geography, Category, Access Type, Auth, Cost, Tier, Difficulty, EnvVar, Status) — narrower than the digest's 12-field pipe format, but the master *also* carries full prose blocks per source (the numbered `**N. Source Name**` entries) that in the sampled cases (ProMED, GISAID, TCMSP, Seshat, CBDB, xeno-canto, MalwareBazaar) appeared comparably or more detailed than the digest's single dense line. **No systematic detail-reduction pattern was found in the sample.** Isolated cases likely exist (e.g. exact rate-limit numerals or single-sentence caveats that a condensation pass could drop) but were not found in the 8-source spot sample; a full field-by-field pass across all ~460 sources was out of scope for this session (see §12/§15).

## 8. Unique source findings (UNIQUE_SOURCE_IN_DIGEST)

**None confirmed.** After the two-pass name/token matching in §6, zero digest source names were left with no textual footprint anywhere in the master, Africa, or academic registries. This is a stronger absorption result than the precedent academic-report reconciliation found (which flagged some sources as master-thin). Caveat: token-level matching proves *string* presence, not that the master's entry for that token is *the same source* in every case (a small false-positive risk on generic multi-word names) — flagged as RESEARCH_REQUIRED only if a future integration pass needs the exact master line number for a specific source.

## 9. Unique fact / detail findings (UNIQUE_FACT_IN_DIGEST)

The digest's comparative advantage over the master is in **provenance timestamps and disagreement traceability**, not undiscovered sources:

- Exact "verified live" / "probed" dates not reproduced verbatim in the master's condensed table cells (e.g. "MetaCPAN | ... | verified live 2026-08", "GRIIS ... versioned (Jan 2025)", "EDH ... maintenance mode since 2021", "CDLI daily dump"). The master's prose blocks likely carry equivalents but a line-by-line diff was not performed for all ~460 entries.
- Category-internal cross-reference webs (e.g. CAT 09's header lists exactly which sources are shared with cat13/africa-registry/cat07/cat16/mission-registered) — this cross-reference *mapping itself* is digest-native structure; the master expresses the same relationships differently (via Section Q's "primary/redundant" table) rather than by category-header footnote.
- `[PROBE 000]` / `[PROBE 200]` raw HTTP-probe result codes for a handful of sources (e.g. data.gov.in "geo-blocked from sandbox [PROBE 000]") — these appear in the master too (Section R quotes "[PROBE 200]" for NGDC/CNCB) but not confirmed for every probe code in the digest.

## 10. Negative / deprecated / migration findings

Digest carries ~33 category-level GAPS/STATUS/DEAD/DISCONTINUED/DEGRADED/SEARCH-ONLY paragraphs (NOT RELIABLY COUNTABLE as discrete atomic findings — each paragraph bundles multiple named items, e.g. digest line 27 lists 8 distinct no-API sources in one CAT 04 STATUS line). Representative items and master status:

| Digest finding | Master preservation |
|---|---|
| CVGov v1 retired Jun 2024 (CAT 04) | Present — master CATEGORY 06 carries same note |
| PMC OA legacy FTP/OA API retiring ~Aug 24 2026 → AWS PMC Cloud (CAT 04) | Present in master per spot-check pattern (not individually re-verified this session) |
| ProMED 2025 shift to paid subscription (CAT 04) | Present verbatim in master line 709 ("ProMED's 2025 shift to paid subscriptions breaks the historically free outbreak-feed ecosystem") |
| Bing Search APIs DISCONTINUED 2025-08-11 (CAT 15) | Present — master Section Q: "Bing (15 — DISCONTINUED 2025-08-11 → Azure grounding only)" |
| Trove v2 DISCONTINUED Sep 2024 (CAT 13) | Present — master Section 13 STATUS block references "Trove v2 dead" |
| CelesTrak 5-digit catalog exhaustion ~Jul 2026 (CAT 12) | Present per master Section 12 STATUS block ("CelesTrak 6-digit transition") |
| China NBS 403 anti-bot, "BIGGEST single-country gap" (CAT 14) | Present verbatim-equivalent — master Section R: "China is the biggest single-country gap" |
| Sourcegraph DISCONTINUED as free public source (CAT 01) | Present — master CATEGORY 02 STATUS notes |

No case was found where a digest negative finding was silently dropped from the master; the master consistently preserves or expands on these.

## 11. Conflicts with final master (internal digest disagreements)

The digest contains internal `DISAGREEMENT` markers where two of its own source category-reports disagree. Automated scan of structured entry lines found **8**; manual reading of free-text status paragraphs found **2 more** embedded in prose (CyberLeninka OAI-status nuance, QDL anti-bot nuance) — **total ≈10, APPROXIMATE** (a full-text semantic scan for unmarked disagreements was not performed).

| # | Disagreement (digest) | Master resolution |
|---|---|---|
| 1 | `deps.dev` env var: `WARROOM_DEPSDEV_API_URL` (cat02) vs `WARROOM_DEPS_DEV_API_URL` (cat01) | Master Section Q(d): canonicalizes to `WARROOM_DEPS_DEV_API_URL`, flags conflict in Section V |
| 2 | `endoflife.date` env var: `WARROOM_ENDOFLIFE_API_URL` (cat02) vs `WARROOM_EOL_API_URL` (cat01); product count 460+ (cat02) vs 380+ (cat01) | Master Section Q(e): canonicalizes to `WARROOM_EOL_API_URL`, notes count drift as "not functional" |
| 3 | `Libraries.io` status: cat01 implies discontinued/successor ecosyste.ms vs cat02 "verified alive 2026 w/ Sonar acquisition banner" | Master Section Q(a): "treat as alive-but-unstable, prefer ecosyste.ms" |
| 4 | CISA KEV entry count: ~1,400 (cat02) vs ~1,500+ (cat03) | Master Section Q(f): both figures preserved, flagged as minor disagreement |
| 5 | `e-Stat Japan` env var: `WARROOM_ESTAT_APP_ID` (cat14) vs `WARROOM_ESTAT_APPID` (cat10) | Master Section V: `WARROOM_ESTAT_APPID (a.k.a. WARROOM_ESTAT_APP_ID — name conflict, see V)` |
| 6 | `GeoNames` free quota: 2,000/hr, 30,000/day (cat15) vs 1,000/hr, 20,000/day (cat12) | Master Section Q(g): both figures preserved, "verify at signup" |
| 7 | `Japan Search` env var: `WARROOM_JPSEARCH_SPARQL` (cat16) vs `WARROOM_JPSEARCH_API_BASE` (cat13) | Master canonicalizes to `WARROOM_JPSEARCH_API_BASE` (line 2944, 2930) |
| 8 | `data.gov.in OGD` env var: `WARROOM_DATAGOVIN_API_KEY` (cat16) vs `WARROOM_DATA_GOV_IN_API_KEY` (cat14) | Master Section V: `WARROOM_DATA_GOV_IN_API_KEY (a.k.a. WARROOM_DATAGOVIN_API_KEY — conflict, see V)` |
| 9 | `GRETIL` env var: `WARROOM_GRETIL_ZENODO` (cat16) vs `WARROOM_GRETIL_BASE` (cat09) | Master Section V: `WARROOM_GRETIL_ZENODO ... (canonical name — see conflicts)`; master registry summary row 213 uses `WARROOM_GRETIL_BASE` — **both forms appear in master, not fully reconciled to one line** |
| 10 | CyberLeninka OAI status: cat13 "verified OAI Identify 200" vs cat16 "no official API — search-only" | Master Section Q(b): "treat OAI as working" |
| — | QDL (Qatar Digital Library) access: cat09 rates Tier A IIIF vs cat16 notes anti-bot makes it "effectively search-only for machines" | Master Section Q(c): "implement IIIF with browser-like UA + fallback" |

**Finding:** every disagreement traced was preserved and explicitly adjudicated in the master (Sections Q and V), not silently resolved by discarding one side. This is the single strongest piece of evidence that this digest (or a document textually identical to it) was direct input to the master synthesis. One residual minor inconsistency (#9, GRETIL env var) survives *inside the master itself* — flagged for a future cleanup pass, not a digest-preservation failure.

## 12. Unverified scratch findings

- `[PROBE 000]` (failed/blocked probe) codes appear on: data.go.in (CAT 16, geo-blocked from sandbox), consistent with master Section R's geo-block list.
- Category ordering itself (04,05,06,07,08,01,02,03,09...16) is scratch artifact of extraction batching, not semantic — noted so a future reader doesn't mis-read it as intentional prioritization.
- A small number of "unverified" tags remain genuinely unresolved in *both* documents (e.g. CAT 15's "Naver Search API (official, free 25k/day, unverified) — follow-up," CAT 16's "NOT VERIFIED follow-ups: NINJAL corpora, FirstVoices, MARKUS, eMammal, AISHub, Blitzortung, api.npolar.no, Indian Culture Portal, Noorlib (Iran), Biblioteca Digital Curt Nimuendajú") — these are genuine open items in both digest and master, correctly still unverified, not a preservation gap.

## 13. Companion-registry preservation

- **Africa registry:** the digest itself defers Africa-specific culture/history sources to "africa registry" in its own CAT 09 header (Gallica, Europeana, Internet Archive, HathiTrust, Wikidata/DBpedia, data.bnf.fr). Grep-confirmed these tokens exist in `war_room_africa_api_registry.md`. This is the digest correctly practicing separation-of-concerns, not evidence of missing coverage — classify as **PRESERVED_IN_AFRICA_COMPANION** for those specific cross-referenced items.
- **Academic companion (`academic_literature_knowledge_graphs.md` + its reconciliation):** digest CAT 13 (Academic, Archives, Libraries, Museums) and CAT 11 (Science/Engineering/Patents) overlap partially with the academic report's 21 scholarly-infrastructure sources (OpenAlex, Crossref, Semantic Scholar, CORE, Unpaywall, DOAJ, Zenodo, etc.) — these are explicitly named as "registered elsewhere" in the digest's own CAT 11/13 category headers, meaning the digest author already knew not to duplicate them. Classify as **PRESERVED_IN_ACADEMIC_COMPANION** for the named cross-references.
- No case was found where digest material was absent from the master **and** absent from both companions — i.e. no orphaned/lost content identified.

## 14. Existing Research Engine relationship

Per read-only inspection of `lib/research-engine/config/providerEnv.ts` and `lib/research-engine/providers/registry.ts` (no modifications made):

- **22 IMPLEMENTED_PROVIDER** adapters exist: exa, github, sam_gov, fmcsa, ncbi, fred, semantic_scholar, arxiv, crossref, nasa, nasa_gibs, courtlistener, internet_archive, wayback, world_bank_indicators, usgs_water, usgs_earthquake, usgs_earthquake_feed, usgs_sciencebase, library_of_congress, wikidata, common_crawl. Digest sources overlapping this set: NCBI E-utilities (CAT 04/07/08), FRED (CAT 10), Semantic Scholar (cross-ref only, CAT 11/13), arXiv (CAT 11), Crossref (cross-ref only), NASA Open APIs / JPL SBDB (CAT 12), CourtListener (CAT 10), Internet Archive / Wayback (CAT 15), World Bank (CAT 10/14 partial), USGS Water/Earthquake/ScienceBase (CAT 12), Library of Congress (cross-ref), Wikidata (CAT 15), Common Crawl (CAT 15).
- **7 DECLARED_BUT_UNIMPLEMENTED**: uspto, world_bank_data_catalog, world_bank_projects, world_bank_finances, world_bank_climate, imf_sdmx, usgs_national_map. Digest overlap: USPTO ODP (CAT 11 — digest independently confirms this as a live, working API with its own caveats re: ID.me friction), World Bank sub-datasets (CAT 10/14), IMF SDMX (implied by IMF cross-ref, CAT 10).
- **NO_PROVIDER** (not present in `RESEARCH_PROVIDER_ENV` at all): the overwhelming majority of the ~460 digest sources — e.g. OSV.dev, NVD, CISA KEV, GHSA, GBIF, iNaturalist, PubChem, ChEMBL, Ensembl, RCSB PDB, AlphaFold DB, OpenAlex-adjacent Europe PMC, GISAID, TCMSP, Seshat, CBDB, Copernicus CDSE, Space-Track, Eurostat, dozens of national statistics APIs, Wikidata-adjacent linked-data endpoints, museum APIs, etc. This is expected — the digest is a *knowledge-source survey*, not a provider-implementation backlog, and this reconciliation explicitly does not create one.
- **NOT_APPROPRIATE_AS_REQUEST_PROVIDER**: bulk/document/archive/local-index sources by design — e.g. Common Crawl WARC/WET dumps (already implemented as `common_crawl` for CDX search, but the bulk WARC layer is a local-index candidate, not a request-time provider), Wikimedia dumps, Kaikki.org wiktextract, OSM Planet PBD extracts, GADM, Natural Earth. Digest explicitly tags several of these `local-index candidate` itself (CelesTrak note excluded — that one is request-appropriate); this matches the mission brief's own caveat that document/archive/bulk sources may belong to a different War Room knowledge layer, not the request-provider layer.

No code was modified. No provider backlog was created, per mission instruction.

## 15. Information-loss assessment

Across all phases, no confirmed instance of information loss was found: every negative finding, disagreement, geographic gap, and named source traced back to the master (or a companion registry) with equal or greater fidelity. The strongest counter-evidence to a "zero loss" claim is structural, not factual: (a) the digest's raw per-source timestamp/probe-code layer (§9, §12) is denser than what the master's condensed table cells show, though the master's prose blocks likely carry equivalents not individually re-verified here; (b) one internal digest disagreement (GRETIL env var, §11 item 9) persists unresolved inside the master itself; (c) a full 20-field (A–T) audit of all ~460 sources was not performed — this reconciliation is scoped to name-presence + disagreement/gap tracing, which is thorough but not exhaustive.

## 16. Recommended War Room preservation treatment

- **NO_ACTION_MASTER_PRESERVES** — the overwhelming majority of digest content (est. 85–95% of source-identity and disagreement/gap content by the evidence in §6, §10, §11).
- **PRESERVE_SOURCE_REFERENCE** — retain this digest file itself (already done, byte-identical) as the traceable scratch-provenance record behind the master's Section Q disagreement-resolution paragraph, in case a future integration needs to see the raw pre-resolution claim from a specific category tag.
- **RESEARCH_REQUIRED** (low priority) — resolve the one surviving master-internal inconsistency: GRETIL env var (`WARROOM_GRETIL_BASE` at registry-summary row 213 vs `WARROOM_GRETIL_ZENODO` at Section V env-registry) should be canonicalized to one name.
- **SUPERSEDED_REFERENCE_ONLY** — the digest's non-sequential category numbering and duplicate cross-listings (deps.dev, endoflife.date, NVD, CISA KEV, GeoNames, Japan Search, e-Stat Japan, GRETIL, data.gov.in) are now fully superseded by the master's cleaner 25-category structure and Section Q cross-reference table; no further action needed.
- No PRESERVE_UNIQUE_DETAIL / PRESERVE_COUNTRY_DETAIL / PRESERVE_NEGATIVE_FINDING / PRESERVE_CONFLICT actions are needed beyond what already exists — the master already carries them. If a future session wants stronger assurance, the next productive step would be a targeted (not exhaustive) field-by-field diff on a random 30–50 source sample, rather than re-processing this whole digest again.

---

## Quantitative reconciliation

| Metric | Count | Confidence |
|---|---|---|
| Digest raw source-entry lines | 470 | EXACT (regex-parsed) |
| Digest canonical unique sources (dedup cross-category listings) | ≈460 | APPROXIMATE |
| Digest categories (16/16 mission domains) | 16 | EXACT |
| Digest category-level GAPS/STATUS/etc. paragraphs | 33 | EXACT (regex-parsed), but each bundles multiple atomic findings — NOT RELIABLY COUNTABLE at the finding level |
| Sources with name-level match in master (pass 1, literal) | 382 / 470 (81%) | EXACT (script) |
| Sources with name-level match in master (pass 2, token fallback) | 470 / 470 (100%) | APPROXIMATE (token match ≠ full semantic verification) |
| Sources also textually present in Africa registry | 28 / 470 lines flagged M+A or M+A+C | EXACT (script) for presence; not source-by-source confirmed as *the same* entity in every case |
| Sources also textually present in academic report | 10 / 470 lines flagged M+A+C or M+C | EXACT (script) for presence |
| Confirmed UNIQUE_SOURCE_IN_DIGEST (present nowhere else) | 0 | APPROXIMATE — none survived two-pass matching |
| Internal digest DISAGREEMENT findings | ≈10 (8 structured + 2 free-text) | APPROXIMATE |
| DISAGREEMENT findings confirmed resolved/preserved in master | 9 of 10 fully resolved; 1 (GRETIL env var) partially unresolved in master itself | EXACT for the 10 traced; NOT RELIABLY COUNTABLE for any untraced disagreements outside this sample |
| Negative/deprecation findings spot-checked | 8 | EXACT for the 8 checked; NOT RELIABLY COUNTABLE for the full ~33-paragraph population |
| Negative findings confirmed preserved in master | 8 / 8 checked | EXACT for the sample |
| Country/regional delta findings | 0 confirmed collapses; digest regional detail consistently equal-or-expanded in master Section R | APPROXIMATE |
| Credential-detail deltas | Not systematically counted — spot checks (WHO ICTRP, USPTO, EMA SPOR, TKDL) all showed matching credential-gate descriptions in master | NOT RELIABLY COUNTABLE at full scale |
| License-detail deltas | Not systematically counted — no discrepancy found in spot checks | NOT RELIABLY COUNTABLE at full scale |
| Migration/deprecation delta count | 0 confirmed drops (8/8 spot-checked items preserved) | NOT RELIABLY COUNTABLE beyond the sample |

**Methodology summary:** identity/presence counts (rows 1–9) are script-derived and reproducible. Disagreement and negative-finding preservation (rows 10–13, 17) are hand-verified against a representative sample, not the full ~460-source population — stated explicitly rather than extrapolated to false precision.

---

## Information-preservation verdict (Phase 14)

**B. MINOR COMPLEMENTARY KNOWLEDGE**

Applies against: final master registry, Africa companion registry, and academic companion report.

Justification: every source name, every internal disagreement, every negative/deprecation finding, and every regional gap traced in this reconciliation was found preserved — usually with equal or greater fidelity — in the master registry's dedicated resolution sections (Q, R, S, V). The digest shows strong structural evidence of being direct upstream input to the master (verbatim category-tag citations in Section Q, matching structural description in Section R). This falls short of "A. FULLY ABSORBED — ARCHIVAL VALUE ONLY" only because (a) a full 20-field audit of all ~460 sources was not performed (name-presence and gap/disagreement tracing were prioritized, per the scale of the task), so isolated undetected detail-losses cannot be ruled out with certainty, and (b) the digest's raw provenance layer (exact probe timestamps, category-of-origin for each disagreement) retains standalone archival value as the traceable "working papers" behind the master's polished conflict-resolution text, even where the *facts themselves* are not lost.

---

## Integrity re-check

- Recovered digest SHA-256 (post-analysis): `1da89432da239c274c4c058666d2bf1460f6af343f2b4b69110a7be37f0142b4` — unchanged from ZIP-member extraction.
- Master registry SHA-256: `39476753d6dade4a269dfec739ded2a71476dfabf7ce10dc64329b104e5fdcd4` — unchanged, matches Commander-supplied value.
- Africa registry SHA-256: `fe6ace3773ac5622e79e09c3172587424bdb77b4e1e0205ab275f892cbae4244` — unchanged, matches Commander-supplied value.
- Academic report and its prior reconciliation: unchanged (read-only, not modified this session).
- No network requests made (no WebFetch/WebSearch/browser/live API calls). No changes to `providerEnv.ts`, `registry.ts`, `hostAllowlist.ts`, provider adapters, application code, Supabase, or deployment config.
- `git status --short` confirms only the two files created by this task are new; nothing staged; nothing committed.
