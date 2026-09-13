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
fs.mkdirSync(evalDir, { recursive: true })
const script = path.join(repoRoot, 'scripts', 'wrim-environment', 'stage3_eval_baseline.py')
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
    '--suite-out',
    path.join(evalDir, 'WRIM-EVAL-S3-000001.json'),
    '--leakage-out',
    path.join(evalDir, 'WRIM-EVAL-S3-000001.LEAKAGE.json'),
    '--duplication-out',
    path.join(evalDir, 'WRIM-EVAL-S3-000001.DUPLICATION.json'),
    '--baseline-out',
    paths.stage3EvalBaselinePath,
    '--pointer-out',
    path.join(evalDir, 'WRIM-EVAL-S3-000001.BASELINE_POINTER.json'),
    '--authorization',
    'STAGE3_EVAL_BASELINE_ONLY',
  ],
  { stdio: 'inherit', windowsHide: true, cwd: path.join(repoRoot, 'scripts', 'wrim-environment') },
)
process.exit(result.status ?? 1)
