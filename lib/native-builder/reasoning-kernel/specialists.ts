/**
 * Specialist roles and evidence-based worker selection.
 * FRK remains the mission owner. There is no universal model ranking.
 */
import { recordWorkerDisagreement } from './search'
import type { FoundryWorkerCandidate, FoundryWorkerCapabilityEvidence, FrkSpecialistRole } from './program-types'
import { FRK_SPECIALIST_ROLES } from './program-types'
import { nextSessionId } from './session'
import type { FoundryReasoningSession, FrkDepth } from './types'

export function specialistRoles(): readonly FrkSpecialistRole[] {
  return FRK_SPECIALIST_ROLES
}

export function specialistsForDepth(depth: FrkDepth | null): FrkSpecialistRole[] {
  if (depth === 'R3') return ['CODE_ENGINEER', 'REVIEWER']
  if (depth === 'R4') return ['ARCHITECT', 'DEBUGGER', 'REVIEWER', 'VERIFIER']
  if (depth === 'R2') return ['CODE_ENGINEER']
  return ['CODE_ENGINEER']
}

export function recordWorkerCapability(session: FoundryReasoningSession, input: FoundryWorkerCapabilityEvidence): void {
  session.workerEvidence.push(input)
}

export function selectWorker(candidates: FoundryWorkerCandidate[], evidence: FoundryWorkerCapabilityEvidence[], need: { role: FrkSpecialistRole; privacy: 'local' | 'remote' | 'any'; localRequired: boolean }): { ok: true; provider: string; model: string } | { ok: false; reason: string } {
  const fitting = candidates.filter(candidate => {
    if (!candidate.available) return false
    if (!candidate.taskTypes.includes(need.role)) return false
    if (need.localRequired && !candidate.local) return false
    if (need.privacy !== 'any' && candidate.privacy !== need.privacy) return false
    return true
  })
  if (!fitting.length) return { ok: false, reason: 'No available worker matches the task constraints.' }
  const ranked = [...fitting].sort((left, right) => factualWorkerOrder(left, right, evidence, need.role))
  const chosen = ranked[0]
  return { ok: true, provider: chosen.provider, model: chosen.model }
}

function factualWorkerOrder(left: FoundryWorkerCandidate, right: FoundryWorkerCandidate, evidence: FoundryWorkerCapabilityEvidence[], role: FrkSpecialistRole): number {
  const leftHits = evidence.filter(item => item.provider === left.provider && item.model === left.model && item.success && item.capabilityFamily === 'ROOT_CAUSE_DIAGNOSIS').length
  const rightHits = evidence.filter(item => item.provider === right.provider && item.model === right.model && item.success && item.capabilityFamily === 'ROOT_CAUSE_DIAGNOSIS').length
  if (role === 'DEBUGGER' && leftHits !== rightHits) return rightHits - leftHits
  if (left.toolCalls !== right.toolCalls) return left.toolCalls - right.toolCalls
  if (left.tokens !== right.tokens) return left.tokens - right.tokens
  return left.provider.localeCompare(right.provider)
}

export function resolveWorkerDisagreement(session: FoundryReasoningSession, input: { claims: [string, string]; proposedBy: [{ provider: string; model: string }, { provider: string; model: string }] }): { stored: boolean; voted: false } {
  const pair = recordWorkerDisagreement(session, input)
  return { stored: Boolean(pair.first && pair.second), voted: false }
}

export function pinnedWorkerUnavailable(): { status: 'BLOCKED_PROVIDER'; fallback: false } {
  return { status: 'BLOCKED_PROVIDER', fallback: false }
}

export function governedFallback(input: { policyAllowsFallback: boolean; alternateAvailable: boolean }): { ok: boolean; status: 'FALLBACK' | 'BLOCKED_PROVIDER' } {
  if (input.policyAllowsFallback && input.alternateAvailable) return { ok: true, status: 'FALLBACK' }
  return { ok: false, status: 'BLOCKED_PROVIDER' }
}

export function noteSpecialistReview(session: FoundryReasoningSession, role: FrkSpecialistRole, summary: string): string {
  const id = nextSessionId(session, 'specialist')
  session.directionChanges.push(`${role} ${id}: ${summary}`)
  return id
}
