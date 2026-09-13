import path from 'node:path'
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
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'phase2_grid.py')
const result = spawnSync(
  paths.venvPython,
  [
    script,
    '--weights',
    dumpWrim0FinalWeights(dump),
    '--tokenizer',
    dumpTokenizerPath(dump),
    '--dump-root',
    dump,
    '--report',
    paths.phase2ReportPath,
    '--ckpt-root',
    paths.phase2GridCheckpointDir,
    '--frozen-nll',
    path.join(paths.root, 'wrim0-reference-nll.json'),
    '--harness',
    paths.phase1HarnessPath,
    '--phase0-report',
    paths.phase0ReportPath,
    '--preregistration',
    path.join(repoRoot, 'scripts', 'wrim-environment', 'PREREGISTRATION.md'),
    '--authorization',
    'PHASE2_GRID_ONLY',
  ],
  { stdio: 'inherit', windowsHide: true, cwd: path.join(repoRoot, 'scripts', 'wrim-environment') },
)
process.exit(result.status ?? 1)
