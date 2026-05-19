export { runSchemaSweep, runSchemaSweepApi } from './sweep'
export { createRepairPacket } from './repairPacket'
export { sanitizeSchemaError, sanitizePersistenceNote } from './sanitize'
export { EXPECTED_MIGRATIONS, EXPECTED_TABLES, CONNECTED_SCHEMA_SURFACES, SCHEMA_SWEEP_GUARDRAILS, SCHEMA_VALIDATION_CHECKLIST } from './expectedSchema'
export type {
  ExpectedMigration,
  ExpectedTable,
  SchemaFeatureId,
  SchemaIssueKind,
  SchemaIssueSeverity,
  SchemaRepairPacket,
  SchemaSweepApiResponse,
  SchemaSweepDiff,
  SchemaSweepIssue,
  SchemaSweepSnapshot,
  SchemaSweepStatus,
  SchemaTableDiagnostic,
} from './types'
