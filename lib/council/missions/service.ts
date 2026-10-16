import { randomUUID } from 'node:crypto'
import type { FoundryMissionView, FoundryPort } from './foundryPort'
import {
  TERMINAL_COUNCIL_MISSION_STATUSES,
  type CouncilMissionFoundrySnapshot,
  type CouncilMissionProposal,
  type CouncilMissionStatus,
  type CouncilMissionTarget,
} from './types'

/** Persistence of proposals: they live in the owning conversation's metadata (owner scoped, survives restart, travels with Trash/restore). */
export type CouncilMissionStorage = {
  read(): CouncilMissionProposal[] | null
  write(next: CouncilMissionProposal[]): void
  /** durable message in the same conversation (the result is returned into the thread through this) */
  postMessage(input: { role: 'assistant'; family: string; content: string; metadata: Record<string, unknown> }): { id: string | null }
}

export class CouncilMissionError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND' | 'ILLEGAL' | 'UNAVAILABLE', message: string) { super(message) }
}

const nowIso = () => new Date().toISOString()
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9_@.\-/]{1,200}$/

export function safeRelativePath(p: string): string | null {
  const t = p.trim().replace(/^\.\//, '')
  if (!t || t.includes('//') || !SAFE_PATH.test(t)) return null
  return t
}

export type ProposalInput = {
  conversationId: string
  title?: string
  request: string
  acceptance?: string[]
  targets?: Array<{ path: string; action?: string }>
  scopePaths?: string[]
  scopeWrite?: string[]
  discussion?: { messageIds?: string[]; contributors?: Array<{ member: string; model: string | null }>; excerpt?: string }
}

export function buildProposal(input: ProposalInput): CouncilMissionProposal {
  const request = String(input.request ?? '').trim()
  if (request.length < 10) throw new CouncilMissionError('INVALID', 'The mission request needs at least a sentence describing what to build or fix.')
  if (request.length > 4000) throw new CouncilMissionError('INVALID', 'The mission request is too long (4000 characters max).')
  const stated = (input.acceptance ?? []).map(a => String(a).trim()).filter(Boolean).slice(0, 10).map(a => a.slice(0, 300))
  // Foundry requires at least one testable criterion; when the Commander gave none, state the default one explicitly rather than failing at start.
  const acceptance = stated.length ? stated : ['The change described in the request is implemented and the repository\'s own tests and checks pass.']
  const targets: CouncilMissionTarget[] = []
  for (const t of (input.targets ?? []).slice(0, 20)) {
    const p = safeRelativePath(String(t.path ?? ''))
    if (!p) throw new CouncilMissionError('INVALID', `Unsafe or invalid target path: ${String(t.path ?? '').slice(0, 80)}`)
    if (!targets.some(x => x.path === p)) targets.push({ path: p, action: t.action === 'create' ? 'create' : 'modify' })
  }
  const clean = (list: string[] | undefined) => {
    const out: string[] = []
    for (const raw of (list ?? []).slice(0, 40)) {
      const p = safeRelativePath(String(raw))
      if (!p) throw new CouncilMissionError('INVALID', `Unsafe or invalid scope path: ${String(raw).slice(0, 80)}`)
      if (!out.includes(p)) out.push(p)
    }
    return out
  }
  const paths = clean(input.scopePaths?.length ? input.scopePaths : targets.map(t => t.path))
  const write = clean(input.scopeWrite?.length ? input.scopeWrite : targets.map(t => t.path))
  const title = String(input.title ?? '').trim().slice(0, 120) || request.slice(0, 80)
  return {
    proposalId: `cm_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    conversationId: input.conversationId,
    createdAt: nowIso(),
    title,
    request,
    acceptance,
    targets,
    scope: { paths, write },
    install: false, // installing a result is a separate Commander decision; a Council proposal never asks for it
    discussion: {
      messageIds: (input.discussion?.messageIds ?? []).slice(0, 40).map(String),
      contributors: (input.discussion?.contributors ?? []).slice(0, 12),
      excerpt: String(input.discussion?.excerpt ?? '').slice(0, 600),
    },
    status: 'PROPOSED',
    statusReason: 'Drafted from the Council discussion; waiting for Commander approval.',
    approval: null,
    rejection: null,
    foundry: null,
    resultReturned: null,
  }
}

function snapshotOf(view: FoundryMissionView): CouncilMissionFoundrySnapshot {
  const r = view.receipt
  return {
    missionId: view.id,
    state: view.state,
    stateReason: view.stateReason,
    stateAt: view.stateAt,
    progress: view.progress ?? null,
    result: view.result ?? null,
    receipt: r
      ? {
          receiptSha256: r.receiptSha256,
          verifier: r.verifier,
          integration: r.integration,
          filesCreated: r.filesCreated.map(f => f.path),
          filesModified: r.filesModified.map(f => f.path),
          testsAdded: r.testsAdded,
          receiptVerified: view.receiptCheck !== undefined && view.receiptCheck !== 'NO_RECEIPT' && view.receiptCheck.ok === true,
        }
      : null,
    syncedAt: nowIso(),
  }
}

/**
 * The ONLY place a Council proposal status is derived from Foundry. COMPLETED requires Foundry's own record: mission state COMPLETED,
 * a result of COMPLETED, a change receipt whose independent verifier exited 0, and a receipt that re-verifies against the workspace.
 */
export function statusFromFoundry(view: FoundryMissionView): { status: CouncilMissionStatus; reason: string } {
  const s = view.state
  if (s === 'QUEUED' || s === 'RUNNING' || s === 'VERIFYING' || s === 'APPLYING' || s === 'INSTALLING') return { status: 'RUNNING', reason: `Foundry mission ${s.toLowerCase()}: ${view.stateReason}` }
  if (s === 'INTERRUPTED') return { status: 'INTERRUPTED', reason: `Foundry reports the run was interrupted: ${view.stateReason}` }
  if (s === 'CANCELLED') return { status: 'CANCELLED', reason: `Foundry mission cancelled: ${view.stateReason}` }
  if (s === 'FAILED') return { status: 'FAILED', reason: `Foundry mission failed: ${view.stateReason}` }
  if (s === 'COMPLETED') {
    const verifierPassed = view.receipt?.verifier.exitCode === 0
    const resultOk = view.result?.status === 'COMPLETED'
    const receiptOk = view.receiptCheck !== undefined && view.receiptCheck !== 'NO_RECEIPT' && view.receiptCheck.ok === true
    if (verifierPassed && resultOk && receiptOk) return { status: 'COMPLETED', reason: 'Foundry mission completed; independent verifier passed and the change receipt verifies.' }
    const missing = [!resultOk && 'result is not COMPLETED', !view.receipt && 'no change receipt', view.receipt && !verifierPassed && `verifier exit ${String(view.receipt.verifier.exitCode)}`, !receiptOk && 'receipt not verified'].filter(Boolean).join('; ')
    return { status: 'FAILED', reason: `Foundry reported COMPLETED but its own records do not support completion (${missing}).` }
  }
  return { status: 'RUNNING', reason: `Foundry mission state ${s}: ${view.stateReason}` }
}

export type CouncilMissionService = ReturnType<typeof createCouncilMissionService>

export function createCouncilMissionService(deps: { storage: CouncilMissionStorage; foundry: FoundryPort }) {
  const { storage, foundry } = deps
  const all = () => storage.read() ?? []
  const find = (proposalId: string) => {
    const rows = all()
    const idx = rows.findIndex(p => p.proposalId === proposalId)
    if (idx < 0) throw new CouncilMissionError('NOT_FOUND', `Unknown mission proposal ${proposalId}`)
    return { rows, idx, proposal: rows[idx] }
  }
  const save = (rows: CouncilMissionProposal[], idx: number, next: CouncilMissionProposal) => {
    const copy = rows.slice()
    copy[idx] = next
    storage.write(copy)
    return next
  }

  return {
    list(): CouncilMissionProposal[] { return all() },

    propose(input: ProposalInput): CouncilMissionProposal {
      const proposal = buildProposal(input)
      storage.write([...all(), proposal])
      storage.postMessage({
        role: 'assistant',
        family: 'COUNCIL',
        content: `Mission proposal drafted: "${proposal.title}". Nothing has been started. It needs your approval before Foundry runs it.`,
        metadata: { councilMission: { proposalId: proposal.proposalId, status: proposal.status } },
      })
      return proposal
    },

    reject(proposalId: string, actor: string, reason = 'Commander declined'): CouncilMissionProposal {
      const { rows, idx, proposal } = find(proposalId)
      if (proposal.status !== 'PROPOSED' && proposal.status !== 'START_FAILED') throw new CouncilMissionError('ILLEGAL', `Cannot reject a mission that is ${proposal.status}.`)
      return save(rows, idx, { ...proposal, status: 'REJECTED', statusReason: reason, rejection: { at: nowIso(), by: actor, reason } })
    },

    /** Commander approval: the one and only way a Council proposal reaches Foundry. */
    async approve(proposalId: string, actor: string): Promise<CouncilMissionProposal> {
      const { rows, idx, proposal } = find(proposalId)
      if (proposal.status !== 'PROPOSED' && proposal.status !== 'START_FAILED') {
        throw new CouncilMissionError('ILLEGAL', `Mission proposal is ${proposal.status}; only a proposed mission can be approved.`)
      }
      const approval = { at: nowIso(), by: actor }
      const avail = foundry.availability()
      if (!avail.ok) {
        return save(rows, idx, { ...proposal, status: 'START_FAILED', statusReason: `Foundry is not available: ${avail.reason}`, approval })
      }
      try {
        const started = await foundry.start({
          action: 'start',
          title: proposal.title,
          request: proposal.request,
          acceptance: proposal.acceptance,
          targets: proposal.targets,
          scope: proposal.scope,
          install: false,
        }, actor)
        const view = foundry.get(started.missionId)
        const snap: CouncilMissionFoundrySnapshot = view
          ? snapshotOf(view)
          : { missionId: started.missionId, state: started.state, stateReason: 'accepted by Foundry', stateAt: nowIso(), progress: null, result: null, receipt: null, syncedAt: nowIso() }
        return save(rows, idx, { ...proposal, approval, status: 'RUNNING', statusReason: `Foundry accepted mission ${started.missionId}.`, foundry: snap })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Foundry refused to start the mission'
        return save(rows, idx, { ...proposal, approval, status: 'START_FAILED', statusReason: msg.slice(0, 400) })
      }
    },

    cancel(proposalId: string, actor: string, reason = 'Commander cancelled'): CouncilMissionProposal {
      const { rows, idx, proposal } = find(proposalId)
      if (!proposal.foundry || TERMINAL_COUNCIL_MISSION_STATUSES.includes(proposal.status)) throw new CouncilMissionError('ILLEGAL', `Cannot cancel a mission that is ${proposal.status}.`)
      foundry.cancel(proposal.foundry.missionId, actor, reason)
      return save(rows, idx, { ...proposal, statusReason: 'Cancellation requested from Foundry; waiting for Foundry to confirm.' })
    },

    /**
     * Pull Foundry's authoritative state for every non-terminal proposal, and return a terminal result into the conversation exactly
     * once. Safe to call repeatedly (the UI polls it).
     */
    sync(): CouncilMissionProposal[] {
      let rows = all()
      let changed = false
      rows = rows.map(p => {
        if (!p.foundry || TERMINAL_COUNCIL_MISSION_STATUSES.includes(p.status) && p.resultReturned) return p
        const view = foundry.get(p.foundry.missionId)
        if (!view) {
          if (p.status === 'RUNNING') {
            changed = true
            return { ...p, status: 'FAILED' as const, statusReason: `Foundry has no record of mission ${p.foundry.missionId}.` }
          }
          return p
        }
        const derived = statusFromFoundry(view)
        const snap = snapshotOf(view)
        let next: CouncilMissionProposal = { ...p, status: derived.status, statusReason: derived.reason, foundry: snap }
        const terminal = TERMINAL_COUNCIL_MISSION_STATUSES.includes(next.status)
        if (terminal && !next.resultReturned) {
          const lines = [
            next.status === 'COMPLETED'
              ? `Foundry finished mission "${next.title}" and its records support it.`
              : `Foundry mission "${next.title}" ended ${next.status}. ${next.statusReason}`,
            snap.receipt
              ? `Verifier: ${snap.receipt.verifier.label} exit ${String(snap.receipt.verifier.exitCode)} — ${snap.receipt.verifier.summary}`
              : 'No change receipt was produced.',
            snap.receipt && snap.receipt.integration.state !== 'NOT_RUN'
              ? `Integration: ${snap.receipt.integration.state}${snap.receipt.integration.branch ? ` on ${snap.receipt.integration.branch}` : ''}${snap.receipt.integration.commit ? ` (${snap.receipt.integration.commit.slice(0, 8)})` : ''}.`
              : '',
            snap.receipt && (snap.receipt.filesCreated.length || snap.receipt.filesModified.length)
              ? `Files: ${snap.receipt.filesCreated.length} created, ${snap.receipt.filesModified.length} modified${snap.receipt.testsAdded.length ? `, ${snap.receipt.testsAdded.length} test(s) added` : ''}.`
              : '',
            `Foundry mission ${snap.missionId}${snap.receipt ? ` · receipt ${snap.receipt.receiptSha256.slice(0, 12)}` : ''}.`,
          ].filter(Boolean)
          const posted = storage.postMessage({
            role: 'assistant',
            family: 'FOUNDRY',
            content: lines.join('\n'),
            metadata: {
              councilMission: {
                proposalId: next.proposalId,
                missionId: snap.missionId,
                status: next.status,
                receiptSha256: snap.receipt?.receiptSha256 ?? null,
                verifierExit: snap.receipt?.verifier.exitCode ?? null,
              },
              roundRequestId: `council-mission-result-${next.proposalId}`,
            },
          })
          next = { ...next, resultReturned: { at: nowIso(), messageId: posted.id } }
        }
        if (JSON.stringify(next) !== JSON.stringify(p)) changed = true
        return next
      })
      if (changed) storage.write(rows)
      return rows
    },
  }
}
