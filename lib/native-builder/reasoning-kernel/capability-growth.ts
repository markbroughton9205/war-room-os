/**
 * Capability gaps, disposable practice, and difficulty progression.
 * Practice does not mutate protected Commander projects or expand authority.
 */
import { nextSessionId } from './session'
import type { FoundryCapabilityGap, FoundryPracticeVariant, FrkFailureClass, FrkFailureLayer } from './program-types'
import type { FoundryReasoningSession, FrkCapability } from './types'

const PROTECTED = ['terra', 'hvs', 'wrim', 'harbor', 'lane & box', 'lane and box', 'inventory', 'higher vision']

export function classifyFailure(input: { failureClass: FrkFailureClass; providerDown?: boolean; budget?: boolean; environment?: boolean; modelMiss?: boolean }): { failureClass: FrkFailureClass; layer: FrkFailureLayer } {
  if (input.providerDown || input.failureClass === 'PROVIDER') return { failureClass: 'PROVIDER', layer: 'PROVIDER' }
  if (input.budget || input.failureClass === 'RESOURCE') return { failureClass: 'RESOURCE', layer: 'RESOURCE' }
  if (input.environment || input.failureClass === 'ENVIRONMENT') return { failureClass: 'ENVIRONMENT', layer: 'ENVIRONMENT' }
  if (input.modelMiss || input.failureClass === 'MODEL_CAPABILITY') return { failureClass: 'MODEL_CAPABILITY', layer: 'MODEL' }
  return { failureClass: input.failureClass, layer: 'PROCESS' }
}

export function openCapabilityGap(session: FoundryReasoningSession, input: {
  capability: FrkCapability
  observedFailure: string
  evidence: string[]
  failureClass: FrkFailureClass
  layer: FrkFailureLayer
}): FoundryCapabilityGap {
  const gap: FoundryCapabilityGap = {
    gapId: nextSessionId(session, 'gap'),
    capability: input.capability,
    observedFailure: input.observedFailure,
    evidence: input.evidence,
    failureClass: input.failureClass,
    failureLayer: input.layer,
    practiceNeeded: true,
    recommendedDifficulty: 'current',
    providerSpecific: input.layer === 'PROVIDER',
    processSpecific: input.layer === 'PROCESS',
    modelSpecific: input.layer === 'MODEL',
    status: 'OPEN',
    practiceIds: [],
    distinctPasses: [],
  }
  session.capabilityGaps.push(gap)
  return gap
}

export function generatePractice(session: FoundryReasoningSession, gap: FoundryCapabilityGap, benchmark: { domain: string; answer: string; names: string[]; layout: string; inputs: string[]; constraints: string[]; failureEvidence: string }): { ok: true; practice: FoundryPracticeVariant } | { ok: false; reason: string } {
  const target = `${benchmark.domain} ${benchmark.names.join(' ')}`.toLowerCase()
  if (PROTECTED.some(name => target.includes(name))) return { ok: false, reason: 'Practice does not run on a protected Commander project.' }
  const practice: FoundryPracticeVariant = {
    practiceId: nextSessionId(session, 'practice-variant'),
    domain: benchmark.domain === 'orders' ? 'shipments' : 'inventory-transfers',
    names: benchmark.names.map(name => `practice-${name}`),
    layout: benchmark.layout === 'table' ? 'queue' : 'ledger',
    inputs: benchmark.inputs.map(item => `alt-${item}`),
    constraints: [...benchmark.constraints, 'practice-only'],
    failureEvidence: benchmark.failureEvidence === 'stale row' ? 'duplicate shipment id' : 'stale transfer token',
    protectedProject: false,
    copiesBenchmarkAnswer: false,
  }
  const blob = JSON.stringify(practice)
  if (benchmark.answer && blob.includes(benchmark.answer)) return { ok: false, reason: 'Practice copied a benchmark answer.' }
  if (practice.domain === benchmark.domain || practice.layout === benchmark.layout || practice.failureEvidence === benchmark.failureEvidence) {
    return { ok: false, reason: 'Practice did not change the benchmark enough.' }
  }
  gap.practiceIds.push(practice.practiceId)
  gap.status = 'PRACTICING'
  session.commanderProjectsBlocked = false
  return { ok: true, practice }
}

export function recordPracticePass(session: FoundryReasoningSession, gap: FoundryCapabilityGap, passId: string): { reevaluation: boolean; advanced: boolean } {
  if (!gap.distinctPasses.includes(passId)) gap.distinctPasses.push(passId)
  gap.status = 'REEVALUATING'
  session.verificationState.projectReady = false
  const advanced = advanceDifficulty(session, gap)
  return { reevaluation: true, advanced }
}

export function recordPracticeFailure(gap: FoundryCapabilityGap): { advanced: false } {
  gap.status = 'PRACTICING'
  return { advanced: false }
}

function advanceDifficulty(session: FoundryReasoningSession, gap: FoundryCapabilityGap): boolean {
  if (gap.distinctPasses.length < 3) return false
  session.difficulty.ambiguity += 1
  gap.recommendedDifficulty = `ambiguity:${session.difficulty.ambiguity}`
  gap.status = 'CLOSED'
  return true
}

export function authorityUnchanged(session: FoundryReasoningSession): { expanded: false; commanderProjectsBlocked: false } {
  session.commanderProjectsBlocked = false
  return { expanded: false, commanderProjectsBlocked: false }
}
