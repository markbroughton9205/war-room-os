import 'server-only'

import { EXPECTED_MIGRATIONS, EXPECTED_TABLES } from '@/schema/war-room-schema-manifest'
import type { LiveSchemaCatalog } from './introspect'
import type {
  SchemaMigrationDiagnostic,
  SchemaSweepApiResponse,
  SchemaSweepDiff,
  SchemaSweepSnapshot,
  SchemaSweepStatus,
  SchemaTableDiagnostic,
} from './types'
import { formatOperatorNextStepsMarkdown } from '@/lib/operator/nextStepsReport'
import { buildSchemaRepairOperatorNextSteps } from '@/lib/operator/repairPacketNextSteps'

import { createRepairPacket, createSchemaIssue, issuesForTable } from './repairPacket'
import {
  CONNECTED_SCHEMA_SURFACES,
  SCHEMA_SWEEP_GUARDRAILS,
  SCHEMA_VALIDATION_CHECKLIST,
} from '@/schema/war-room-schema-manifest'
import { sanitizePersistenceNote } from './sanitize'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

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

export async function probeMigrations(client: WarRoomSupabase): Promise<SchemaMigrationDiagnostic> {
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
      detail: 'Migration catalog is not exposed to this server route (heuristic comparison unavailable).',
      heuristic: true,
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
      detail: 'Migration catalog was reachable but did not expose recognizable migration names.',
      heuristic: true,
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
      ? 'Migration catalog differs from War Room expected migration files (heuristic name match).'
      : 'Migration catalog matches expected migration file names (heuristic).',
    heuristic: true,
  }
}

export function compareManifestToLive(
  catalog: LiveSchemaCatalog,
  tableProbes: SchemaTableDiagnostic[],
): SchemaSweepDiff {
  const missingTables: string[] = []
  const missingColumns: SchemaSweepApiResponse['missingColumns'] = []
  const missingIndexes: SchemaSweepApiResponse['missingIndexes'] = []
  const missingConstraints: SchemaSweepApiResponse['missingConstraints'] = []
  const catalogCanVerifyIndexes = catalog.mode === 'catalog_rpc'
  const catalogCanVerifyConstraints = catalog.mode === 'catalog_rpc'

  for (const expected of EXPECTED_TABLES) {
    const tableExists = catalog.tables.has(expected.name)
    const probe = tableProbes.find(row => row.table === expected.name)
    const tableMissing = !tableExists || probe?.status === 'missing'

    if (tableMissing) {
      missingTables.push(expected.name)
      for (const column of expected.columns) {
        missingColumns.push({ table: expected.name, column: column.name })
      }
      for (const index of expected.indexes) {
        missingIndexes.push({ table: expected.name, index })
      }
      for (const constraint of expected.constraints) {
        missingConstraints.push({ table: expected.name, constraint })
      }
      continue
    }

    const liveColumns = catalog.columns.get(expected.name) ?? new Set<string>()
    for (const column of expected.columns) {
      const missingInCatalog = liveColumns.size > 0 && !liveColumns.has(column.name)
      const missingInProbe = probe?.missingColumns.includes(column.name) ?? false
      if (missingInCatalog || missingInProbe) {
        missingColumns.push({ table: expected.name, column: column.name })
      }
    }

    if (catalogCanVerifyIndexes) {
      for (const index of expected.indexes) {
        if (!catalog.indexes.has(index)) {
          missingIndexes.push({ table: expected.name, index })
        }
      }
    } else if (probe?.missingIndexes.length) {
      for (const index of probe.missingIndexes) {
        missingIndexes.push({ table: expected.name, index })
      }
    }

    if (catalogCanVerifyConstraints) {
      for (const constraint of expected.constraints) {
        if (!catalog.constraints.has(constraint)) {
          missingConstraints.push({ table: expected.name, constraint })
        }
      }
    }
  }

  const schemaDrift =
    missingColumns.length > 0
    || missingIndexes.length > 0
    || missingConstraints.length > 0
    || tableProbes.some(table => table.staleSchemaCache)

  return {
    missingTables,
    missingColumns,
    missingIndexes,
    missingConstraints,
    schemaDrift,
    introspectionMode: catalog.mode,
    introspectionNote: catalog.note,
  }
}

export function deriveSweepStatus(input: {
  configError?: string
  missingTables: string[]
  missingColumns: SchemaSweepApiResponse['missingColumns']
  missingIndexes: SchemaSweepApiResponse['missingIndexes']
  missingConstraints: SchemaSweepApiResponse['missingConstraints']
  migrationStatus: SchemaMigrationDiagnostic['status']
  missingMigrations: string[]
  schemaDrift: boolean
}): SchemaSweepStatus {
  if (input.configError) return 'error'
  if (input.missingTables.length > 0 || input.missingMigrations.length > 0) return 'incomplete'
  if (
    input.schemaDrift
    || input.missingColumns.length > 0
    || input.missingIndexes.length > 0
    || input.missingConstraints.length > 0
    || input.migrationStatus === 'drift'
  ) {
    return 'drift_detected'
  }
  return 'healthy'
}

export function recommendedNextAction(status: SchemaSweepStatus, diff: SchemaSweepDiff): string {
  if (status === 'error') {
    return 'Configure server-only Supabase credentials, then rerun Schema Sweep from Engineering View.'
  }
  if (status === 'incomplete') {
    return 'Apply missing repository migration files in Supabase, reload PostgREST schema cache, then generate a repair packet for manual review.'
  }
  if (status === 'drift_detected') {
    return 'Open Engineering View → Schema Sweep repair packet, review additive SQL in Supabase SQL editor, and rerun sweep validation.'
  }
  if (diff.introspectionMode !== 'catalog_rpc') {
    return 'Schema looks healthy for probed tables/columns. Optionally apply war_room_phase31_schema_introspect.sql for full index and constraint catalog checks.'
  }
  return 'No schema repair required. Continue routine migration discipline when shipping new War Room phases.'
}

export function buildTableDiagnostics(
  catalog: LiveSchemaCatalog,
  tableProbes: SchemaTableDiagnostic[],
): SchemaTableDiagnostic[] {
  return EXPECTED_TABLES.map(expected => {
    const probe = tableProbes.find(row => row.table === expected.name)
    const exists = catalog.tables.has(expected.name)
    const liveColumns = catalog.columns.get(expected.name)
    const missingFromCatalog = expected.columns
      .map(column => column.name)
      .filter(name => liveColumns && !liveColumns.has(name))
    const missingColumns = [...new Set([...(probe?.missingColumns ?? []), ...missingFromCatalog])]

    if (!exists) {
      return {
        table: expected.name,
        feature: expected.feature,
        label: expected.label,
        migrationFile: expected.migrationFile,
        status: 'missing',
        checkedColumns: expected.columns.map(column => column.name),
        missingColumns: expected.columns.map(column => column.name),
        missingIndexes: expected.indexes,
        missingConstraints: expected.constraints,
        rlsStatus: 'missing',
        policyStatus: 'missing',
        permission: probe?.permission ?? 'unknown',
        staleSchemaCache: probe?.staleSchemaCache ?? false,
        detail: 'Table not visible in live schema catalog or PostgREST probe.',
      }
    }

    const missingIndexes =
      catalog.mode === 'catalog_rpc'
        ? expected.indexes.filter(index => !catalog.indexes.has(index))
        : (probe?.missingIndexes ?? [])

    return {
      table: expected.name,
      feature: expected.feature,
      label: expected.label,
      migrationFile: expected.migrationFile,
      status: missingColumns.length || missingIndexes.length ? 'degraded' : 'ready',
      checkedColumns: expected.columns.map(column => column.name),
      missingColumns,
      missingIndexes,
      missingConstraints:
        catalog.mode === 'catalog_rpc'
          ? expected.constraints.filter(constraint => !catalog.constraints.has(constraint))
          : [],
      rlsStatus: probe?.rlsStatus ?? 'unknown',
      policyStatus: probe?.policyStatus ?? 'unknown',
      permission: probe?.permission ?? 'ok',
      staleSchemaCache: probe?.staleSchemaCache ?? false,
      detail: missingColumns.length || missingIndexes.length
        ? 'Manifest objects are missing or not visible through live introspection.'
        : 'Table matches manifest for probed/catalog-checked objects.',
    }
  })
}

export function toApiResponse(
  snapshot: SchemaSweepSnapshot,
  diff: SchemaSweepDiff,
  status: SchemaSweepStatus,
): SchemaSweepApiResponse {
  const operatorReport = buildSchemaRepairOperatorNextSteps({ status, issues: snapshot.issues })
  const operatorMarkdown = formatOperatorNextStepsMarkdown(operatorReport)
  const actionLine = recommendedNextAction(status, diff)

  return {
    status,
    missingTables: diff.missingTables,
    missingColumns: diff.missingColumns,
    missingIndexes: diff.missingIndexes,
    missingConstraints: diff.missingConstraints,
    checkedAt: snapshot.generatedAt,
    recommendedNextAction: `${actionLine}\n\n${operatorMarkdown}`,
    operatorNextSteps: operatorReport,
    operatorNextStepsMarkdown: operatorMarkdown,
    introspectionMode: diff.introspectionMode,
    introspectionNote: diff.introspectionNote,
    migrations: snapshot.migrations,
    repairPacketAvailable: snapshot.summary.repairPacketAvailable,
    snapshot,
  }
}

export function buildSnapshot(input: {
  generatedAt: string
  persistenceHealth: SchemaSweepSnapshot['persistenceHealth']
  persistenceNote: string
  tables: SchemaTableDiagnostic[]
  migrations: SchemaMigrationDiagnostic
  diff: SchemaSweepDiff
}): SchemaSweepSnapshot {
  const issues = input.tables.flatMap(diagnostic => {
    const table = EXPECTED_TABLES.find(expected => expected.name === diagnostic.table)
    return table ? issuesForTable(table, diagnostic) : []
  })

  for (const file of input.migrations.missingMigrations) {
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

  if (input.diff.schemaDrift) {
    issues.push(createSchemaIssue({
      kind: 'app_schema_drift',
      table: EXPECTED_TABLES[0],
      title: 'Schema drift detected against War Room manifest',
      missingObject: 'manifest vs live catalog',
      impact: 'One or more columns, indexes, or constraints differ from the canonical manifest.',
      severity: 'medium',
    }))
  }

  const missingTables = input.tables.filter(table => table.status === 'missing').map(table => table.table)
  const sweepStatus = deriveSweepStatus({
    missingTables,
    missingColumns: input.diff.missingColumns,
    missingIndexes: input.diff.missingIndexes,
    missingConstraints: input.diff.missingConstraints,
    migrationStatus: input.migrations.status,
    missingMigrations: input.migrations.missingMigrations,
    schemaDrift: input.diff.schemaDrift,
  })
  const repairPacket = createRepairPacket(issues, input.generatedAt, sweepStatus)
  const missingTableCount = missingTables.length
  const missingColumns = input.tables.reduce((sum, table) => sum + table.missingColumns.length, 0)
  const permissionFailures = input.tables.filter(table => table.permission === 'failed').length
  const staleSchemaCacheSymptoms = input.tables.filter(table => table.staleSchemaCache).length
  const missingPolicies = input.tables.filter(table => table.rlsStatus === 'missing' || table.policyStatus === 'missing').length

  return {
    generatedAt: input.generatedAt,
    persistenceHealth: input.persistenceHealth,
    persistenceNote: sanitizePersistenceNote(input.persistenceNote),
    summary: {
      expectedTables: EXPECTED_TABLES.length,
      readyTables: input.tables.filter(table => table.status === 'ready').length,
      missingTables: missingTableCount,
      missingColumns,
      missingIndexes: input.diff.missingIndexes.length,
      missingConstraints: input.diff.missingConstraints.length,
      permissionFailures,
      staleSchemaCacheSymptoms,
      missingPolicies,
      migrationStatus: input.migrations.status,
      repairPacketAvailable: issues.length > 0,
    },
    tables: input.tables,
    issues,
    migrations: input.migrations,
    affectedFeatures: [...new Set(issues.map(issue => issue.affectedFeature))],
    repairPacket,
    connectedSurfaces: CONNECTED_SCHEMA_SURFACES,
    validationChecklist: SCHEMA_VALIDATION_CHECKLIST,
    guardrails: SCHEMA_SWEEP_GUARDRAILS,
  }
}

export function unavailableDiff(): SchemaSweepDiff {
  return {
    missingTables: [],
    missingColumns: [],
    missingIndexes: [],
    missingConstraints: [],
    schemaDrift: false,
    introspectionMode: 'postgrest_probe',
    introspectionNote: 'Supabase unavailable.',
  }
}
