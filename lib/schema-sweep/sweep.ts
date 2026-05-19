import 'server-only'

import { EXPECTED_TABLES } from '@/schema/war-room-schema-manifest'
import {
  buildSnapshot,
  buildTableDiagnostics,
  compareManifestToLive,
  deriveSweepStatus,
  probeMigrations,
  toApiResponse,
  unavailableDiff,
} from './compare'
import { introspectLiveSchema, probeTableColumns } from './introspect'
import { createRepairPacket, createSchemaIssue } from './repairPacket'
import { sanitizeSchemaError } from './sanitize'
import type { SchemaSweepApiResponse, SchemaSweepSnapshot, SchemaTableDiagnostic } from './types'
import {
  CONNECTED_SCHEMA_SURFACES,
  EXPECTED_MIGRATIONS,
  SCHEMA_SWEEP_GUARDRAILS,
  SCHEMA_VALIDATION_CHECKLIST,
} from '@/schema/war-room-schema-manifest'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

async function buildTableProbes(): Promise<SchemaTableDiagnostic[]> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) return []

  return Promise.all(EXPECTED_TABLES.map(async expected => {
    const probe = await probeTableColumns(
      supabase.client,
      expected.name,
      expected.columns.map(column => column.name),
    )

    if (!probe.exists) {
      return {
        table: expected.name,
        feature: expected.feature,
        label: expected.label,
        migrationFile: expected.migrationFile,
        status: 'missing' as const,
        checkedColumns: expected.columns.map(column => column.name),
        missingColumns: expected.columns.map(column => column.name),
        missingIndexes: expected.indexes,
        missingConstraints: expected.constraints,
        rlsStatus: 'missing' as const,
        policyStatus: 'missing' as const,
        permission: probe.permissionFailed ? 'failed' as const : 'unknown' as const,
        staleSchemaCache: probe.staleSchemaCache,
        detail: 'Table not visible through PostgREST probe.',
      }
    }

    return {
      table: expected.name,
      feature: expected.feature,
      label: expected.label,
      migrationFile: expected.migrationFile,
      status: probe.missingColumns.length ? 'degraded' as const : 'ready' as const,
      checkedColumns: expected.columns.map(column => column.name),
      missingColumns: probe.missingColumns,
      missingIndexes: [],
      missingConstraints: [],
      rlsStatus: 'unknown' as const,
      policyStatus: 'unknown' as const,
      permission: probe.permissionFailed ? 'failed' as const : 'ok' as const,
      staleSchemaCache: probe.staleSchemaCache,
      detail: probe.missingColumns.length
        ? 'One or more expected columns were not visible through PostgREST.'
        : 'Table and expected columns are visible to server-only Supabase probe.',
    }
  }))
}

function unavailableSnapshot(configError: string, generatedAt: string): SchemaSweepSnapshot {
  const issues = EXPECTED_TABLES.map(table => createSchemaIssue({
    kind: 'introspection_unavailable',
    table,
    title: `${table.name} could not be probed`,
    missingObject: `${table.name} schema probe`,
    impact: `War Room cannot verify ${table.label} until the server-only Supabase client is configured.`,
    severity: 'info',
    safeSqlMigration: `-- Supabase introspection unavailable for ${table.name}.\n-- Configure server-only Supabase credentials, then run Schema Sweep again.`,
  }))
  const repairPacket = createRepairPacket(issues, generatedAt)
  return {
    generatedAt,
    persistenceHealth: 'unavailable',
    persistenceNote: sanitizeSchemaError(configError),
    summary: {
      expectedTables: EXPECTED_TABLES.length,
      readyTables: 0,
      missingTables: 0,
      missingColumns: 0,
      missingIndexes: 0,
      missingConstraints: 0,
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
      missingConstraints: [],
      rlsStatus: 'unknown',
      policyStatus: 'unknown',
      permission: 'unknown',
      staleSchemaCache: false,
      detail: 'Supabase server-only client is unavailable.',
    })),
    issues,
    migrations: {
      status: 'unknown',
      appliedMigrations: [],
      expectedMigrations: EXPECTED_MIGRATIONS.map(migration => migration.file),
      missingMigrations: [],
      orphanedMigrations: [],
      detail: 'Migration drift cannot be checked without Supabase access.',
      heuristic: true,
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

  const columnsByTable = new Map(
    EXPECTED_TABLES.map(table => [table.name, table.columns.map(column => column.name)]),
  )
  const [catalog, tableProbes, migrations] = await Promise.all([
    introspectLiveSchema(supabase.client, EXPECTED_TABLES.map(table => table.name), columnsByTable),
    buildTableProbes(),
    probeMigrations(supabase.client),
  ])

  const diff = compareManifestToLive(catalog, tableProbes)
  const tables = buildTableDiagnostics(catalog, tableProbes)
  const missingTables = tables.filter(table => table.status === 'missing').length
  const missingColumns = tables.reduce((sum, table) => sum + table.missingColumns.length, 0)
  const permissionFailures = tables.filter(table => table.permission === 'failed').length

  const snapshot = buildSnapshot({
    generatedAt,
    persistenceHealth: missingTables || missingColumns || permissionFailures ? 'degraded' : 'ready',
    persistenceNote: missingTables || missingColumns
      ? 'Supabase is reachable, but expected schema objects are missing or not visible.'
      : catalog.note,
    tables,
    migrations,
    diff,
  })

  return snapshot
}

export async function runSchemaSweepApi(): Promise<SchemaSweepApiResponse> {
  const generatedAt = new Date().toISOString()
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    const snapshot = unavailableSnapshot(supabase.configError, generatedAt)
    const diff = unavailableDiff()
    const status = deriveSweepStatus({
      configError: supabase.configError,
      missingTables: [],
      missingColumns: [],
      missingIndexes: [],
      missingConstraints: [],
      migrationStatus: 'unknown',
      missingMigrations: [],
      schemaDrift: false,
    })
    return toApiResponse(snapshot, diff, status)
  }

  const columnsByTable = new Map(
    EXPECTED_TABLES.map(table => [table.name, table.columns.map(column => column.name)]),
  )
  const [catalog, tableProbes, migrations] = await Promise.all([
    introspectLiveSchema(supabase.client, EXPECTED_TABLES.map(table => table.name), columnsByTable),
    buildTableProbes(),
    probeMigrations(supabase.client),
  ])

  const diff = compareManifestToLive(catalog, tableProbes)
  const tables = buildTableDiagnostics(catalog, tableProbes)
  const missingTables = tables.filter(table => table.status === 'missing').length
  const missingColumns = tables.reduce((sum, table) => sum + table.missingColumns.length, 0)
  const permissionFailures = tables.filter(table => table.permission === 'failed').length

  const snapshot = buildSnapshot({
    generatedAt,
    persistenceHealth: missingTables || missingColumns || permissionFailures ? 'degraded' : 'ready',
    persistenceNote: missingTables || missingColumns
      ? 'Supabase is reachable, but expected schema objects are missing or not visible.'
      : catalog.note,
    tables,
    migrations,
    diff,
  })

  const status = deriveSweepStatus({
    missingTables: diff.missingTables,
    missingColumns: diff.missingColumns,
    missingIndexes: diff.missingIndexes,
    missingConstraints: diff.missingConstraints,
    migrationStatus: migrations.status,
    missingMigrations: migrations.missingMigrations,
    schemaDrift: diff.schemaDrift,
  })

  return toApiResponse(snapshot, diff, status)
}
