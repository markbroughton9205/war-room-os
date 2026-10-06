/**
 * Cognitive blackboard — mission working state on top of EBC.
 * EBC remains factual truth. Blackboard never upgrades model reasoning to VERIFIED.
 */

import type { EbcMissionResult } from '@/lib/council/evidence-board/types'
import { BLACKBOARD_SCHEMA, type BlackboardItem, type BlackboardSection, type CognitiveBlackboard, type CognitiveTaskGraph, type Hypothesis, type QuestionGraph } from './orchestrationTypes'
import type { JanusAnalysis, MissionContractV1, SentinelReview, TruthState } from './types'

let seq = 0
function nid(): string {
  seq += 1
  return `bb-${seq.toString(36)}`
}

function item(partial: Omit<BlackboardItem, 'item_id'> & { item_id?: string }): BlackboardItem {
  return Object.freeze({
    item_id: partial.item_id ?? nid(),
    ...partial,
  })
}

export function buildBlackboard(input: {
  contract: MissionContractV1
  tasks: CognitiveTaskGraph
  questions: QuestionGraph
  hypotheses: readonly Hypothesis[]
  ebc: EbcMissionResult | null
  janus: JanusAnalysis | null
  sentinel: SentinelReview | null
  now?: string
}): CognitiveBlackboard {
  const now = input.now ?? new Date().toISOString()
  const mission_id = input.contract.mission_id
  const items: BlackboardItem[] = [
    item({
      section: 'OBJECTIVE',
      text: input.contract.objective,
      origin: 'mission-contract',
      mission_id,
      status: 'ACTIVE',
      provenance: ['contract'],
      timestamp: now,
      ebc_evidence_ids: [],
      truth_state: 'UNKNOWN',
    }),
    item({
      section: 'AUTHORITY',
      text: `commit=${input.contract.authority.commit} push=${input.contract.authority.push} deploy=${input.contract.authority.production_deploy}`,
      origin: 'mission-contract',
      mission_id,
      status: 'ACTIVE',
      provenance: ['contract.authority'],
      timestamp: now,
      ebc_evidence_ids: [],
      truth_state: 'VERIFIED',
    }),
  ]
  for (const task of input.tasks.tasks) {
    items.push(item({
      section: 'TASKS',
      text: `${task.task_id} ${task.objective} [${task.status}]`,
      origin: 'atlas',
      mission_id,
      status: task.status === 'COMPLETE' ? 'RESOLVED' : 'OPEN',
      provenance: ['atlas'],
      timestamp: now,
      ebc_evidence_ids: [],
      truth_state: 'UNKNOWN',
    }))
  }
  for (const q of input.questions.questions) {
    items.push(item({
      section: 'QUESTIONS',
      text: q.text,
      origin: q.assigned_role,
      mission_id,
      status: q.answer_state === 'OPEN' ? 'OPEN' : 'RESOLVED',
      provenance: [q.question_id],
      timestamp: now,
      ebc_evidence_ids: [],
      truth_state: 'UNKNOWN',
    }))
  }
  for (const h of input.hypotheses) {
    items.push(item({
      section: 'HYPOTHESES',
      text: `${h.id}: ${h.statement} [${h.status}]`,
      origin: 'ORION',
      mission_id,
      status: h.status === 'OPEN' ? 'OPEN' : 'ACTIVE',
      provenance: h.supporting_evidence,
      timestamp: now,
      ebc_evidence_ids: h.supporting_evidence,
      truth_state: 'UNVERIFIED',
    }))
  }
  if (input.ebc) {
    for (const ev of input.ebc.board.evidence) {
      items.push(item({
        section: 'EVIDENCE',
        text: ev.summary,
        origin: ev.tool_name,
        mission_id,
        status: ev.ok ? 'ACTIVE' : 'OPEN',
        provenance: [ev.evidence_id],
        timestamp: now,
        ebc_evidence_ids: [ev.evidence_id],
        truth_state: ev.ok ? 'SUPPORTED' : 'UNKNOWN',
      }))
    }
    for (const claim of input.ebc.board.claims) {
      const truth = mapClaim(claim.status)
      items.push(item({
        section: claim.status === 'CONTRADICTED' ? 'CONFLICTS' : 'CLAIMS',
        text: claim.text,
        origin: claim.agent_id,
        mission_id,
        status: claim.status === 'CONTRADICTED' ? 'OPEN' : 'ACTIVE',
        provenance: claim.evidence_ids,
        timestamp: now,
        ebc_evidence_ids: claim.evidence_ids,
        truth_state: truth,
      }))
    }
  }
  for (const scenario of input.janus?.scenarios ?? []) {
    items.push(item({
      section: 'SCENARIOS',
      text: scenario.option,
      origin: 'JANUS',
      mission_id,
      status: 'ACTIVE',
      provenance: scenario.evidence_ids,
      timestamp: now,
      ebc_evidence_ids: scenario.evidence_ids,
      truth_state: 'UNVERIFIED',
    }))
  }
  for (const risk of input.sentinel?.risks ?? []) {
    items.push(item({
      section: 'RISKS',
      text: `${risk.category}: ${risk.description}`,
      origin: 'SENTINEL',
      mission_id,
      status: risk.blocking ? 'OPEN' : 'ACTIVE',
      provenance: risk.evidence_ids,
      timestamp: now,
      ebc_evidence_ids: risk.evidence_ids,
      truth_state: 'SUPPORTED',
    }))
    if (risk.blocking) {
      items.push(item({
        section: 'BLOCKERS',
        text: risk.description,
        origin: 'SENTINEL',
        mission_id,
        status: 'OPEN',
        provenance: [risk.risk_id],
        timestamp: now,
        ebc_evidence_ids: risk.evidence_ids,
        truth_state: 'SUPPORTED',
      }))
    }
  }
  return Object.freeze({
    schema: BLACKBOARD_SCHEMA,
    mission_id,
    items,
    ebc_truth_spine: true,
  })
}

function mapClaim(status: string): TruthState {
  if (status === 'VERIFIED') return 'VERIFIED'
  if (status === 'SUPPORTED') return 'SUPPORTED'
  if (status === 'CONTRADICTED') return 'CONFLICTED'
  if (status === 'UNVERIFIED' || status === 'PROPOSED') return 'UNVERIFIED'
  return 'UNKNOWN'
}

export function blackboardNeverUpgradesInference(board: CognitiveBlackboard): boolean {
  return board.items.every(row => row.origin !== 'model-prose' || row.truth_state !== 'VERIFIED')
    && board.items.filter(row => row.section === 'EVIDENCE').every(row => row.ebc_evidence_ids.length > 0 || row.truth_state !== 'VERIFIED')
}

export function sectionOf(board: CognitiveBlackboard, section: BlackboardSection): BlackboardItem[] {
  return board.items.filter(item => item.section === section)
}
