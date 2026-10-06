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
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'foundational_p2_run.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const stream = path.join(paths.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')
const ledger = path.join(paths.foundationalP1SovereignDir, 'sovereign-document-ledger.json')
const p1Npy = path.join(paths.foundationalP1Dir, 'p2-diagnostic-stream.npy')
const refineNpy = path.join(paths.foundationalP1RefineDir, 'refined-p2-diagnostic-stream.npy')

const run = spawnSync(
  paths.venvPython,
  [
    script,
    '--weights',
    dumpWrim0FinalWeights(dump),
    '--tokenizer',
    dumpTokenizerPath(dump),
    '--sovereignty-report',
    paths.foundationalP1SovereignReportPath,
    '--design',
    paths.foundationalRemediationDesignReportPath,
    '--stream',
    stream,
    '--ledger',
    ledger,
    '--refine-npy',
    refineNpy,
    '--p1-npy',
    p1Npy,
    '--out-dir',
    paths.foundationalP2Dir,
    '--report',
    paths.foundationalP2ReportPath,
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.foundationalP2ReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.foundationalP2ReportPath, 'utf8'))
if (Number(report.optimizer_steps) !== 0) process.exit(1)
if (report.AdamW_constructed === true) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.ready_to_run_optimizer === true) process.exit(1)
if (report.P2_EXECUTION_STARTED === true) process.exit(1)
if (report.corpus_mutated === true || report.tokenizer_mutated === true) process.exit(1)
if (report.stream_sha256 === 'a783785a579f6983f25d4157ab801d6d7b6f331edf4b2aedc4c9127070734ba0') process.exit(1)
if (report.final_classification !== 'P2_AUTHORIZED_BUT_CONFIGURATION_INCOMPLETE' && report.hard_abort !== true) process.exit(1)
process.exit(0)
