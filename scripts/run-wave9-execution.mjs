import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { evaluateWave9Gate } from '../lib/wrim1-training/gate.ts'
import { wrim0VsWrim1Contract, regressionGateChecks } from '../lib/wrim1-training/comparison.ts'
import { LEGAL_PROMOTION_TRANSITIONS, PROMOTION_STATES, activeModelSeparation, currentPromotionState, postTrainEvalSequence } from '../lib/wrim1-training/promotion.ts'

const repo = process.cwd()
const out = join(repo, 'model-lab', 'manifests', 'wave9')
await mkdir(out, { recursive: true })
const snap = evaluateWave9Gate(repo)
await writeFile(join(out, 'comparison-contract.json'), `${JSON.stringify({
  wrim1: 'NOT_RUN',
  agiPercentage: null,
  rows: wrim0VsWrim1Contract(repo),
}, null, 2)}\n`)
await writeFile(join(out, 'promotion-state.json'), `${JSON.stringify({
  current: currentPromotionState(),
  states: PROMOTION_STATES,
  legalTransitions: LEGAL_PROMOTION_TRANSITIONS,
  activeModelSeparation,
  postTrainEvalSequence,
  regressionGateChecks,
}, null, 2)}\n`)
await writeFile(join(out, 'wave9-gate.json'), `${JSON.stringify({
  gate: snap.gate,
  production: snap.production,
  trainingStarted: snap.trainingStarted,
  authorization: snap.auth,
  python: { expected: snap.python?.expected, total: snap.python?.total, passed: snap.python?.passed, failed: snap.python?.failed },
}, null, 2)}\n`)
console.log(JSON.stringify({ gatePassed: snap.gate.passed, deficiencies: snap.gate.deficiencies }))
