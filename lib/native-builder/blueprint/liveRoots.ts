/** Blueprint data roots under the existing War Room application-data hierarchy (never a second data root). */
import path from 'node:path'
import { foundryDataHierarchy } from '../foundryPaths'

export type BlueprintRoots = {
  root: string
  /** Durable control plane (approvals, leases, cancels, effect ledger, broker packages/exec/outbox). */
  control: string
  /** Core run evidence (receipts, snapshots) - outside every workspace. */
  evidence: string
  /** Host-owned tool scripts materialized from embeddedTools.generated.ts (hash-pinned). */
  tools: string
  /** Commander dependency approvals (sealed records). */
  dependencyApprovals: string
  /** Blueprint-owned lease epoch journal (live REPO_WRITE claims carry no epoch). */
  leaseEpochs: string
  /** The shared REPO_WRITE registry used by Foundry missions (same file, same guard protocol). */
  repoWriteRegistry: string
}

export function blueprintRoots(): BlueprintRoots {
  const f = foundryDataHierarchy()
  const root = path.join(f.foundryRoot, 'blueprints')
  return {
    root,
    control: path.join(root, 'control'),
    evidence: path.join(root, 'evidence'),
    tools: path.join(root, 'tools'),
    dependencyApprovals: path.join(root, 'dependency-approvals'),
    leaseEpochs: path.join(root, 'lease-epochs.json'),
    repoWriteRegistry: path.join(f.resourceLocks, 'REPO_WRITE.json'),
  }
}
