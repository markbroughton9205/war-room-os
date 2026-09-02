import { wrim0Baseline81 } from '@/lib/wrim1-dataset/wrim0Baseline81'
import { buildHeldOutSuite81 } from '@/lib/wrim1-dataset/heldOut'
import type { ComparisonRow } from './types'

export function wrim0VsWrim1Contract(repo = process.cwd()): ComparisonRow[] {
  const items = buildHeldOutSuite81()
  const baseline = wrim0Baseline81(repo, items)
  return items.map(item => {
    const row = baseline.find(entry => entry.evalId === item.evalId)
    const unsupported = item.wrim0Support === 'UNSUPPORTED'
    return {
      evalId: item.evalId,
      capability: item.capability,
      wrim0Result: row?.score ?? null,
      wrim0Support: item.wrim0Support,
      wrim1Result: 'NOT_RUN',
      delta: null,
      improvement: false,
      regression: false,
      unsupported,
      evidenceRefs: [
        `heldout:${item.evalId}`,
        `wrim0:${row?.status ?? 'missing'}`,
        'wrim1:NOT_RUN',
      ],
    }
  })
}

export const regressionGateChecks = [
  'language_degradation',
  'repetition',
  'json_degradation',
  'format_failures',
  'tool_protocol_regression',
  'evidence_grounding',
  'contradiction_handling',
  'context_retrieval',
  'code_behavior_where_runtime_supports',
  'catastrophic_collapse',
] as const
