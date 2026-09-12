/**
 * WRIM reconciliation storage under AppData — reports only.
 * Never copies checkpoint trees. Never mutates the Mac recovery dump.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ensureLocalAppDataDirs,
  resolveLocalAppDataPaths,
} from '@/lib/sovereign-runtime/local-ownership/paths'
import { defaultRecoveryDumpRoot } from '@/lib/wr-corpus/recoverySource'
import {
  DUMP_EVAL_ONLY_DIR,
  DUMP_RECOVERY_DIR,
  DUMP_WRIM0_DIR,
  DUMP_WRIM1_DIR,
  DUMP_WRIM1_OFFICIAL_DIR,
} from './identity'

export type WrimReconciliationPaths = {
  appRoot: string
  data: string
  root: string
  reportPath: string
  inspectPath: string
  inferenceSmokePath: string
}

export function resolveWrimReconciliationPaths(dataDirOverride?: string | null): WrimReconciliationPaths {
  const app = resolveLocalAppDataPaths(dataDirOverride)
  ensureLocalAppDataDirs(app)
  const root = path.join(app.data, 'wrim-reconciliation')
  return {
    appRoot: app.root,
    data: app.data,
    root,
    reportPath: path.join(root, 'reconciliation-report.json'),
    inspectPath: path.join(root, 'checkpoint-inspect.json'),
    inferenceSmokePath: path.join(root, 'isolated-inference-smoke.json'),
  }
}

export function ensureWrimReconciliationDirs(paths: WrimReconciliationPaths): void {
  fs.mkdirSync(paths.root, { recursive: true })
}

export function dumpWrim0Dir(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), ...DUMP_WRIM0_DIR)
}

export function dumpWrim0FinalWeights(dumpRoot?: string | null): string {
  return path.join(dumpWrim0Dir(dumpRoot), 'checkpoint-final.safetensors')
}

export function dumpWrim0FinalSidecar(dumpRoot?: string | null): string {
  return path.join(dumpWrim0Dir(dumpRoot), 'checkpoint-final.json')
}

export function dumpWrim0Lineage(dumpRoot?: string | null): string {
  return path.join(dumpWrim0Dir(dumpRoot), 'lineage-manifest.json')
}

export function dumpWrim1Dir(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), ...DUMP_WRIM1_DIR)
}

export function dumpWrim1FinalModel(dumpRoot?: string | null): string {
  return path.join(dumpWrim1Dir(dumpRoot), 'checkpoint-step-001893', 'model.safetensors')
}

export function dumpWrim1FinalRunManifest(dumpRoot?: string | null): string {
  return path.join(dumpWrim1Dir(dumpRoot), 'checkpoint-step-001893', 'run-manifest.json')
}

export function dumpWrim1OfficialDir(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), ...DUMP_WRIM1_OFFICIAL_DIR)
}

export function dumpRecoveryDir(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), ...DUMP_RECOVERY_DIR)
}

export function dumpEvalOnlyDir(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), ...DUMP_EVAL_ONLY_DIR)
}

export function dumpGenesisReport(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), 'model-lab', 'manifests', 'GENESIS_REPORT.md')
}

export function dumpWrim0EvalResults(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), 'model-lab', 'manifests', 'wrim0_eval_results.json')
}
