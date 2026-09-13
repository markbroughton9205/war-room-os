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
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'stage3a_adjudication.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const freezeOnly = process.argv.includes('--freeze-only')

const args = [
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
  '--nll-anchor',
  path.join(paths.root, 'wrim0-reference-nll.json'),
  '--ckpt-dir',
  paths.stage3aCheckpointDir,
  '--selection',
  paths.stage3aSelectionReportPath,
  '--eval-dir',
  evalDir,
  '--report',
  paths.stage3aAdjudicationReportPath,
]
if (freezeOnly) args.push('--freeze-only')

const run = spawnSync(paths.venvPython, args, { stdio: 'inherit', windowsHide: true, cwd })
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.stage3aAdjudicationReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.stage3aAdjudicationReportPath, 'utf8'))
if (report.optimizer_steps_this_pass !== 0) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
process.exit(0)
