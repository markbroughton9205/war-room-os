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
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'p2_recipe.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const stream = path.join(paths.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')
const ledger = path.join(paths.foundationalP1SovereignDir, 'sovereign-document-ledger.json')

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
    '--ledger',
    ledger,
    '--sovereignty-report',
    paths.foundationalP1SovereignReportPath,
    '--stage1',
    paths.stage1ReportPath,
    '--stage2',
    paths.stage2ReportPath,
    '--phase2',
    paths.phase2ReportPath,
    '--stage3a',
    paths.stage3aReportPath,
    '--corrective',
    paths.stage3aCorrectiveReportPath,
    '--claude-md',
    path.join(repoRoot, 'CLAUDE.md'),
    '--out-dir',
    paths.foundationalP2RecipeDir,
    '--report',
    paths.foundationalP2RecipeReportPath,
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.foundationalP2RecipeReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.foundationalP2RecipeReportPath, 'utf8'))
if (Number(report.optimizer_steps) !== 0) process.exit(1)
if (report.AdamW_constructed === true) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.training_authorized === true) process.exit(1)
if (report.corpus_mutated === true || report.tokenizer_mutated === true) process.exit(1)
if (report.final_classification !== 'P2_RECIPE_READY_FOR_COMMANDER_AUTHORIZATION') process.exit(1)
process.exit(0)
