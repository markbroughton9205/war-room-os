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
fs.mkdirSync(paths.retentionRepairExperimentsDir, { recursive: true })
const dump = defaultRecoveryDumpRoot()
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'retention_repair_experiments.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const stream = path.join(paths.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')

const run = spawnSync(
  paths.venvPython,
  [
    script,
    '--weights',
    dumpWrim0FinalWeights(dump),
    '--tokenizer',
    dumpTokenizerPath(dump),
    '--stream',
    stream,
    '--baseline',
    paths.stage3EvalBaselinePath,
    '--out-dir',
    paths.retentionRepairExperimentsDir,
    '--report',
    paths.retentionRepairExperimentsReportPath,
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.retentionRepairExperimentsReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.retentionRepairExperimentsReportPath, 'utf8'))
if (Number(report.optimizer_steps_this_pass) !== 0) process.exit(1)
if (report.AdamW_constructed === true) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.training_authorized === true) process.exit(1)
if (report.experiments_executed === true) process.exit(1)
if (report.final_classification !== 'WRIM_RETENTION_REPAIR_EXPERIMENTS_CORRECTED_AND_FROZEN') process.exit(1)
if (report.weights_mutated === true || report.corpus_mutated === true || report.tokenizer_mutated === true) process.exit(1)
process.exit(0)
