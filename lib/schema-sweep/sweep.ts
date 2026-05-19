import 'server-only'

import { EXPECTED_MIGRATIONS, EXPECTED_TABLES, CONNECTED_SCHEMA_SURFACES, SCHEMA_SWEEP_GUARDRAILS, SCHEMA_VALIDATION_CHECKLIST } from './expectedSchema'
import { createRepairPacket, createSchemaIssue, issuesForTable } from './repairPacket'
import type { ExpectedTable, SchemaMigrationDiagnostic, SchemaSweepSnapshot, SchemaTableDiagnostic } from './types'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'

type SupabaseErrorLike = {
  message?: string
  code?: string
  details?: string
  hint?: string
}

function errorText(error: SupabaseErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint, error?.code].filter(Boolean).join(' ')
}

function isMissingTable(error: SupabaseErrorLike | null | undefined, table: string) {
  const text = errorText(error)
  return new RegExp(`could not find .*${table}|relation .*${table}.*does not exist|undefined table|PGRST205`, 'i').test(text)
}

function isPermissionFailure(error: SupabaseErrorLike | null | undefined) {
  return /permission denied|42501|row-level security|violates row-level security|not authorized|JWT/i.test(errorText(error))
}

function isStaleSchemaCache(error: SupabaseErrorLike | null | undefined) {
  return /schema cache|PGRST204|PGRST205/i.test(errorText(error))
}

async function probeColumn(client: WarRoomSupabase, table: string, column: string) {
  const { error } = await client.from(table).select(column, { head: true }).limit(1)
  return !error
}

async function probeTable(client: WarRoomSupabase, table: ExpectedTable): Promise<SchemaTableDiagnostic> {
  const tableProbe = await client.from(table.name).select('id', { head: true, count: 'exact' }).limit(1)
  if (tableProbe.error) {
    const missing = isMissingTable(tableProbe.error, table.name)
    const permissionFailure = isPermissionFailure(tableProbe.error)
    return {
      table: table.name,
      feature: table.feature,
      label: table.label,
      migrationFile: table.migrationFile,
      status: missing ? 'missing' : 'degraded',
      checkedColumns: ['id'],
      missingColumns: missing ? table.columns.map(column => column.name) : [],
      missingIndexes: missing ? table.indexes : [],
      rlsStatus: missing ? 'missing' : 'unknown',
      policyStatus: missing ? 'missing' : 'unknown',
      permission: permissionFailure ? 'failed' : 'unknown',
      staleSchemaCache: isStaleSchemaCache(tableProbe.error),
      detail: errorText(tableProbe.error) || 'Table probe failed.',
    }
  }

  const columnNames = table.columns.map(column => column.name)
  const columnProbe = await client.from(table.name).select(columnNames.join(','), { head: true }).limit(1)
  const missingColumns = columnProbe.error
    ? (await Promise.all(columnNames.map(async column => [column, await probeColumn(client, table.name, column)] as const)))
      .filter(([, ok]) => !ok)
      .map(([column]) => column)
    : []

  return {
    table: table.name,
    feature: table.feature,
    label: table.label,
    migrationFile: table.migrationFile,
    status: missingColumns.length ? 'degraded' : 'ready',
    checkedColumns: columnNames,
    missingColumns,
    missingIndexes: [],
    rlsStatus: 'unknown',
    policyStatus: 'unknown',
    permission: 'ok',
    staleSchemaCache: isStaleSchemaCache(columnProbe.error),
    detail: missingColumns.length
      ? errorText(columnProbe.error) || 'One or more expected columns were not visible through PostgREST.'
      : 'Table and expected columns are visible to server-only Supabase probe. RLS, policies, and indexes require catalog introspection or manual validation.',
  }
}

function migrationName(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  for (const key of ['name', 'migration_name', 'version']) {
    const candidate = row[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (typeof candidate === 'number') return String(candidate)
  }
  return null
}

function expectedMigrationKey(file: string) {
  return file.split('/').pop()?.replace(/\.sql$/i, '') ?? file
}

async function probeMigrations(client: WarRoomSupabase): Promise<SchemaMigrationDiagnostic> {
  const expected = EXPECTED_MIGRATIONS.map(migration => migration.file)
  const result = await client
    .schema('supabase_migrations')
    .from('schema_migrations')
    .select('*')
    .limit(250)

  if (result.error) {
    return {
      status: 'unknown',
      appliedMigrations: [],
      expectedMigrations: expected,
      missingMigrations: [],
      orphanedMigrations: [],
      detail: `Supabase migration catalog is not exposed to this server route: ${errorText(result.error) || 'catalog unavailable'}`,
    }
  }

  const applied = (result.data ?? []).map(migrationName).filter((name): name is string => Boolean(name))
  if (!applied.length) {
    return {
      status: 'unknown',
      appliedMigrations: [],
      expectedMigrations: expected,
      missingMigrations: [],
      orphanedMigrations: [],
      detail: 'Migration catalog was reachable but did not expose recognizable migration names for comparison.',
    }
  }

  const missing = expected.filter(file => {
    const key = expectedMigrationKey(file)
    return !applied.some(name => name.includes(file) || name.includes(key))
  })
  const knownKeys = EXPECTED_MIGRATIONS.map(migration => expectedMigrationKey(migration.file))
  const orphaned = applied.filter(name => !knownKeys.some(key => name.includes(key)))

  return {
    status: missing.length || orphaned.length ? 'drift' : 'ready',
    appliedMigrations: applied,
    expectedMigrations: expected,
    missingMigrations: missing,
    orphanedMigrations: orphaned,
    detail: missing.length || orphaned.length
      ? 'Migration catalog is reachable and differs from War Room expected migration files.'
      : 'Migration catalog is reachable and matches expected migration file names.',
  }
}

function unavailableSnapshot(configError: string, generatedAt: string): SchemaSweepSnapshot {
  const issues = EXPECTED_TABLES.map(table => createSchemaIssue({
    kind: 'introspection_unavailable',
    table,
    title: `${table.name} could not be probed`,
    missingObject: `${table.name} schema probe`,
    impact: `War Room cannot verify ${table.label} until the server-only Supabase client is configured.`,
    severity: 'info',
    safeSqlMigration: `-- Supabase introspection unavailable for ${table.name}.\n-- Configure server-only Supabase credentials, then run Schema Sweep again.\n-- Do not apply SQL until a live sweep confirms the missing object.`,
  }))
  const repairPacket = createRepairPacket(issues, generatedAt)
  return {
    generatedAt,
    persistenceHealth: 'unavailable',
    persistenceNote: `Supabase unavailable: ${configError}`,
    summary: {
      expectedTables: EXPECTED_TABLES.length,
      readyTables: 0,
      missingTables: 0,
      missingColumns: 0,
      permissionFailures: 0,
      staleSchemaCacheSymptoms: 0,
      missingPolicies: 0,
      migrationStatus: 'unknown',
      repairPacketAvailable: true,
    },
    tables: EXPECTED_TABLES.map(table => ({
      table: table.name,
      feature: table.feature,
      label: table.label,
      migrationFile: table.migrationFile,
      status: 'unknown',
      checkedColumns: [],
      missingColumns: [],
      missingIndexes: [],
      rlsStatus: 'unknown',
      policyStatus: 'unknown',
      permission: 'unknown',
      staleSchemaCache: false,
      detail: 'Supabase server-only client is unavailable; no repaired state is claimed.',
    })),
    issues,
    migrations: {
      status: 'unknown',
      appliedMigrations: [],
      expectedMigrations: EXPECTED_MIGRATIONS.map(migration => migration.file),
      missingMigrations: [],
      orphanedMigrations: [],
      detail: 'Migration drift cannot be checked without Supabase access.',
    },
    affectedFeatures: [...new Set(issues.map(issue => issue.affectedFeature))],
    repairPacket,
    connectedSurfaces: CONNECTED_SCHEMA_SURFACES,
    validationChecklist: SCHEMA_VALIDATION_CHECKLIST,
    guardrails: SCHEMA_SWEEP_GUARDRAILS,
  }
}

export async function runSchemaSweep(): Promise<SchemaSweepSnapshot> {
  const generatedAt = new Date().toISOString()
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) return unavailableSnapshot(supabase.configError, generatedAt)

  const [tables, migrations] = await Promise.all([
    Promise.all(EXPECTED_TABLES.map(table => probeTable(supabase.client, table))),
    probeMigrations(supabase.client),
  ])

  const issues = tables.flatMap(diagnostic => {
    const table = EXPECTED_TABLES.find(expected => expected.name === diagnostic.table)
    return table ? issuesForTable(table, diagnostic) : []
  })

  for (const file of migrations.missingMigrations) {
    const expected = EXPECTED_MIGRATIONS.find(migration => migration.file === file)
    const representative = EXPECTED_TABLES.find(table => table.feature === expected?.feature) ?? EXPECTED_TABLES[0]
    issues.push(createSchemaIssue({
      kind: 'migration_missing',
      table: representative,
      title: `${file} is not recorded as applied`,
      missingObject: file,
      impact: `${expected?.label ?? 'Expected War Room schema'} may be absent or out of sync with app code.`,
      severity: 'medium',
      safeSqlMigration: `-- Review and apply ${file} through your normal Supabase migration path.\n-- War Room does not execute migration files from the browser.`,
    }))
  }

  const repairPacket = createRepairPacket(issues, generatedAt)
  const missingTables = tables.filter(table => table.status === 'missing').length
  const missingColumns = tables.reduce((sum, table) => sum + table.missingColumns.length, 0)
  const permissionFailures = tables.filter(table => table.permission === 'failed').length
  const staleSchemaCacheSymptoms = tables.filter(table => table.staleSchemaCache).length
  const missingPolicies = tables.filter(table => table.rlsStatus === 'missing' || table.policyStatus === 'missing').length

  return {
    generatedAt,
    persistenceHealth: missingTables || missingColumns || permissionFailures ? 'degraded' : 'ready',
    persistenceNote: missingTables || missingColumns
      ? 'Supabase is reachable, but expected schema objects are missing or not visible through PostgREST.'
      : 'Supabase is reachable. Table and column probes are read-only; RLS, policy, and index checks may still require SQL catalog validation.',
    summary: {
      expectedTables: EXPECTED_TABLES.length,
      readyTables: tables.filter(table => table.status === 'ready').length,
      missingTables,
      missingColumns,
      permissionFailures,
      staleSchemaCacheSymptoms,
      missingPolicies,
      migrationStatus: migrations.status,
      repairPacketAvailable: issues.length > 0,
    },
    tables,
    issues,
    migrations,
    affectedFeatures: [...new Set(issues.map(issue => issue.affectedFeature))],
    repairPacket,
    connectedSurfaces: CONNECTED_SCHEMA_SURFACES,
    validationChecklist: SCHEMA_VALIDATION_CHECKLIST,
    guardrails: SCHEMA_SWEEP_GUARDRAILS,
  }
}
