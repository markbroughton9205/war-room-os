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
fs.mkdirSync(paths.stage3aCorrectiveCheckpointDir, { recursive: true })
if (paths.stage3aCorrectiveCheckpointDir.includes('WRIM1-RUN-000003')) process.exit(2)
const dump = defaultRecoveryDumpRoot()
const evalDir = path.join(repoRoot, 'scripts', 'wrim-environment', 'evals')
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'stage3a_corrective_train.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')

const run = spawnSync(
  paths.venvPython,
  [
    script,
    '--weights',
    dumpWrim0FinalWeights(dump),
    '--tokenizer',
    dumpTokenizerPath(dump),
    '--dump-root',
    dump,
    '--baseline',
    paths.stage3EvalBaselinePath,
    '--design',
    paths.stage3aCorrectiveDesignReportPath,
    '--eval-dir',
    evalDir,
    '--report',
    paths.stage3aCorrectiveReportPath,
    '--ckpt-dir',
    paths.stage3aCorrectiveCheckpointDir,
    '--authorize-wrim1-run-000004',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.stage3aCorrectiveReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.stage3aCorrectiveReportPath, 'utf8'))
if (Number(report.optimizer_steps_executed) > 25) process.exit(1)
if (fs.existsSync(path.join(paths.stage3aCorrectiveCheckpointDir, 'step-26'))) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.STAGE3B_AUTHORIZATION !== 'NO') process.exit(1)
process.exit(0)
