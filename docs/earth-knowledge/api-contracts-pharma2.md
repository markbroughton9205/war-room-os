# API contracts — pharmacology/bioactivity batch 2 (Checkpoint 2)

All 4 confirmed live via direct HTTP calls during this research pass (not just docs). Feeds directly into new `lib/research-engine/providers/*.ts` adapters.

## 1. RxNorm / RxNav REST API

- Host to allowlist: `rxnav.nlm.nih.gov`
- Endpoint: `GET /REST/drugs.json?name={text}` — searches by drug name (ingredient or brand), returns ALL matching concepts grouped by term-type (TTY: IN=ingredient, BN=brand name, SBD=branded drug, SCD=clinical drug, BPCK/GPCK=pack, etc.)
- Required params: `name`
- Auth: **none**, fully public, no key.
- Response format: JSON, **nested** — `drugGroup.conceptGroup[]`, each with `tty` and `conceptProperties[]` (each `{rxcui, name, synonym, tty, language, suppress, umlscui}`). Adapter must flatten `conceptGroup[].conceptProperties[]` into one flat result list. Confirmed live: `GET /REST/drugs.json?name=aspirin` → returns multiple concept groups (BPCK, GPCK, etc.) each containing entries with real `rxcui`/`name` pairs.
- Stable ID: `rxcui` (RxNorm Concept Unique Identifier, e.g. `1191` for plain aspirin — confirmed via `GET /REST/rxcui.json?name=aspirin` → `{"idGroup":{"rxnormId":["1191"]}}`).
- Canonical URL: no official per-concept web page exists; use `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm={rxcui}` (RxNav browser UI) as canonicalUrl, or omit and rely on sourceUrl = the API URL.
- Rate limit: no hard published cap; NLM asks for reasonable use, no required User-Agent format documented (a descriptive one is still good etiquette).
- Simpler alternative considered and rejected: `/REST/approximateTerm.json?term=X` returns ranked `{rxcui, score, rank}` candidates but **no name field** — would require an N+1 follow-up call per candidate to get a display name, which this codebase's adapters avoid. `drugs.json` returns names in one bounded call despite the nested shape.

## 2. DailyMed SPL Web Services

- Host to allowlist: `dailymed.nlm.nih.gov`
- Endpoint: `GET /dailymed/services/v2/spls.json?drug_name={text}&pagesize={n}`
- Required params: `drug_name` (or other filters like `rxcui`); optional `pagesize` (tested up to at least a few, page-based), `page`
- Auth: **none**, fully public, no key.
- Response format: JSON. Confirmed live: `{"data": [{"spl_version": 2, "published_date": "Aug 21, 2026", "title": "CHILDRENS IBUPROFEN (IBUPROFEN) TABLET, CHEWABLE [AMAZON.COM SERVICES LLC]", "setid": "5ba08c30-7eb9-433b-b763-9288f4dd1012"}], "metadata": {"total_elements": 1518, "total_pages": ..., "current_page": 1, "next_page_url": "..."}}`.
- Stable ID: `setid` (SPL Set ID, a UUID).
- Canonical URL: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={setid}`
- Title already includes drug name + manufacturer in one string (no separate structured brand/generic split at this list-endpoint level — full detail requires a second call to `/spls/{setid}.json`, not needed for a search-shaped adapter).
- Rate limit: no published hard numeric cap; standard NLM fair-use expected.

## 3. ChEMBL Web Services

- Host to allowlist: `www.ebi.ac.uk`
- Endpoint: `GET /chembl/api/data/molecule/search?q={text}&format=json`
- Required params: `q`, `format=json` (default is XML without it)
- Auth: **none**, fully public, no key.
- Response format: JSON. Confirmed live: `{"molecules": [{"molecule_chembl_id": "CHEMBL941", "pref_name": "IMATINIB", "max_phase": "4.0", "first_approval": 2001, "molecule_type": ..., "molecule_properties": {"full_mwt": "493.62", "full_molformula": "C29H31N7O", "alogp": "4.59", ...}, "molecule_structures": {...}, "atc_classifications": ["L01EA01"], "black_box_warning": 0, "withdrawn_flag": false, "score": ...}]}` — full field list confirmed: id/name/phase/approval/properties/structures/synonyms/therapeutic flags all present.
- Stable ID: `molecule_chembl_id` (e.g. `CHEMBL941`).
- Canonical URL: `https://www.ebi.ac.uk/chembl/explore/compound/{molecule_chembl_id}`
- Rate limit: no strict published numeric cap; EBI asks for reasonable use + descriptive User-Agent (matches this codebase's NCBI/PubChem/UniProt convention).

## 4. Open Targets Platform GraphQL API

- Host to allowlist: `api.platform.opentargets.org`
- Endpoint: `POST /api/v4/graphql`, body `{"query": "..."}`; Content-Type `application/json`
- Auth: **none**, fully public, no key.
- Example query confirmed live (search across diseases/targets/drugs by free text):
  ```graphql
  query { search(queryString: "asthma", entityNames: ["disease"]) { hits { id name entity } } }
  ```
  Response: `{"data":{"search":{"hits":[{"id":"MONDO_0004979","name":"asthma","entity":"disease"}, ...]}}}`. `entityNames` can be `["disease"]`, `["target"]`, `["drug"]`, or omitted for all three mixed.
- Stable ID: `id` (an ontology ID — MONDO/EFO for disease, Ensembl gene ID for target, ChEMBL ID for drug, depending on `entity`).
- Canonical URL: `https://platform.opentargets.org/{entity}/{id}` (e.g. `https://platform.opentargets.org/disease/MONDO_0004979`).
- Rate limit: not strictly published; documented as intended for programmatic/bulk use, reasonable-use etiquette expected.
- Note: this is the **only POST+JSON-body GraphQL endpoint** in this batch — matches the existing `osv_dev` adapter's POST-body pattern already established this mission, not a new pattern for this codebase.

## Summary
All 4 are genuinely public, zero-auth-required APIs — no credential blockers. All confirmed via live HTTP calls this pass (not just documentation), so field names above are ground-truth, not guessed. RxNorm's `drugs.json` nested shape is the only real design wrinkle (documented flattening approach above); all others return a flat/near-flat array. No uncertainty flags — all 4 ready to build as `LIVE_IMPLEMENTED` candidates.
