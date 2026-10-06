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
fs.mkdirSync(paths.retentionBreakForensicDir, { recursive: true })
const dump = defaultRecoveryDumpRoot()
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'retention_break_forensic.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const stepMap = path.join(paths.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-step-map.json')
const ledger = path.join(paths.foundationalP1SovereignDir, 'sovereign-document-ledger.json')
const stream = path.join(paths.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')

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
    '--p2-ckpt',
    paths.foundationalP2TrainDir,
    '--p2-report',
    paths.foundationalP2TrainReportPath,
    '--step-map',
    stepMap,
    '--ledger',
    ledger,
    '--stream',
    stream,
    '--out-dir',
    paths.retentionBreakForensicDir,
    '--report',
    paths.retentionBreakForensicReportPath,
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.retentionBreakForensicReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.retentionBreakForensicReportPath, 'utf8'))
if (Number(report.optimizer_steps_this_pass) !== 0) process.exit(1)
if (report.AdamW_constructed === true) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.P3_AUTHORIZED === true) process.exit(1)
if (report.STAGE3B_AUTHORIZATION !== 'NO') process.exit(1)
if (report.weights_mutated === true || report.corpus_mutated === true || report.tokenizer_mutated === true) process.exit(1)
process.exit(0)
