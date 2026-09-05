# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

War Room is a solo-built Next.js 16 (App Router) + React 19 + TypeScript agentic orchestration platform. It coordinates multiple LLM providers (Claude, GPT, Grok, Gemini, Kimi/Moonshot — see `lib/council*`) as a "Council," backed by Supabase, with self-audit/self-repair tooling and autonomous income-generation features under human ("Commander") approval gates. See `docs/war-room-constitution.md` for the full operating philosophy.

## Commands

- `pnpm install` — install deps
- `pnpm dev` / `pnpm run dev` — start dev server (Next.js, port 3000; expect a Windows firewall prompt on first run)
- `pnpm run build` — production build
- `pnpm start` / `pnpm run start` — run production build
- `pnpm exec tsc --noEmit` — typecheck (no dedicated `typecheck` script exists)
- `pnpm lint` / `pnpm exec eslint` — lint
- No test suite exists in this repo (no Jest/Vitest, no `*.test.ts` files, no `test` script). Verification relies on `tsc --noEmit` + `eslint`. Don't introduce a test framework unless asked.
- No formatter (Prettier/Biome) is configured. Match surrounding code style; don't reformat files incidentally.

## Structure

- `app/api/**` — ~140+ API route directories (agents, council, operator, income, payments, revenue-engine, etc.)
- `lib/**` — mirrors most `app/api` subsystems (council, operator, orchestration, income, payments, security, etc.). Note: both `lib/war-room` and `lib/warRoom` exist — don't conflate them, check which one a given feature actually uses.
- `supabase/*.sql` — manually numbered phase migrations (`war_room_phase32_...sql`), **not** a Supabase CLI migrations folder. Apply by running the SQL directly (via Supabase CLI or the SQL editor), then run `select pg_notify('pgrst', 'reload schema');` to reload PostgREST.
- Path alias: `@/*` → repo root (e.g. `@/lib/operator`, `@/components/...`).
- `docs/deploy-war-room-netlify-vercel.md` — deployment target/workflow reference.

## Secrets and env vars

- `SUPABASE_SERVICE_ROLE_KEY` must stay server-only — never prefix it (or any secret) with `NEXT_PUBLIC_`. It's used server-side by `/api/tools/memory`.
- `SUPABASE_FILES_BUCKET` must exactly match the actual Supabase Storage bucket name, including spaces/capitalization (currently `War Room Files`).
- `.env.example` is out of date vs. actual usage — real `.env.local` also includes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, `FIRECRAWL_API_KEY`, `TAVILY_API_KEY`, and more.
- Payment operations must route through secure provider integrations, require explicit War Room approval, and must never store raw routing/account numbers.

## Approval-gated workflow

This repo runs under an explicit approval doctrine (ported from `.cursor/rules/war-room-trusted-development.mdc`).

**Treat as trusted, no extra approval needed** (batch when practical): creating/modifying files in this repo; `pnpm install`; `pnpm run build`; `pnpm exec tsc --noEmit`; `pnpm exec eslint`; `pnpm dev`/`pnpm run dev`/`pnpm start`/`pnpm run start`; `git status`; `git add` (this repo only); `git commit` / `git push` (only once the user has explicitly asked for that specific action); generating Supabase migration files under `supabase/`.

**Always ask first**: deleting large directories or recursive destructive cleanup; creating/modifying/deleting files outside this repo; changing OS/shell/package-manager/network/firewall/browser/credential-store/system config; reading, printing, copying, or exposing credentials/tokens/keys/`.env` contents/secrets; changing network or security config; running unreviewed/unknown scripts; `rm -rf` or broad recursive deletes; force git operations (hard reset, force push, rebase) unless the user explicitly requested that exact action; broadening `~/.cursor/permissions.json` or other global tool permissions for this project.

## Completion reporting

Every implementation-completion summary in this repo (ported from `.cursor/rules/operator-next-steps-reporting.mdc`) must end with:

```
## NEXT STEPS FOR OPERATOR
```

covering, in plain numbered language:

1. Required environment changes
2. Required SQL/migrations
3. Restart requirements
4. Verification URLs/routes
5. Expected successful output
6. Feature flags enabled/disabled
7. What should visibly change in UI
8. Safe rollback instruction if needed

If nothing is needed, state "No operator action required." Never expose secret values — env var names/placeholders only. When generating repair packets or API payloads, prefer `formatOperatorNextStepsMarkdown` / `buildNextStepsFromContext` from `@/lib/operator` over hand-rolling this section.

## Adding scoped instructions

For module-specific conventions, add focused files under `.claude/rules/` (e.g. `council.md`, `operator.md`) — they load automatically alongside this file and can be scoped to paths via `paths` frontmatter.
