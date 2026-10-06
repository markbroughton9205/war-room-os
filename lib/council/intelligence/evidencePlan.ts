/**
 * Evidence acquisition planner. Decide what evidence would actually resolve the mission
 * before spending research/tool budget.
 */

import type { CognitiveStrategy, EvidenceRequirement } from './orchestrationTypes'

export function planEvidence(input: {
  strategy: CognitiveStrategy
  questions: Array<{ text: string; type: string; required_evidence: string[] }>
  text: string
}): EvidenceRequirement[] {
  const reqs: EvidenceRequirement[] = []
  if (input.strategy.evidence_requirement === 'NONE') return reqs

  if (input.strategy.runtime_knowledge || input.strategy.id === 'VERIFY') {
    reqs.push(req('current runtime identity', 'live_telemetry', 1, 'CURRENT_LIVE', false, 'wr.ports.list', 'install_id + 3847/3848 pids'))
    reqs.push(req('core/ui health', 'live_telemetry', 1, 'CURRENT_LIVE', false, 'system.health', 'HTTP 200'))
  }
  if (input.strategy.evidence_requirement === 'MULTI_SOURCE' || input.strategy.id === 'RESEARCH') {
    reqs.push(req('current primary sources', 'primary_external', /\bcontroversial|architecture claim\b/i.test(input.text) ? 2 : 1, 'CURRENT_LIVE', true, 'research.web', 'dated primary URL'))
  }
  if (input.strategy.id === 'DIAGNOSE') {
    reqs.push(req('discriminating diagnostic probe', 'tool_result', 1, 'CURRENT_LIVE', false, 'browser.status', 'one probe that can falsify the leading hypothesis'))
  }
  if (input.strategy.id === 'PLAN' || input.strategy.id === 'DESIGN') {
    reqs.push(req('repo/runtime behavior', 'repo_config', 1, 'LAST_VERIFIED', false, 'files.read', 'source + tests, not model prose'))
  }
  if (/\bversion\b/i.test(input.text) && reqs.every(r => r.evidence_type !== 'primary_external')) {
    reqs.push(req('current version', 'primary_external', 1, 'CURRENT_LIVE', true, 'research.web', 'one current authoritative source may suffice'))
  }
  return reqs
}

function req(
  claim_or_question: string,
  evidence_type: string,
  minimum_sources: number,
  freshness: EvidenceRequirement['freshness'],
  independence_required: boolean,
  tool: string,
  completion_threshold: string,
): EvidenceRequirement {
  return Object.freeze({
    claim_or_question,
    evidence_type,
    minimum_sources,
    freshness,
    primary_preference: evidence_type === 'primary_external',
    independence_required,
    tool,
    completion_threshold,
  })
}
