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
fs.mkdirSync(paths.stage3aCheckpointDir, { recursive: true })
const dump = defaultRecoveryDumpRoot()
const evalDir = path.join(repoRoot, 'scripts', 'wrim-environment', 'evals')
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'stage3_train.py')
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
    '--suite',
    path.join(evalDir, 'WRIM-EVAL-S3-000001.json'),
    '--baseline',
    paths.stage3EvalBaselinePath,
    '--report',
    paths.stage3aReportPath,
    '--ckpt-dir',
    paths.stage3aCheckpointDir,
    '--mode',
    'stage3a',
  ],
  { stdio: 'inherit', windowsHide: true, cwd },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.stage3aReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.stage3aReportPath, 'utf8'))
if (report.step_51_exists === true) process.exit(1)
if (Number(report.optimizer_steps) > 50) process.exit(1)
process.exit(0)
