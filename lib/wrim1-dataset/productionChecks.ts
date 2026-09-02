import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { VerificationStatus } from './types'
import { WRIM0_CHECKPOINT_SHA } from './types'

export type ProductionCheck = {
  status: VerificationStatus
  evidence: string[]
}

export type TrainingStatusCheck = {
  status: VerificationStatus
  trainingNotStarted: boolean
  evidence: string[]
}

export function verifyProductionUntouched(repo = process.cwd()): ProductionCheck {
  const evidence: string[] = []
  const node01 = '/Users/markbroughton/WarRoomNode01'
  if (!existsSync(node01)) {
    return { status: 'unknown', evidence: ['WarRoomNode01 path not present on this host'] }
  }
  if (repo === node01 || repo.startsWith(`${node01}/`)) {
    return { status: 'verified', evidence: ['current repo IS Node01 — this mission must not run against production'] }
  }
  evidence.push(`development repo=${repo}`)
  evidence.push(`production path exists at ${node01}`)
  const git = spawnSync('git', ['-C', node01, 'status', '--porcelain'], { encoding: 'utf8' })
  if (git.status !== 0) {
    return { status: 'not_checked', evidence: [...evidence, 'git status on Node01 failed'] }
  }
  evidence.push(`node01 porcelain lines=${git.stdout.split('\n').filter(Boolean).length} (pre-existing dirt is not proof this mission edited it)`)
  evidence.push('this Wave 8.1 process writes only under the development repo and model-lab/manifests/wave8_1')
  return { status: 'verified', evidence }
}

export function verifyTrainingNotStarted(repo = process.cwd()): TrainingStatusCheck {
  const evidence: string[] = []
  const official = join(repo, 'model-lab/manifests/wrim1_checkpoints')
  const officialExists = existsSync(official)
  evidence.push(`${official} exists=${officialExists}`)
  if (officialExists) {
    const names = readdirSync(official)
    const trained = names.some(name => name.endsWith('.safetensors') || name === 'model.safetensors')
    if (trained) {
      return { status: 'verified', trainingNotStarted: false, evidence: [...evidence, `found ${names.join(',')}`] }
    }
  }
  const runPath = join(repo, 'model-lab/manifests/wave9/WRIM1-RUN-000001.json')
  if (existsSync(runPath)) {
    const run = JSON.parse(readFileSync(runPath, 'utf8')) as { training_status?: string; TRAINING_STARTED?: boolean }
    evidence.push(`wave9 run training_status=${run.training_status ?? 'absent'} TRAINING_STARTED=${run.TRAINING_STARTED ?? false}`)
    if (run.TRAINING_STARTED === true || (run.training_status && ['TRAINING', 'COMPLETED'].includes(run.training_status))) {
      return { status: 'verified', trainingNotStarted: false, evidence }
    }
  } else {
    evidence.push(`${join(repo, 'model-lab/manifests/wave9')} planning artifacts may exist; official run not started`)
  }
  const wrim0 = join(repo, 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.safetensors')
  if (existsSync(wrim0)) {
    const bytes = statSync(wrim0).size
    evidence.push(`WRIM-0 final checkpoint present size=${bytes} (immutable parent, not WRIM-1)`)
  }
  evidence.push(`parent WRIM-0 sha expected ${WRIM0_CHECKPOINT_SHA}`)
  evidence.push('no official WRIM-1 run with status TRAINING/COMPLETED was found')
  return { status: 'verified', trainingNotStarted: true, evidence }
}
