import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  NEXT_AUTHORIZED_PASS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  TRAINING_AUTHORIZATION,
  WRIM_REBUILD_DESIGN,
  WRIM_REBUILD_DESIGN_DECISION,
  wrimRebuildDesignTruthNotes,
} from './identity'
import { resolveWrimRebuildDesignPaths } from './paths'
import fs from 'node:fs'

export function wrimRebuildDesignStatusPayload(dataDirOverride?: string | null) {
  const paths = resolveWrimRebuildDesignPaths(dataDirOverride)
  const truth = getSovereignRuntimeTruth()
  let report: Record<string, unknown> | null = null
  if (fs.existsSync(paths.reportPath)) {
    report = JSON.parse(fs.readFileSync(paths.reportPath, 'utf8')) as Record<string, unknown>
  }
  return {
    ok: true,
    WRIM_REBUILD_DESIGN,
    decision: (report?.decision as string | undefined) ?? WRIM_REBUILD_DESIGN_DECISION,
    next_authorized_pass: NEXT_AUTHORIZED_PASS,
    train_button: false,
    installation: false,
    conversion: false,
    training: false,
    training_authorization: TRAINING_AUTHORIZATION,
    current_production_wrim: CURRENT_PRODUCTION_WRIM,
    current_training: CURRENT_WRIM_TRAINING,
    rael: RAEL_STATUS,
    qwen: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY',
    official_run_id: 'WRIM1-RUN-000003',
    parent: 'WRIM-0',
    tokenizer: 'WR-TOKENIZER-0',
    peak_lr: 3e-5,
    packing: 'CONTIGUOUS_UNIT_PACK_DEFICIT_INTERLEAVE',
    tool_use: 'EXCLUDED',
    roadmap_22: ROADMAP_22_STATUS,
    roadmap_23: ROADMAP_23_STATUS,
    autonomy: truth.ASCENSION_AUTONOMY,
    notes: wrimRebuildDesignTruthNotes(),
    report_present: Boolean(report),
  }
}
