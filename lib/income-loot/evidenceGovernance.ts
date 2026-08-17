import type { EvidenceTruthState, IncomeLootEvidenceTransitionAudit, IncomeLootEvidenceTransitionRequest, IncomeLootEvidenceTransitionResult } from './types'
import { applyIncomeLootEvidenceTruthStateForOwner, getIncomeLootEvidenceForOwner } from './evidenceStore'

const history: IncomeLootEvidenceTransitionAudit[] = []
const HISTORY_CAP = 500
const allowedTransitions: Readonly<Record<EvidenceTruthState, readonly EvidenceTruthState[]>> = {
  CAPTURED: ['REVIEWED', 'REJECTED'],
  REVIEWED: ['VERIFIED', 'REJECTED'],
  VERIFIED: [],
  REJECTED: [],
}

function denied(request: IncomeLootEvidenceTransitionRequest, previousState: EvidenceTruthState, code: IncomeLootEvidenceTransitionResult['code']): IncomeLootEvidenceTransitionResult {
  return { changed: false, previousState, currentState: previousState, targetState: request.targetState, code, transition: null }
}

function hasAuthority(request: IncomeLootEvidenceTransitionRequest): IncomeLootEvidenceTransitionResult['code'] | null {
  if (!request.actorId.trim()) return 'AUTHORITY_REQUIRED'
  if (request.authority === 'COMMANDER') return null
  if (request.targetState === 'VERIFIED') return 'COMMANDER_APPROVAL_REQUIRED'
  if (request.authority === 'OWNER') return request.targetState === 'REVIEWED' || request.targetState === 'REJECTED' ? null : 'AUTHORITY_REQUIRED'
  return request.targetState === 'REVIEWED' && request.workforceReviewAuthorized === true ? null : 'AUTHORITY_REQUIRED'
}

export function transitionIncomeLootEvidenceTruthState(request: IncomeLootEvidenceTransitionRequest, now: () => string = () => new Date().toISOString()): IncomeLootEvidenceTransitionResult {
  const current = getIncomeLootEvidenceForOwner(request.ownerUserId, request.evidenceId)
  if (!current) return { changed: false, previousState: null, currentState: null, targetState: request.targetState, code: 'EVIDENCE_NOT_FOUND', transition: null }
  if (current.truthState === request.targetState) return denied(request, current.truthState, 'NO_CHANGE')
  if (!allowedTransitions[current.truthState].includes(request.targetState)) return denied(request, current.truthState, 'TRANSITION_NOT_ALLOWED')
  const authorityError = hasAuthority(request)
  if (authorityError) return denied(request, current.truthState, authorityError)
  const transition: IncomeLootEvidenceTransitionAudit = { evidenceId: current.id, ownerUserId: current.ownerUserId, fromState: current.truthState, toState: request.targetState, actorId: request.actorId, authority: request.authority, transitionedAt: now(), reason: request.reason ?? null }
  const updated = applyIncomeLootEvidenceTruthStateForOwner(request.ownerUserId, request.evidenceId, request.targetState)
  if (!updated) return { changed: false, previousState: null, currentState: null, targetState: request.targetState, code: 'EVIDENCE_NOT_FOUND', transition: null }
  history.unshift(transition)
  if (history.length > HISTORY_CAP) history.splice(HISTORY_CAP)
  return { changed: true, previousState: transition.fromState, currentState: updated.truthState, targetState: request.targetState, code: 'TRANSITION_APPLIED', transition }
}

export function listIncomeLootEvidenceTransitionHistoryForOwner(ownerUserId: string): IncomeLootEvidenceTransitionAudit[] {
  return history.filter(entry => entry.ownerUserId === ownerUserId)
}

export function __resetIncomeLootEvidenceTransitionHistory(): void {
  history.splice(0)
}
