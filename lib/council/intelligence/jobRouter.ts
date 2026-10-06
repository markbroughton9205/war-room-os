/**
 * Model routing by cognitive job. Role ≠ provider. No fake local. No hard-binding agent id to provider.
 */

import { LOCAL_MODEL_REGISTRY } from '@/lib/council/live-orchestration/backends/localModelRegistry'
import type { CognitiveJob, JobRoute } from './orchestrationTypes'

const GENERAL_MODEL_ID = LOCAL_MODEL_REGISTRY.find(row => row.slot === 'GENERAL')?.modelId ?? 'huihui_ai/qwen3-abliterated:14b'

const JOB_DEFAULT: Record<CognitiveJob, Omit<JobRoute, 'fake_local'>> = {
  conversation: { job: 'conversation', model_target: 'deterministic-aurora', placement: 'NONE', reason: 'Presence/synthesis can stay deterministic.', fallback: null },
  classification: { job: 'classification', model_target: 'evidence-board.classifier', placement: 'NONE', reason: 'Existing EBC classifier.', fallback: null },
  planning: { job: 'planning', model_target: 'intelligence.atlas', placement: 'NONE', reason: 'ATLAS is a typed function. Future WRIM may fulfill.', fallback: 'frontier-planner' },
  quant_reasoning: { job: 'quant_reasoning', model_target: 'NOVA', placement: 'LOCAL', reason: 'Structured data prefers local NOVA when healthy.', fallback: 'frontier' },
  research_synthesis: { job: 'research_synthesis', model_target: 'PULSAR', placement: 'HYBRID', reason: 'Live research may use broker + frontier; not fake local.', fallback: 'local-GENERAL' },
  verification: { job: 'verification', model_target: 'intelligence.lumen', placement: 'NONE', reason: 'LUMEN is deterministic verification against evidence IDs.', fallback: null },
  adversarial_review: { job: 'adversarial_review', model_target: 'PHOENIX', placement: 'HYBRID', reason: 'Adversary may be local RED_TEAM or frontier. Role stays PHOENIX.', fallback: 'local-RED_TEAM' },
  coding_analysis: { job: 'coding_analysis', model_target: 'ORION', placement: 'LOCAL', reason: 'Coding analysis prefers local CODING/GENERAL when probed healthy.', fallback: 'frontier' },
}

export function routeCognitiveJob(job: CognitiveJob, localGeneralReady: boolean): JobRoute {
  const row = JOB_DEFAULT[job]
  let placement = row.placement
  let model_target = row.model_target
  if ((job === 'quant_reasoning' || job === 'coding_analysis' || job === 'research_synthesis') && !localGeneralReady && placement === 'LOCAL') {
    placement = 'CLOUD'
    model_target = `${row.model_target}/fallback-frontier`
  }
  if (localGeneralReady && job === 'conversation') {
    return Object.freeze({
      job,
      model_target: GENERAL_MODEL_ID,
      placement: 'LOCAL',
      reason: 'Local GENERAL reachable. Not a fake local.',
      fallback: 'deterministic-aurora',
      fake_local: false as const,
    })
  }
  return Object.freeze({ ...row, placement, model_target, fake_local: false as const })
}

export function routeJobsForStrategy(jobs: readonly CognitiveJob[], localGeneralReady: boolean): JobRoute[] {
  return jobs.map(job => routeCognitiveJob(job, localGeneralReady))
}
