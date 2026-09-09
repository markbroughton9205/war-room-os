# War Room Search — Discovery Providers

War Room Search (`lib/war-room-search`) is the existing federated retrieval path used by `/api/search` and Council search handoff. It is not a second research engine. Discovery providers find pages; Build #6 independence still decides whether those pages are independent evidence.

## Providers

| Provider | Identity | Role | Enabled when |
|---|---|---|---|
| Tavily | `tavily` / `TAVILY` | Hosted web discovery | `TAVILY_API_KEY` |
| Google Web Search | `google_web_search` / `GOOGLE` | Hosted web discovery | `GOOGLE_WEB_SEARCH_API_KEY` + `GOOGLE_WEB_SEARCH_CLIENT_ID` |
| **SearXNG** | `searxng` / `SEARXNG` | Self-hosted federated web discovery | `SEARXNG_BASE_URL` |
| Public RSS | `public_news_rss` / `RSS` | Feed discovery | always attempted |
| Research Engine | per-adapter / `RESEARCH_ENGINE` | Primary/public structured sources | per adapter |
| **War Room Local** | `war_room_local` / `WAR_ROOM_LOCAL` | Sovereign corpus retrieval (Stage 3) | local SQLite index under `.war-room/sovereign-search/` |

Missing or failed providers degrade independently. The research runtime continues.

## SEARXNG

Purpose: self-hosted federated web-discovery provider.

Status: available when `SEARXNG_BASE_URL` is configured.

Architecture:

```
Commander / Council / Research request
  → existing War Room Search / live-research orchestrator
  → SearXNG adapter
  → self-hosted SearXNG HTTP API (`GET /search?format=json`)
  → federated upstream engines
  → normalized War Room results
  → existing dedupe / source-family / evidence pipeline
  → Council (no new authority, no new approvals)
```

Key distinction: SearXNG increases discovery breadth but does **not** create independent evidence when multiple engines, or SearXNG plus Tavily/Google, surface the same underlying source.

Provenance example:

- `discovered_via`: `SEARXNG`
- `upstream_engines`: `brave`, `duckduckgo`
- `source_family` / publisher: `reuters.com` (or the actual publisher family)
- If Tavily or Google found the same canonical URL: one cluster head, `also_discovered_via` records the other discovery services

### Configuration (placeholders only)

```
SEARXNG_BASE_URL=https://search.example.internal
SEARXNG_TIMEOUT_MS=10000
```

Optional reverse-proxy auth (SearXNG has no native API-key scheme):

```
SEARXNG_AUTH_HEADER=Authorization
SEARXNG_AUTH_VALUE=Bearer <token>
```

LAN / trusted internal HTTP is supported for loopback, RFC1918, `.internal`, `.local`, and `.lan` hosts. The configured URL must be the final search origin — the adapter does not follow redirects (SSRF control). Commander search text never changes the host.

JSON output must be enabled on the SearXNG instance (`search.formats` must include `json`).

### Privacy boundary

This is not absolute anonymity.

```
Commander → War Room → SearXNG → upstream engines
```

War Room does not forward Commander IP or identity headers to SearXNG. The query string is sent to the self-hosted instance, which may query upstream engines according to that instance's engine list.

### Intentionally not in Stage 2

Stage 2 is external federated discovery only. Stage 3 owns the crawler/index. Stage 4 (hybrid retrieval + relevance control) is frozen. Stage 5 manages freshness, controlled recrawl, and controlled re-index of already-approved corpus URLs; it is not autonomous discovery.

### Validation (Stage 2)

```
pnpm run validate:searxng
pnpm run validate:searxng:live
pnpm run validate:war-room-search
```

## Stage 3 — War Room crawler + local searchable index

**DISCOVERY OWNERSHIP ≠ CONTENT AUTHORSHIP.**

War Room may store and retrieve a page. The publisher remains the original source.

Example:

- `discovered_via`: `WAR_ROOM_LOCAL` (this retrieval)
- `storage_origin`: `WAR_ROOM_CORPUS`
- `source_family` / publisher: `reuters.com`
- If Google/SearXNG also found the same canonical URL: one Build #6 cluster head, not two independent sources

Architecture:

```
Approved URL
  → crawl policy / SSRF / robots
  → bounded fetch (HTML or text/plain)
  → extract
  → canonicalize
  → SHA-256 content hash
  → SQLite metadata + FTS5
  → documents JSON under .war-room/sovereign-search/documents/
  → war_room_local federated search provider
  → existing Build #6 independence / Council handoff
```

Crawls are **not** autonomous. Stage 3A accepts a Commander-approved or trusted-internal-test URL only. No recursive spider, no scheduler, no embeddings.

### Storage

Default directory (gitignored via `.war-room/`):

```
.war-room/sovereign-search/corpus.sqlite
.war-room/sovereign-search/documents/{id}.json
```

Override: `WAR_ROOM_SOVEREIGN_SEARCH_DIR`

Policy (placeholders only):

```
WAR_ROOM_CRAWL_ALLOWLIST=
WAR_ROOM_CRAWL_DENYLIST=
WAR_ROOM_CRAWL_DISABLED=
WAR_ROOM_LOCAL_SEARCH_DISABLED=
```

User-Agent: `WarRoomBot/1.0`

There is no public crawler-information URL yet, so the identity is the product token only. Do not emit a placeholder `+https://...` URI.

robots.txt is a technical signal, not legal authorization. If robots.txt cannot be fetched, Stage 3 conservatively refuses the crawl (`ROBOTS_FETCH_ERROR`). A missing robots.txt is `ROBOTS_UNKNOWN` and does not block.

### Commands

```
pnpm run crawl:approved-url -- --url=https://example.com --approved-by=commander
pnpm run crawl:approved-url -- --url=http://127.0.0.1:PORT/allowed --approved-by=trusted_internal_test --allow-internal
pnpm run sovereign-search:crawl -- --approved-by=commander --input=work/sovereign-search/batch.example.json
pnpm run validate:sovereign-crawler
pnpm run validate:local-index
pnpm run validate:sovereign-search-stage3
pnpm run validate:sovereign-search-stage3b
pnpm run sovereign-search:reset
```

`sovereign-search:reset` deletes only `.war-room/sovereign-search/` (or a `WAR_ROOM_SOVEREIGN_SEARCH_DIR` that still stays under `.war-room/`).

### Stage 3B — bounded Commander-approved batch ingest

Stage 3B accepts an **explicit URL list**. It is not a spider: no discovered-link expansion, no domain crawl, no sitemap, no scheduler.

Maximum batch size is a server-side constant (`MAX_SOVEREIGN_BATCH_URLS = 25`). Over-limit input is refused before any fetch.

Each URL is independent:

```
INDEXED | BLOCKED_ROBOTS | BLOCKED_POLICY | DUPLICATE_URL | DUPLICATE_CONTENT
| UNSUPPORTED_TYPE | FETCH_FAILED | EXTRACT_FAILED
```

One URL failure does not abort the batch unless SQLite/storage itself fails. Duplicate canonical URL updates last-seen metadata (Stage 3A semantics). Same content hash at a different canonical URL is `DUPLICATE_CONTENT` (alias/event provenance, not independent evidence).

Operator JSON (local file only — not a URL):

```json
{
  "urls": [
    { "url": "https://example.com", "discoveredVia": "COMMANDER" },
    { "url": "https://example.org", "discoveredVia": "SEARXNG" }
  ]
}
```

`discoveredVia` is optional trusted provenance (`SEARXNG`, `GOOGLE`, `TAVILY`, `RSS`, `COMMANDER`, …). Discovery-provider count is still not evidence independence.

### Stage 3C — controlled discovery → approval → ingest

Discovery does **not** authorize a crawl. Stage 3C stores pending ingest candidates from existing `SearchResult` rows, then waits for Commander approval before reusing Stage 3B batch ingest.

```
federated discovery
  → pending ingest candidate (no page fetch)
  → Commander approve / reject
  → Stage 3B batch ingest (policy / robots / SSRF)
  → SQLite / FTS / WAR_ROOM_LOCAL
```

Candidates live in the existing corpus database (`.war-room/sovereign-search/corpus.sqlite`, table `ingest_candidates`). Same canonical URL from multiple providers merges provenance onto one candidate. Council may recommend; only Commander or `trusted_internal_test` may approve or ingest. Unapproved candidates are not crawled. URLs already in the corpus return `ALREADY_INDEXED` and are not recrawled.

```
pnpm run sovereign-search:candidates -- --discover --query="example domain" --select-index=0,1
pnpm run sovereign-search:candidates -- --list --status=PENDING
pnpm run sovereign-search:candidates -- --approve=1 --approved-by=commander
pnpm run sovereign-search:candidates -- --reject=2 --approved-by=commander
pnpm run sovereign-search:candidates -- --ingest=1 --approved-by=commander
pnpm run validate:sovereign-search-stage3c
```

Maximum approved ingest batch remains 25. Candidate-bridge failures must not take down federated discovery.

### Stage 4A — hybrid lexical + semantic retrieval

Stage 4A upgrades `WAR_ROOM_LOCAL` over documents already ingested through Stage 3. It is not a crawler, not a research engine, and not a Build #6 replacement.

```
query
  → FTS lexical retrieval
  + local semantic retrieval (when the operator-installed model is present)
  → Reciprocal Rank Fusion
  → normalized WAR_ROOM_LOCAL results
  → existing Build #6 independence
```

Semantic retrieval uses a sovereign local ONNX embedder (`BAAI/bge-small-en-v1.5`, MIT). Model weights live under `.war-room/models/` (gitignored). Queries never download weights. If the model or vector index is missing/corrupt, FTS continues and search stays healthy.

Verified inference backend on this Windows x64 Node runtime:

- package: `@huggingface/transformers` 4.2.0
- runtime: native `onnxruntime-node` 1.24.3 (not `onnxruntime-web`, not WASM)
- execution provider: CPU (transformers.js Node default; DirectML/CUDA are not selected)
- process modules after a live embed: `onnxruntime_binding.node` and `onnxruntime.dll`
- no WASM fallback occurred

pnpm may list `onnxruntime-node` under ignored builds. On Windows x64 that only skips optional CUDA EP downloads; CPU binaries are already bundled in the npm package and were loaded at runtime. Do not treat ignored install scripts as proof of WASM inference.

```
pnpm run sovereign-search:prepare-embeddings -- --download
pnpm run sovereign-search:embed
pnpm run validate:sovereign-search-stage4a
```

Chunks preserve document lineage. Ten chunks from one publisher remain one evidence source. Lexical and semantic scores stay separate; fusion is rank-based (RRF, k=60), not an uncalibrated weighted sum.

### Stage 4B — hybrid evaluation, diagnostics, and guardrails

Stage 4B does not add another retrieval system. It measures and observes the Stage 4A path:

```
query → WAR_ROOM_LOCAL → FTS + semantic → RRF → SearchResult.localRetrievalSignals
                                          ↘ existing federated rankBreakdown (authority/freshness/relevance)
                                          → Build #6 clustering → Council evidence
```

`localRetrievalSignals` (lexical/semantic/RRF) stay off the federated score scale. Cosine similarity is never compared directly to BM25 or authority.

Semantic unavailability is diagnostic (`sourceSummary.localSemantic`) and does not mark `WAR_ROOM_LOCAL` unhealthy while FTS still works.

Stale vectors are counted and withheld from retrieval. Controlled re-index of stale vectors is part of Stage 5 maintenance of already-approved documents; it is not autonomous discovery.

Brute-force cosine is the intended Stage 4B method. Reconsider ANN storage only after about **50,000 chunks** or **256MB** of `vectors.sqlite`. Do not introduce a vector service in this stage.

```
pnpm run validate:sovereign-search-stage4b
pnpm run validate:sovereign-search-stage4b:live
```

### Stage 4C — semantic relevance gating and abstention

Semantic nearest-neighbor search no longer promotes an unrelated closest vector as a local result. Admission uses retrieval profile `wr-retrieval-v4c.1`:

- model `BAAI/bge-small-en-v1.5` revision `xenova-onnx-q8`
- chunking `wr-chunk-v1`
- RRF k=60
- strategy `min_cosine`
- threshold `0.61` (measured; not an arbitrary 0.5/0.55/0.6)

If FTS has no hit and semantic candidates fail the gate, `WAR_ROOM_LOCAL` returns zero local results with `semanticAdmission.abstained=true`. That is healthy. Semantic infrastructure can remain `available` while a query abstains.

Stage 4D adds deterministic lexical query planning in front of SQLite FTS5. User text is never sent raw into `MATCH`. Strict AND is tried first. If that returns nothing, a bounded relaxed plan may OR connector-split groups that each have at least two content tokens. Stop words removed from planning: `and`, `or`, `the`, `for`, `of`, `in`, `to`. Plan names (`STRICT` / `RELAXED`) are retrieval diagnostics only — not publishers, not evidence sources.

Rejected semantic candidates do not enter RRF and do not become Council evidence.

```
pnpm run validate:sovereign-search-stage4c
pnpm run validate:sovereign-search-stage4c:live
pnpm run validate:sovereign-search-stage4d
pnpm run validate:sovereign-search-stage4d:live
```

### Stage 4D — lexical query planning and mixed-intent retrieval

SQLite FTS no longer requires every query token to appear in one document before mixed-topic retrieval can succeed. Example: `reserved DNS names and LIV Golf` is planned as `(reserved AND DNS AND names) OR (LIV AND Golf)` after the connector `and` is removed. Exact queries such as `RFC 2606` still use the strict plan when it already returns hits.

Lexical BM25 and semantic cosine remain separate scales. RRF still fuses the two lists. Semantic abstention stays on retrieval profile `wr-retrieval-v4c.1` at cosine `0.61`.

Diagnostics: `lexicalPlan` (`planUsed`, `strictCandidateCount`, `relaxedCandidateCount`, `termsUsed`, `phrasesUsed`, `relaxationApplied`). No raw SQL is exposed.

```
pnpm run validate:sovereign-search-stage4d
pnpm run validate:sovereign-search-stage4d:live
```

## SOVEREIGN SEARCH STAGE 4 — FREEZE

**HYBRID RETRIEVAL + RELEVANCE CONTROL**

STATUS: **PASS / LIVE-VALIDATED / COMMITTED**

Frozen at `b819918819740b34c3bea0ccf9a0025cd9a64d32` (`feat(search): add lexical query planning and mixed-intent retrieval`).

Stage 4 now includes:

- **4A** local semantic retrieval + RRF
- **4B** retrieval evaluation + diagnostics
- **4C** semantic relevance gating + abstention
- **4D** lexical query planning + mixed-intent retrieval

Do not create Stage 4E unless a future measured retrieval defect requires it.

Known non-blocking limitations:

- lexical relaxation currently depends on explicit `and`/`or` grouping
- 8-token lexical cap
- semantic profile is model/corpus specific (`wr-retrieval-v4c.1`, cosine `0.61`)
- no LLM query rewriting
- current vector search remains brute-force at small corpus scale

## Stage 5 — durable sovereign search intelligence

Stage 5 manages freshness, controlled recrawl, and controlled re-index of URLs **already approved and ingested**. It is not autonomous source discovery, not automatic candidate approval, and not permission to expand the corpus without Commander authority. This is roadmap item #11, not a new stage.

```
existing approved document
  → freshness evaluation
  → recrawl due state
  → controlled recrawl
  → policy/robots/SSRF re-check
  → fetch/extract/hash
  → unchanged OR changed
  → corpus version/update
  → stale-vector marking
  → retrieval continues safely
```

A document being in the corpus means War Room may evaluate whether **that already-approved URL** is stale. It does **not** mean follow its links, crawl its domain, discover new URLs, bypass robots/policy, or expand recursively. New URLs still require the Stage 3C candidate + Commander approval path.

### Freshness model

Time-based states: `FRESH`, `DUE`, `STALE`, `UNKNOWN`.

Operator overlay: `RECRAWL_BLOCKED`, `RECRAWL_FAILED`.

Source availability is recorded separately: `AVAILABLE`, `NOT_FOUND`, `GONE`.

Due calculation uses **last successful crawl** (`last_crawled_at`) plus the configured interval. Search/FTS/semantic retrieval time is not crawl freshness.

### Freshness policy

Conservative defaults (operator-controlled, not LLM-inferred):

- default interval: **720 hours (30 days)** via `WAR_ROOM_FRESHNESS_DEFAULT_INTERVAL_HOURS`
- stale multiplier: **2** via `WAR_ROOM_FRESHNESS_STALE_MULTIPLIER` (STALE after 2× the interval)
- optional per-domain overrides: `WAR_ROOM_FRESHNESS_DOMAIN_INTERVALS=iana.org:168,example.com:720`
- optional per-document override stored in `crawl_documents.metadata_json.freshnessIntervalHours`

Minimum interval is 1 hour. Stage 5 does not infer aggressive refresh rates from page contents.

### Recrawl

`recrawlStoredDocument` reuses Stage 3 policy, robots, SSRF, bounded fetch, extraction, canonicalization, and content hash. Every recrawl re-evaluates robots and current allowlist/denylist/crawl-disabled/SSRF. Previous permission does not permanently authorize future fetches.

- **UNCHANGED**: hash matches; crawl metadata updates; no fake new evidence source
- **CHANGED**: current document + FTS update atomically; previous/new hash lineage in `document_versions`; old embeddings become stale and are not served; controlled re-index is operator-enabled during maintenance and is not implied by recrawl alone
- **BLOCKED / FAILED / timeout / HTTP 5xx**: last known good document is preserved
- **404 / 410**: recorded as `NOT_FOUND` / `GONE`; local evidence is not deleted
- **canonical/redirect change**: hops are safety-checked; stored canonical identity is not rewritten automatically

Hash lineage lives in `document_versions` (no Wayback-style HTML archive). Full previous bodies are not retained.

### Controlled re-index of stale vectors

When corpus `content_hash` != stored vector `content_hash`, those vectors are stale and are not served. Stage 5 reuses Stage 4 chunking (`wr-chunk-v1`), local BGE (`BAAI/bge-small-en-v1.5` / `xenova-onnx-q8`), and `vectors.sqlite`. Replacement vectors are prepared first, then swapped in one SQLite transaction. Usable current vectors are not deleted until the replacement is ready. If re-index fails, FTS remains, stale vectors stay withheld, and semantic retrieval is not marked healthy for that document.

Council may recommend maintenance. Council cannot authorize recrawl or re-index.

### Operator maintenance (no public endpoint, no in-process daemon)

There is no Stage 5 in-process scheduler and no `setInterval` loop. The durable loop is an operator-triggered command. A host scheduler (Windows Task Scheduler, systemd timer, or crontab) may invoke that same command later; War Room does not install those tasks.

```
pnpm run sovereign-search:lifecycle -- --list-freshness
pnpm run sovereign-search:lifecycle -- --list-due
pnpm run sovereign-search:lifecycle -- --diagnostics
pnpm run sovereign-search:lifecycle -- --recrawl=1 --approved-by=commander
pnpm run sovereign-search:lifecycle -- --recrawl-due --limit=5 --approved-by=commander
pnpm run sovereign-search:maintain -- --approved-by=commander --recrawl-due --reembed-stale --limit=5
pnpm run sovereign-search:maintain -- --diagnostics
```

Overlapping maintenance runs are refused via a SQLite lock/lease (`sovereign-search-maintenance`). An expired lease is recoverable on the next invocation; work is not silently duplicated mid-document. Search/FTS stay available during maintenance. Semantic retrieval continues to serve only vectors whose content hash matches the current corpus document.

Batch recrawl and re-index are capped at 25 (`MAX_MAINTENANCE_BATCH`). If the local ONNX model is missing, re-index reports unavailable and does not download weights.

Example host schedule (operator-installed, not applied by War Room):

```
# Windows Task Scheduler: daily 03:15 local, working directory = repo root
pnpm run sovereign-search:maintain -- --approved-by=commander --recrawl-due --reembed-stale --limit=5
```

```
pnpm run validate:sovereign-search-stage5a
pnpm run validate:sovereign-search-stage5a:live
pnpm run validate:sovereign-search-stage5
pnpm run validate:sovereign-search-stage5:live
```

