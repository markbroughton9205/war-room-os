import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defaultRecoveryDumpRoot } from '../lib/wr-corpus/recoverySource.ts'
import { dumpTokenizerPath } from '../lib/wr-tokenizer/inspect.ts'
import { ensureWrimEnvironmentDirs, resolveWrimEnvironmentPaths } from '../lib/wrim-environment/paths.ts'
import { dumpWrim0FinalWeights } from '../lib/wrim-reconciliation/paths.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const paths = resolveWrimEnvironmentPaths()
ensureWrimEnvironmentDirs(paths)
const dump = defaultRecoveryDumpRoot()
const evalDir = path.join(repoRoot, 'scripts', 'wrim-environment', 'evals')
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'stage3_train.py')
const schedule = path.join(repoRoot, 'scripts', 'wrim-environment', 'stage3_schedule.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const common = [
  '--weights',
  dumpWrim0FinalWeights(dump),
  '--tokenizer',
  dumpTokenizerPath(dump),
  '--dump-root',
  dump,
  '--suite',
  path.join(evalDir, 'WRIM-EVAL-S3-000001.json'),
  '--baseline',
  paths.stage3EvalBaselinePath,
]

const sched = spawnSync(paths.venvPython, [schedule, '--self-test'], { stdio: 'inherit', windowsHide: true, cwd })
if ((sched.status ?? 1) !== 0) process.exit(sched.status ?? 1)

const dry = spawnSync(
  paths.venvPython,
  [
    script,
    ...common,
    '--report',
    paths.stage3DryRunReportPath,
    '--ckpt-dir',
    paths.stage3DryRunCheckpointDir,
    '--mode',
    'dry-run',
  ],
  { stdio: 'inherit', windowsHide: true, cwd },
)
if ((dry.status ?? 1) !== 0) process.exit(dry.status ?? 1)

const denied = spawnSync(
  paths.venvPython,
  [
    script,
    ...common,
    '--report',
    paths.stage3TrainDeniedPath,
    '--ckpt-dir',
    paths.stage3DryRunCheckpointDir,
    '--mode',
    'train',
  ],
  { stdio: 'inherit', windowsHide: true, cwd },
)
if ((denied.status ?? 1) !== 0) process.exit(denied.status ?? 1)

const denyFile = paths.stage3TrainDeniedPath
if (!fs.existsSync(denyFile)) process.exit(1)
const deny = JSON.parse(fs.readFileSync(denyFile, 'utf8'))
if (deny.error !== 'TRAINING_DENIED' || deny.optimizer_steps !== 0) process.exit(1)
process.exit(0)
