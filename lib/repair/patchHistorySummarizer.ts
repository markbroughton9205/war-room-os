import { REPAIR_LEDGER_ENTRIES, type RepairLedgerEntry, type RepairLedgerStatus } from '@/lib/repair/repairLedger'

export type PatchHistorySummary = {
  generatedAt: string
  totalEntries: number
  entriesByStatus: Record<RepairLedgerStatus, number>
  filesChanged: string[]
  sqlMigrationsReferenced: string[]
  commitHashes: string[]
  unresolvedWarnings: string[]
  rollbackCheckpoints: string[]
  futureRisks: string[]
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

function emptyStatusCounts(): Record<RepairLedgerStatus, number> {
  return {
    resolved: 0,
    unresolved: 0,
    monitor: 0,
    deprecated: 0,
  }
}

export function summarizePatchHistory(
  entries: RepairLedgerEntry[] = REPAIR_LEDGER_ENTRIES,
  generatedAt = new Date().toISOString(),
): PatchHistorySummary {
  const entriesByStatus = emptyStatusCounts()
  for (const entry of entries) entriesByStatus[entry.status] += 1

  return {
    generatedAt,
    totalEntries: entries.length,
    entriesByStatus,
    filesChanged: uniqueSorted(entries.flatMap(entry => entry.filesChanged)),
    sqlMigrationsReferenced: uniqueSorted(entries.flatMap(entry => entry.filesChanged).filter(file => file.startsWith('supabase/') && file.endsWith('.sql'))),
    commitHashes: uniqueSorted(entries.map(entry => entry.patchOrCommitHash ?? '').filter(Boolean)),
    unresolvedWarnings: uniqueSorted(entries.flatMap(entry => entry.remainingWarnings)),
    rollbackCheckpoints: uniqueSorted(entries.map(entry => entry.rollbackNotes)),
    futureRisks: uniqueSorted(entries.map(entry => entry.futureRisk)),
  }
}

export function formatPatchHistoryMarkdown(summary: PatchHistorySummary): string {
  const lines = [
    `Generated: ${summary.generatedAt}`,
    `Total repair entries: ${summary.totalEntries}`,
    `Status counts: resolved=${summary.entriesByStatus.resolved}, unresolved=${summary.entriesByStatus.unresolved}, monitor=${summary.entriesByStatus.monitor}, deprecated=${summary.entriesByStatus.deprecated}`,
    '',
    'SQL migrations referenced:',
    ...summary.sqlMigrationsReferenced.map(file => `- ${file}`),
    '',
    'Unresolved warnings:',
    ...(summary.unresolvedWarnings.length ? summary.unresolvedWarnings.map(warning => `- ${warning}`) : ['- None recorded.']),
    '',
    'Future risks:',
    ...(summary.futureRisks.length ? summary.futureRisks.map(risk => `- ${risk}`) : ['- None recorded.']),
  ]
  return lines.join('\n')
}
