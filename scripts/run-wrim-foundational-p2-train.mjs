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
fs.mkdirSync(paths.foundationalP2TrainDir, { recursive: true })
if (paths.foundationalP2TrainDir.includes('P2-INCOMPLETE-CONFIG') || paths.foundationalP2TrainDir.endsWith(`${path.sep}P2-RECIPE`)) {
  process.exit(2)
}
const dump = defaultRecoveryDumpRoot()
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'foundational_p2_train.py')
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
    '--dump-root',
    dump,
    '--baseline',
    paths.stage3EvalBaselinePath,
    '--sovereignty-report',
    paths.foundationalP1SovereignReportPath,
    '--stream',
    stream,
    '--ledger',
    ledger,
    '--p1-npy',
    p1Npy,
    '--refine-npy',
    refineNpy,
    '--claude-md',
    path.join(repoRoot, 'CLAUDE.md'),
    '--report',
    paths.foundationalP2TrainReportPath,
    '--ckpt-dir',
    paths.foundationalP2TrainDir,
    '--authorize-wrim1-run-000005',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.foundationalP2TrainReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.foundationalP2TrainReportPath, 'utf8'))
if (Number(report.optimizer_steps) > 1000) process.exit(1)
if (fs.existsSync(path.join(paths.foundationalP2TrainDir, 'step-1001'))) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.STAGE3B_AUTHORIZATION !== 'NO') process.exit(1)
if (report.P3_AUTHORIZED === true) process.exit(1)
if (report.recipe_sha256 !== '5b6237dcad4321111510453c9bfcb6713a8f61a8218c487afd67952a42d18117') process.exit(1)
if (report.stream_sha256 !== '5bf8951e364ed9a7f02889d4d96e44c7a9d3a2e6a78464c8fe4b43c9bbe22db5') process.exit(1)
if (report.stream_sha256 === 'a783785a579f6983f25d4157ab801d6d7b6f331edf4b2aedc4c9127070734ba0') process.exit(1)
process.exit(0)
