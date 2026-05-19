export { runSchemaSweep } from './sweep'
export { createRepairPacket } from './repairPacket'
export { EXPECTED_MIGRATIONS, EXPECTED_TABLES, CONNECTED_SCHEMA_SURFACES, SCHEMA_SWEEP_GUARDRAILS, SCHEMA_VALIDATION_CHECKLIST } from './expectedSchema'
export type {
  ExpectedMigration,
  ExpectedTable,
  SchemaFeatureId,
  SchemaIssueKind,
  SchemaIssueSeverity,
  SchemaRepairPacket,
  SchemaSweepIssue,
  SchemaSweepSnapshot,
  SchemaTableDiagnostic,
} from './types'
