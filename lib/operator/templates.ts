import { formatOperatorNextStepsMarkdown } from './nextStepsReport'
import { buildNextStepsFromContext } from './nextStepsReport'

/** Example templates for docs and agent reference — no secret values. */

export const TEMPLATE_COUNCIL_STABILITY_MODE = formatOperatorNextStepsMarkdown(
  buildNextStepsFromContext({
    envNotes: ['Set COUNCIL_STABILITY_MODE=true in .env.local and matching Vercel project env.'],
    restartDevServer: true,
    featureFlags: [
      { name: 'COUNCIL_STABILITY_MODE', enabled: true, note: 'Minimal stable council; repair packets disabled.' },
    ],
    verificationRoutes: [
      'GET /api/council/stability-mode',
      'POST /api/chat',
      'GET /api/council/repair-packet (expect 503)',
    ],
    expectedOutputs: ['Council chat works with reduced layers; repair packet API returns repair_packet_disabled.'],
    uiChanges: ['Repair packet actions hidden or blocked while stability mode is on.'],
    rollback: ['Set COUNCIL_STABILITY_MODE=false, restart dev server, run layer checklist in lib/council/stabilityMode.ts.'],
  }),
)

export const TEMPLATE_SUPABASE_PHASE_MIGRATION = formatOperatorNextStepsMarkdown(
  buildNextStepsFromContext({
    envVarNames: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    migrationFiles: [
      'supabase/war_room_phase26_example.sql',
      'supabase/war_room_phase28_rss_ingestion.sql',
      'supabase/war_room_phase30_cognitive_bus.sql',
      'supabase/war_room_phase32_example.sql',
    ],
    sqlNotes: ['Prefer applying the exact repository file; do not paste production secrets into SQL editor notes.'],
    restartNotes: ['After apply: `select pg_notify(\'pgrst\', \'reload schema\');` if API still reports stale cache.'],
    verificationRoutes: ['GET /api/schema/sweep', 'GET /api/schema/repair-packet'],
    expectedOutputs: ['Schema Sweep missing table/column counts drop to zero for the affected feature.'],
    uiChanges: ['Engineering → Schema Sweep shows healthy or reduced drift.'],
    rollback: ['Drop only additive objects created in this session; confirm no production rows before drop.'],
  }),
)

export const TEMPLATE_RSS_POLL_CRON = formatOperatorNextStepsMarkdown(
  buildNextStepsFromContext({
    envVarNames: ['WAR_ROOM_RSS_POLL_SECRET', 'NEWS_RSS_FEEDS'],
    envNotes: [
      'Schedule an external cron (Vercel Cron, GitHub Action, or operator scheduler) to POST /api/signals/rss/poll with header x-war-room-rss-secret: <WAR_ROOM_RSS_POLL_SECRET>.',
    ],
    verificationRoutes: ['POST /api/signals/rss/poll', 'GET /api/signals/rss/status'],
    expectedOutputs: ['RSS status shows last poll timestamp; News Intel refreshes without manual browser refresh.'],
    uiChanges: ['Signal / News panels show newer ingested items after cron runs.'],
    rollback: ['Disable cron job; RSS ingestion pauses but existing rows remain.'],
  }),
)

export const TEMPLATE_VERCEL_ENV_NAMES = formatOperatorNextStepsMarkdown(
  buildNextStepsFromContext({
    envNotes: [
      'In Vercel Project → Settings → Environment Variables, set names only (values from your secret store):',
      'OPENAI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY, GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, COUNCIL_STABILITY_MODE.',
      'Redeploy preview/production after changes.',
    ],
    verificationRoutes: ['GET /api/configuration/sweep', 'GET /api/runtime/canonical-status'],
    expectedOutputs: ['Configuration sweep shows providers configured on deployed URL.'],
    uiChanges: ['Deployed War Room matches local configured capabilities.'],
    rollback: ['Remove or unset changed env names in Vercel and redeploy previous deployment.'],
  }),
)

export const OPERATOR_TEMPLATE_EXAMPLES: Record<string, string> = {
  COUNCIL_STABILITY_MODE: TEMPLATE_COUNCIL_STABILITY_MODE,
  SUPABASE_PHASE_MIGRATION: TEMPLATE_SUPABASE_PHASE_MIGRATION,
  RSS_POLL_CRON: TEMPLATE_RSS_POLL_CRON,
  VERCEL_ENV_NAMES: TEMPLATE_VERCEL_ENV_NAMES,
}
