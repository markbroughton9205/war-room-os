import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ensureWrimEnvironmentDirs, resolveWrimEnvironmentPaths } from '../lib/wrim-environment/paths.ts'
import { TRAINING_AUTHORIZATION } from '../lib/wrim-environment/identity.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const paths = resolveWrimEnvironmentPaths()
ensureWrimEnvironmentDirs(paths)
if (TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)

const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'sovereign_lab.py')
const cwd = path.join(repoRoot, 'scripts', 'wrim-environment')
const py = paths.labVenvPython && fs.existsSync(paths.labVenvPython) ? paths.labVenvPython : paths.venvPython

const run = spawnSync(py, [script], {
  stdio: 'inherit',
  windowsHide: true,
  cwd,
  env: {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    DO_NOT_TRACK: '1',
    MLFLOW_DISABLE_TELEMETRY: 'true',
    DVC_NO_ANALYTICS: '1',
    AIM_UI_TELEMETRY_ENABLED: '0',
    HF_HUB_DISABLE_TELEMETRY: '1',
  },
})
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)
if (!fs.existsSync(paths.sovereignLabReportPath)) process.exit(1)
const report = JSON.parse(fs.readFileSync(paths.sovereignLabReportPath, 'utf8'))
if (report.TRAINING_AUTHORIZATION !== 'OFF') process.exit(1)
if (Number(report.optimizer_steps_this_pass) !== 0) process.exit(1)
process.exit(0)
