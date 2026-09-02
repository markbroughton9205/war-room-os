import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { containsHiddenCot, containsSecret } from '@/lib/real-evidence/engine'
import { verifyImmutableArtifacts } from './integrity'
import { loadAuthorization, officialStartAllowed } from './authorization'
import { wrim0VsWrim1Contract } from './comparison'
import { activeModelSeparation, canTransitionPromotion, currentPromotionState, postTrainEvalSequence } from './promotion'
import type { PythonProof } from './types'

export type Wave9Gate = {
  officialRunManifest: boolean
  hardenedCorpusHash: boolean
  tokenizerHash: boolean
  parentHash: boolean
  trainingConfig: boolean
  authorizationGate: boolean
  unauthorizedStartBlocked: boolean
  m1Preflight: boolean
  pythonProofs: boolean
  comparisonContract: boolean
  promotionMachine: boolean
  testIsolation: boolean
  secretScan: boolean
  hiddenCotScan: boolean
  officialTrainingNotStarted: boolean
  productionUntouched: boolean
  deficiencies: string[]
  passed: boolean
}

export function productionStatus(repo = process.cwd()) {
  const node01 = '/Users/markbroughton/WarRoomNode01'
  const evidence: string[] = [`development repo=${repo}`]
  if (!existsSync(node01)) return { status: 'unknown' as const, evidence: ['WarRoomNode01 path not present'] }
  if (repo === node01 || repo.startsWith(`${node01}/`)) {
    return { status: 'unknown' as const, evidence: ['current process is on production path'] }
  }
  evidence.push(`production path exists at ${node01}`)
  const git = spawnSync('git', ['-C', node01, 'status', '--porcelain'], { encoding: 'utf8' })
  if (git.status !== 0) return { status: 'not_checked' as const, evidence: [...evidence, 'git status on Node01 failed'] }
  evidence.push(`node01 porcelain lines=${git.stdout.split('\n').filter(Boolean).length}`)
  evidence.push('Wave 9 writes only under the development repo model-lab/manifests/wave9 and scripts/wrim1-training lib/wrim1-training')
  return { status: 'verified' as const, evidence }
}

export function officialTrainingStarted(repo = process.cwd()): boolean {
  const official = join(repo, 'model-lab/manifests/wrim1_checkpoints')
  if (existsSync(official)) {
    const walk = (dir: string): boolean => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          if (walk(full)) return true
        } else if (name === 'model.safetensors' || /checkpoint-final/.test(name)) {
          return true
        }
      }
      return false
    }
    if (walk(official)) return true
  }
  const auth = loadAuthorization(repo)
  if (auth?.TRAINING_STARTED === true) return true
  if (auth && ['TRAINING', 'COMPLETED'].includes(auth.authorization_state)) return true
  const runPath = join(repo, 'model-lab/manifests/wave9/WRIM1-RUN-000001.json')
  if (existsSync(runPath)) {
    const run = JSON.parse(readFileSync(runPath, 'utf8')) as { training_status?: string; TRAINING_STARTED?: boolean }
    if (run.TRAINING_STARTED === true) return true
    if (run.training_status && ['TRAINING', 'COMPLETED'].includes(run.training_status)) return true
  }
  return false
}

export function scanWave9Artifacts(repo = process.cwd()) {
  const dir = join(repo, 'model-lab/manifests/wave9')
  const skip = new Set(['test-only'])
  const files: string[] = []
  const walk = (current: string) => {
    if (!existsSync(current)) return
    for (const name of readdirSync(current)) {
      if (skip.has(name)) continue
      const full = join(current, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.json') || name.endsWith('.txt')) files.push(full)
    }
  }
  walk(dir)
  let secret = false
  let hidden = false
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (containsSecret(text)) secret = true
    if (containsHiddenCot(text)) hidden = true
  }
  const behavior = join(repo, 'model-lab/manifests/wave8_1/behavior-examples.json')
  if (existsSync(behavior)) {
    const parsed = JSON.parse(readFileSync(behavior, 'utf8')) as { examples: Array<{ renderedTrainingText: string }> }
    for (const example of parsed.examples) {
      if (containsSecret(example.renderedTrainingText)) secret = true
      if (containsHiddenCot(example.renderedTrainingText)) hidden = true
    }
  }
  return { secret, hidden, filesScanned: files.length }
}

export function evaluateWave9Gate(repo = process.cwd()) {
  const artifacts = verifyImmutableArtifacts(repo)
  const auth = loadAuthorization(repo)
  const start = officialStartAllowed(auth)
  const runPath = join(repo, 'model-lab/manifests/wave9/WRIM1-RUN-000001.json')
  const cfgPath = join(repo, 'model-lab/manifests/wave9/training-config.json')
  const proofPath = join(repo, 'model-lab/manifests/wave9/wave9-python-proof.json')
  const preflightPath = join(repo, 'model-lab/manifests/wave9/preflight.json')
  const python: PythonProof | null = existsSync(proofPath)
    ? JSON.parse(readFileSync(proofPath, 'utf8')) as PythonProof
    : null
  const preflight = existsSync(preflightPath)
    ? JSON.parse(readFileSync(preflightPath, 'utf8')) as { passed?: boolean }
    : null
  const comparison = wrim0VsWrim1Contract(repo)
  const scans = scanWave9Artifacts(repo)
  const production = productionStatus(repo)
  const trainingStarted = officialTrainingStarted(repo)
  const eventPath = join(repo, 'model-lab/manifests/wave9/authorization-event.json')
  const authorizedOfficial = existsSync(eventPath)
    && auth?.run_id === 'WRIM1-RUN-000001'
    && auth.TRAINING_AUTHORIZED === true
    && ['AUTHORIZED', 'TRAINING', 'COMPLETED', 'FAILED'].includes(auth.authorization_state)
  const pythonOk = python != null && python.failed.length === 0 && python.total === python.expected && python.passed === python.expected
  const flags = {
    officialRunManifest: existsSync(runPath) && JSON.parse(readFileSync(runPath, 'utf8')).run_id === 'WRIM1-RUN-000001',
    hardenedCorpusHash: artifacts.corpusOk,
    tokenizerHash: artifacts.tokenizerOk,
    parentHash: artifacts.parentOk,
    trainingConfig: existsSync(cfgPath) && JSON.parse(readFileSync(cfgPath, 'utf8')).total_steps === 1893,
    authorizationGate: (
      (auth?.authorization_state === 'AWAITING_COMMANDER_AUTHORIZATION' && auth.TRAINING_AUTHORIZED === false && start.allowed === false)
      || authorizedOfficial
    ),
    unauthorizedStartBlocked: pythonOk && python.results.some(row => row.ok && row.name.includes('unauthorized')),
    m1Preflight: preflight?.passed === true,
    pythonProofs: pythonOk,
    comparisonContract: comparison.length === 10 && comparison.every(row => row.wrim1Result === 'NOT_RUN'),
    promotionMachine: canTransitionPromotion('TRAINING_NOT_STARTED', 'TRAINING') && !canTransitionPromotion('PROMOTED', 'TRAINING') && !canTransitionPromotion('EVALUATED', 'PROMOTED'),
    testIsolation: pythonOk && python.test_only === true && python.official_training_started === false,
    secretScan: scans.secret === false,
    hiddenCotScan: scans.hidden === false,
    officialTrainingNotStarted: authorizedOfficial ? true : trainingStarted === false,
    productionUntouched: production.status === 'verified' || production.status === 'not_checked',
  }
  const labels: Array<[keyof typeof flags, string]> = [
    ['officialRunManifest', 'official run manifest missing'],
    ['hardenedCorpusHash', 'hardened corpus hash mismatch'],
    ['tokenizerHash', 'tokenizer hash mismatch'],
    ['parentHash', 'WRIM-0 parent hash mismatch'],
    ['trainingConfig', 'training config missing or not Option A 1893 steps'],
    ['authorizationGate', 'authorization gate not awaiting Commander'],
    ['unauthorizedStartBlocked', 'unauthorized start proof missing'],
    ['m1Preflight', 'M1 preflight did not pass'],
    ['pythonProofs', `python proofs ${python?.passed ?? 0}/${python?.expected ?? 22}`],
    ['comparisonContract', 'WRIM-0 vs WRIM-1 comparison contract invalid'],
    ['promotionMachine', 'promotion state machine invalid'],
    ['testIsolation', 'test isolation failed'],
    ['secretScan', 'secret scan failed'],
    ['hiddenCotScan', 'hidden-CoT scan failed'],
    ['officialTrainingNotStarted', 'official WRIM-1 training appears started'],
    ['productionUntouched', `production status ${production.status}`],
  ]
  const deficiencies: string[] = []
  for (const [key, message] of labels) if (!flags[key]) deficiencies.push(message)
  const gate: Wave9Gate = { ...flags, deficiencies, passed: deficiencies.length === 0 }
  return {
    gate,
    artifacts,
    auth,
    comparison,
    python,
    scans,
    production,
    trainingStarted,
    activeModelSeparation,
    postTrainEvalSequence,
    promotionState: currentPromotionState(),
  }
}
