import { REPAIR_LEDGER_ENTRIES, type RepairLedgerEntry } from '@/lib/repair/repairLedger'

export type RepairMemoryCategory =
  | 'docs'
  | 'supabase'
  | 'memory'
  | 'security'
  | 'runtime'
  | 'events'
  | 'repo'
  | 'red_sentinel'
  | 'action_logs'
  | 'audit_logs'
  | 'strategic_memory'
  | 'archived_transcripts'
  | 'configuration_sweep'

export type RepairMemorySource = {
  category: RepairMemoryCategory
  files: string[]
  preserves: string[]
  gaps: string[]
  readiness: 'strong' | 'partial' | 'missing'
}

export type RepairMemoryCoverage = {
  alreadyExisted: boolean
  answer: 'yes_partial' | 'yes' | 'no'
  strongCategories: RepairMemoryCategory[]
  partialCategories: RepairMemoryCategory[]
  missingCategories: RepairMemoryCategory[]
  filesFound: string[]
  gapsFound: string[]
}

export const REPAIR_MEMORY_SOURCES: RepairMemorySource[] = [
  {
    category: 'docs',
    files: ['docs/phases/phase-8.md', 'docs/runtime-roadmap.md', 'docs/war-room-constitution.md'],
    preserves: ['governance doctrine', 'approval gates', 'engineering routing expectations', 'memory refinement priorities'],
    gaps: ['No single repair ledger existed before Phase 8A.7.'],
    readiness: 'partial',
  },
  {
    category: 'supabase',
    files: [
      'supabase/war_room_audit_logs_permissions_fix.sql',
      'supabase/war_room_actions_permissions_fix.sql',
      'supabase/war_room_conversations_permissions_fix.sql',
      'supabase/war_room_phase7b_workflow_queue_rls_patch.sql',
      'supabase/war_room_phase7d_memory_archive_immutable_patch.sql',
      'supabase/war_room_runtime_integrity_logs.sql',
    ],
    preserves: ['SQL repair patches', 'RLS/service_role fixes', 'runtime integrity log schema', 'memory archive schema fixes'],
    gaps: ['Applied migration hashes are not stored in-repo; confirm live Supabase migration state externally.'],
    readiness: 'partial',
  },
  {
    category: 'memory',
    files: ['lib/memory/transcriptArchive.ts', 'lib/memory/proposals.ts', 'lib/memory/importance.ts', 'lib/memory/recallCommands.ts'],
    preserves: ['failure summaries', 'provider notes', 'unfinished tasks', 'strategic memory promotion inputs'],
    gaps: ['Memory records are content-addressed by session/context, not yet linked to patch or commit hashes.'],
    readiness: 'partial',
  },
  {
    category: 'security',
    files: ['lib/security/routeIntegrityAudit.ts', 'lib/security/runtimeBoundaryAudit.ts', 'lib/security/sensitiveEnv.ts'],
    preserves: ['deprecated/reserved route classification', 'service_role boundary findings', 'privileged runtime checks'],
    gaps: ['Route audit is heuristic and does not prove external API consumers.'],
    readiness: 'strong',
  },
  {
    category: 'runtime',
    files: ['lib/runtime/runtimeRepairMap.ts', 'lib/runtime/runtimeContinuityServer.ts', 'lib/runtime/diagnosticLog.ts'],
    preserves: ['runtime repair recommendations', 'historical warnings', 'diagnostic events', 'red-team unresolved holds'],
    gaps: ['Runtime diagnostics do not by themselves produce a durable patch ledger.'],
    readiness: 'partial',
  },
  {
    category: 'events',
    files: ['lib/events/types.ts'],
    preserves: ['diff preview events', 'rollback checkpoint events', 'Red Sentinel scan lifecycle events', 'memory proposal events'],
    gaps: ['Event types exist, but event persistence coverage depends on the active logging path.'],
    readiness: 'partial',
  },
  {
    category: 'repo',
    files: ['lib/repo/types.ts', 'lib/repo/diff.ts', 'lib/repo/rollback.ts', 'lib/repo/checkpoint-store.ts', 'lib/war-room/repoAudit.ts'],
    preserves: ['commit hash snapshots', 'diff preview support', 'rollback checkpoints', 'changed-file metadata'],
    gaps: ['Checkpoints are metadata snapshots only and never auto-apply rollback.'],
    readiness: 'strong',
  },
  {
    category: 'red_sentinel',
    files: ['lib/red-sentinel/runScan.ts', 'components/war-room/council/SentinelStatusPanel.tsx'],
    preserves: ['scan findings', 'route/orphan heuristics', 'runtime boundary findings', 'duplicate snippet findings'],
    gaps: ['Scan outputs are reviewed through runtime/UI paths; no static historical rollup existed before this ledger.'],
    readiness: 'partial',
  },
  {
    category: 'action_logs',
    files: ['lib/war-room/actionLogs.ts', 'supabase/war_room_actions_permissions_fix.sql'],
    preserves: ['action-level messages', 'levels', 'metadata for repair execution breadcrumbs'],
    gaps: ['Action logs do not enforce a patch schema with root cause and rollback notes.'],
    readiness: 'partial',
  },
  {
    category: 'audit_logs',
    files: ['lib/war-room/auditLog.ts', 'supabase/war_room_audit_logs_permissions_fix.sql'],
    preserves: ['system/user audit categories', 'repo/sentinel/memory/runtime categories', 'metadata payloads'],
    gaps: ['Audit metadata is flexible and may be inconsistent without repair ledger conventions.'],
    readiness: 'partial',
  },
  {
    category: 'strategic_memory',
    files: ['supabase/war_room_phase7d1_strategic_memory.sql', 'lib/memory/transcriptArchive.ts'],
    preserves: ['promoted durable lessons', 'decisions', 'long-lived memory summaries'],
    gaps: ['Strategic memories are not specialized for repair postmortems yet.'],
    readiness: 'partial',
  },
  {
    category: 'archived_transcripts',
    files: ['supabase/war_room_phase7d_memory_archive.sql', 'lib/memory/transcriptArchive.ts'],
    preserves: ['raw transcript preservation', 'failures/errors', 'provider performance notes', 'unfinished tasks'],
    gaps: ['Archived transcripts preserve evidence but require summarization to become patch readiness memory.'],
    readiness: 'partial',
  },
  {
    category: 'configuration_sweep',
    files: [
      'lib/configuration/configurationRegistry.ts',
      'lib/configuration/configurationHealth.ts',
      'lib/configuration/providerConfigStatus.ts',
      'components/war-room/configuration/ConfigurationSweepPanel.tsx',
    ],
    preserves: ['provider readiness', 'missing dependencies', 'critical blockers', 'optional enhancements'],
    gaps: ['Configuration sweep results are current-state readiness records, not historical repairs.'],
    readiness: 'partial',
  },
]

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

export function listRepairMemorySources(): RepairMemorySource[] {
  return REPAIR_MEMORY_SOURCES.map(source => ({
    ...source,
    files: [...source.files],
    preserves: [...source.preserves],
    gaps: [...source.gaps],
  }))
}

export function summarizeRepairMemoryCoverage(
  sources: RepairMemorySource[] = REPAIR_MEMORY_SOURCES,
  ledger: RepairLedgerEntry[] = REPAIR_LEDGER_ENTRIES,
): RepairMemoryCoverage {
  const strongCategories = sources.filter(source => source.readiness === 'strong').map(source => source.category)
  const partialCategories = sources.filter(source => source.readiness === 'partial').map(source => source.category)
  const missingCategories = sources.filter(source => source.readiness === 'missing').map(source => source.category)
  const filesFound = uniqueSorted([...sources.flatMap(source => source.files), ...ledger.flatMap(entry => entry.filesChanged)])
  const gapsFound = uniqueSorted(sources.flatMap(source => source.gaps))

  return {
    alreadyExisted: sources.some(source => source.readiness === 'strong' || source.readiness === 'partial'),
    answer: missingCategories.length === 0 && partialCategories.length <= 2 ? 'yes' : 'yes_partial',
    strongCategories,
    partialCategories,
    missingCategories,
    filesFound,
    gapsFound,
  }
}
