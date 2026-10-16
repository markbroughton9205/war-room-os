/**
 * Truthful progress signals for the immersive Council.
 * A star is derived ONLY from authoritative records (the Council round record, the research accounting, Foundry's own mission
 * state/result/receipt, the browser broker control state). Nothing here animates on a timer or implies success: `verified` is only
 * produced when the record itself carries the evidence (verifier exit 0 AND a verified receipt), and every star states its evidence.
 */
export type StarKind = 'council' | 'research' | 'mission' | 'computer' | 'request'
export type StarState = 'idle' | 'active' | 'pending' | 'partial' | 'done' | 'verified' | 'blocked' | 'failed'

export type ProgressStar = {
  id: string
  kind: StarKind
  state: StarState
  label: string
  /** What record this star is derived from (shown to the Commander on focus/hover). */
  evidence: string
}

export type RoundPhase = 'idle' | 'researching' | 'deliberating' | 'synthesizing' | 'failed' | 'done'

export type StarMissionInput = {
  proposalId: string
  title: string
  /** Council-side status (already derived from Foundry's records by lib/council/missions). */
  status: 'PROPOSED' | 'START_FAILED' | 'RUNNING' | 'INTERRUPTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REJECTED'
  foundry?: {
    missionId: string
    state: string
    verifierExit?: number | null
    receiptVerified?: boolean
  } | null
}

export type StarInput = {
  round: { phase: RoundPhase; reason?: string | null; members?: string[] }
  /** RESPONDED: sources answered but nothing was independently checked (the live HUD's own wording). UNAVAILABLE: could not run, which is not the same as failing. */
  research?: { active: boolean; mode?: string | null; status?: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'RESPONDED' | 'UNAVAILABLE' | null; accepted?: number; considered?: number; responded?: number } | null
  /** Council continuation requests (Allow / Summarize / Hold / Deny) waiting on the Commander. */
  pendingRequests?: number
  missions?: StarMissionInput[]
  computer?: { controlState: string; url?: string | null } | null
}

const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function deriveProgressStars(input: StarInput): ProgressStar[] {
  const stars: ProgressStar[] = []

  const { round } = input
  const memberText = round.members?.length ? ` (${round.members.slice(0, 5).join(', ')})` : ''
  const councilMap: Record<RoundPhase, Pick<ProgressStar, 'state' | 'label'>> = {
    idle: { state: 'idle', label: 'Council idle' },
    researching: { state: 'active', label: 'Council gathering evidence' },
    deliberating: { state: 'active', label: `Council deliberating${memberText}` },
    synthesizing: { state: 'active', label: 'Council synthesizing' },
    failed: { state: 'failed', label: `Council round failed${round.reason ? `: ${clip(round.reason, 60)}` : ''}` },
    // A finished discussion is "done", never "verified": nobody checked its claims.
    done: { state: 'done', label: 'Council round finished' },
  }
  stars.push({ id: 'council', kind: 'council', ...councilMap[round.phase], evidence: 'Council round record' })

  const r = input.research
  if (r && (r.active || r.status)) {
    if (r.active && !r.status) {
      stars.push({ id: 'research', kind: 'research', state: 'active', label: 'Research active', evidence: 'Research router is running for this turn' })
    } else if (r.status === 'COMPLETED') {
      const ok = (r.accepted ?? 0) >= 2
      stars.push({ id: 'research', kind: 'research', state: ok ? 'verified' : 'partial', label: ok ? `Research complete — ${r.accepted} accepted source(s)` : 'Research marked complete without enough accepted sources', evidence: `Research accounting: ${r.accepted ?? 0} accepted of ${r.considered ?? 0} considered` })
    } else if (r.status === 'RESPONDED') {
      stars.push({ id: 'research', kind: 'research', state: 'partial', label: `Research: ${r.responded ?? 0} source(s) responded — not independently checked`, evidence: 'Live research HUD (sources responded; no accepted-source accounting)' })
    } else if (r.status === 'UNAVAILABLE') {
      stars.push({ id: 'research', kind: 'research', state: 'blocked', label: 'Research unavailable for this turn', evidence: 'Live research HUD (unavailable)' })
    } else if (r.status === 'PARTIAL') {
      stars.push({ id: 'research', kind: 'research', state: 'partial', label: `Research partial — ${r.accepted ?? 0} accepted of ${r.considered ?? 0}`, evidence: 'Research accounting (status PARTIAL)' })
    } else {
      stars.push({ id: 'research', kind: 'research', state: 'failed', label: 'Research failed — no accepted sources', evidence: 'Research accounting (status FAILED)' })
    }
  }

  for (const m of (input.missions ?? []).slice(0, 6)) {
    if (m.status === 'REJECTED') continue
    const id = `mission:${m.proposalId}`
    const title = clip(m.title)
    const f = m.foundry
    const fstate = f?.state ?? null
    if (m.status === 'PROPOSED') {
      stars.push({ id, kind: 'mission', state: 'pending', label: `Mission awaiting your approval: ${title}`, evidence: 'Proposal record (nothing started)' })
    } else if (m.status === 'START_FAILED') {
      stars.push({ id, kind: 'mission', state: 'blocked', label: `Mission could not start: ${title}`, evidence: 'Foundry refused or was unavailable at start' })
    } else if (m.status === 'RUNNING') {
      const verifying = fstate === 'VERIFYING'
      stars.push({ id, kind: 'mission', state: 'active', label: verifying ? `Verification underway: ${title}` : `Foundry mission running: ${title}`, evidence: `Foundry mission ${f?.missionId ?? '?'} state ${fstate ?? 'unknown'}` })
    } else if (m.status === 'INTERRUPTED') {
      stars.push({ id, kind: 'mission', state: 'blocked', label: `Mission interrupted: ${title}`, evidence: `Foundry mission ${f?.missionId ?? '?'} state INTERRUPTED` })
    } else if (m.status === 'CANCELLED') {
      stars.push({ id, kind: 'mission', state: 'blocked', label: `Mission cancelled: ${title}`, evidence: `Foundry mission ${f?.missionId ?? '?'} state CANCELLED` })
    } else if (m.status === 'FAILED') {
      stars.push({ id, kind: 'mission', state: 'failed', label: `Mission failed: ${title}`, evidence: `Foundry mission ${f?.missionId ?? '?'} state ${fstate ?? 'FAILED'}` })
    } else if (m.status === 'COMPLETED') {
      // Both pieces of evidence must be present on the record itself.
      const proven = f?.verifierExit === 0 && f?.receiptVerified === true && fstate === 'COMPLETED'
      stars.push(proven
        ? { id, kind: 'mission', state: 'verified', label: `Mission verified: ${title}`, evidence: `Foundry mission ${f.missionId}: verifier exit 0 and receipt verified` }
        : { id, kind: 'mission', state: 'partial', label: `Mission reported complete but not proven: ${title}`, evidence: 'Foundry record lacks verifier exit 0 and/or a verified receipt' })
    }
  }

  if ((input.pendingRequests ?? 0) > 0) {
    const n = input.pendingRequests!
    stars.push({ id: 'requests', kind: 'request', state: 'pending', label: `${n} Council request${n === 1 ? '' : 's'} waiting for you`, evidence: 'Continuation request records with status pending (open Conversation to answer)' })
  }

  const c = input.computer
  if (c) {
    if (c.controlState === 'COMMANDER_CONTROL') stars.push({ id: 'computer', kind: 'computer', state: 'active', label: 'You hold the Council computer', evidence: 'Browser broker control state COMMANDER_CONTROL' })
    else if (c.controlState === 'AGENT_CONTROL') stars.push({ id: 'computer', kind: 'computer', state: 'active', label: `Council computer open${c.url ? `: ${clip(c.url, 40)}` : ''}`, evidence: 'Browser broker control state AGENT_CONTROL' })
  }
  return stars
}

/** Round phase from the observable client state: only phases the app can actually see. */
export function roundPhaseFrom(input: { loading: boolean; presence: string | null | undefined; researchActive: boolean; failed: boolean; hasReply: boolean; failReason?: string | null }): { phase: RoundPhase; reason: string | null } {
  if (input.failed) return { phase: 'failed', reason: input.failReason ?? null }
  const p = (input.presence ?? '').toLowerCase()
  if (input.researchActive) return { phase: 'researching', reason: null }
  if (/synthes/.test(p)) return { phase: 'synthesizing', reason: null }
  if (input.loading || /deliberat|thinking|streaming|respond|understanding|verifying/.test(p)) return { phase: 'deliberating', reason: null }
  return { phase: input.hasReply ? 'done' : 'idle', reason: null }
}
