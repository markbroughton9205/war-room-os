# Operator next steps — templates

Copy patterns from `lib/operator/templates.ts`. **Never paste real secret values** into War Room UI or repair packets.

## COUNCIL_STABILITY_MODE

```markdown
## NEXT STEPS FOR OPERATOR

1. Required environment changes
   1. Set COUNCIL_STABILITY_MODE=true in .env.local and matching Vercel project env.
2. Required SQL/migrations
   No operator action required.
3. Restart requirements
   1. Stop the local Next.js dev server, then run `pnpm dev` again so server env and route handlers reload.
4. Verification URLs/routes
   1. GET /api/council/stability-mode
   2. POST /api/chat
   3. GET /api/council/repair-packet (expect 503)
5. Expected successful output
   1. Council chat works with reduced layers; repair packet API returns repair_packet_disabled.
6. Feature flags enabled/disabled
   1. COUNCIL_STABILITY_MODE: enabled — Minimal stable council; repair packets disabled.
7. What should visibly change in UI
   1. Repair packet actions hidden or blocked while stability mode is on.
8. Safe rollback instruction if needed
   1. Set COUNCIL_STABILITY_MODE=false, restart dev server, run layer checklist in lib/council/stabilityMode.ts.
```

## Supabase migrations (phase 26, 28, 30, 32, …)

1. Confirm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (names only in docs).
2. Apply the repository file, e.g. `supabase/war_room_phase28_rss_ingestion.sql`, via Supabase CLI or reviewed SQL editor.
3. Reload PostgREST: `select pg_notify('pgrst', 'reload schema');`
4. Verify: `GET /api/schema/sweep`, Engineering → Schema Sweep.
5. UI: missing table/column counts decrease; status moves toward healthy.

## RSS poll cron

1. Set `WAR_ROOM_RSS_POLL_SECRET` and `NEWS_RSS_FEEDS` in env (values in secret store only).
2. Schedule POST `/api/signals/rss/poll` with header `x-war-room-rss-secret: <secret>`.
3. Verify: `GET /api/signals/rss/status` — last poll timestamp updates.
4. UI: News Intel / signal panels show fresher items.

## Vercel env vars (names only)

Set in Vercel → Environment Variables, then redeploy:

- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `COUNCIL_STABILITY_MODE`

Verify: `GET /api/configuration/sweep` on the deployed URL.

Programmatic examples: `import { OPERATOR_TEMPLATE_EXAMPLES } from '@/lib/operator/templates'`.
