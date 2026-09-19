import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defaultRecoveryDumpRoot } from '../lib/wr-corpus/recoverySource.ts'
import { ensureWrimEnvironmentDirs, resolveWrimEnvironmentPaths } from '../lib/wrim-environment/paths.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const paths = resolveWrimEnvironmentPaths()
ensureWrimEnvironmentDirs(paths)

function resolvePython() {
  if (fs.existsSync(paths.venvPython)) return paths.venvPython
  const posix = path.join(paths.venvRoot, 'bin', 'python')
  if (fs.existsSync(posix)) return posix
  return 'python3'
}

function resolveDump() {
  const env = process.env.WAR_ROOM_RECOVERY_DUMP?.trim()
  const seagate =
    '/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/Documents/Codex/2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419'
  for (const c of [env, defaultRecoveryDumpRoot(), seagate]) {
    if (!c) continue
    const tok = path.join(c, 'model-lab', 'manifests', 'wrim0_tokenizer_v16384', 'tokenizer.json')
    if (fs.existsSync(tok)) return c
  }
  return defaultRecoveryDumpRoot()
}

const dump = resolveDump()
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'run000006_preflight.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const suite = path.join(repoRoot, 'scripts', 'wrim-environment', 'evals', 'WRIM-EVAL-S3-000001.json')

const run = spawnSync(
  resolvePython(),
  [
    script,
    '--dump-root',
    dump,
    '--data-root',
    paths.root,
    '--suite',
    suite,
    '--report',
    paths.run000006PreflightReportPath,
    '--config',
    paths.run000006ConfigPath,
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  },
)
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.run000006PreflightReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.run000006PreflightReportPath, 'utf8'))
if (Number(report.optimizer_steps) !== 0) process.exit(1)
if (report.AdamW_constructed === true) process.exit(1)
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (report.training_executed === true) process.exit(1)
if (report.READY_FOR_TRAINING_AUTHORIZATION !== 'YES') process.exit(1)
process.exit(0)
