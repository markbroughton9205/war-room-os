/**
 * Detect overlapping files, schema, API, and test conflicts before combining parallel results.
 * Never silently overwrite one agent with another.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { FoundryCommandCenterGraph, FoundryTaskArtifact, FoundryWorkspaceRecord } from './foundryAgentTypes'

export type FoundryConflict = {
  kind: 'files' | 'schema' | 'api' | 'tests' | 'dependency'
  path: string
  leftAgentId: string
  rightAgentId: string
  detail: string
}

export function detectWorkspaceConflicts(graph: FoundryCommandCenterGraph): FoundryConflict[] {
  const conflicts: FoundryConflict[] = []
  const mutating = graph.workspaces.filter(ws => ws.kind !== 'project-root' && ws.mergeStatus === 'UNMERGED')
  for (let i = 0; i < mutating.length; i++) {
    for (let j = i + 1; j < mutating.length; j++) {
      const left = mutating[i]
      const right = mutating[j]
      if (left.projectId !== right.projectId) continue
      const overlap = left.filesChanged.filter(file => right.filesChanged.includes(file))
      for (const file of overlap) {
        const leftText = readIf(left, file)
        const rightText = readIf(right, file)
        if (leftText === rightText) continue
        conflicts.push({
          kind: file.endsWith('schema.json') || file === 'db.mjs' ? 'schema' : file.includes('contracts/api') ? 'api' : file.includes('test') ? 'tests' : 'files',
          path: file,
          leftAgentId: left.agentId,
          rightAgentId: right.agentId,
          detail: `Overlapping writes to ${file} differ between ${left.workspaceId} and ${right.workspaceId}.`,
        })
      }
    }
  }
  const contracts = graph.artifacts.filter(item => item.kind === 'api_contract')
  if (contracts.length >= 2 && contracts[0].body !== contracts[1].body) {
    conflicts.push({
      kind: 'api',
      path: '.foundry/contracts/api.json',
      leftAgentId: contracts[0].agentId || 'unknown',
      rightAgentId: contracts[1].agentId || 'unknown',
      detail: 'API contract disagreement between artifacts.',
    })
  }
  return conflicts
}

export function conflictArtifact(graphId: string, conflicts: FoundryConflict[]): FoundryTaskArtifact {
  return {
    artifactId: `conflict-${graphId}`,
    kind: 'blocker',
    title: conflicts.length ? 'Merge conflicts detected' : 'No merge conflicts',
    body: conflicts.length ? JSON.stringify(conflicts, null, 2) : 'No overlapping divergent writes.',
    createdAt: new Date().toISOString(),
    taskId: graphId,
  }
}

function readIf(workspace: FoundryWorkspaceRecord, rel: string): string | null {
  const abs = path.join(workspace.sourceRoot, rel)
  if (!existsSync(abs)) return null
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}
