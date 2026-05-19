export type SchemaIssueKind =
  | 'missing_table'
  | 'missing_column'
  | 'missing_index'
  | 'missing_rls'
  | 'missing_policy'
  | 'permission_failure'
  | 'schema_cache_stale'
  | 'migration_missing'
  | 'migration_orphaned'
  | 'app_schema_drift'
  | 'introspection_unavailable'

export type SchemaIssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

import type {
  ExpectedColumn,
  ExpectedMigration,
  ExpectedTable,
  SchemaFeatureId,
} from '@/schema/war-room-schema-manifest'

export type { ExpectedColumn, ExpectedMigration, ExpectedTable, SchemaFeatureId }

export type SchemaTableDiagnostic = {
  table: string
  feature: SchemaFeatureId
  label: string
  migrationFile: string
  status: 'ready' | 'missing' | 'degraded' | 'unknown'
  checkedColumns: string[]
  missingColumns: string[]
  missingIndexes: string[]
  missingConstraints: string[]
  rlsStatus: 'required' | 'verified' | 'missing' | 'unknown'
  policyStatus: 'required' | 'verified' | 'missing' | 'unknown'
  permission: 'ok' | 'failed' | 'unknown'
  staleSchemaCache: boolean
  detail: string
}

export type SchemaMigrationDiagnostic = {
  status: 'unknown' | 'ready' | 'missing' | 'drift'
  appliedMigrations: string[]
  expectedMigrations: string[]
  missingMigrations: string[]
  orphanedMigrations: string[]
  detail: string
  heuristic?: boolean
}

export type SchemaSweepStatus = 'healthy' | 'drift_detected' | 'incomplete' | 'error'

export type SchemaSweepDiff = {
  missingTables: string[]
  missingColumns: Array<{ table: string; column: string }>
  missingIndexes: Array<{ table: string; index: string }>
  missingConstraints: Array<{ table: string; constraint: string }>
  schemaDrift: boolean
  introspectionMode: 'catalog_rpc' | 'information_schema' | 'postgrest_probe'
  introspectionNote: string
}

export type SchemaSweepApiResponse = {
  status: SchemaSweepStatus
  missingTables: string[]
  missingColumns: Array<{ table: string; column: string }>
  missingIndexes: Array<{ table: string; index: string }>
  missingConstraints: Array<{ table: string; constraint: string }>
  checkedAt: string
  recommendedNextAction: string
  introspectionMode: SchemaSweepDiff['introspectionMode']
  introspectionNote: string
  migrations: SchemaMigrationDiagnostic
  repairPacketAvailable: boolean
  snapshot: SchemaSweepSnapshot
}

export type SchemaSweepIssue = {
  id: string
  kind: SchemaIssueKind
  title: string
  affectedFeature: SchemaFeatureId
  missingObject: string
  impact: string
  severity: SchemaIssueSeverity
  table?: string
  migrationFile?: string
  safeSqlMigration: string
  rollbackNotes: string
  validationQuery: string
  cursorReadyPrompt: string
  supabaseSqlEditorInstructions: string[]
}

export type SchemaRepairPacket = {
  id: string
  createdAt: string
  advisoryOnly: true
  canExecute: false
  title: string
  summary: string
  issues: SchemaSweepIssue[]
  combinedSql: string
  combinedCursorPrompt: string
  validationChecklist: string[]
  guardrails: string[]
}

export type SchemaSweepSnapshot = {
  generatedAt: string
  persistenceHealth: 'ready' | 'degraded' | 'unavailable' | 'unknown'
  persistenceNote: string
  summary: {
    expectedTables: number
    readyTables: number
    missingTables: number
    missingColumns: number
    missingIndexes: number
    missingConstraints: number
    permissionFailures: number
    staleSchemaCacheSymptoms: number
    missingPolicies: number
    migrationStatus: SchemaMigrationDiagnostic['status']
    repairPacketAvailable: boolean
  }
  tables: SchemaTableDiagnostic[]
  issues: SchemaSweepIssue[]
  migrations: SchemaMigrationDiagnostic
  affectedFeatures: SchemaFeatureId[]
  repairPacket: SchemaRepairPacket
  connectedSurfaces: string[]
  validationChecklist: string[]
  guardrails: string[]
}
