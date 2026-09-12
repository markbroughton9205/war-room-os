import fs from 'node:fs'
import path from 'node:path'
import { dumpEvalOnlyDir } from './paths'

export type EvalSuiteStatus = 'AVAILABLE' | 'REUSABLE' | 'INCOMPATIBLE' | 'MISSING'

export type EvalSuite = {
  id: string
  pathRel: string
  status: EvalSuiteStatus
  excludeFromTraining: boolean
  notes: string
}

export function inventoryEvalSuites(dumpRoot?: string | null): EvalSuite[] {
  const root = dumpEvalOnlyDir(dumpRoot)
  const suites: EvalSuite[] = [
    {
      id: 'WRIM-0-GENESIS-EVAL',
      pathRel: 'model-lab/manifests/wrim0_eval_results.json',
      status: fs.existsSync(path.join(root, '..', 'manifests', 'wrim0_eval_results.json')) ? 'REUSABLE' : 'MISSING',
      excludeFromTraining: true,
      notes: 'Calibration suite (6 fixed prompts). Not MMLU. Disclosed train-domain overlap with WR-CORPUS-0 literary text.',
    },
    {
      id: 'WRIM-RECOVERY-DIAGNOSTIC-0',
      pathRel: 'model-lab/manifests/wrim1_1_recovery/test-only/WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json',
      status: 'REUSABLE',
      excludeFromTraining: true,
      notes: 'DIAGNOSTIC_ONLY collapse probes. Not held-out capability proof.',
    },
    {
      id: 'WRIM-1.1-CAP-EVAL-0',
      pathRel: 'model-lab/eval-only/WRIM-1.1-CAP-EVAL-0',
      status: fs.existsSync(path.join(root, 'WRIM-1.1-CAP-EVAL-0', 'suite.json')) ? 'REUSABLE' : 'MISSING',
      excludeFromTraining: true,
      notes: 'EXCLUDE_FROM_TRAINING=true. 86-item capability suite. Reusable on Nebula if tokenizer remains WR-TOKENIZER-0.',
    },
    {
      id: 'WRIM-1.1-TOOL-EVAL-1',
      pathRel: 'model-lab/eval-only/WRIM-1.1-TOOL-EVAL-1',
      status: fs.existsSync(path.join(root, 'WRIM-1.1-TOOL-EVAL-1', 'suite.json')) ? 'REUSABLE' : 'MISSING',
      excludeFromTraining: true,
      notes: 'Tool held-out. Historical scores 0/10–0/12. Keep excluded from train.',
    },
    {
      id: 'WR-TOOL-EVAL-2',
      pathRel: 'model-lab/eval-only/WR-TOOL-EVAL-2',
      status: fs.existsSync(path.join(root, 'WR-TOOL-EVAL-2', 'suite.json')) ? 'REUSABLE' : 'MISSING',
      excludeFromTraining: true,
      notes: 'Modular tool-head eval, not dense WRIM LM eval.',
    },
    {
      id: 'WR-TOOL-EVAL-3',
      pathRel: 'model-lab/eval-only/WR-TOOL-EVAL-3',
      status: fs.existsSync(path.join(root, 'WR-TOOL-EVAL-3', 'suite.json')) ? 'REUSABLE' : 'MISSING',
      excludeFromTraining: true,
      notes: 'Modular tool eval.',
    },
    {
      id: 'WAVE-8.1-HELDOUT',
      pathRel: 'model-lab/manifests/wave8_1/wrim0-heldout-run.json',
      status: 'INCOMPATIBLE',
      excludeFromTraining: true,
      notes: 'Historical WRIM-1 held-out had eval-infra substring leakage. Do not treat as clean generalization.',
    },
  ]
  return suites
}
