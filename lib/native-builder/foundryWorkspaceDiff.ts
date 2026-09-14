/**
 * Workspace-aware Foundry diff. `git diff` ignores untracked files, which produced
 * false +0/-0 on greenfield missions. Product files (not .war-room metadata) are included.
 */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { terminalRepoDiff, terminalRepoStatus } from './terminalExecutor'
import { isFoundryMetadataPath, type FoundryWorkspaceSurface } from './foundryCompletionTruth'
import { classifyWorkspaceRoot } from './foundryWorkspaceIdentity'
import type { NativeDiffEvidence } from './types'

const MAX_UNTRACKED_BYTES = 80 * 1024

export function classifyFoundryWorkspaceSurface(): FoundryWorkspaceSurface {
  return classifyWorkspaceRoot(resolveRepoRoot()) === 'WAR_ROOM_CANONICAL_SOURCE'
    ? 'war_room_source'
    : 'generated_project'
}

export async function collectFoundryWorkspaceDiff(): Promise<{
  diff: string
  created: string[]
  modified: string[]
  metadataFiles: string[]
  evidence: NativeDiffEvidence
}> {
  const status = await terminalRepoStatus()
  const tracked = await terminalRepoDiff()
  const created: string[] = []
  const modified: string[] = []
  const metadataFiles: string[] = []
  const parts: string[] = []
  if (tracked.diff.trim()) parts.push(tracked.diff.trimEnd())

  const root = resolveRepoRoot()
  for (const file of status.changedFiles) {
    const rel = file.path.replace(/\\/g, '/')
    if (isFoundryMetadataPath(rel)) {
      metadataFiles.push(rel)
      continue
    }
    const untracked = file.workTreeStatus === '?' || file.porcelain.trim() === '??'
    if (untracked) {
      created.push(rel)
      try {
        const raw = await readFile(path.join(root, rel), 'utf8')
        const body = raw.length > MAX_UNTRACKED_BYTES ? `${raw.slice(0, MAX_UNTRACKED_BYTES)}\n… truncated` : raw
        const lines = body.split('\n').map(line => `+${line}`).join('\n')
        parts.push(`diff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n${lines}`)
      } catch {
        parts.push(`diff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n+`)
      }
      continue
    }
    modified.push(rel)
  }

  const diff = parts.join('\n')
  return {
    diff,
    created,
    modified,
    metadataFiles,
    evidence: {
      diff,
      truncated: Boolean(tracked.truncated),
      changedFiles: [...created, ...modified],
      diffHash: createHash('sha256').update(diff.slice(0, 64 * 1024), 'utf8').digest('hex').slice(0, 32),
    },
  }
}
