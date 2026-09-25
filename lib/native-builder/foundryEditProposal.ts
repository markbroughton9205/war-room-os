/**
 * Foundry Workbench W2 structured edit proposals.
 * Server-owned records. Renderer/adapter cannot be apply authority.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import { refuseIfDirtyCommanderBuffer } from './foundryWorkbenchDirtyGuard'
import { executeEngineerTool } from './engineerTools'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import {
  applyRangeReplacement,
  extractRangeText,
  hashEditorText,
  type FoundryEditorContextEnvelope,
  type FoundryEditorSelection,
} from './foundryEditorContext'
import { appendFoundryWorkbenchEvent } from './foundryWorkbenchEvents'

export const FOUNDRY_EDIT_PROPOSAL_STATUSES = [
  'PROPOSED',
  'ACCEPTED',
  'REJECTED',
  'STALE',
  'APPLIED',
  'FAILED',
] as const

export type FoundryEditProposalStatus = (typeof FOUNDRY_EDIT_PROPOSAL_STATUSES)[number]
export type FoundryEditChangeKind = 'MODIFY' | 'CREATE'

export type FoundryEditChange = {
  kind: FoundryEditChangeKind
  filePath: string
  baseFileHash: string | null
  selectionRange: FoundryEditorSelection | null
  originalTextHash: string | null
  replacementText: string
  reason: string
}

export type FoundryEditProposal = {
  proposalId: string
  projectId: string
  workspaceId: string
  workspaceRoot: string
  filePath: string
  baseFileHash: string | null
  selectionRange: FoundryEditorSelection | null
  instruction: string
  originalTextHash: string | null
  replacementText: string
  reason: string
  modelProvider: string
  modelId: string | null
  createdAt: string
  updatedAt: string
  status: FoundryEditProposalStatus
  kind: FoundryEditChangeKind
  changes: FoundryEditChange[]
  writeSet: string[]
  commanderAcceptedAt?: string | null
  toolBroker?: { ok: boolean; tool?: string; error?: string | null; result?: unknown }
  failureCode?: string | null
}

export type FoundryProposalApplyResult = {
  ok: boolean
  proposal: FoundryEditProposal
  code?: string
  error?: string
}

function proposalsDir(): string {
  const dir = path.join(foundryDataHierarchy().foundryRoot, 'workbench', 'proposals')
  mkdirSync(dir, { recursive: true })
  return dir
}

function proposalPath(id: string): string {
  return path.join(proposalsDir(), `${id}.json`)
}

function activePath(): string {
  return path.join(foundryDataHierarchy().foundryRoot, 'workbench', 'active-proposal.json')
}

function relToWorkspace(root: string, filePath: string): string {
  const abs = path.resolve(root, filePath)
  const base = path.resolve(root)
  if (abs === base) return '.'
  if (abs.startsWith(base + path.sep)) return abs.slice(base.length + 1).split(path.sep).join('/')
  return filePath.split(path.sep).join('/')
}

function absInWorkspace(root: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return path.resolve(filePath)
  return path.resolve(root, filePath)
}

function readDisk(root: string, filePath: string): { exists: boolean; content: string } {
  const abs = absInWorkspace(root, filePath)
  if (!existsSync(abs)) return { exists: false, content: '' }
  return { exists: true, content: readFileSync(abs, 'utf8') }
}

export function persistFoundryEditProposal(proposal: FoundryEditProposal): FoundryEditProposal {
  proposal.updatedAt = new Date().toISOString()
  writeFileSync(proposalPath(proposal.proposalId), `${JSON.stringify(proposal, null, 2)}\n`)
  writeFileSync(activePath(), `${JSON.stringify({ proposalId: proposal.proposalId, status: proposal.status, updatedAt: proposal.updatedAt }, null, 2)}\n`)
  return proposal
}

export function loadFoundryEditProposal(proposalId: string): FoundryEditProposal | null {
  const file = proposalPath(proposalId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as FoundryEditProposal
  } catch {
    return null
  }
}

export function listFoundryEditProposals(): FoundryEditProposal[] {
  const dir = proposalsDir()
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => {
        try {
          return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as FoundryEditProposal
        } catch {
          return null
        }
      })
      .filter((item): item is FoundryEditProposal => Boolean(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } catch {
    return []
  }
}

export function createFoundryEditProposal(input: {
  envelope: FoundryEditorContextEnvelope
  instruction: string
  reason: string
  replacementText: string
  kind?: FoundryEditChangeKind
  filePath?: string
  modelProvider: string
  modelId?: string | null
  extraChanges?: FoundryEditChange[]
}): FoundryEditProposal {
  const filePath = relToWorkspace(input.envelope.workspaceRoot, input.filePath || input.envelope.activeFile || 'untitled.ts')
  const kind = input.kind ?? 'MODIFY'
  const change: FoundryEditChange = {
    kind,
    filePath,
    baseFileHash: input.envelope.fileHash ?? null,
    selectionRange: kind === 'MODIFY' ? input.envelope.selection : null,
    originalTextHash: input.envelope.originalTextHash ?? null,
    replacementText: input.replacementText,
    reason: input.reason,
  }
  const changes = [change, ...(input.extraChanges ?? [])]
  const proposal: FoundryEditProposal = {
    proposalId: randomUUID(),
    projectId: input.envelope.projectId,
    workspaceId: input.envelope.workspaceId,
    workspaceRoot: input.envelope.workspaceRoot,
    filePath,
    baseFileHash: change.baseFileHash,
    selectionRange: change.selectionRange,
    instruction: input.instruction,
    originalTextHash: change.originalTextHash,
    replacementText: input.replacementText,
    reason: input.reason,
    modelProvider: input.modelProvider,
    modelId: input.modelId ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'PROPOSED',
    kind,
    changes,
    writeSet: [...new Set(changes.map(item => item.filePath))],
    commanderAcceptedAt: null,
    failureCode: null,
  }
  persistFoundryEditProposal(proposal)
  appendFoundryWorkbenchEvent('AI_EDIT_PROPOSED', input.reason, { proposalId: proposal.proposalId, path: filePath })
  return proposal
}

function mark(proposal: FoundryEditProposal, status: FoundryEditProposalStatus, extra?: Partial<FoundryEditProposal>): FoundryEditProposal {
  const next = { ...proposal, ...extra, status }
  persistFoundryEditProposal(next)
  return next
}

export function rejectFoundryEditProposal(proposalId: string): FoundryProposalApplyResult {
  const proposal = loadFoundryEditProposal(proposalId)
  if (!proposal) return { ok: false, proposal: null as unknown as FoundryEditProposal, code: 'MISSING', error: 'Proposal not found.' }
  if (proposal.status === 'APPLIED') {
    return { ok: false, proposal, code: 'ALREADY_APPLIED', error: 'Proposal already applied.' }
  }
  const rejected = mark(proposal, 'REJECTED')
  appendFoundryWorkbenchEvent('AI_EDIT_REJECTED', 'Commander rejected proposal', { proposalId, path: proposal.filePath })
  return { ok: true, proposal: rejected }
}

function verifyChange(root: string, change: FoundryEditChange): { ok: boolean; code?: string; error?: string; current?: string } {
  const disk = readDisk(root, change.filePath)
  if (change.kind === 'CREATE') {
    if (disk.exists) {
      return { ok: false, code: 'EDIT_PROPOSAL_STALE', error: 'CREATE target already exists; refuse overwrite.' }
    }
    return { ok: true, current: '' }
  }
  if (!disk.exists) {
    return { ok: false, code: 'EDIT_PROPOSAL_STALE', error: 'MODIFY target is missing.' }
  }
  const currentHash = hashEditorText(disk.content)
  if (change.baseFileHash && change.baseFileHash !== currentHash) {
    return { ok: false, code: 'EDIT_PROPOSAL_STALE', error: 'EDIT_PROPOSAL_STALE: base file hash mismatch.', current: disk.content }
  }
  if (change.selectionRange && change.originalTextHash) {
    const slice = extractRangeText(disk.content, change.selectionRange)
    if (hashEditorText(slice) !== change.originalTextHash) {
      return { ok: false, code: 'EDIT_PROPOSAL_STALE', error: 'EDIT_PROPOSAL_STALE: selection range changed.', current: disk.content }
    }
  }
  return { ok: true, current: disk.content }
}

function nextContent(current: string, change: FoundryEditChange): string {
  if (change.kind === 'CREATE') return change.replacementText
  if (change.selectionRange) return applyRangeReplacement(current, change.selectionRange, change.replacementText)
  return change.replacementText
}

export async function acceptFoundryEditProposal(proposalId: string, options?: { replacementOverride?: string }): Promise<FoundryProposalApplyResult> {
  const stored = loadFoundryEditProposal(proposalId)
  if (!stored) return { ok: false, proposal: null as unknown as FoundryEditProposal, code: 'MISSING', error: 'Proposal not found.' }
  if (options?.replacementOverride && options.replacementOverride !== stored.replacementText) {
    return { ok: false, proposal: stored, code: 'RENDERER_CONTENT_UNTRUSTED', error: 'Accept uses server-stored replacement only.' }
  }
  if (stored.status === 'REJECTED') {
    return { ok: false, proposal: stored, code: 'REJECTED', error: 'Rejected proposal cannot be applied.' }
  }
  if (stored.status === 'APPLIED') {
    return { ok: true, proposal: stored }
  }
  const accepted = mark(stored, 'ACCEPTED', { commanderAcceptedAt: new Date().toISOString() })
  appendFoundryWorkbenchEvent('AI_EDIT_ACCEPTED', 'Commander accepted proposal', { proposalId, path: stored.filePath })

  for (const change of accepted.changes) {
    const abs = absInWorkspace(accepted.workspaceRoot, change.filePath)
    const dirty = refuseIfDirtyCommanderBuffer(abs)
    if (dirty.blocked) {
      const failed = mark(accepted, 'FAILED', { failureCode: 'DIRTY_COMMANDER_BUFFER', toolBroker: { ok: false, error: dirty.reason } })
      appendFoundryWorkbenchEvent('AI_EDIT_FAILED', dirty.reason || 'DIRTY_COMMANDER_BUFFER', { proposalId, path: change.filePath })
      return { ok: false, proposal: failed, code: 'DIRTY_COMMANDER_BUFFER', error: dirty.reason }
    }
    const verified = verifyChange(accepted.workspaceRoot, change)
    if (!verified.ok) {
      const stale = mark(accepted, 'STALE', { failureCode: verified.code })
      appendFoundryWorkbenchEvent('AI_EDIT_STALE', verified.error || 'stale', { proposalId, path: change.filePath })
      return { ok: false, proposal: stale, code: verified.code, error: verified.error }
    }
  }

  for (const change of accepted.changes) {
    const verified = verifyChange(accepted.workspaceRoot, change)
    const content = nextContent(verified.current ?? '', change)
    const rel = relToWorkspace(accepted.workspaceRoot, change.filePath)
    const broker = await runWithWorkspaceRoot(accepted.workspaceRoot, () => executeEngineerTool({
      tool: 'file.write',
      input: { path: rel, content, reason: `W2 ${change.kind}: ${change.reason}` },
    }, { repairId: `w2-${accepted.proposalId}` }))
    if (!broker.ok) {
      const failed = mark(accepted, 'FAILED', {
        failureCode: broker.error?.includes('DIRTY_COMMANDER_BUFFER') ? 'DIRTY_COMMANDER_BUFFER' : 'TOOL_BROKER_FAILED',
        toolBroker: { ok: false, tool: 'file.write', error: broker.error ?? 'write failed' },
      })
      appendFoundryWorkbenchEvent('AI_EDIT_FAILED', broker.error || 'Tool Broker failed', { proposalId, path: rel })
      return { ok: false, proposal: failed, code: failed.failureCode || 'TOOL_BROKER_FAILED', error: broker.error }
    }
    accepted.toolBroker = { ok: true, tool: 'file.write', error: null, result: broker.result }
  }

  const applied = mark(accepted, 'APPLIED', { toolBroker: accepted.toolBroker })
  appendFoundryWorkbenchEvent('AI_EDIT_APPLIED', 'Tool Broker applied proposal', { proposalId, path: accepted.filePath })
  return { ok: true, proposal: applied }
}
