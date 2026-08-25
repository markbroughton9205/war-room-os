# API contracts — disease/ontology batch (Checkpoint 2 biomedical)

All 3 confirmed live via direct `curl` against the real endpoints (not just docs) during this research pass.

## 1. EBI Ontology Lookup Service (OLS4)

- Host to allowlist: `www.ebi.ac.uk`
- Endpoint: `GET /ols4/api/search?q={text}&rows={n}` — free-text search across all loaded ontologies (GO, HPO, MONDO, DOID, MeSH, ChEBI, etc. all in one index)
- Optional params: `ontology={id}` (restrict to one ontology, e.g. `hp`, `mondo`), `rows` (page size), `start` (offset), `exact=true` (exact label match only)
- Auth: **none required**, fully public
- Response format: JSON. Top-level `response.numFound`, `response.docs[]`. Per doc (confirmed live): `iri` (full ontology term URI, stable), `short_form` (e.g. `HP_0005978`), `obo_id` (e.g. `HP:0005978`), `ontology_name` (e.g. `hp`, `mesh`), `ontology_prefix`, `label` (preferred term name), `description[]` (array, often empty for some ontologies), `type` (`class`/`property`/etc.), `exact_synonyms[]`, `related_synonyms[]`. No native canonical URL field — construct as `https://www.ebi.ac.uk/ols4/ontologies/{ontology_name}/classes/{encodeURIComponent(iri)}`.
- Rate limit: no documented hard cap observed; no rate-limit headers returned on a single test request. Be a well-behaved client (timeout, single concurrency) per EBI convention used elsewhere in this codebase (ncbi/crossref-style).
- Example confirmed live: `GET https://www.ebi.ac.uk/ols4/api/search?q=diabetes&rows=2` → first doc `obo_id: "HP:0005978"`, `label: "Type II diabetes mellitus"`, `ontology_name: "hp"`.
- Stable ID for `providerRecordId`: `obo_id` (fall back to `short_form` if `obo_id` absent).

## 2. MedlinePlus Web Service

- Host to allowlist: `wsearch.nlm.nih.gov`
- Endpoint: `GET /ws/query?db=healthTopics&term={text}&rettype=brief`
- Required params: `db=healthTopics`, `term`; optional `rettype` (`brief` omits full body-heavy fields — use `brief`... actually confirmed live: even `brief` still returns `FullSummary` — the full HTML-formatted consumer health article body), `retstart`/`retmax` (pagination, default retmax=10)
- Auth: **none required**, fully public, no key exists for this API
- Response format: **XML** (not JSON) — `<nlmSearchResult><list><document rank="N" url="...">` with nested `<content name="FIELD">` elements. Confirmed live fields: `document@url` (canonical URL, e.g. `https://medlineplus.gov/highbloodpressure.html`), `content[name=title]` (HTML-highlighted, contains `<span class="qt0">` wrapper spans around matched terms — must be stripped), `content[name=organizationName]`, `content[name=altTitle]` (repeated, alternate names), `content[name=FullSummary]` (full HTML article body — long, contains `<p>`/`<ul>` tags), `content[name=snippet]` (short excerpt, better for a summary field than FullSummary), `content[name=mesh]` (repeated MeSH term tags), `content[name=groupName]` (repeated topic-group tags). No stable numeric ID field — use the `url` slug (e.g. `highbloodpressure`) as `providerRecordId`.
- Rate limit: no documented hard numeric cap; NLM asks for reasonable use, no key/registration needed.
- Example confirmed live: `GET https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=hypertension&rettype=brief` → 93 results, first doc url=`https://medlineplus.gov/highbloodpressure.html`, title (after stripping `<span class="qt0"><span class="qt1">...</span></span>` wrappers) = "High Blood Pressure".
- Note: title/snippet fields contain nested `<span class="qt0"><span class="qt1">TERM</span></span>` highlight-wrapper markup around matched search terms, plus general HTML tags (`<p>`, `<ul>`, `<li>`) inside FullSummary — needs generic tag-stripping (not just the two qt spans) using this codebase's existing `xmlLite.ts`-style regex tag stripping, plus standard entity decoding.

## 3. WHO Global Health Observatory (GHO) OData API

- Host to allowlist: **`ghoapi.azureedge.net`** — NOT `who.int`. The GHO OData API is served from an Azure CDN endpoint distinct from the WHO website; `www.who.int/data/gho/info/gho-odata-api` is documentation only, the actual API base is `https://ghoapi.azureedge.net/api/`.
- Two-step model: (1) `GET /api/Indicator` lists all ~2,300 indicator codes/names (no query param needed, supports OData `$filter`/`$top`), (2) `GET /api/{IndicatorCode}?$top={n}` returns actual data values for one indicator across countries/years.
- Confirmed live indicator list fields: `IndicatorCode` (stable id, e.g. `WHOSIS_000001`), `IndicatorName`, `Language`.
- Confirmed live data-value fields (querying a specific indicator): `Id` (numeric row id), `IndicatorCode`, `SpatialDimType` (`COUNTRY`/`REGION`/etc.), `SpatialDim` (ISO3 country code e.g. `SOM`), `ParentLocation` (region name), `TimeDim` (year, numeric), `Dim1`/`Dim1Type` (e.g. sex breakdown), `Value` (display string, e.g. `"48.0 [46.7-49.6]"`), `NumericValue` (float), `Low`/`High` (confidence interval), `Date` (last-updated timestamp).
- Auth: **none required**, fully public, no key.
- Query mapping for a text-search-shaped adapter: a caller's free-text query is best matched client-side against `IndicatorName` from the `/api/Indicator` list (cached), then the matched `IndicatorCode` is used to fetch a bounded page of `/api/{code}?$top=N` data values — similar two-step pattern already used by this codebase's `eurostat` adapter (keyword→code lookup, since neither API supports server-side free-text search over indicator names with a single call). No canonical human-readable URL per data point exists; use `https://www.who.int/data/gho/data/indicators/indicator-details/GHO/{IndicatorCode}` as canonical.
- Rate limit: no documented hard cap; Azure CDN-backed, generally fast and tolerant.
- OData `$top`/`$filter`/`$select` syntax works as standard OData v4; no auth header needed for any of it.

## Flags / uncertainty

- None — all three endpoints were live-confirmed via direct HTTP requests during this research pass, not just documentation review. No auth blockers, no commercial gating, no external blockers for any of the three.
- MedlinePlus and GHO both require a keyword/text→code or HTML-stripping normalization step (not simple pass-through JSON), similar in shape to the `eurostat` adapter's dataset-code lookup pattern already established in this codebase.
