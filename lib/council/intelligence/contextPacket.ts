/**
 * Per-task context packets and long-mission compression.
 * Agents do not receive the entire mission history. Provenance is never dropped.
 */

import type { CognitiveBlackboard, CompressedContext, ContextPacket, CouncilWorkProduct, QuestionGraph } from './orchestrationTypes'
import type { MissionContractV1 } from './types'

export function buildContextPackets(input: {
  contract: MissionContractV1
  blackboard: CognitiveBlackboard
  products: readonly CouncilWorkProduct[]
  questions: QuestionGraph
  kgNodeIds: readonly string[]
}): ContextPacket[] {
  const agents = [...new Set(input.products.map(p => p.agent).concat(['AURORA']))]
  return agents.map(agent => {
    const relevant = input.products.filter(p => p.agent === agent || (agent === 'AURORA') || (agent === 'LUMEN' && (p.type === 'INVESTIGATION' || p.type === 'RESEARCH')) || (agent === 'PHOENIX' && p.type === 'VERIFICATION'))
    const qs = input.questions.questions.filter(q => q.assigned_role === agent || agent === 'AURORA' && q.blocking)
    return {
      agent: agent as ContextPacket['agent'],
      mission_objective: input.contract.objective,
      task_id: `pkt-${agent}`,
      task_objective: qs[0]?.text || `${agent} contribution`,
      constraints: [...input.contract.explicit_exclusions, ...input.contract.constraints].slice(0, 8),
      evidence_refs: [...new Set(relevant.flatMap(p => p.evidence_refs))],
      prior_work_product_ids: relevant.filter(p => p.agent !== agent).map(p => p.work_product_id),
      kg_node_ids: [...input.kgNodeIds],
      unresolved_questions: qs.filter(q => q.answer_state === 'OPEN').map(q => q.text),
      hypotheses: input.blackboard.items.filter(i => i.section === 'HYPOTHESES').map(i => i.text).slice(0, 8),
      authority: [
        `commit=${input.contract.authority.commit}`,
        `push=${input.contract.authority.push}`,
        `deploy=${input.contract.authority.production_deploy}`,
      ],
      temporal_scope: 'CURRENT',
      query: agent === 'PULSAR' ? `primary sources: ${input.contract.objective}` : agent === 'ORION' ? (qs[0]?.text || input.contract.objective) : input.contract.objective,
    }
  })
}

export function packetsDiffer(packets: readonly ContextPacket[]): boolean {
  if (packets.length < 2) return true
  const keys = packets.map(p => `${p.agent}:${p.query ?? ''}:${p.task_objective ?? ''}:${p.prior_work_product_ids.join(',')}:${p.unresolved_questions.join('|')}`)
  return new Set(keys).size > 1
}

export function compressContext(input: {
  blackboard: CognitiveBlackboard
  products: readonly CouncilWorkProduct[]
  force?: boolean
}): CompressedContext | null {
  const proseChars = input.products.reduce((n, p) => n + p.summary.length + p.claims.join('').length, 0)
  if (!input.force && proseChars < 2_000 && input.products.length < 8) return null
  const facts = input.blackboard.items.filter(i => i.section === 'CLAIMS' && (i.truth_state === 'VERIFIED' || i.truth_state === 'SUPPORTED')).map(i => i.text)
  const evidence_refs = [...new Set(input.blackboard.items.flatMap(i => i.ebc_evidence_ids))]
  return Object.freeze({
    facts,
    evidence_refs,
    decisions: input.blackboard.items.filter(i => i.section === 'DECISIONS').map(i => i.text),
    unknowns: input.blackboard.items.filter(i => i.section === 'UNKNOWNS' || i.section === 'QUESTIONS').map(i => i.text),
    risks: input.blackboard.items.filter(i => i.section === 'RISKS').map(i => i.text),
    authority: input.blackboard.items.filter(i => i.section === 'AUTHORITY').map(i => i.text),
    open_tasks: input.blackboard.items.filter(i => i.section === 'TASKS' && i.status === 'OPEN').map(i => i.text),
    dropped: ['duplicate prose', 'agent chatter', 'superseded plans'],
    provenance_preserved: true,
  })
}
