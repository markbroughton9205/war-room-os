import type { CapabilityModuleRecord, CapabilityModuleState } from './types'
import { LEGAL_MODULE_TRANSITIONS } from './types'

export class IllegalModuleTransitionError extends Error {
  constructor(from: CapabilityModuleState, to: CapabilityModuleState) {
    super(`Illegal capability-module transition: ${from} -> ${to}`)
    this.name = 'IllegalModuleTransitionError'
  }
}

export function canTransitionModule(from: CapabilityModuleState, to: CapabilityModuleState): boolean {
  return LEGAL_MODULE_TRANSITIONS[from].includes(to)
}

export function transitionModule(
  record: CapabilityModuleRecord,
  to: CapabilityModuleState,
  note: string,
): CapabilityModuleRecord {
  if (!canTransitionModule(record.status, to)) {
    throw new IllegalModuleTransitionError(record.status, to)
  }
  const at = new Date().toISOString()
  return {
    ...record,
    status: to,
    promotion_history: [...record.promotion_history, { at, from: record.status, to, note }],
  }
}

export function rejectFailedModule(
  record: CapabilityModuleRecord,
  evidence: { summary: string; evalDeltas: Record<string, number>; metrics: Record<string, number> },
): { record: CapabilityModuleRecord; packet: import('./types').FailedModulePacket } {
  const rejected = record.status === 'REJECTED'
    ? record
    : transitionModule(record, 'REJECTED', evidence.summary)
  const withMetrics: CapabilityModuleRecord = {
    ...rejected,
    metrics: { ...rejected.metrics, ...evidence.evalDeltas, ...evidence.metrics },
  }
  return {
    record: withMetrics,
    packet: {
      module_id: withMetrics.module_id,
      status: 'REJECTED',
      active_core_untouched: true,
      artifact_preserved: true,
      failure_evidence_preserved: true,
      eval_deltas_preserved: true,
      gradients_or_metrics_preserved: Object.keys(evidence.metrics).length > 0,
      forensic_work_item: {
        title: `Forensic: capability module ${withMetrics.module_id} REJECTED`,
        summary: evidence.summary,
        auto_promotion: false,
      },
      core_rollback_required: false,
    },
  }
}
