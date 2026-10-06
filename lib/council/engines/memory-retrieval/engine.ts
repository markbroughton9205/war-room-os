/**
 * MemoryRetrievalEngine — retrieval-first wrap of existing experience/playbook/memory gate.
 * Does not write permanent memory. Does not treat all memories as facts.
 */
import { listExperience, loadPlaybook, listStagedEval } from '@/lib/council/intelligence/adaptiveStore'
import { createEngineReceipt } from '../receipts'
import type { EngineReceipt } from '../types'
import { MEMORY_RETRIEVAL_SCHEMA, type MemoryHit, type MemoryRetrievalResult, type MemoryType } from '../long-horizon/types'
import { evaluateTemporalMemory } from '../temporal-world/engine'

function memoryTemporal(state: ReturnType<typeof evaluateTemporalMemory>['state']): MemoryHit['temporal_state'] {
  return state === 'FUTURE_SCHEDULED' ? 'TIME_UNKNOWN' : state
}

function tokensOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function scoreRelevance(input: {
  objective: string
  domain?: string
  entities?: string[]
  candidate: string
  sourceMission: string
  currentMission: string
}): number {
  const obj = input.objective.toLowerCase()
  const cand = input.candidate.toLowerCase()
  if (input.sourceMission === input.currentMission) return 0.2
  let score = 0
  const tokens = obj.split(/\W+/).filter(t => t.length > 3)
  for (const t of tokens) if (cand.includes(t)) score += 0.15
  for (const ent of input.entities ?? []) if (cand.includes(ent.toLowerCase())) score += 0.25
  if (input.domain && cand.includes(input.domain.toLowerCase())) score += 0.2
  if (/fail|timeout|unavailable/.test(obj) && /fail|timeout|unavailable/.test(cand)) score += 0.2
  return Math.min(1, score)
}

export async function retrieveMemories(input: {
  mission_id: string
  objective: string
  task_objective?: string
  domain?: string
  entities?: string[]
  required_facts?: string[]
  open_questions?: string[]
  ebc_evidence_ids?: string[]
  memory_budget?: number
  privacy_scope?: 'MISSION' | 'PROJECT' | 'COMMANDER_APPROVED'
  seed?: Array<{ content_summary: string; source_mission_id: string; memory_type?: MemoryType; truth_state?: MemoryHit['truth_state']; observed_at?: string; valid_to?: string; speculative?: boolean; evidence_refs?: string[] }>
}): Promise<{ result: MemoryRetrievalResult; receipt: EngineReceipt }> {
  const started = Date.now()
  const budget = Math.max(2, input.memory_budget ?? 6)
  const experience = await listExperience()
  const staged = await listStagedEval()
  void staged
  const candidates: MemoryHit[] = []

  for (const row of experience) {
    const summary = `${row.mission_class} ${row.strategy} ${row.evaluation.join(' ')} ${row.failure_modes.join(' ')} ${row.tools_used.join(' ')}`
    const relevance = scoreRelevance({
      objective: `${input.objective} ${input.task_objective ?? ''}`,
      domain: input.domain,
      entities: input.entities,
      candidate: summary,
      sourceMission: row.mission_id,
      currentMission: input.mission_id,
    })
    const proven = row.failure_modes.length > 0 && row.completion_state !== 'FAILED'
    const type: MemoryType = row.failure_modes.length ? 'FAILURE_PATTERN' : 'MISSION_EXPERIENCE'
    const temporal = evaluateTemporalMemory({
      observed_at: row.timestamp,
      truth: proven ? 'VERIFIED' : 'UNVERIFIED',
      speculative: row.evaluation.some(v => /counterfactual|hypothesis|speculative/i.test(v)),
    })
    candidates.push({
      memory_ref: `exp:${row.mission_id}`,
      memory_type: type,
      source_mission_id: row.mission_id,
      source_evidence_refs: [],
      content_summary: summary.slice(0, 240),
      relevance,
      temporal_state: memoryTemporal(temporal.state),
      truth_state: temporal.speculative ? 'UNVERIFIED' : (proven ? 'VERIFIED' : 'UNKNOWN'),
      confidence_state: temporal.speculative ? 'HYPOTHESIS' : (proven ? 'PROVEN' : 'UNCERTAIN'),
      reason_selected: relevance >= 0.35 ? 'entity/task/domain match' : 'below relevance threshold',
      selected: false,
    })
  }

  if (input.seed?.length) {
    for (const row of input.seed) {
      const temporal = evaluateTemporalMemory({
        observed_at: row.observed_at,
        valid_to: row.valid_to,
        truth: row.truth_state === 'VERIFIED' || row.truth_state === 'SUPPORTED' || row.truth_state === 'UNVERIFIED' ? row.truth_state : 'UNVERIFIED',
        speculative: row.speculative,
      })
      const relevance = scoreRelevance({
        objective: `${input.objective} ${input.task_objective ?? ''}`,
        domain: input.domain,
        entities: input.entities,
        candidate: row.content_summary,
        sourceMission: row.source_mission_id,
        currentMission: input.mission_id,
      })
      candidates.push({
        memory_ref: `seed:${row.source_mission_id}:${row.content_summary.slice(0, 24)}`,
        memory_type: row.memory_type ?? 'MISSION_EXPERIENCE',
        source_mission_id: row.source_mission_id,
        source_evidence_refs: row.evidence_refs ?? [],
        content_summary: row.content_summary.slice(0, 240),
        relevance,
        temporal_state: memoryTemporal(temporal.state),
        truth_state: temporal.speculative ? 'UNVERIFIED' : (row.truth_state === 'VERIFIED' || row.truth_state === 'SUPPORTED' || row.truth_state === 'UNVERIFIED' ? row.truth_state : 'UNKNOWN'),
        confidence_state: temporal.speculative ? 'HYPOTHESIS' : (row.truth_state === 'VERIFIED' ? 'PROVEN' : 'UNCERTAIN'),
        reason_selected: relevance >= 0.35 ? 'entity/task/domain match' : 'below relevance threshold',
        selected: false,
      })
    }
  }

  if (input.required_facts?.length) {
    for (const fact of input.required_facts) {
      const temporal = evaluateTemporalMemory({ observed_at: new Date().toISOString(), truth: 'VERIFIED', speculative: false })
      const relevance = scoreRelevance({
        objective: input.objective,
        domain: input.domain,
        entities: input.entities,
        candidate: fact,
        sourceMission: 'prior-fact',
        currentMission: input.mission_id,
      })
      candidates.push({
        memory_ref: `fact:${fact.slice(0, 32)}`,
        memory_type: 'VERIFIED_FACT',
        source_mission_id: 'prior-fact',
        source_evidence_refs: input.ebc_evidence_ids ?? [],
        content_summary: fact,
        relevance: Math.max(relevance, 0.5),
        temporal_state: memoryTemporal(temporal.state),
        truth_state: 'VERIFIED',
        confidence_state: 'PROVEN',
        reason_selected: 'required current fact',
        selected: false,
      })
    }
  }

  const ranked = candidates.sort((a, b) => b.relevance - a.relevance)
  let used = 0
  let included = 0
  const hits = ranked.map(hit => {
    const contamination = hit.source_mission_id !== input.mission_id && hit.relevance < 0.35
    const privacyBlocked = input.privacy_scope === 'COMMANDER_APPROVED' && hit.memory_type !== 'USER_APPROVED_MEMORY'
    const unverifiedUpgradeBlocked = hit.truth_state === 'UNVERIFIED'
    const take = !contamination && !privacyBlocked && hit.relevance >= 0.35 && included < budget && used < 400
    const cost = tokensOf(hit.content_summary)
    if (take) {
      included += 1
      used += cost
    }
    return {
      ...hit,
      selected: take,
      reason_selected: contamination
        ? 'excluded: unrelated mission contamination'
        : privacyBlocked
          ? 'excluded: privacy/authority scope'
        : unverifiedUpgradeBlocked && take
          ? 'included as unverified history, not upgraded'
          : hit.reason_selected,
      memory_type: unverifiedUpgradeBlocked ? 'UNVERIFIED_HISTORY' as const : hit.memory_type,
    }
  })

  const result: MemoryRetrievalResult = {
    schema: MEMORY_RETRIEVAL_SCHEMA,
    mission_id: input.mission_id,
    hits,
    retrieved_count: hits.length,
    included_count: included,
    excluded_count: hits.length - included,
    token_estimate: used,
    trains_wrim: false,
  }
  void loadPlaybook
  return {
    result,
    receipt: createEngineReceipt({
      engine: 'memory-retrieval',
      mission_id: input.mission_id,
      started_at: started,
      decision_count: included,
      decision: `retrieved=${hits.length} included=${included}`,
      output_refs: hits.filter(h => h.selected).map(h => h.memory_ref),
    }),
  }
}
