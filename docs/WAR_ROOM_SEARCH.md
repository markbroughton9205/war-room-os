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

### Intentionally not in this stage

Stage 3+ is out of scope: no custom crawler, local FTS index, embeddings, semantic reranker, recrawl, or search-intelligence history.

### Validation

```
pnpm run validate:searxng
pnpm run validate:searxng:live
pnpm run validate:war-room-search
```
