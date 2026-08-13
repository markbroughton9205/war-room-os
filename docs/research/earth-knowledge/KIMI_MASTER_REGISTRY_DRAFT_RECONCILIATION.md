# Kimi Master-Registry Draft Reconciliation

Reconciliation of the recovered Kimi ZIP member `earth_kb_integrated/master_registry.md`
against the authoritative final registry `docs/research/earth-knowledge/earth_knowledge_source_registry.md`,
performed 2026-08-11. Recovered draft preserved byte-for-byte at
`docs/research/earth-knowledge/kimi-source-reports/earth_kb_integrated/master_registry.md`.

**Headline finding:** the draft is not merely "condensed knowledge later reworked into the
final registry" — it is **embedded verbatim, byte-for-byte, as a literal contiguous section**
of the final master registry (final-master lines 2526–3107). A full line-by-line diff of all
583 draft lines against that slice of the final master found **zero content mismatches**; the
only discrepancy is a single trailing blank line absorbed at the join boundary when the draft
was concatenated into the larger document. Every fact, row, and summary count in the draft
therefore already exists in the final master in identical form, and the final master
additionally carries ~2,450 more lines of richer per-source narrative blocks, a Top 100 list,
credential/signup tables, gap sections, and a recommended integration sequence that the draft
never had.

---

## 1. Source integrity

| Item | Value |
|---|---|
| ZIP archive | `C:\Users\markb\Downloads\Kimi_Agent_African History API Request.zip` |
| ZIP member | `earth_kb_integrated/master_registry.md` |
| ZIP member size | 87,213 bytes (matches expected) |
| ZIP member SHA-256 | `be64e87d6686432430c33aaa05824f88d008d36f0023a7dc5659e419e3f9ba0a` (matches expected prefix `be64e87d...`) |
| Recovered file path | `docs/research/earth-knowledge/kimi-source-reports/earth_kb_integrated/master_registry.md` |
| Recovered file SHA-256 | `be64e87d6686432430c33aaa05824f88d008d36f0023a7dc5659e419e3f9ba0a` |
| Byte-identical verdict | **MATCH** — extraction performed with no rewriting/reformatting/normalization |
| Draft line count | 583 |

## 2. Draft role and provenance

The draft's own header identifies it: *"Single consolidated registry of every verified
machine-accessible knowledge source found by the discovery swarm (Wave 1 files 01–08 + Wave 2
files 09–16). Sources deduplicated across files into one row each..."* It is a flat,
single-table consolidation pass over the sixteen raw Kimi wave reports, produced as an
intermediate assembly step before the final master's richer per-source-block write-up.

Applicable role classifications:

- **CONDENSED_MASTER_REGISTRY** — yes, exactly this.
- **SUMMARY_LEDGER / CATEGORY_SUMMARY / STATUS_SUMMARY / TIER_SUMMARY** — yes, via its
  "REGISTRY SUMMARY" tail section (category counts, status counts, tier counts).
- **ASSEMBLY_DRAFT** — yes, an intermediate deduplication pass.
- **PROVENANCE_ARTIFACT** — partially; it names its own sourcing (Wave 1/Wave 2 files) but
  carries no per-source citation trail beyond that.
- **INTEGRATION_PRIORITY_LEDGER, CREDENTIAL_SUMMARY (separate section), GAP_LEDGER** — **do
  not apply**. The draft has no priority/sequencing section, no standalone credential-summary
  section (only the per-row Env Var / Key Required? columns), and no standalone gap-analysis
  section.
- **SUPERSEDED_DRAFT** — literally false in the "replaced/lost" sense — see headline finding.
  It is better described as **ABSORBED_DRAFT**: incorporated wholesale rather than superseded.

## 3. Structure and counts

- Title: `# WAR ROOM OS — EARTH KNOWLEDGE BASE: MASTER SOURCE REGISTRY (2026)`
- Body: two intro paragraphs (scope + column conventions) → one flat Markdown table (509 data
  rows, columns: #, Source, Organization, Country/Region, Category, Access Type, Key
  Required?, Cost, Tier, Difficulty, Env Var, 2026 Status) → `## REGISTRY SUMMARY` with three
  sub-tables (count per category, count per 2026 status, count per tier).
- Only 5 Markdown headings total (`#`/`##`/`###`) in the whole file — it is table-dominant, not
  prose-dominant.
- Data-row count: **509** (mechanically counted; matches the draft's own stated "Total unique
  sources: 509").
- Category-field cross-references (e.g. `16 (→21)`) appear on 45 of the 509 rows; primary
  category totals reconcile exactly against the draft's own "Count per category" table (spot
  verified for categories 01 and 21).
- Status breakdown (mechanically counted, matches draft's own table exactly): OPERATIONAL 446,
  SEARCH-ONLY 36, DEGRADED 12, COMMERCIAL-GATED 8, DISCONTINUED 5, STATIC 2 — total 509.
- Tier breakdown (from draft's own table): A 313, B 83, C 53, D 39, E 19, unlisted 2 — total 509.

## 4. Relationship to final master registry

The final master (956,891 bytes, SHA-256 `39476753D6DADE4A269DFEC739DED2A71476DFABF7CE10DC64329B104E5FDCD4`)
contains this exact draft as a literal section, final-master lines 2526–3107, immediately
following Category 25 content and immediately preceding `# WAR ROOM OS — EARTH KNOWLEDGE BASE
REGISTRY: ANALYTICAL SECTIONS A–Z` (final-master line 3108). Line-by-line diff: 582/583 draft
lines match the corresponding final-master lines with zero character differences; the 583rd
(trailing blank) line was absorbed at the section boundary during concatenation — not a content
loss.

The final master is therefore a strict superset for this content: same title, same two intro
paragraphs, same 509-row table (including every Env Var, Access Type, Tier, and Status value),
and the same three-table REGISTRY SUMMARY — plus everything else the final master carries
before and after that section (rich per-source blocks for most categories, Top 100, credential
quick-list, no-credential list, domain blind-spots section, recommended integration sequence,
additional-discoveries section).

## 5. Global domain coverage

The draft already uses the **final master's 25-category taxonomy** (not the raw 16-domain Wave
1/Wave 2 file numbering), so it is a full-coverage cross-cut, not partial:

| Task's 16 Kimi wave domains | Draft/final 25-category equivalent | Present in draft? |
|---|---|---|
| 01 software/coding | 02 Software/coding | Yes |
| 02 bugs/patches | 03 Bugs/patches | Yes |
| 03 cybersecurity/vulnerabilities/malware | 04 Cybersecurity | Yes |
| 04 medicine/diseases | 05 Anatomy/terminologies, 06 Diseases/clinical | Yes |
| 05 pharmaceuticals | 07 Pharmaceuticals | Yes |
| 06 traditional medicine | 08 Traditional medicine | Yes |
| 07 biology/biodiversity | 10 Biology/biodiversity | Yes |
| 08 genomics/molecular biology | 09 Genetics/molecular | Yes |
| 09 history/archaeology/culture | 12 Origins/archaeology, 13 World history | Yes |
| 10 government/law/economics | 14 Government/law, 15 Economics/finance | Yes |
| 11 science/engineering/patents | 17 Patents/IP, 20 Engineering/standards/materials | Yes |
| 12 maps/GIS/space/Earth observation | 11 Earth/environmental, 18 Maps/GIS/satellite, 19 Space/astronomy | Yes |
| 13 academic/archives/museums | 16 Academic research, 21 Archives/libraries/museums | Yes |
| 14 statistics/international organizations | 23 Statistics/census, 24 International orgs | Yes |
| 15 web/reference | 01 General web | Yes |
| 16 regional/non-Western/specialized | 25 Specialized/regional | Yes |

All 16 task-named domains are represented. No domain is absent from the draft.

Advanced content the task asked to check for — **absent from the draft** (present only in the
final master's later ANALYTICAL SECTIONS A–Z, which the draft predates):

- Operator-learning information — **absent**
- Technical-library information — **absent** (beyond the raw rows themselves)
- Finance/enterprise-growth information — **absent**
- Credentials/signup information — only per-row Env Var / Key Required?; **no standalone
  signup-page table** (final master's SECTION D covers this)
- War Room integration classifications — **absent**
- Top 100 / Top 25 — **absent** (final master's SECTION A covers this)
- Recommended integration sequence — **absent** (final master's SECTION T covers this)
- Remaining blind spots — **absent** (final master's SECTION S covers this)

## 6. Summary/count preservation

| Summary | Draft value | Final master value | Classification |
|---|---|---|---|
| Total unique sources | 509 | 509 (identical line, verbatim) | PRESERVED_VERBATIM |
| Count per category (25 rows) | as listed | identical, verbatim | PRESERVED_VERBATIM |
| Count per 2026 status (6 rows) | as listed | identical, verbatim | PRESERVED_VERBATIM |
| Count per tier (6 rows) | as listed | identical, verbatim | PRESERVED_VERBATIM |

No summary table was dropped, altered, or needed re-derivation — all three sub-tables exist
character-for-character in the final master.

## 7. Draft details richer than final

**None found.** Because the draft's content is a strict subset (embedded verbatim) of the
final master's content, there is no fact, count, row, or column value present in the draft that
is not equally present in the final master. This section is empty by construction.

## 8. Final details richer than draft

Extensive. The final master carries, beyond the embedded draft section:

- Full per-source narrative blocks (34-field schema per source: description, verification
  evidence, base URLs, rate limits, provenance notes, etc.) for the majority of the 509 sources
  across Parts 1–4 (final-master lines ~67–2525), vs. the draft's 12-column single-row summary
  per source.
- `SECTION A — TOP 100 SOURCES OVERALL` (line 3114) — absent from draft.
- `SECTION D — OFFICIAL SIGNUP PAGES QUICK LIST` (line 3427) — absent from draft.
- `SECTION E — SOURCES NEEDING NO CREDENTIALS AT ALL` (line 3574) — absent from draft.
- `SECTION S — DOMAIN BLIND SPOTS` (line 3861) — absent from draft.
- `SECTION T — RECOMMENDED INTEGRATION SEQUENCE (waves 1–6)` (line 3896) — absent from draft.
- `SECTION Z — ADDITIONAL DISCOVERIES & FOLLOW-UP MISSIONS` (line 4338) — absent from draft.
- Per-category "Category notes," "Gaps," "Status notes," and "Regional coverage summary"
  prose blocks throughout Parts 1–4 — the draft carries none of this narrative, only the flat
  status flag per row.

## 9. Draft-only source findings

**None.** All 509 draft rows are present verbatim in the final master (they are the same
bytes). No source appears in the draft that is missing from the final master.

## 10. Draft-only fact/detail findings

**None.** Since the comparison in Section 4 found zero content deltas, there is no fact or
column value unique to the draft.

## 11. Status/deprecation/migration differences

**None found.** Every 2026 Status value (OPERATIONAL / DEGRADED / DISCONTINUED / STATIC /
SEARCH-ONLY / COMMERCIAL-GATED) in the draft is byte-identical to the corresponding value in
the final master, because it is the same row.

## 12. Credential/access differences

**None found.** Every Env Var and Key Required? value in the draft is byte-identical to the
final master's copy of the same row.

Cross-check against current Research Engine code (`lib/research-engine/config/providerEnv.ts`,
`lib/research-engine/providers/registry.ts`, read-only, no modification made):

- The 29-entry `RESEARCH_PROVIDER_ENV` declaration matches the task's known "old 29-provider
  cleanup batch" — confirmed present but **not reopened or touched**.
- Sample cross-references confirmed present as draft/final rows: GitHub API (draft row 38),
  Wikidata (row 25), NCBI E-utilities (row 163), CourtListener API (row 239), Common Crawl
  (row 5), Internet Archive/Wayback Machine combined (row 15), USPTO ODP (row 334, Env Var
  `WARROOM_USPTO_ODP_API_KEY` — matches `providerEnv.ts`'s `uspto` descriptor, `implemented:
  false`).
- Classification: of the ~29 declared provider ids, the ones with `implemented: true` in
  `providerEnv.ts` (github, arxiv, crossref, fred, world_bank_indicators, usgs_earthquake,
  wikidata, ncbi, exa, library_of_congress, nasa_gibs, usgs_water, usgs_earthquake_feed,
  usgs_sciencebase, semantic_scholar, courtlistener, internet_archive, wayback, common_crawl,
  sam_gov, nasa, fmcsa) are **CURRENT_IMPLEMENTED_PROVIDER**; the ones with `implemented:
  false` (uspto, world_bank_data_catalog, world_bank_projects, world_bank_finances,
  world_bank_climate, imf_sdmx, usgs_national_map) are **CURRENT_DECLARED_UNIMPLEMENTED**. All
  of these correspond to rows that already exist in both the draft and the final master — no
  new provider information was found in the draft beyond what the final master (and the current
  code's own descriptors) already reflect. `fmcsa` is implemented in code but does not
  correspond to any Kimi-sourced row in either the draft or the final master (it was added by a
  separate, later effort per recent git history) — **NO_PROVIDER** relative to this draft.
- **No provider code was modified. No new provider work was opened or reopened.**

## 13. Regional/country preservation

**None found to differ.** Every Country/Region column value in the draft is byte-identical to
the final master's copy. Because the draft rows are literally embedded, no regional specificity
present in the draft was collapsed or generalized by the final master — it's the same text.

(Separately, the final master's Category 25 "Regional coverage summary" — lines 2501–2510,
immediately preceding the embedded draft section — carries additional regional
narrative not present in the draft; this is final-master-only enrichment, already covered under
Section 8.)

## 14. Priority/integration-order preservation

**Not applicable.** The draft contains no priority ranking or integration-sequencing content
of its own (no Top-N list, no recommended order). There is nothing to compare or preserve on
this axis — the final master's SECTION A (Top 100) and SECTION T (recommended integration
sequence) are purely additive content that never existed in the draft.

## 15. Companion-artifact preservation

Since the draft's content is fully and verbatim present in the final master already, no
cross-check against companion artifacts was needed to rescue any at-risk fact. For completeness:

- **Africa registry** (`docs/research/source-registries/war_room_africa_api_registry.md`,
  verified intact, SHA-256 `FE6ACE3773AC5622E79E09C3172587424BDB77B4E1E0205AB275F892CBAE4244`) —
  the final master explicitly cross-references it rather than duplicating Africa-specific
  content (see final-master line 3110: *"Africa is covered by the separate Africa registry...
  and is cross-referenced, not duplicated"*). Consistent with the draft, which also carries no
  Africa-specific section.
- **Academic report** (verified intact, SHA-256
  `A6E26FB978D98B85E1C5FCECF1F3464DA80A4E7CE4CFD84210B1AE89B0ED8DB6`) — no conflicts found;
  not needed as a rescue source since nothing was at risk.
- **Global digest** (verified intact, SHA-256
  `1DA89432DA239C274C4C058666D2BF1460F6AF343F2B4B69110A7BE37F0142B4`) — no conflicts found; not
  needed as a rescue source.

## 16. Research Engine relationship

See Section 12. No code changes made; no provider implementation opened; the old 29-provider
cleanup batch was not reopened. This reconciliation is purely a documentation/knowledge-base
exercise.

## 17. Conflicts and superseded material

**Zero conflicts.** Because the draft is embedded verbatim rather than reworked, there is no
factual disagreement between draft and final to adjudicate — they are the same text. No
supersession event (correction, migration, renaming, recount) occurred between the draft and
this section of the final master; the final master's *additional* sections (Top 100, gap
sections, etc.) are new content built from the same underlying 509-row dataset, not
corrections to it.

## 18. Information-preservation assessment

Every meaningful fact, count, row, and summary in the draft is verifiably present, verbatim,
in the final master. No draft-only source, fact, credential detail, regional detail, or
priority signal was found. The final master is strictly richer. See verdict below.

---

## Quantitative reconciliation (Phase 14)

| Metric | Value | Confidence |
|---|---|---|
| Draft source-row count | 509 | EXACT |
| Canonical source count | 509 | EXACT |
| Source rows represented in final master | 509 of 509 (100%) | EXACT |
| Draft-only source count | 0 | EXACT |
| Draft-only fact/detail count | 0 | EXACT |
| Preserved-summary count | 3 (category, status, tier tables) | EXACT |
| Non-preserved-summary count | 0 | EXACT |
| Conflict count | 0 | EXACT |
| Superseded-item count | 0 | EXACT |
| Credential-detail delta count | 0 | EXACT |
| Status/migration delta count | 0 | EXACT |
| Regional/country delta count | 0 | EXACT |
| Integration-priority delta count | N/A (draft has no priority ledger to diff against) | NOT RELIABLY COUNTABLE (not applicable, not unknown) |
| Gap-list delta count | N/A (draft has no standalone gap section) | NOT RELIABLY COUNTABLE (not applicable, not unknown) |

## Information-preservation verdict

**A. FULLY SUPERSEDED — ARCHIVAL VALUE ONLY**

Judged against the final master, the Africa registry, the academic report, and the global
digest: the draft contributes no fact, source, count, or detail beyond what the final master
already contains verbatim in the same location. Its value is strictly archival/provenance
(showing the intermediate assembly state of the registry-build pipeline before the richer
per-source write-up and analytical sections A–Z were added) — not a rescue of otherwise-lost
knowledge, since nothing here was ever at risk of loss.

---

## Next stage

Per task instructions, if this reconciliation passes, the next global Kimi recovery stage is:

**PRESERVE THE SIXTEEN RAW KIMI WAVE REPORTS**
(`01_software_coding.md` … `16_regional_specialized.md`, Wave 1 files 01–08 + Wave 2 files
09–16) — original Kimi research/provenance artifacts, not a provider-implementation sweep.

## Recommendation

KIMI MASTER-REGISTRY DRAFT RECOVERED — READY FOR KNOWLEDGE INTEGRATION REVIEW

## Final verdict

**PASS**
