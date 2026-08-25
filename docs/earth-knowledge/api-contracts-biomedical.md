# API contracts — biomedical/chem/bio batch (First-25 gap sources)

Researched via live JSON responses against each official endpoint (except where noted). Feeds directly into new `lib/research-engine/providers/*.ts` adapters.

## 1. Wikipedia REST API (Wikimedia core REST API)

- Host to allowlist: `en.wikipedia.org` (English edition only, matching this repo's single-hostname allowlist pattern; no wildcard subdomain support exists in `hostAllowlist.ts` today — a multi-language adapter would need a fixed small allowlist per configured language or should stay English-only for this build phase)
- Endpoint: `GET /api/rest_v1/page/summary/{title}` (title is the URL-encoded page title, e.g. `Albert_Einstein`)
- Required params: none (title is a path segment, not a query param)
- Auth: **none required**. Wikimedia policy requires a descriptive `User-Agent` header identifying the app + contact (analogous to `WIKIMEDIA_USER_AGENT_BASE` already used by the `wikidata` adapter — reuse it).
- Response format: JSON. Confirmed live fields: `title`, `pageid`, `extract` (plain-text summary), `description` (short one-line description), `timestamp` (ISO 8601, last-revision time), `content_urls.desktop.page` (canonical URL), `thumbnail.source`/`width`/`height`.
- Rate limit: no hard published per-key limit; Wikimedia asks for a descriptive User-Agent and reasonable request volume (soft ceiling informally ~200 req/s across all Wikimedia REST API traffic, not per-client).
- Example: `GET https://en.wikipedia.org/api/rest_v1/page/summary/Albert_Einstein` → `{"title":"Albert Einstein","pageid":736,"extract":"Albert Einstein was a German-born theoretical physicist...","description":"German-born theoretical physicist (1879–1955)","timestamp":"2026-08-18T14:47:41Z","content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Albert_Einstein"}},"thumbnail":{"source":"https://upload.wikimedia.org/...","width":330,"height":408}}`
- Note: this is a single-page lookup (`getById`-shaped), not free-text search — a query would need to be treated as a page title, or paired with the existing Wikidata search to resolve a title first. Recommend implementing as a `getById`/title-lookup capability, not `search`.

## 2. Europe PMC REST API

- Host to allowlist: `www.ebi.ac.uk`
- Endpoint: `GET /europepmc/webservices/rest/search?query={text}&format=json`
- Required params: `query`, `format=json`; optional `pageSize` (default 25, max 1000), `cursorMark` (pagination, start `*`)
- Auth: **none required**, fully public.
- Response format: JSON. Confirmed live fields under `resultList.result[]`: `id`, `title`, `authorString`, `journalTitle`, `pubYear`, `doi`, `source` (e.g. `"MED"`), `pmid`, `pubType`, `isOpenAccess`, `citedByCount`, `firstPublicationDate`. Top-level: `hitCount`, `nextCursorMark`, `request.pageSize`.
- Rate limit: no strict documented cap; EBI asks for reasonable polling and recommends not hammering in tight loops.
- Example: `GET https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=cancer&format=json` → `hitCount: 5534499`, `resultList.result[0]` includes id `"42617733"`.

## 3. ClinicalTrials.gov API v2

- Host to allowlist: `clinicaltrials.gov`
- Endpoint: `GET /api/v2/studies?query.term={text}&pageSize={n}&format=json`
- Required params: none strictly required to hit the endpoint (a bare call returns unfiltered studies), but `query.term` is the free-text search param; `pageSize` bounds results (max 1000, default 10); `format=json` is the default and can be omitted.
- Auth: **none required**, fully public, no key exists for this API.
- Response format: JSON. Confirmed live shape: top-level `studies[]` + `nextPageToken`. Per study: `protocolSection.identificationModule.nctId` (stable ID), `.briefTitle`, `protocolSection.statusModule.overallStatus` (e.g. `ACTIVE_NOT_RECRUITING`), `protocolSection.statusModule.lastUpdatePostDateStruct.date`, `protocolSection.conditionsModule.conditions[]`, `protocolSection.sponsorCollaboratorsModule.leadSponsor.name`.
- Canonical URL pattern: `https://clinicaltrials.gov/study/{nctId}`
- Rate limit: no published hard numeric cap; standard fair-use expected.
- Example confirmed live: `GET https://clinicaltrials.gov/api/v2/studies?query.term=cancer&pageSize=2&format=json` → `studies[0].protocolSection.identificationModule.nctId = "NCT03768492"`, `briefTitle`, `overallStatus = "ACTIVE_NOT_RECRUITING"`.

## 4. openFDA (drug label endpoint)

- Host to allowlist: `api.fda.gov`
- Endpoint: `GET /drug/label.json?search={text}&limit={n}`
- Required params: `search` (Lucene-syntax query string, e.g. free text or field-scoped like `openfda.brand_name:aspirin`); optional `limit` (max 1000 per page), `skip`, `api_key`.
- Auth: **optional** API key (`OPENFDA_API_KEY` env var convention). Without a key: 240 requests/minute and 1,000 requests/day per IP. With a free key (self-service signup, no approval gate): 240 requests/minute and 120,000 requests/day. Not a hard blocker — provider works unauthenticated, matching this repo's `pendingWhenUnconfigured: false` / optional-key pattern (like `ncbi`, `semantic_scholar`).
- Response format: JSON. Top-level `meta` (disclaimer/terms/license/pagination) + `results[]`. Each result is one SPL (Structured Product Labeling) document; live fetch on this pass returned only the narrative label fields (`indications_and_usage`, `warnings_and_cautions`, `dosage_and_administration`, `boxed_warning`, `description`, `contraindications`, `adverse_reactions`, etc.) — the fetch tool's summarizer did not surface `id`/`effective_time`/`openfda.*` in its trimmed output, but per the stable, long-documented openFDA schema those fields are present on every label record: `id` (SPL set ID, stable), `effective_time` (YYYYMMDD label revision date), and a nested `openfda` object with `brand_name[]`, `generic_name[]`, `manufacturer_name[]`, `substance_name[]`, `route[]`, `product_type[]`, `rxcui[]`, `spl_id[]`. **Flag: the id/openfda/effective_time fields were not independently re-confirmed via raw byte inspection this pass (summarizer truncation) — recommend a direct `curl` sanity check before shipping the parser**, though this is documented, stable openFDA behavior unchanged for years.
- Canonical URL: no single canonical human page per record; can construct `https://www.accessdata.fda.gov/spl/data/{spl_id}/{spl_id}.xml` or simply omit canonicalUrl and rely on sourceUrl = the API record URL itself.

## 5. PubChem PUG REST

- Host to allowlist: `pubchem.ncbi.nlm.nih.gov`
- Endpoint (name → properties): `GET /rest/pug/compound/name/{name}/property/MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES/JSON`
- Required params: none beyond the path segments (name is a path segment, not a query param).
- Auth: **none required**, fully public.
- Response format: JSON. Confirmed live: `PropertyTable.Properties[]`, each with `CID` (stable numeric compound ID), `MolecularFormula`, `MolecularWeight`, `IUPACName`. Note: `CanonicalSMILES` was not present in the live response under that exact key — PubChem's current PUG REST schema uses `ConnectivitySMILES` for the non-isomeric SMILES property name (schema drift from older docs); request `ConnectivitySMILES` instead of `CanonicalSMILES`, or omit SMILES from the requested property list to avoid a 400.
- Canonical URL: `https://pubchem.ncbi.nlm.nih.gov/compound/{CID}`
- Rate limit: documented throttling — no more than 5 requests/second and no more than 400 requests/minute per IP; server returns HTTP 503 (dynamic throttling) when overloaded, must back off. A descriptive `User-Agent`/contact is good etiquette (NCBI-adjacent), matching this repo's `ncbi`/`crossref` convention.
- Example confirmed live: `GET https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/aspirin/property/MolecularFormula,MolecularWeight,IUPACName/JSON` → `CID 2244, "C9H8O4", "180.16", "2-acetyloxybenzoic acid"`.

## 6. GBIF Occurrence Search API

- Host to allowlist: `api.gbif.org`
- Endpoint: `GET /v1/occurrence/search?q={text}` (free text) or `?scientificName={name}` (taxon-scoped)
- Required params: at least one filter param (`q` or `scientificName` or others); optional `limit` (max 300 per page, default 20), `offset`.
- Auth: **none required** for read/search, fully public (write/download endpoints need OAuth, not used here).
- Response format: JSON. Confirmed live top-level: `offset`, `limit`, `endOfRecords`, `count`, `results[]`, `facets`. Per result: `key` (stable numeric occurrence ID), `scientificName`, `decimalLatitude`, `decimalLongitude`, `eventDate`, `country`, `basisOfRecord` (e.g. `HUMAN_OBSERVATION`), plus `datasetKey`, `taxonKey`, `species`, `kingdom`/`phylum`/`order`/`family`/`genus`, `recordedBy`, `license`.
- Canonical URL: `https://www.gbif.org/occurrence/{key}`
- Rate limit: no strict published numeric cap for the public search API; a descriptive User-Agent is good etiquette.
- Example confirmed live: `GET https://api.gbif.org/v1/occurrence/search?scientificName=Puma%20concolor&limit=2` → `count: 29398`, `results[0].key = 5938145577`.

## 7. UniProt REST API

- Host to allowlist: `rest.uniprot.org`
- Endpoint: `GET /uniprotkb/search?query={text}&format=json&fields=accession,id,protein_name,organism_name`
- Required params: `query` (supports field-scoped Lucene-like syntax, e.g. `insulin AND organism_id:9606`); `format=json`; `fields` optional (restricts returned columns, reduces payload); optional `size` (page size, max 500).
- Auth: **none required**, fully public read access.
- Response format: JSON. Confirmed live top-level: `results[]`. Per result: `primaryAccession` (stable ID, e.g. `P01308`), `uniProtkbId`, `entryType`, `organism.scientificName`, `proteinDescription.recommendedName.fullName.value`. (`sequence.value` and `uniProtKBCrossReferences` exist in the full schema but were excluded from this pass's requested `fields` list, so not independently re-confirmed live this pass — well-documented stable fields.)
- Canonical URL: `https://www.uniprot.org/uniprotkb/{primaryAccession}/entry`
- Rate limit: no strict published numeric cap; EBI asks for reasonable use and a descriptive User-Agent.
- Example confirmed live: `GET https://rest.uniprot.org/uniprotkb/search?query=insulin+AND+organism_id:9606&format=json&fields=accession,id,protein_name,organism_name&size=2` → `results[0].primaryAccession = "P01308"`, protein name `"Insulin"`, organism `"Homo sapiens"`.

## Flags / things to verify before shipping

- **openFDA**: `id`/`effective_time`/`openfda.*` fields not independently re-confirmed via raw JSON this pass due to WebFetch summarizer truncation on a large label record — these are long-stable, well-documented openFDA fields, but a direct `curl https://api.fda.gov/drug/label.json?search=aspirin&limit=1 | jq '.results[0] | keys'` sanity check is recommended before the parser ships.
- **PubChem**: use `ConnectivitySMILES`, not `CanonicalSMILES`, as the requested property name — the older `CanonicalSMILES` property name did not appear in the live response.
- **Wikipedia REST**: this endpoint is a single-page-title lookup, not free-text search. An adapter either needs the query text to already be (close to) an exact page title, or should chain through Wikidata/another search first to resolve a title — document this capability as `getById`, not `search`, to avoid overclaiming.

All 7 sources: no required credentials, no commercial gating, no external blockers. All are genuinely public REST/JSON APIs suitable for `LIVE_IMPLEMENTED` status once adapters + a live-verification harness exist.
