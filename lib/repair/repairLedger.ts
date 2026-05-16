export type RepairLedgerStatus = 'resolved' | 'unresolved' | 'monitor' | 'deprecated'

export type RepairValidationResult = {
  status: 'passed' | 'partial' | 'pending' | 'failed' | 'not_applicable'
  detail: string
}

export type RepairLedgerEntry = {
  id: string
  issue: string
  rootCause: string
  filesChanged: string[]
  patchOrCommitHash: string | null
  validationResult: RepairValidationResult
  remainingWarnings: string[]
  rollbackNotes: string
  futureRisk: string
  status: RepairLedgerStatus
  recordedAt: string
  sourceRefs: string[]
}

export type RepairLedgerSummary = {
  total: number
  byStatus: Record<RepairLedgerStatus, number>
  unresolvedIds: string[]
  monitorIds: string[]
  deprecatedIds: string[]
}

export const REPAIR_LEDGER_ENTRIES: RepairLedgerEntry[] = [
  {
    id: 'phase7b-workflow-queue-rls',
    issue: 'Economic workflow queue access could fail under Supabase RLS.',
    rootCause: 'The service-role queue table needed explicit grants and an all-access service_role policy after the operational queue schema landed.',
    filesChanged: [
      'supabase/war_room_phase7b_workflow_queue_rls_patch.sql',
      'supabase/war_room_phase7b_workflow_queue_conflict_patch.sql',
      'supabase/war_room_phase7b_queue_schema_patch.sql',
    ],
    patchOrCommitHash: null,
    validationResult: {
      status: 'partial',
      detail: 'Patch files are present and idempotent; applied database state must be confirmed in Supabase.',
    },
    remainingWarnings: ['Confirm migration application order in production before Phase 9 queue expansion.'],
    rollbackNotes: 'RLS policy changes are SQL-level; rollback requires a reviewed Supabase migration, not automatic code rollback.',
    futureRisk: 'New queue tables can repeat the same grant/policy drift if service_role policies are not added with schema changes.',
    status: 'monitor',
    recordedAt: '2026-05-16',
    sourceRefs: ['supabase/war_room_phase7b_workflow_queue_rls_patch.sql'],
  },
  {
    id: 'phase7d-memory-archive-recall-index',
    issue: 'Memory archive recall index migration could fail on generated tsvector expressions.',
    rootCause: 'Postgres rejects non-immutable generated expressions for recall_index; the fix moved recall_index to a trigger-maintained column.',
    filesChanged: [
      'supabase/war_room_phase7d_memory_archive.sql',
      'supabase/war_room_phase7d_memory_archive_immutable_patch.sql',
      'lib/memory/transcriptArchive.ts',
    ],
    patchOrCommitHash: null,
    validationResult: {
      status: 'partial',
      detail: 'Immutable patch is present and preserves archived transcript/session summary tables; live DB trigger presence still needs environment verification.',
    },
    remainingWarnings: ['Verify war_room_session_summaries_set_recall_index exists after production migration.'],
    rollbackNotes: 'Do not drop archived transcript data. Roll forward with a trigger/index patch if recall search regresses.',
    futureRisk: 'Future generated-column search optimizations may fail unless Postgres immutability is checked first.',
    status: 'monitor',
    recordedAt: '2026-05-16',
    sourceRefs: ['supabase/war_room_phase7d_memory_archive_immutable_patch.sql', 'lib/memory/transcriptArchive.ts'],
  },
  {
    id: 'audit-log-service-role-permissions',
    issue: 'War Room audit log writes could receive Supabase/PostgREST 403 responses.',
    rootCause: 'public.war_room_audit_logs needed service_role grants and an explicit RLS policy.',
    filesChanged: ['supabase/war_room_audit_logs_permissions_fix.sql', 'lib/war-room/auditLog.ts'],
    patchOrCommitHash: null,
    validationResult: {
      status: 'partial',
      detail: 'Repair SQL and audit helper exist; production confirmation depends on Supabase migration state.',
    },
    remainingWarnings: ['Check action/audit inserts after any permissions reset or table recreation.'],
    rollbackNotes: 'Keep existing audit rows. If reverted, preserve logs and re-apply least-privilege service_role access.',
    futureRisk: 'New audit tables can silently lose service_role write access if RLS is enabled without matching policy.',
    status: 'monitor',
    recordedAt: '2026-05-16',
    sourceRefs: ['supabase/war_room_audit_logs_permissions_fix.sql', 'lib/war-room/auditLog.ts'],
  },
  {
    id: 'runtime-boundary-service-role-guard',
    issue: 'Server-only Supabase service_role usage needs durable boundary checks.',
    rootCause: 'Privileged environment names and service-role clients must stay out of browser/shared surfaces.',
    filesChanged: [
      'lib/security/sensitiveEnv.ts',
      'lib/security/runtimeBoundaryAudit.ts',
      'lib/supabase/admin.ts',
      'lib/red-sentinel/runScan.ts',
    ],
    patchOrCommitHash: null,
    validationResult: {
      status: 'pending',
      detail: 'Runtime boundary audit is wired into Red Sentinel; current scan output should be reviewed before Phase 9.',
    },
    remainingWarnings: ['Run Red Sentinel after provider/runtime changes and inspect serviceRoleBlockedCount.'],
    rollbackNotes: 'Rollback should retain sensitive env redaction and server-only boundary classification.',
    futureRisk: 'Client imports can regress when UI panels reach directly for privileged helpers.',
    status: 'monitor',
    recordedAt: '2026-05-16',
    sourceRefs: ['lib/security/runtimeBoundaryAudit.ts', 'lib/red-sentinel/runScan.ts'],
  },
  {
    id: 'deprecated-singular-conversation-route',
    issue: 'Legacy singular conversation route can look like an orphan or duplicate API surface.',
    rootCause: 'The singular /api/conversation route is retained for compatibility while /api/conversations is canonical.',
    filesChanged: ['lib/security/routeIntegrityAudit.ts'],
    patchOrCommitHash: null,
    validationResult: {
      status: 'not_applicable',
      detail: 'Route lifecycle is classified as deprecated/reserved audit metadata; no runtime repair is applied.',
    },
    remainingWarnings: ['Remove only after compatibility expectations are explicitly retired.'],
    rollbackNotes: 'Route classification is additive; rollback is not normally required.',
    futureRisk: 'Future route sweeps can misclassify intentionally retained routes without lifecycle metadata.',
    status: 'deprecated',
    recordedAt: '2026-05-16',
    sourceRefs: ['lib/security/routeIntegrityAudit.ts'],
  },
]

export function listRepairLedgerEntries(status?: RepairLedgerStatus): RepairLedgerEntry[] {
  return status ? REPAIR_LEDGER_ENTRIES.filter(entry => entry.status === status) : [...REPAIR_LEDGER_ENTRIES]
}

export function summarizeRepairLedger(entries: RepairLedgerEntry[] = REPAIR_LEDGER_ENTRIES): RepairLedgerSummary {
  const byStatus: Record<RepairLedgerStatus, number> = {
    resolved: 0,
    unresolved: 0,
    monitor: 0,
    deprecated: 0,
  }
  for (const entry of entries) byStatus[entry.status] += 1
  return {
    total: entries.length,
    byStatus,
    unresolvedIds: entries.filter(entry => entry.status === 'unresolved').map(entry => entry.id),
    monitorIds: entries.filter(entry => entry.status === 'monitor').map(entry => entry.id),
    deprecatedIds: entries.filter(entry => entry.status === 'deprecated').map(entry => entry.id),
  }
}
