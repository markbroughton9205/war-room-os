# API contracts — package registries batch (Checkpoint 3: software/coding)

All 5 confirmed live via direct `curl` against real endpoints during this research pass.

## 1. PyPI JSON API

- Host to allowlist: `pypi.org`
- Endpoint: `GET /pypi/{package}/json` — a package-name lookup (`getById`-shaped), not free-text search. No search endpoint exists in PyPI's official JSON API (the old XML-RPC `search` method was removed).
- Auth: **none required**, fully public.
- Response fields (confirmed live, under `info`): `name`, `version` (latest), `summary`, `author`, `license`, `project_urls` (object, e.g. `Source`, `Documentation`), `home_page` (often `null` now — use `project_urls`/`project_url` instead). Canonical URL: `info.project_url` (e.g. `https://pypi.org/project/requests/`). Release dates: `urls[].upload_time` (top-level, per-file) for the current version; full version history under `releases` (keyed by version string).
- Rate limit: no documented hard numeric cap; a descriptive User-Agent is good etiquette (PyPI publishes a fair-use policy, no key/registration).
- Example confirmed live: `GET https://pypi.org/pypi/requests/json` → `info.name: "requests"`, `info.version: "2.34.2"`, `info.license: "Apache-2.0"`.

## 2. npm Registry API

- Host to allowlist: `registry.npmjs.org`
- Endpoint: `GET /{package}` — a package-name lookup (`getById`-shaped), not free-text search (the search-shaped endpoint is on a different host, `registry.npmjs.org/-/v1/search?text=`, not evaluated this pass — recommend building the simpler per-package lookup first).
- Auth: **none required**, fully public.
- Response fields (confirmed live): `name`, `description`, `dist-tags.latest` (current version string), `homepage`, `license` (string or object depending on package age), `repository.url`, `versions[latest].author` (name/email object), `time[latest]` (ISO date the current version was published), `time.created`/`time.modified`.
- Canonical URL: `https://www.npmjs.com/package/{name}`.
- Rate limit: no documented hard numeric cap for reasonable use; no key/registration needed.
- Example confirmed live: `GET https://registry.npmjs.org/express` → `name: "express"`, `dist-tags.latest: "5.2.1"`, `license: "MIT"`.

## 3. crates.io API

- Host to allowlist: `crates.io`
- Endpoint: `GET /api/v1/crates?q={text}&per_page={n}` — genuine free-text search.
- **Auth: none required, BUT a descriptive `User-Agent` header is strictly enforced — confirmed live: a request with no `User-Agent` returns HTTP 403.** Must send something like `"WarRoomResearchEngine/1.0 (contact-info)"` per crates.io's published crawler policy.
- Response fields (confirmed live, under `crates[]`): `name` (stable id/slug), `description`, `max_version` (latest version string), `repository` (source URL), `downloads` (total count), `created_at`, `updated_at` (both ISO datetimes). Top-level `meta.total` = total result count.
- Canonical URL: `https://crates.io/crates/{name}`.
- Rate limit: documented ~1 request/second sustained; bursts tolerated. Must identify via User-Agent as above — this is the one genuinely required-header source in this batch (not optional etiquette, an enforced 403 block).
- Example confirmed live: `GET https://crates.io/api/v1/crates?q=serde&per_page=3` (with UA) → `name: "serde"`, `max_version: "1.0.229"`, `downloads: 1301752025`.

## 4. RubyGems.org API

- Host to allowlist: `rubygems.org`
- Endpoint: `GET /api/v1/search.json?query={text}` — genuine free-text search.
- Auth: **none required**, fully public. No User-Agent enforcement observed (unlike crates.io) — still good etiquette to send one.
- Response format: JSON **array directly** (not wrapped in an object) — confirmed live: `[{...}, {...}]`. Per entry: `name` (stable id/slug), `info` (description text), `downloads` (total), `version` (latest), `authors` (string, often comma-joined for multiple), `licenses` (array), `gem_uri` (direct .gem download URL), `project_uri` (human page URL — note: response confirmed a `project_uri` field, not always present in older docs; fall back to constructing `https://rubygems.org/gems/{name}` if absent).
- Canonical URL: `project_uri` if present, else `https://rubygems.org/gems/{name}`.
- Rate limit: no documented hard numeric cap for reasonable use; no key/registration needed.
- Example confirmed live: `GET https://rubygems.org/api/v1/search.json?query=rails` → `name: "rails"`, `version: "8.1.3.1"`, `authors: "David Heinemeier Hansson"`, `licenses: ["MIT"]`.

## 5. Maven Central Search API

- Host to allowlist: `search.maven.org`
- Endpoint: `GET /solrsearch/select?q={text}&rows={n}&wt=json` — genuine free-text search (Solr-backed).
- Auth: **none required**, fully public.
- Response format: JSON, top-level `response.numFound` + `response.docs[]`. Per doc (confirmed live): `id` (stable, format `"{groupId}:{artifactId}"`, e.g. `"com.google.guava:guava"`), `g` (groupId), `a` (artifactId), `latestVersion`, `versionCount`, `timestamp` (Unix epoch ms, last-indexed time), `p` (packaging type, e.g. `bundle`/`jar`). No description/summary field in the search response (Maven Central doesn't index artifact descriptions in this endpoint) — title should be constructed as `"{g}:{a}"`.
- Canonical URL: `https://search.maven.org/artifact/{g}/{a}` (or `https://central.sonatype.com/artifact/{g}/{a}` — Sonatype's newer UI; either is a valid stable pattern, `search.maven.org` is the longer-established one).
- Rate limit: no documented hard numeric cap for reasonable use; no key/registration needed.
- Example confirmed live: `GET https://search.maven.org/solrsearch/select?q=guava&rows=2&wt=json` → `numFound: 386`, top doc `id: "com.google.guava:guava"`, `latestVersion: "33.4.8-jre"`.

## Summary

All 5 are genuinely public. **crates.io is the only one with an enforced auth-adjacent requirement**: no API key, but a missing `User-Agent` header gets a hard HTTP 403 (confirmed live, not just documented) — this must be a required, always-sent header in the adapter, not optional etiquette like the other four. PyPI and npm are per-package `getById`-shaped lookups, not search (no free-text search endpoint exists at these hosts); crates.io, RubyGems, and Maven Central are genuine free-text search. RubyGems' response is a bare JSON array, not an object-wrapped list — a shape difference from the other four that the adapter must handle explicitly. No uncertainty flags beyond the RubyGems `project_uri` fallback noted above.
