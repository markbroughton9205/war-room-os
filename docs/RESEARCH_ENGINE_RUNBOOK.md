# Research Engine — Runbook

## Checking what's configured

`GET /api/research/providers` (Commander session required) returns every one
of the 29 registered providers with `configStatus` and `implemented`. This
is env-presence only — it does not make a network call.

## Running an explicit health check

`GET /api/research/providers/[provider]/health` (Commander session
required) makes one real, cached (30s TTL) request to the provider. For
providers without an adapter yet, this returns `state: 'not_implemented'`
rather than a fake success.

## Running a search

```
POST /api/research/search
{ "text": "climate risk assessment", "intent": "climate_environment", "maxResults": 10 }
```
`intent` and `providers` are both optional; `providers` (an explicit array of
provider ids) overrides intent-based routing. `maxResults` is capped at 50
server-side regardless of what's requested.

## Enabling a new provider (Commander side)

1. Set the required env var(s) for that provider in Vercel (see
   `RESEARCH_PROVIDER_MATRIX.md` for exact names — this repo's Commander
   controls forbid Claude Code from doing this step).
2. Redeploy (env var changes require a redeploy to take effect).
3. Confirm via `GET /api/research/providers` that `configStatus` flips to
   `configured` (if an adapter already exists) or stays `pending` (if it
   doesn't yet — see the matrix).

## Adding a new provider adapter (engineering side)

1. Add/confirm its descriptor in `lib/research-engine/config/providerEnv.ts`
   (`implemented: true` once done).
2. Add its official host(s) to
   `lib/research-engine/security/hostAllowlist.ts`.
3. Write `lib/research-engine/providers/<name>.ts` implementing
   `ResearchProviderAdapter` (`providers/adapter.ts`). Use
   `safeProviderFetch` for every request — never raw `fetch`. Use
   `providers/shared.ts::makeDocument`/`okResponse`/`errorResponse` to keep
   the response shape consistent (see the cache-hit-shape bug fixed during
   this build: the cache-hit branch must return the same wrapped
   `{ ok, response }` shape as the live-fetch branch, not a flattened one).
4. Register it in `lib/research-engine/providers/registry.ts`.
5. Add it to the relevant intent(s) in
   `lib/research-engine/routing/router.ts::INTENT_PROVIDER_MAP` if it isn't
   already there.
6. Add adapter-specific mocked tests to
   `lib/research-engine/diagnostics/validation.ts` — see `re_42`–`re_99` for
   the current pattern (`withAdapterFetch`/`withEnv` helpers). Each adapter
   needs at minimum one successful-normalization case and one malformed- or
   upstream-error case, and must call the adapter's real exported `run()`,
   not just a shared utility function. Use `__setResearchFetchForTests` (via
   `withAdapterFetch`), never a live network call, and run
   `pnpm run validate:research-engine`.
7. Update `RESEARCH_PROVIDER_MATRIX.md`, including the new adapter's
   `re_NN` check ids in the "Unit tested" column — don't write "Yes" without
   a real adapter-level test backing it (see that doc's definition of what
   "Unit tested: Yes" means).

## Troubleshooting

- **`configStatus: unavailable`** — required env var missing; check exact
  name in the matrix (case-sensitive, no `NEXT_PUBLIC_` prefix).
- **`configStatus: pending`, `implemented: false`** — adapter not yet built;
  this is not an error.
- **Health check `rate_limited` / `authentication_failed`** — the provider
  itself rejected the request; check the key value in the provider's own
  dashboard (never printed here) or wait out the rate limit. The engine's
  own concurrency gate independently opens a 30s cooldown after 3
  consecutive failures per provider — a health check made during that
  cooldown throws before it hits the network.
- **Search returns `partial_success`** — one or more selected providers
  failed; check `summary.providerResponses[].error` for the category
  (`not_configured` / `timeout` / `rate_limited` / `upstream_error` /
  `parse_error` / `blocked_host` / `unknown`). This is expected, correct
  behavior for a multi-provider fan-out, not a bug.

## Deployment validation steps

1. `pnpm exec tsc --noEmit`
2. `pnpm exec eslint`
3. `pnpm run validate:research-engine`
4. `pnpm run build`
5. Manually hit `GET /api/research/providers` as the Commander in a deployed
   environment and confirm the configured-provider list matches what was set
   in Vercel.

## Rollback

The Research Engine is fully additive — no existing route, table, or module
was modified except `.env.example` (names only) and `package.json` (one new
`validate:research-engine` script). To roll back, remove
`lib/research-engine/`, `app/api/research/`, the `.env.example` section, and
the `package.json` script line. Nothing else in the app depends on it yet
(Council integration is not wired in this build phase).
