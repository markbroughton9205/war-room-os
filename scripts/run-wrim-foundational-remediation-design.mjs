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
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'foundational_remediation_design.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const metrics = path.join(paths.stage3aCorrectiveCheckpointDir, 'metrics.jsonl')

const run = spawnSync(
  paths.venvPython,
  [
    script,
    '--audit',
    paths.foundationalRootCauseReportPath,
    '--weights',
    dumpWrim0FinalWeights(dump),
    '--tokenizer',
    dumpTokenizerPath(dump),
    '--metrics',
    metrics,
    '--report',
    paths.foundationalRemediationDesignReportPath,
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.foundationalRemediationDesignReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.foundationalRemediationDesignReportPath, 'utf8'))
if (Number(report.optimizer_steps_this_pass) !== 0) process.exit(1)
if (report.AdamW_constructed === true) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.STAGE3B_AUTHORIZATION !== 'NO') process.exit(1)
if (report.corpus_mutated === true || report.tokenizer_mutated === true) process.exit(1)
if (report.ready_to_run_optimizer === true) process.exit(1)
process.exit(0)
