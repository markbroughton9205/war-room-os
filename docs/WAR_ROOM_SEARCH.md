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

Stage 2 is external federated discovery only. Stage 3 owns the crawler/index. Stage 4+ (embeddings, BGE-M3, semantic rerank) and Stage 5 (autonomous recrawl) remain separate.

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
