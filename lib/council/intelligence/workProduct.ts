/**
 * Structured work products. Agents do not exchange free-form chat threads.
 */

import type { EbcMissionResult } from '@/lib/council/evidence-board/types'
import { WORK_PRODUCT_SCHEMA, type CouncilWorkProduct, type WorkProductType } from './orchestrationTypes'
import type { JanusAnalysis, SentinelReview } from './types'

let seq = 0
function id(prefix: string): string {
  seq += 1
  return `${prefix}-${seq.toString(36)}`
}

export function workProduct(partial: Omit<CouncilWorkProduct, 'schema' | 'work_product_id'> & { work_product_id?: string }): CouncilWorkProduct {
  return Object.freeze({
    schema: WORK_PRODUCT_SCHEMA,
    work_product_id: partial.work_product_id ?? id('wp'),
    ...partial,
  })
}

export function workProductsFromLayers(input: {
  missionId: string
  ebc: EbcMissionResult | null
  janus: JanusAnalysis | null
  sentinel: SentinelReview | null
  now?: string
}): CouncilWorkProduct[] {
  const now = input.now ?? new Date().toISOString()
  const products: CouncilWorkProduct[] = []
  if (input.ebc) {
    for (const agent of input.ebc.classification.selected_agents) {
        const claims = input.ebc.board.claims.filter(claim => claim.agent_id === agent)
      const type: WorkProductType =
        agent === 'PULSAR' ? 'RESEARCH'
          : agent === 'LUMEN' ? 'VERIFICATION'
            : agent === 'PHOENIX' ? 'CHALLENGE'
              : agent === 'NOVA' ? 'DATA_ANALYSIS'
                : agent === 'AURORA' ? 'SYNTHESIS_INPUT'
                  : 'INVESTIGATION'
      products.push(workProduct({
        mission_id: input.missionId,
        task_id: `seat-${agent}`,
        agent,
        type,
        summary: claims[0]?.text.slice(0, 180) || `${agent} work product`,
        claims: claims.map(c => c.text).slice(0, 8),
        evidence_refs: [...new Set(claims.flatMap(c => c.evidence_ids))],
        unknowns: claims.filter(c => c.status === 'UNVERIFIED').map(c => c.text).slice(0, 4),
        questions: [],
        risks: [],
        recommendations: [],
        requested_followups: [],
        confidence_class: claims.some(c => c.status === 'VERIFIED') ? 'VERIFIED' : claims.some(c => c.status === 'SUPPORTED') ? 'SUPPORTED' : 'UNVERIFIED',
        temporal_scope: 'CURRENT',
        created_at: now,
      }))
    }
  }
  if (input.janus?.invoked) {
    products.push(workProduct({
      mission_id: input.missionId,
      task_id: 'janus',
      agent: 'JANUS',
      type: 'SCENARIO',
      summary: input.janus.scenarios.map(s => s.option).join(' | '),
      claims: [],
      evidence_refs: input.janus.scenarios.flatMap(s => s.evidence_ids),
      unknowns: input.janus.scenarios.flatMap(s => s.unknowns),
      questions: [],
      risks: input.janus.scenarios.flatMap(s => s.risks.map(r => r.text)),
      recommendations: [],
      requested_followups: [],
      confidence_class: 'UNVERIFIED',
      temporal_scope: 'CURRENT',
      created_at: now,
    }))
  }
  if (input.sentinel?.invoked) {
    products.push(workProduct({
      mission_id: input.missionId,
      task_id: 'sentinel',
      agent: 'SENTINEL',
      type: 'RISK',
      summary: input.sentinel.risks.map(r => r.category).join(', ') || 'no material operational risk',
      claims: [],
      evidence_refs: input.sentinel.risks.flatMap(r => r.evidence_ids),
      unknowns: [],
      questions: [],
      risks: input.sentinel.risks.map(r => r.description),
      recommendations: input.sentinel.risks.map(r => r.mitigation),
      requested_followups: [],
      confidence_class: 'SUPPORTED',
      temporal_scope: 'CURRENT',
      created_at: now,
    }))
  }
  return products
}

export function productsForAgent(products: readonly CouncilWorkProduct[], agent: string): CouncilWorkProduct[] {
  return products.filter(item => item.agent === agent || (agent === 'AURORA' && item.type !== 'SYNTHESIS_INPUT') || (agent === 'LUMEN' && (item.type === 'INVESTIGATION' || item.type === 'RESEARCH')))
}
