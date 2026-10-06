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
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'foundational_sovereignty.py')
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
    '--ckpt-000004',
    paths.stage3aCorrectiveCheckpointDir,
    '--p1-report',
    paths.foundationalP1ReportPath,
    '--p1-dir',
    paths.foundationalP1Dir,
    '--refine-report',
    paths.foundationalP1RefineReportPath,
    '--refine-dir',
    paths.foundationalP1RefineDir,
    '--out-dir',
    paths.foundationalP1SovereignDir,
    '--report',
    paths.foundationalP1SovereignReportPath,
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.foundationalP1SovereignReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.foundationalP1SovereignReportPath, 'utf8'))
if (Number(report.optimizer_steps_this_pass) !== 0) process.exit(1)
if (report.AdamW_constructed === true) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.P2_AUTHORIZED === true) process.exit(1)
if (report.corpus_mutated === true || report.tokenizer_mutated === true) process.exit(1)
if (report.concatenated_p2_training_directive_executed === true) process.exit(1)
const refine = JSON.parse(fs.readFileSync(paths.foundationalP1RefineReportPath, 'utf8'))
if (refine.packing?.stream_sha256 !== 'a783785a579f6983f25d4157ab801d6d7b6f331edf4b2aedc4c9127070734ba0') process.exit(1)
const p1 = JSON.parse(fs.readFileSync(paths.foundationalP1ReportPath, 'utf8'))
if (p1.packing?.stream_sha256 !== '166139473acf7edc5d12210cfa3b456b3bcbc2b56efb0674671da7e8a09796ed') process.exit(1)
process.exit(0)
