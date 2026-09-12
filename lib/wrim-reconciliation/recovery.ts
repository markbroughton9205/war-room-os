import fs from 'node:fs'
import path from 'node:path'
import { dumpRecoveryDir } from './paths'

export type RecoveryClass =
  | 'DISCARD'
  | 'HISTORICAL_ONLY'
  | 'REUSABLE_MECHANISM'
  | 'REUSABLE_HYPERPARAMETER'
  | 'REUSABLE_DATA_STRATEGY'
  | 'NEEDS_RETEST_ON_NEBULA'

export type RecoveryExperiment = {
  id: string
  testOnly: true
  changed: string
  problem: string
  plannedSteps: number | null
  completedSteps: number | null
  peakLr: number | null
  collapsedProbes: string | null
  verdict: 'PASS' | 'FAIL' | 'FORENSIC'
  classification: RecoveryClass[]
  reusableIdea: string | null
  deadEnd: boolean
}

export const RECOVERY_EXPERIMENTS: RecoveryExperiment[] = [
  {
    id: 'TEST-WRIM1.1-RECOVERY-001',
    testOnly: true,
    changed: 'Contiguous packing + BOS/EOS units + WR-CORPUS-0 rehearsal ~39% + peak LR 3e-4',
    problem: 'Test whether fixing token-shuffle restores WRIM-0 language',
    plannedSteps: 150,
    completedSteps: 100,
    peakLr: 3e-4,
    collapsedProbes: '6/13 at 100',
    verdict: 'FAIL',
    classification: ['HISTORICAL_ONLY', 'REUSABLE_MECHANISM'],
    reusableIdea: 'Contiguous windows + per-unit EOS wrapping must stay. High rehearsal+3e-4 still collapsed.',
    deadEnd: false,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-002',
    testOnly: true,
    changed: 'Mix shifted toward prose (52%) + peak LR 1e-4; still short horizon',
    problem: 'Data-mix / LR after 001',
    plannedSteps: 50,
    completedSteps: 25,
    peakLr: 1e-4,
    collapsedProbes: '4/13 at 25',
    verdict: 'FAIL',
    classification: ['DISCARD'],
    reusableIdea: null,
    deadEnd: true,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-003',
    testOnly: true,
    changed: 'Data-mix isolation (35/35 prose/code)',
    problem: 'Isolate mix vs packing',
    plannedSteps: 50,
    completedSteps: 25,
    peakLr: 3e-4,
    collapsedProbes: '11/13 at 25',
    verdict: 'FAIL',
    classification: ['DISCARD'],
    reusableIdea: 'High code+3e-4 is actively worse.',
    deadEnd: true,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-004',
    testOnly: true,
    changed: 'Rehearsal ablation (30% WR-CORPUS-0)',
    problem: 'Rehearsal share',
    plannedSteps: 50,
    completedSteps: 45,
    peakLr: 3e-4,
    collapsedProbes: 'stop at 45 (4/13 gate)',
    verdict: 'FAIL',
    classification: ['HISTORICAL_ONLY'],
    reusableIdea: 'Forensics at step 45 remain diagnostic-only.',
    deadEnd: false,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-005',
    testOnly: true,
    changed: 'Interleaved rehearsal, LR still 3e-4',
    problem: 'Binge/rehearsal locality',
    plannedSteps: 50,
    completedSteps: 30,
    peakLr: 3e-4,
    collapsedProbes: '7/13 class at 30',
    verdict: 'FAIL',
    classification: ['HISTORICAL_ONLY', 'REUSABLE_DATA_STRATEGY'],
    reusableIdea: 'Deficit interleave of windows is the later packing method; 3e-4 is not.',
    deadEnd: false,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-006',
    testOnly: true,
    changed: 'Peak LR 3e-5 + interleaved mix identical to 005',
    problem: 'LR vs mix',
    plannedSteps: 50,
    completedSteps: 50,
    peakLr: 3e-5,
    collapsedProbes: '2/13 end',
    verdict: 'PASS',
    classification: ['REUSABLE_HYPERPARAMETER', 'REUSABLE_DATA_STRATEGY', 'NEEDS_RETEST_ON_NEBULA'],
    reusableIdea: '3e-5 + interleaved rehearsal is the first stable short-horizon recipe.',
    deadEnd: false,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-007',
    testOnly: true,
    changed: 'Same 006 recipe, horizon 150',
    problem: 'Endurance of 3e-5 mix',
    plannedSteps: 150,
    completedSteps: 150,
    peakLr: 3e-5,
    collapsedProbes: '3/13 end',
    verdict: 'PASS',
    classification: ['REUSABLE_HYPERPARAMETER', 'NEEDS_RETEST_ON_NEBULA'],
    reusableIdea: '150-step endurance holds; capability still not improved.',
    deadEnd: false,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-008',
    testOnly: true,
    changed: 'Official 000002 capability stream; LR cosine 150 then planned floor to 250',
    problem: 'Is stretched LR the 000002 failure?',
    plannedSteps: 250,
    completedSteps: 120,
    peakLr: 3e-5,
    collapsedProbes: '4/13 at 120',
    verdict: 'FAIL',
    classification: ['HISTORICAL_ONLY'],
    reusableIdea: 'LR-horizon hypothesis NOT SUFFICIENT. Keep forensics.',
    deadEnd: false,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-009',
    testOnly: true,
    changed: 'Replace QUALITY_CODE leftover 1:1 with WR-CORPUS-0 rehearsal',
    problem: 'H1 code-as-primary-driver',
    plannedSteps: 250,
    completedSteps: 75,
    peakLr: 3e-5,
    collapsedProbes: '4/13 at 75 (worse than 008)',
    verdict: 'FAIL',
    classification: ['DISCARD'],
    reusableIdea: 'Do not automatically delete code from future training.',
    deadEnd: true,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-010',
    testOnly: true,
    changed: 'Replace TOOL_USE supervised windows with WR-CORPUS-0 rehearsal; keep QUALITY_CODE',
    problem: 'H2 tool-use isolation',
    plannedSteps: 250,
    completedSteps: 250,
    peakLr: 3e-5,
    collapsedProbes: '1–3/13; 3/13 at end',
    verdict: 'PASS',
    classification: ['REUSABLE_DATA_STRATEGY', 'REUSABLE_MECHANISM', 'NEEDS_RETEST_ON_NEBULA'],
    reusableIdea: 'Tool-use V1 windows destabilize language. Best recovery experiment. Still TEST_ONLY, not promoted. TOOL eval 0/10.',
    deadEnd: false,
  },
  {
    id: 'TEST-WRIM1.1-RECOVERY-011',
    testOnly: true,
    changed: 'Reintroduce compact TOOL_USE V2 in former V1 slots from WRIM-0 (not from 010 weights)',
    problem: 'Can compact tool intent be added without 008-class collapse?',
    plannedSteps: 250,
    completedSteps: 120,
    peakLr: 3e-5,
    collapsedProbes: '4/13 at 120',
    verdict: 'FAIL',
    classification: ['HISTORICAL_ONLY'],
    reusableIdea: 'Compact tool representation alone does not preserve 010 stability. Tool curriculum needs a later isolated design.',
    deadEnd: false,
  },
]

export function liveRecoveryListing(dumpRoot?: string | null) {
  const dir = dumpRecoveryDir(dumpRoot)
  if (!fs.existsSync(dir)) return { present: false, dirs: [] as string[] }
  return {
    present: true,
    dirs: fs.readdirSync(dir).filter(n => {
      try {
        return fs.statSync(path.join(dir, n)).isDirectory()
      } catch {
        return false
      }
    }),
  }
}

export function reusableRecoveryMechanisms() {
  return RECOVERY_EXPERIMENTS.filter(e =>
    e.classification.some(c => c === 'REUSABLE_MECHANISM' || c === 'REUSABLE_HYPERPARAMETER' || c === 'REUSABLE_DATA_STRATEGY'),
  )
}
