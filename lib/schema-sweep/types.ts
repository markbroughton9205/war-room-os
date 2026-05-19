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

export type SchemaFeatureId =
  | 'baby_ai'
  | 'signals'
  | 'revenue'
  | 'outcomes'
  | 'growth_calendar'
  | 'commander'
  | 'runtime'
  | 'council_repair'
  | 'memory'
  | 'files_evidence'
  | 'approvals'

export type ExpectedColumn = {
  name: string
  type?: string
  nullable?: boolean
}

export type ExpectedTable = {
  name: string
  feature: SchemaFeatureId
  label: string
  migrationFile: string
  columns: ExpectedColumn[]
  indexes: string[]
  rlsRequired: boolean
  serviceRolePolicy: string | null
  exactRepairSql?: string
}

export type ExpectedMigration = {
  file: string
  feature: SchemaFeatureId
  label: string
}

export type SchemaTableDiagnostic = {
  table: string
  feature: SchemaFeatureId
  label: string
  migrationFile: string
  status: 'ready' | 'missing' | 'degraded' | 'unknown'
  checkedColumns: string[]
  missingColumns: string[]
  missingIndexes: string[]
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
