import fs from 'node:fs'
import path from 'node:path'
import { defaultRecoveryDumpRoot } from '@/lib/wr-corpus/recoverySource'
import { dumpEvalOnlyDir, dumpRecoveryDir, dumpWrim0Dir, dumpWrim1Dir, dumpWrim1OfficialDir } from './paths'

export type ArtifactClass =
  | 'WRIM-0'
  | 'WRIM1-RUN-000001'
  | 'WRIM1-RUN-000002'
  | 'WRIM1.1-RECOVERY-TEST_ONLY'
  | 'EVAL_ONLY'
  | 'CAPABILITY_DESIGN'
  | 'TOOL_CURRICULUM_DESIGN'

function dirSizeBytes(dir: string, maxFiles = 20000): { bytes: number; files: number; truncated: boolean } {
  let bytes = 0
  let files = 0
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0, truncated: false }
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of ents) {
      const full = path.join(cur, ent.name)
      if (ent.isDirectory()) stack.push(full)
      else {
        files += 1
        try {
          bytes += fs.statSync(full).size
        } catch {
          /* skip */
        }
        if (files >= maxFiles) return { bytes, files, truncated: true }
      }
    }
  }
  return { bytes, files, truncated: false }
}

function listNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
}

export function inventoryHistoricalWrim(dumpRoot?: string | null) {
  const root = defaultRecoveryDumpRoot(dumpRoot)
  const wrim0 = dumpWrim0Dir(dumpRoot)
  const wrim1 = dumpWrim1Dir(dumpRoot)
  const official = dumpWrim1OfficialDir(dumpRoot)
  const recovery = dumpRecoveryDir(dumpRoot)
  const evalOnly = dumpEvalOnlyDir(dumpRoot)
  const recoverySize = dirSizeBytes(recovery)
  return {
    dumpRoot: root,
    trees: [
      { class: 'WRIM-0' as ArtifactClass, path: wrim0, names: listNames(wrim0), ...dirSizeBytes(wrim0) },
      { class: 'WRIM1-RUN-000001' as ArtifactClass, path: wrim1, names: listNames(wrim1), ...dirSizeBytes(wrim1) },
      { class: 'WRIM1-RUN-000002' as ArtifactClass, path: official, names: listNames(official), ...dirSizeBytes(official) },
      {
        class: 'WRIM1.1-RECOVERY-TEST_ONLY' as ArtifactClass,
        path: recovery,
        names: listNames(recovery),
        ...recoverySize,
        note: 'Inventory by directory listing only. Full 13.8GB tree is not loaded into runtime.',
      },
      { class: 'EVAL_ONLY' as ArtifactClass, path: evalOnly, names: listNames(evalOnly), ...dirSizeBytes(evalOnly) },
    ],
    recoveryExperiments: listNames(recovery).filter(n => n.startsWith('TEST-WRIM1.1-RECOVERY-')),
    wrim0Checkpoints: listNames(wrim0).filter(n => n.endsWith('.safetensors')),
    wrim1Checkpoints: listNames(wrim1).filter(n => n.startsWith('checkpoint-step-')),
  }
}
