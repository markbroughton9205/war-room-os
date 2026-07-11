# Phase 46P-A — Environment-Aware Action Route Policy

## Context

Independent review found that action-triggering routes had no deployment-environment awareness at all. `assertActionRouteAuthorized` (`lib/security/actionRouteGuard.ts`) accepts either `WAR_ROOM_ACTION_SECRET` or a signed-in Supabase session, with no concept of Preview vs. Production -- so removing the secret from a Preview environment does not stop an authenticated Preview session from reaching `/api/grok/chat`, `/api/payments/deposits`, or `/api/payments/proof`. `/api/council/apple-reminder-live` was worse: it has no call to `assertActionRouteAuthorized` at all, and constructs `SupabaseApprovalAuthority`/`SupabaseSingleUseLedger` as eager call-expression arguments in `route.ts`, before its own internal feature flags are ever checked -- so a missing service-role key in Preview produces a generic 500 instead of a clean block, and the admin client is constructed regardless of whether the route is supposed to be live there.

`NODE_ENV` cannot be used to fix this: it is `"production"` in both Preview and Production builds on Vercel (empirically confirmed this session via a throwaway probe route, since deleted). `VERCEL_ENV` is the correct signal -- empirically confirmed to resolve to `"preview"` in a real Preview deployment and to be fully `undefined` in local dev (bare `next dev`/`pnpm dev`, no Vercel CLI).

## Policy

New module: `lib/security/actionRoutePolicy.ts`.

```ts
export type DeploymentEnvironment = 'production' | 'preview' | 'development' | 'local'

export type ActionRoutePolicy = {
  environment: DeploymentEnvironment
  liveActionsAllowed: boolean
  sessionAuthorizationAllowed: boolean
  actionSecretAuthorizationAllowed: boolean
}
```

`environment` resolves from `process.env.VERCEL_ENV` only -- never from request body, header, or any `NEXT_PUBLIC_*` variable (client-bundled and spoofable). `'production'` and `'preview'` map directly; `'development'` (set by `vercel dev`) and a fully absent value (bare local run) both map to `'local'`/`'development'` and default to zero authority, treated identically.

Production: `liveActionsAllowed`, `sessionAuthorizationAllowed`, `actionSecretAuthorizationAllowed` all `true` -- unchanged behavior, exactly as approved today.

Preview / development / local: all three `false` by default. A distinct override flag, `WAR_ROOM_ALLOW_LOCAL_LIVE_ACTIONS`, restores authority -- but **only** outside Preview. Preview is a shared, externally-reachable deployment; the flag must never be settable in a way that reopens it, even by an env var someone could set on the Preview environment itself. Setting the flag while `VERCEL_ENV=production` is a no-op -- Production already has `liveActionsAllowed: true` unconditionally, independent of the flag.

**Hard invariant:** `sessionAuthorizationAllowed`/`actionSecretAuthorizationAllowed` are never consulted when `liveActionsAllowed` is `false`. The environment check is the cheapest, safest gate and always runs first, exactly as 46O-H established for malformed approval IDs (check before any DB query, not after).

`assertActionRouteAuthorized`'s own secret-or-session logic is not modified. This is a gate prepended at each call site, not a rewrite of shared guard semantics -- Production's existing accept-either behavior is untouched.

## Ordering contract

deployment environment policy &rarr; route availability (existing per-route feature flags, unchanged) &rarr; authentication (`assertActionRouteAuthorized` / middleware session default) &rarr; action authorization (route-specific, e.g. 46N approval consume) &rarr; dependency initialization (Supabase admin clients, provider clients) &rarr; handler execution.

## Route scope (explicit, not inferred from existing guard call sites)

| Route | Change |
|---|---|
| `app/api/grok/chat/route.ts` POST | Prepend `assertLiveActionsAllowed()` before `assertActionRouteAuthorized`. |
| `app/api/payments/deposits/route.ts` POST, PATCH | Same, both handlers. GET is read-only and out of scope. |
| `app/api/payments/proof/route.ts` POST | Same. |
| `app/api/council/apple-reminder-live/route.ts` POST | Prepend `assertLiveActionsAllowed()` as the first statement, before `request.json()` and before the `createLiveAppleApprovalConsumer()`/`createSupabaseSingleUseLedger()`/`createLiveAppleReminderLedgerReceiptVerifier()` call-expression arguments. This ordering fix alone resolves the eager-construction/500 bug -- `handler.ts`'s existing feature flags are untouched. |
| *(future 46P approval-issuance route)* | Must adopt the same first-statement pattern from its initial PR. |

## Production-unchanged matrix

| Route | Secret only | Session only | Neither |
|---|---|---|---|
| grok/chat | works (unchanged) | works (unchanged) | 401 (unchanged) |
| payments/deposits, payments/proof | works (unchanged) | works (unchanged) | 401 (unchanged) |
| apple-reminder-live | n/a (no secret path) | works (unchanged, middleware default + existing flags) | 401 (unchanged, middleware) |

## Gate 16

1. Preview + valid session &rarr; all 4 routes blocked 403.
2. Preview + valid session &rarr; provider/mutation functions never reached (verified structurally: environment check is the first statement, so control flow returns before any subsequent call).
3. Same, payments fallback mutation path.
4. Preview apple-reminder-live &rarr; admin-client factories never constructed (same structural guarantee).
5. Ordering: environment check resolves before those factory calls are reachable at all.
6. Local default (`VERCEL_ENV` unset) behaves identically to Preview across all 4 routes.
7. Full Production-unchanged matrix, all cells.
8. Preview/local + session + no secret &rarr; still blocked (the original bug, proven fixed).
9. Policy unaffected by request body, header, or `NEXT_PUBLIC_*` -- only `process.env.VERCEL_ENV` read.
10. `VERCEL_ENV` entirely absent resolves to `'local'`/zero-authority, not an error, not Production.
11. Override flag set while simulating Preview has zero effect.
12. Override flag set while simulating Production is a no-op -- Production is already `liveActionsAllowed: true` unconditionally regardless of the flag.

## Rollback

Revert the 4 route files and delete `lib/security/actionRoutePolicy.ts`. No schema changes, no new persisted fields -- pure in-memory policy logic.
