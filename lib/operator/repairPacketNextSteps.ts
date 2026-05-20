import { COUNCIL_STABILITY_ENV } from '@/lib/council/stabilityMode'
import type { RepairClassification } from '@/lib/council-repair/model'
import type { SchemaSweepIssue, SchemaSweepStatus } from '@/lib/schema-sweep/types'
import type { SweepFinding } from '@/lib/war-room-sweep/types'

import {
  buildNextStepsFromContext,
  emptyOperatorNextStepsReport,
  type OperatorNextStepsReport,
  toOperatorNextStepsPayload,
} from './nextStepsReport'

export function buildCouncilRepairOperatorNextSteps(input: {
  classification: RepairClassification
  affectedPanelRoute: string
  validationCommands: string[]
}): OperatorNextStepsReport {
  const routes = [
    input.affectedPanelRoute,
    'GET /api/council/repair-packet',
    'Engineering Lane → Repair Packets',
  ]

  const baseRollback = [
    'Revert the approved manual Cursor commit with `git revert <hash>` on a branch before merging.',
    'Do not run destructive SQL or delete production rows from War Room UI.',
  ]

  switch (input.classification) {
    case 'supabase_schema_issue':
      return buildNextStepsFromContext({
        envVarNames: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
        verificationRoutes: ['GET /api/schema/sweep', 'GET /api/schema/repair-packet', ...routes],
        expectedOutputs: [
          'Schema Sweep status moves toward healthy after reviewed migrations.',
          'Repair packet lists additive SQL only; War Room does not execute DB changes.',
        ],
        uiChanges: ['Engineering View → Schema Sweep shows fewer missing tables/columns.'],
        rollback: baseRollback,
      })
    case 'provider_runtime_issue':
      return buildNextStepsFromContext({
        envNotes: [
          'Set provider API key env names in .env.local (see Configuration Sweep for the exact names).',
          'Redeploy Vercel preview/production env if keys changed remotely.',
        ],
        restartDevServer: true,
        verificationRoutes: ['GET /api/configuration/sweep', 'GET /api/runtime/canonical-status', ...routes],
        expectedOutputs: ['Provider row shows configured; council/provider probes return 200 with non-empty diagnostics.'],
        uiChanges: ['Live Environment / Configuration panels show provider as configured instead of missing.'],
        rollback: baseRollback,
      })
    case 'security_truth_boundary_issue':
      return buildNextStepsFromContext({
        verificationRoutes: routes,
        expectedOutputs: ['No secret values appear in client bundles, repair packets, or operator-facing panels.'],
        uiChanges: ['Sensitive values remain server-only; operator views show names only.'],
        rollback: baseRollback,
      })
    default:
      return buildNextStepsFromContext({
        restartDevServer: true,
        verificationRoutes: routes,
        expectedOutputs: [
          ...input.validationCommands.map(cmd => `Run locally: ${cmd}`),
          'After manual Cursor fix, refresh the affected War Room panel and confirm the original symptom is gone.',
        ],
        uiChanges: [`${input.affectedPanelRoute} reflects the repaired behavior without fake completion banners.`],
        rollback: baseRollback,
      })
  }
}

export function buildSchemaRepairOperatorNextSteps(input: {
  status: SchemaSweepStatus
  issues: SchemaSweepIssue[]
}): OperatorNextStepsReport {
  if (!input.issues.length && input.status === 'healthy') {
    return emptyOperatorNextStepsReport()
  }

  const migrationFiles = [...new Set(input.issues.map(issue => issue.migrationFile).filter(Boolean) as string[])]

  return buildNextStepsFromContext({
    envVarNames: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    migrationFiles: migrationFiles.length ? migrationFiles : undefined,
    sqlNotes: migrationFiles.length
      ? undefined
      : ['Run validation queries from the repair packet in Supabase SQL editor after any additive change.'],
    restartNotes: [
      'After SQL apply, run `select pg_notify(\'pgrst\', \'reload schema\');` when PostgREST cache symptoms appear.',
    ],
    verificationRoutes: [
      'GET /api/schema/sweep',
      'GET /api/schema/repair-packet',
      'Engineering View → Schema Sweep',
    ],
    expectedOutputs: [
      'Schema Sweep status is healthy or drift_detected with zero missing critical tables.',
      'Validation queries in the repair packet return expected rows.',
    ],
    uiChanges: [
      'Schema Sweep panel shows green/healthy summary and repair packet button only when drift remains.',
    ],
    rollback: [
      'Rollback is manual: drop only objects you added in this session after confirming no production data was written.',
      'Never run destructive rollback SQL from War Room UI.',
    ],
  })
}

export function buildSweepFindingOperatorNextSteps(finding: SweepFinding): OperatorNextStepsReport {
  return buildNextStepsFromContext({
    verificationRoutes: [
      finding.affectedPanel,
      'GET /api/war-room/sweep',
      'War Room Evolution → OS Sweep',
    ],
    expectedOutputs: [
      `Finding "${finding.title}" no longer appears as ${finding.severity} after the fix.`,
      'pnpm exec tsc --noEmit · pnpm exec eslint · pnpm run build pass locally.',
    ],
    uiChanges: [`${finding.affectedFeature} panel matches the suggested action without advisory-only blockers.`],
    rollback: [
      'Revert the fix commit on a branch; re-run GET /api/war-room/sweep to confirm the finding returns if expected.',
    ],
  })
}

export function buildStabilityModeOperatorNextSteps(enabled: boolean): OperatorNextStepsReport {
  return buildNextStepsFromContext({
    envNotes: [
      `Set ${COUNCIL_STABILITY_ENV}=${enabled ? 'true' : 'false'} in .env.local (and matching Vercel env if deployed).`,
    ],
    restartDevServer: true,
    featureFlags: [
      {
        name: COUNCIL_STABILITY_ENV,
        enabled,
        note: enabled
          ? 'Disables repair packets, synthesis compression, RSS federation context, and other heavy council layers.'
          : 'Restores full council layers — enable only after layer-by-layer stability tests pass.',
      },
    ],
    verificationRoutes: [
      'GET /api/council/stability-mode',
      'POST /api/chat (smoke)',
      'GET /api/council/repair-packet (expect 503 when stability on)',
    ],
    expectedOutputs: [
      enabled
        ? 'Repair packet API returns 503 with repair_packet_disabled while stability mode is active.'
        : 'Council chat and repair packet endpoints respond normally.',
    ],
    uiChanges: [
      enabled
        ? 'Repair packet buttons may be disabled; council responses use minimal stable path.'
        : 'Full Engineering / Council repair flows available again.',
    ],
    rollback: [
      `Set ${COUNCIL_STABILITY_ENV}=false, restart dev server, and re-run the layer re-enable checklist in lib/council/stabilityMode.ts.`,
    ],
  })
}

export function buildRepairIntelligenceOperatorNextSteps(input: {
  title: string
  affectedPanel: string
  affectedRoute?: string
  validationCommands: string[]
  envVarNames?: string[]
  suggestedSqlMigration?: string
  repairPacketAvailable: boolean
}): OperatorNextStepsReport {
  if (input.title.includes('No blocker detected')) {
    return emptyOperatorNextStepsReport()
  }

  const routes = [
    input.affectedRoute ?? '/api/evolution/repair-intelligence',
    input.affectedPanel,
    ...(input.repairPacketAvailable ? ['GET /api/schema/repair-packet', 'GET /api/council/repair-packet'] : []),
  ]

  return buildNextStepsFromContext({
    envVarNames: input.envVarNames,
    sqlNotes: input.suggestedSqlMigration
      ? ['Apply suggested SQL from repair intelligence via reviewed Supabase migration path only.']
      : undefined,
    restartDevServer: Boolean(input.envVarNames?.length),
    verificationRoutes: [...new Set([...routes, ...input.validationCommands.filter(cmd => cmd.startsWith('GET '))])],
    expectedOutputs: [
      `Next required action "${input.title}" clears from repair intelligence after the fix.`,
      ...input.validationCommands.filter(cmd => !cmd.startsWith('GET ')).map(cmd => `Local check: ${cmd}`),
    ],
    uiChanges: [`${input.affectedPanel} no longer lists this item as a blocker.`],
    rollback: ['Revert env or migration changes on a branch; refresh repair intelligence snapshot.'],
  })
}

export { toOperatorNextStepsPayload }
