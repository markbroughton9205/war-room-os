/**
 * JANUS — structured scenario analysis.
 * Scenario reasoning is not evidence. FACT / INFERENCE / PROJECTION / UNKNOWN stay labeled.
 * Projections are never promoted to VERIFIED.
 */

import { JANUS_SCENARIO_SCHEMA, type JanusAnalysis, type JanusScenario, type JanusStatement, type MissionContractV1, type StatementKind } from './types'
import type { AtlasPlanGraph } from './types'

function stmt(text: string, kind: StatementKind, evidence_ids: string[] = []): JanusStatement {
  return Object.freeze({ text, kind, evidence_ids })
}

function option(partial: Omit<JanusScenario, 'family' | 'time' | 'resource_demand' | 'operational_complexity' | 'security' | 'authority'> & Partial<Pick<JanusScenario, 'family' | 'time' | 'resource_demand' | 'operational_complexity' | 'security' | 'authority'>>): JanusScenario {
  return Object.freeze({
    family: 'OPTION_A',
    time: [],
    resource_demand: [],
    operational_complexity: [],
    security: [],
    authority: [],
    ...partial,
  })
}

export function shouldInvokeJanus(invokedByRouting: boolean): boolean {
  return invokedByRouting
}

export function analyzeScenarios(input: {
  contract: MissionContractV1
  plan?: AtlasPlanGraph | null
  evidenceIds?: readonly string[]
  candidateOptions?: readonly string[]
  now?: string
}): JanusAnalysis {
  const evidence = [...(input.evidenceIds ?? [])]
  const factKind: StatementKind = evidence.length ? 'FACT' : 'UNKNOWN'
  const options = input.candidateOptions?.length
    ? [...input.candidateOptions]
    : ['Overwrite mutable current-state fields', 'Keep temporal records', 'Do nothing / keep current design']

  const scenarios: JanusScenario[] = [
    option({
      scenario_id: 'opt-a',
      option: options[0] ?? 'OPTION A',
      family: 'OPTION_A',
      assumptions: [stmt('Current-state consumers want a single latest value', 'INFERENCE')],
      time: [stmt('Immediate cutover', 'PROJECTION')],
      resource_demand: [stmt('Low write cost, high hidden history cost', 'INFERENCE')],
      operational_complexity: [stmt('Simple field update', 'INFERENCE')],
      security: [stmt('No new exposure', 'INFERENCE')],
      authority: [stmt('No extra Commander grant implied', 'INFERENCE')],
      benefits: [stmt('Simple reads for dashboards', 'INFERENCE')],
      costs: [stmt('History of previous current-state claims is lost unless separately archived', 'PROJECTION')],
      risks: [stmt('Stale overwrite can present yesterday’s install as current', 'INFERENCE', evidence)],
      dependencies: ['consumers of ACTIVE_INSTALL'],
      reversibility: 'IRREVERSIBLE',
      evidence_ids: evidence,
      unknowns: evidence.length ? [] : ['No evidence IDs attached; option remains non-factual'],
      failure_modes: [stmt('Later install proven while UI still answers with overwritten-away identity', 'PROJECTION')],
      migration_impact: [stmt('Requires rewrite of current-state readers', 'INFERENCE')],
    }),
    option({
      scenario_id: 'opt-b',
      option: options[1] ?? 'OPTION B',
      family: 'OPTION_B',
      assumptions: [stmt('Observation time is recorded with each current-state fact', 'INFERENCE')],
      time: [stmt('Additive; no freeze window', 'INFERENCE')],
      resource_demand: [stmt('Modest storage growth', 'PROJECTION')],
      operational_complexity: [stmt('Readers must honor temporal_state', 'INFERENCE')],
      security: [stmt('History retention must not store secrets', 'INFERENCE')],
      authority: [stmt('Read-only knowledge update', 'INFERENCE')],
      benefits: [
        stmt('Newest valid evidence becomes CURRENT without deleting history', factKind, evidence),
        stmt('Conflicts can mark older CURRENT as SUPERSEDED', 'INFERENCE'),
      ],
      costs: [stmt('Readers must resolve temporal_state instead of a single cell', 'INFERENCE')],
      risks: [stmt('If temporal_state is ignored, stale CURRENT can still leak', 'INFERENCE')],
      dependencies: ['temporal truth resolver', 'Evidence Board temporal layers'],
      reversibility: 'REVERSIBLE',
      evidence_ids: evidence,
      unknowns: [],
      failure_modes: [stmt('Resolver bug could rank a weaker newer claim over stronger older evidence', 'PROJECTION')],
      migration_impact: [stmt('Additive: historical rows remain', 'INFERENCE')],
    }),
    option({
      scenario_id: 'opt-c',
      option: options[2] ?? 'Do nothing / current state',
      family: 'DO_NOTHING',
      assumptions: [stmt('Existing EBC temporal_layer already distinguishes CURRENT_LIVE / LAST_VERIFIED / HISTORICAL', evidence.length ? 'FACT' : 'INFERENCE', evidence)],
      time: [stmt('Zero migration time', 'INFERENCE')],
      resource_demand: [stmt('None', 'INFERENCE')],
      operational_complexity: [stmt('Split-brain risk remains', 'INFERENCE')],
      security: [stmt('Unchanged', 'INFERENCE')],
      authority: [stmt('No new authority', 'INFERENCE')],
      benefits: [stmt('No migration', 'INFERENCE')],
      costs: [stmt('Knowledge graph and mission memory still need an explicit supersession rule', 'INFERENCE')],
      risks: [stmt('Install identity can remain stale in non-EBC stores', 'INFERENCE')],
      dependencies: ['current EBC board'],
      reversibility: 'REVERSIBLE',
      evidence_ids: evidence,
      unknowns: ['Whether every current-state store already honors EBC temporal layers'],
      failure_modes: [stmt('Split-brain: EBC current vs KG current', 'PROJECTION')],
      migration_impact: [stmt('None immediately; residual stale-fact risk remains', 'INFERENCE')],
    }),
    option({
      scenario_id: 'opt-baseline',
      option: 'BASELINE current design',
      family: 'BASELINE',
      assumptions: [stmt('Current EBC + intelligence overlay is the baseline', evidence.length ? 'FACT' : 'INFERENCE', evidence)],
      benefits: [stmt('Known behavior', 'INFERENCE')],
      costs: [stmt('Does not add orchestration', 'INFERENCE')],
      risks: [stmt('Hard missions stay under-decomposed', 'PROJECTION')],
      dependencies: ['current Council'],
      reversibility: 'REVERSIBLE',
      evidence_ids: evidence,
      unknowns: [],
      failure_modes: [stmt('Mission cost stays high on trivial work if layers are not gated', 'PROJECTION')],
      migration_impact: [stmt('None', 'INFERENCE')],
      time: [stmt('Zero', 'INFERENCE')],
      resource_demand: [stmt('Current cost', 'INFERENCE')],
      operational_complexity: [stmt('Unchanged', 'INFERENCE')],
      security: [stmt('Unchanged', 'INFERENCE')],
      authority: [stmt('Unchanged', 'INFERENCE')],
    }),
    option({
      scenario_id: 'opt-rollback',
      option: 'ROLLBACK to prior install',
      family: 'ROLLBACK',
      assumptions: [stmt('Prior additive install still exists under ~/.local/opt', 'INFERENCE')],
      benefits: [stmt('Known last-good runtime', 'INFERENCE')],
      costs: [stmt('Loses newest intelligence features', 'INFERENCE')],
      risks: [stmt('Launcher must not overlay /opt', 'INFERENCE')],
      dependencies: ['prior install id'],
      reversibility: 'REVERSIBLE',
      evidence_ids: evidence,
      unknowns: ['Which prior install Commander wants'],
      failure_modes: [stmt('Wrong install selected', 'PROJECTION')],
      migration_impact: [stmt('Launcher retarget only', 'INFERENCE')],
      time: [stmt('Minutes', 'PROJECTION')],
      resource_demand: [stmt('None beyond stop/start of identified PIDs', 'INFERENCE')],
      operational_complexity: [stmt('Foundry activate of historical install needs Commander confirmation', 'INFERENCE')],
      security: [stmt('No secret migration', 'INFERENCE')],
      authority: [stmt('Commander confirmation required for runtime transition', 'INFERENCE')],
    }),
    option({
      scenario_id: 'opt-staged',
      option: 'STAGED_MIGRATION of orchestration features',
      family: 'STAGED_MIGRATION',
      assumptions: [stmt('Layers can be gated by strategy so SOCIAL stays cheap', evidence.length ? 'FACT' : 'INFERENCE', evidence)],
      benefits: [stmt('Progressive disclosure of intelligence cost', 'INFERENCE')],
      costs: [stmt('More routing surface', 'INFERENCE')],
      risks: [stmt('Mis-routed strategy could skip required verification', 'PROJECTION')],
      dependencies: ['cognitive strategy selector', 'budget governor'],
      reversibility: 'REVERSIBLE',
      evidence_ids: evidence,
      unknowns: [],
      failure_modes: [stmt('FAST budget skips safety — must be forbidden by governor', 'PROJECTION')],
      migration_impact: [stmt('Additive code; no production mutation', 'INFERENCE')],
      time: [stmt('This pass', 'INFERENCE')],
      resource_demand: [stmt('Bounded extra CPU on hard missions only', 'PROJECTION')],
      operational_complexity: [stmt('Inspector surfaces orchestration', 'INFERENCE')],
      security: [stmt('No new secret stores', 'INFERENCE')],
      authority: [stmt('Tool Governor unchanged', 'INFERENCE')],
    }),
  ]

  return Object.freeze({
    schema: JANUS_SCENARIO_SCHEMA,
    mission_id: input.contract.mission_id,
    role: 'JANUS',
    provider_kind: 'deterministic',
    invoked: true,
    skip_reason: null,
    scenarios,
    created_at: input.now ?? new Date().toISOString(),
  })
}

export function skippedJanus(missionId: string, reason: string, now?: string): JanusAnalysis {
  return Object.freeze({
    schema: JANUS_SCENARIO_SCHEMA,
    mission_id: missionId,
    role: 'JANUS',
    provider_kind: 'deterministic',
    invoked: false,
    skip_reason: reason,
    scenarios: [],
    created_at: now ?? new Date().toISOString(),
  })
}

export function janusHasUnsupportedFact(analysis: JanusAnalysis): boolean {
  return analysis.scenarios.some(scenario =>
    [...scenario.assumptions, ...scenario.benefits, ...scenario.costs, ...scenario.risks, ...scenario.failure_modes, ...scenario.migration_impact]
      .some(row => row.kind === 'FACT' && row.evidence_ids.length === 0),
  )
}

export function promoteJanusToVerified(): never {
  throw new Error('JANUS projections and inferences cannot be promoted to VERIFIED truth')
}
