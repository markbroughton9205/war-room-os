import { OllamaModelClient } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import type { ModelClient, ModelResult } from '@/lib/agents/ops/engineering/runtime/ports'
import { GovernorRefusal, type ResidencyGovernor } from './governor'
import { keepAliveFor, type PoolAssignment, type SpecialistRole } from './pool'
import type { ModelEntry } from './types'

/**
 * Governed model clients: every call of a pool role runs inside the node's residency lease (serialized, evicting what must go) and uses the keep_alive
 * of that role. Opt-in (SPECIALIST_POOL=1 in the harness); a refusal is returned as a failed ModelResult, never as a silent fallback to another model.
 */
export function governedClient(governor: ResidencyGovernor, assignment: PoolAssignment, models: ModelEntry[], role: SpecialistRole): ModelClient | null {
  const member = assignment.members.find((m) => m.role === role)
  if (!member?.modelRef || member.residency === 'NEVER_IMPLICIT') return null
  const entry = models.find((m) => m.ref === member.modelRef)
  const inner = new OllamaModelClient(member.modelRef, governor.node.endpoint, keepAliveFor(assignment, member.modelRef))
  return {
    async generate(input): Promise<ModelResult> {
      try {
        return await governor.lease({ ref: member.modelRef as string, role, residency: member.residency, status: entry?.status, artifactBytes: entry?.artifactBytes }, assignment.residentRefs, () => inner.generate(input))
      } catch (e) {
        if (e instanceof GovernorRefusal) return { ok: false, detail: `governor refused: ${e.message}`.slice(0, 200), executor: { provider: 'ollama', model: member.modelRef as string } }
        throw e
      }
    },
  }
}

/** A governed client for an explicit model ref (the harness names its models itself): same lease, same keep-alive discipline. */
export function governedClientForRef(governor: ResidencyGovernor, ref: string, role: string, residency: 'RESIDENT' | 'TRANSIENT', keepAlive: string, keep: string[] = [], entry?: ModelEntry): ModelClient {
  const inner = new OllamaModelClient(ref, governor.node.endpoint, keepAlive)
  return {
    async generate(input): Promise<ModelResult> {
      try {
        return await governor.lease({ ref, role, residency, status: entry?.status, artifactBytes: entry?.artifactBytes }, keep, () => inner.generate(input))
      } catch (e) {
        if (e instanceof GovernorRefusal) return { ok: false, detail: `governor refused: ${e.message}`.slice(0, 200), executor: { provider: 'ollama', model: ref } }
        throw e
      }
    },
  }
}
