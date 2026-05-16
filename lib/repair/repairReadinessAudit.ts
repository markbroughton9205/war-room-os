import { summarizePatchHistory, type PatchHistorySummary } from '@/lib/repair/patchHistorySummarizer'
import { summarizeRepairLedger, type RepairLedgerSummary } from '@/lib/repair/repairLedger'
import { summarizeRepairMemoryCoverage, type RepairMemoryCoverage } from '@/lib/repair/repairMemory'
import { buildUnresolvedRepairTracker, type UnresolvedRepairTracker } from '@/lib/repair/unresolvedRepairTracker'

export type RepairReadinessAuditStatus = 'ready_with_monitoring' | 'needs_attention' | 'blocked'

export type RepairReadinessAudit = {
  auditId: 'phase-8a-7-repair-memory-readiness'
  generatedAt: string
  question: 'Does War Room currently preserve enough repair memory to diagnose and fix future failures?'
  answer: 'yes_partial' | 'yes' | 'no'
  status: RepairReadinessAuditStatus
  repairMemoryAlreadyExisted: boolean
  filesFound: string[]
  gapsFound: string[]
  ledger: RepairLedgerSummary
  patchHistory: PatchHistorySummary
  unresolved: UnresolvedRepairTracker
  hardConstraints: {
    changesRuntimeBehavior: false
    autoAppliesRepairs: false
    deletesOldRepairInfo: false
  }
}

function statusFromAudit(coverage: RepairMemoryCoverage, unresolved: UnresolvedRepairTracker): RepairReadinessAuditStatus {
  if (coverage.answer === 'no' || unresolved.phase9Blockers.length > 0) return 'blocked'
  if (coverage.gapsFound.length > 0 || unresolved.monitorCount > 0) return 'needs_attention'
  return 'ready_with_monitoring'
}

export function runRepairReadinessAudit(generatedAt = new Date().toISOString()): RepairReadinessAudit {
  const coverage = summarizeRepairMemoryCoverage()
  const unresolved = buildUnresolvedRepairTracker({ generatedAt })
  const ledger = summarizeRepairLedger()
  const patchHistory = summarizePatchHistory(undefined, generatedAt)

  return {
    auditId: 'phase-8a-7-repair-memory-readiness',
    generatedAt,
    question: 'Does War Room currently preserve enough repair memory to diagnose and fix future failures?',
    answer: coverage.answer,
    status: statusFromAudit(coverage, unresolved),
    repairMemoryAlreadyExisted: coverage.alreadyExisted,
    filesFound: coverage.filesFound,
    gapsFound: coverage.gapsFound,
    ledger,
    patchHistory,
    unresolved,
    hardConstraints: {
      changesRuntimeBehavior: false,
      autoAppliesRepairs: false,
      deletesOldRepairInfo: false,
    },
  }
}
