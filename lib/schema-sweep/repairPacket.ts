import { appendOperatorNextStepsToPrompt, toOperatorNextStepsPayload } from '@/lib/operator/nextStepsReport'
import { buildSchemaRepairOperatorNextSteps } from '@/lib/operator/repairPacketNextSteps'

import { SCHEMA_SWEEP_GUARDRAILS, SCHEMA_VALIDATION_CHECKLIST } from './expectedSchema'
import type { ExpectedTable, SchemaIssueKind, SchemaRepairPacket, SchemaSweepIssue, SchemaTableDiagnostic } from './types'

function objectLabel(kind: SchemaIssueKind, table: string, name?: string) {
  if (kind === 'missing_column') return `${table}.${name ?? 'column'}`
  if (kind === 'missing_index') return `${table}.${name ?? 'index'}`
  if (kind === 'missing_policy') return `${table}.${name ?? 'service_role policy'}`
  if (kind === 'missing_rls') return `${table}.RLS`
  return table
}

function fallbackSql(table: ExpectedTable) {
  return [
    `-- Advisory-only repair for ${table.name}.`,
    `-- Preferred safe path: apply and review ${table.migrationFile} from this repository.`,
    '-- This packet intentionally avoids creating a partial table shape for features that need their full local migration.',
    "select pg_notify('pgrst', 'reload schema');",
  ].join('\n')
}

function validationQuery(table: string, columns: string[]) {
  const columnList = columns.map(column => `'${column}'`).join(', ')
  return [
    `select to_regclass('public.${table}') as table_exists;`,
    'select column_name',
    'from information_schema.columns',
    `where table_schema = 'public' and table_name = '${table}' and column_name in (${columnList})`,
    'order by column_name;',
  ].join('\n')
}

export function createSchemaIssue(input: {
  kind: SchemaIssueKind
  table: ExpectedTable
  title: string
  missingObject?: string
  impact: string
  severity: SchemaSweepIssue['severity']
  safeSqlMigration?: string
}): SchemaSweepIssue {
  const missingObject = input.missingObject ?? objectLabel(input.kind, input.table.name)
  const safeSqlMigration = input.safeSqlMigration ?? input.table.exactRepairSql ?? fallbackSql(input.table)
  const cursorReadyPrompt = [
    `War Room schema repair needed: ${input.title}`,
    `Affected feature: ${input.table.feature}`,
    `Missing object: ${missingObject}`,
    `Migration file: ${input.table.migrationFile}`,
    `Impact: ${input.impact}`,
    '',
    'Implement this as a reviewed Supabase migration or SQL editor patch. Do not execute production schema changes from the browser. Preserve service-role-only access and RLS guardrails.',
    '',
    'SQL packet:',
    safeSqlMigration,
    '',
    'Validation query:',
    validationQuery(input.table.name, input.table.columns.map(column => column.name)),
  ].join('\n')

  return {
    id: `${input.kind}:${missingObject}`,
    kind: input.kind,
    title: input.title,
    affectedFeature: input.table.feature,
    missingObject,
    impact: input.impact,
    severity: input.severity,
    table: input.table.name,
    migrationFile: input.table.migrationFile,
    safeSqlMigration,
    rollbackNotes: 'Rollback is manual only. For additive table repairs, drop only newly-created objects after confirming no production data was written. Never run destructive rollback SQL from War Room UI.',
    validationQuery: validationQuery(input.table.name, input.table.columns.map(column => column.name)),
    cursorReadyPrompt,
    supabaseSqlEditorInstructions: [
      'Open Supabase SQL editor with an operator who can review production schema changes.',
      'Paste the SQL packet or apply the referenced repository migration.',
      'Confirm all statements are additive unless intentionally performing manual rollback.',
      'Run the validation query and refresh War Room Schema Sweep.',
    ],
  }
}

export function issuesForTable(table: ExpectedTable, diagnostic: SchemaTableDiagnostic): SchemaSweepIssue[] {
  const issues: SchemaSweepIssue[] = []
  if (diagnostic.staleSchemaCache) {
    issues.push(createSchemaIssue({
      kind: 'schema_cache_stale',
      table,
      title: `${table.name} may be missing from PostgREST schema cache`,
      missingObject: `${table.name} schema cache entry`,
      impact: `${table.label} can exist in Postgres while API routes still fail until PostgREST reloads the schema cache.`,
      severity: 'medium',
      safeSqlMigration: "select pg_notify('pgrst', 'reload schema');",
    }))
  }
  if (diagnostic.status === 'missing') {
    issues.push(createSchemaIssue({
      kind: 'missing_table',
      table,
      title: `${table.name} is missing`,
      impact: `${table.label} cannot persist or read durable War Room state.`,
      severity: table.feature === 'baby_ai' || table.feature === 'signals' ? 'critical' : 'high',
    }))
    return issues
  }
  if (diagnostic.permission === 'failed') {
    issues.push(createSchemaIssue({
      kind: 'permission_failure',
      table,
      title: `${table.name} denies server-side schema probe`,
      impact: `${table.label} may be present but unavailable to server-only War Room APIs.`,
      severity: 'high',
    }))
  }
  for (const column of diagnostic.missingColumns) {
    issues.push(createSchemaIssue({
      kind: 'missing_column',
      table,
      title: `${table.name}.${column} is missing`,
      missingObject: objectLabel('missing_column', table.name, column),
      impact: `${table.label} app code expects this column and may fail with schema drift or stale cache symptoms.`,
      severity: 'high',
    }))
  }
  for (const index of diagnostic.missingIndexes) {
    issues.push(createSchemaIssue({
      kind: 'missing_index',
      table,
      title: `${index} index needs verification`,
      missingObject: objectLabel('missing_index', table.name, index),
      impact: `${table.label} may work but degrade or drift from the expected migration contract.`,
      severity: 'medium',
    }))
  }
  for (const constraint of diagnostic.missingConstraints) {
    issues.push(createSchemaIssue({
      kind: 'app_schema_drift',
      table,
      title: `${constraint} constraint needs verification`,
      missingObject: objectLabel('app_schema_drift', table.name, constraint),
      impact: `${table.label} may be missing a check or integrity constraint from the canonical migration.`,
      severity: 'medium',
    }))
  }
  if (diagnostic.rlsStatus === 'missing') {
    issues.push(createSchemaIssue({
      kind: 'missing_rls',
      table,
      title: `${table.name} RLS is missing`,
      missingObject: objectLabel('missing_rls', table.name),
      impact: `${table.label} would not match War Room's service-role-only persistence model.`,
      severity: 'critical',
    }))
  }
  if (diagnostic.policyStatus === 'missing') {
    issues.push(createSchemaIssue({
      kind: 'missing_policy',
      table,
      title: `${table.name} service-role policy is missing`,
      missingObject: objectLabel('missing_policy', table.name, table.serviceRolePolicy ?? undefined),
      impact: `${table.label} may deny server-only API reads/writes or tempt unsafe public policies.`,
      severity: 'high',
    }))
  }
  return issues
}

export function createRepairPacket(
  issues: SchemaSweepIssue[],
  createdAt = new Date().toISOString(),
  status: 'healthy' | 'drift_detected' | 'incomplete' | 'error' = issues.length ? 'drift_detected' : 'healthy',
): SchemaRepairPacket {
  const uniqueSql = [...new Map(issues.map(issue => [issue.safeSqlMigration, issue.safeSqlMigration])).values()]
  const combinedSql = uniqueSql.length
    ? uniqueSql.join('\n\n-- ---- next repair ----\n\n')
    : '-- No schema repair SQL required by the latest sweep.'
  const combinedCursorPrompt = issues.length
    ? issues.map(issue => issue.cursorReadyPrompt).join('\n\n---\n\n')
    : 'Latest schema sweep found no repair packet issues.'

  const operatorPayload = toOperatorNextStepsPayload(buildSchemaRepairOperatorNextSteps({ status, issues }))
  const cursorWithOperator = appendOperatorNextStepsToPrompt(combinedCursorPrompt, operatorPayload.report)

  return {
    id: `schema-repair-${Date.parse(createdAt) || Date.now()}`,
    createdAt,
    advisoryOnly: true,
    canExecute: false,
    title: issues.length ? `Schema repair packet (${issues.length} issue${issues.length === 1 ? '' : 's'})` : 'Schema repair packet not required',
    summary: issues.length
      ? 'Manual Supabase/Cursor repair packet prepared. War Room did not execute database changes.'
      : 'Schema sweep did not find actionable missing table or column issues.',
    issues,
    combinedSql,
    combinedCursorPrompt: cursorWithOperator,
    validationChecklist: SCHEMA_VALIDATION_CHECKLIST,
    guardrails: SCHEMA_SWEEP_GUARDRAILS,
    operatorNextSteps: operatorPayload.report,
    operatorNextStepsMarkdown: operatorPayload.markdown,
  }
}
