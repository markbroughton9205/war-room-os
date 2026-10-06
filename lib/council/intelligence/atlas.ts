/**
 * ATLAS — typed planning function. Plans only. Does not execute tools.
 * DAG dependencies. Unauthorized-but-required steps stay visible as BLOCKED_BY_AUTHORITY.
 */

import { ATLAS_PLAN_SCHEMA, type AtlasPlanGraph, type AtlasPlanStep, type MissionContractV1 } from './types'

const UNAUTHORIZED_ACTIONS: Array<{ pattern: RegExp; capability: string; title: string }> = [
  { pattern: /\bcommit\b/i, capability: 'git.commit', title: 'Commit code' },
  { pattern: /\bpush\b/i, capability: 'git.push', title: 'Push remote' },
  { pattern: /\bdeploy\b/i, capability: 'deploy.run', title: 'Production deploy' },
  { pattern: /\bspend\b|\bpayment\b/i, capability: 'finance.spend', title: 'Spend money' },
  { pattern: /\btrade\b/i, capability: 'finance.trade', title: 'Trade' },
  { pattern: /\bwager\b/i, capability: 'finance.wager', title: 'Wager' },
  { pattern: /\bsettlement\b/i, capability: 'finance.settlement_submit', title: 'Settlement submission' },
]

/** A step that is not blocked has no blocking reason and no parallel group unless one is given. */
function step(partial: Omit<AtlasPlanStep, 'parallel_group' | 'blocked_reason'> & { parallel_group?: string | null; blocked_reason?: string | null }): AtlasPlanStep {
  return Object.freeze({
    ...partial,
    parallel_group: partial.parallel_group ?? null,
    blocked_reason: partial.blocked_reason ?? null,
  })
}

function authorityAllows(contract: MissionContractV1, capability: string): boolean {
  if (capability === 'git.commit') return contract.authority.commit
  if (capability === 'git.push') return contract.authority.push
  if (capability === 'deploy.run') return contract.authority.production_deploy
  if (capability === 'finance.spend') return contract.authority.spend
  if (capability === 'finance.trade') return contract.authority.trade
  if (capability === 'finance.wager') return contract.authority.wager
  if (capability === 'finance.settlement_submit') return contract.authority.settlement_submit
  return true
}

function markUnauthorized(planStep: AtlasPlanStep, contract: MissionContractV1): AtlasPlanStep {
  const blocked = planStep.required_capabilities.some(cap => !authorityAllows(contract, cap))
  if (!blocked) return planStep
  return Object.freeze({
    ...planStep,
    status: 'BLOCKED_BY_AUTHORITY',
    approval_required: true,
    blocked_reason: 'Authority does not permit this action. Step retained because it is logically required.',
  })
}

function engineeringSteps(contract: MissionContractV1): AtlasPlanStep[] {
  const s1 = step({
    step_id: 's1',
    title: 'Inspect current runtime',
    purpose: 'Establish live 3847/3848 identity',
    depends_on: [],
    required_capabilities: ['system.health', 'wr.ports.list'],
    required_evidence: ['3847_pid', '3848_pid'],
    expected_output: 'Port ownership evidence',
    reversible: true,
    approval_required: false,
    risk_level: 'LOW',
    status: 'PLANNED',
    required: true,
    parallel_group: 'inspect',
  })
  const inspectProviders = step({
    step_id: 's2',
    title: 'Inspect provider registry',
    purpose: 'Council backend and provider health',
    depends_on: [],
    required_capabilities: ['wr.council.backend'],
    required_evidence: ['council_backend_state'],
    expected_output: 'READY_LOCAL or UNAVAILABLE evidence',
    reversible: true,
    approval_required: false,
    risk_level: 'LOW',
    status: 'PLANNED',
    required: true,
    parallel_group: 'inspect',
  })
  const validateAuth = step({
    step_id: 's3',
    title: 'Validate authority bounds',
    purpose: 'Confirm commit/push/deploy remain gated',
    depends_on: ['s1', 's2'],
    required_capabilities: [],
    required_evidence: [],
    expected_output: 'Authority matrix snapshot',
    reversible: true,
    approval_required: false,
    risk_level: 'LOW',
    status: 'PLANNED',
    required: true,
  })
  const completion = step({
    step_id: 's4',
    title: 'Installed acceptance evidence',
    purpose: 'Completion cannot verify without identity evidence',
    depends_on: ['s3'],
    required_capabilities: ['system.health'],
    required_evidence: ['3847_pid', '3848_pid', 'executable_path', 'install_id'],
    expected_output: 'Required evidence classes present',
    reversible: true,
    approval_required: false,
    risk_level: 'LOW',
    status: 'PLANNED',
    required: true,
  })
  return [s1, inspectProviders, validateAuth, completion]
}

function independentResearchSteps(): AtlasPlanStep[] {
  return [
    step({
      step_id: 's1',
      title: 'PULSAR browser research',
      purpose: 'Independent primary-source browser gather',
      depends_on: [],
      required_capabilities: ['research.web', 'browser.fetch'],
      required_evidence: ['primary_external'],
      expected_output: 'Browser evidence rows',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
      parallel_group: 'independent-gather',
    }),
    step({
      step_id: 's1b',
      title: 'NOVA structured telemetry analysis',
      purpose: 'Independent CPU-only structured analysis (not a second 14B job)',
      depends_on: [],
      required_capabilities: ['wr.ports.list'],
      required_evidence: ['live_telemetry'],
      expected_output: 'Typed port/runtime structure',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
      parallel_group: 'independent-gather',
    }),
    step({
      step_id: 's2',
      title: 'LUMEN verification',
      purpose: 'Verify claims against evidence IDs after both gathers',
      depends_on: ['s1', 's1b'],
      required_capabilities: ['verification'],
      required_evidence: ['primary_external'],
      expected_output: 'LUMEN verdicts',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
    step({
      step_id: 's3',
      title: 'PHOENIX challenge',
      purpose: 'Challenge unsupported claims',
      depends_on: ['s2'],
      required_capabilities: ['adversarial_review'],
      required_evidence: [],
      expected_output: 'Open conflicts or none',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
    step({
      step_id: 's4',
      title: 'AURORA board-only synthesis',
      purpose: 'Answer from surviving board',
      depends_on: ['s3'],
      required_capabilities: ['synthesis'],
      required_evidence: [],
      expected_output: 'Commander brief',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
  ]
}

function researchSteps(): AtlasPlanStep[] {
  return [
    step({
      step_id: 's1',
      title: 'ORION / PULSAR gathering',
      purpose: 'Collect primary-source evidence',
      depends_on: [],
      required_capabilities: ['research.web', 'browser.fetch'],
      required_evidence: ['primary_external'],
      expected_output: 'Evidence board rows',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
      parallel_group: 'gather',
    }),
    step({
      step_id: 's2',
      title: 'LUMEN verification',
      purpose: 'Verify claims against evidence IDs',
      depends_on: ['s1'],
      required_capabilities: ['verification'],
      required_evidence: ['primary_external'],
      expected_output: 'LUMEN verdicts',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
    step({
      step_id: 's3',
      title: 'PHOENIX challenge',
      purpose: 'Challenge unsupported claims',
      depends_on: ['s2'],
      required_capabilities: ['adversarial_review'],
      required_evidence: [],
      expected_output: 'Open conflicts or none',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
    step({
      step_id: 's4',
      title: 'AURORA board-only synthesis',
      purpose: 'Answer from surviving board',
      depends_on: ['s3'],
      required_capabilities: ['synthesis'],
      required_evidence: [],
      expected_output: 'Commander brief',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
  ]
}

function statusSteps(): AtlasPlanStep[] {
  return [
    step({
      step_id: 's1',
      title: 'Probe live runtime',
      purpose: 'Core/UI/ports/council backend',
      depends_on: [],
      required_capabilities: ['system.health', 'wr.ui.health', 'wr.ports.list', 'wr.council.backend'],
      required_evidence: ['live_telemetry'],
      expected_output: 'CURRENT_LIVE evidence',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
  ]
}

function decisionSteps(): AtlasPlanStep[] {
  return [
    step({
      step_id: 's1',
      title: 'Collect decision evidence',
      purpose: 'Facts for scenario comparison',
      depends_on: [],
      required_capabilities: ['system.health'],
      required_evidence: ['live_telemetry'],
      expected_output: 'Evidence IDs for JANUS',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
    step({
      step_id: 's2',
      title: 'Compare options',
      purpose: 'JANUS A / B / do nothing',
      depends_on: ['s1'],
      required_capabilities: [],
      required_evidence: [],
      expected_output: 'Scenario records labeled FACT/INFERENCE/PROJECTION',
      reversible: true,
      approval_required: false,
      risk_level: 'LOW',
      status: 'PLANNED',
      required: true,
    }),
    step({
      step_id: 's3',
      title: 'Operational risk review',
      purpose: 'SENTINEL on preferred option',
      depends_on: ['s2'],
      required_capabilities: [],
      required_evidence: [],
      expected_output: 'Risk records; no authority grant',
      reversible: true,
      approval_required: false,
      risk_level: 'MED',
      status: 'PLANNED',
      required: true,
    }),
  ]
}

function injectUnauthorizedRequired(contract: MissionContractV1, steps: AtlasPlanStep[]): AtlasPlanStep[] {
  const extras: AtlasPlanStep[] = []
  const blob = [contract.objective, contract.commander_wording, ...contract.explicit_requirements].join(' ')
  for (const row of UNAUTHORIZED_ACTIONS) {
    if (!row.pattern.test(blob)) continue
    if (contract.explicit_exclusions.some(item => row.pattern.test(item))) {
      extras.push(markUnauthorized(step({
        step_id: `auth-${row.capability}`,
        title: row.title,
        purpose: 'Logically required if the mission asked for it; authority currently forbids execution',
        depends_on: steps.map(item => item.step_id).slice(-1),
        required_capabilities: [row.capability],
        required_evidence: [],
        expected_output: 'Not executed',
        reversible: false,
        approval_required: true,
        risk_level: 'HIGH',
        status: 'BLOCKED_BY_AUTHORITY',
        required: true,
        blocked_reason: 'Authority does not permit this action. Step retained.',
      }), contract))
      continue
    }
    if (!authorityAllows(contract, row.capability)) {
      extras.push(markUnauthorized(step({
        step_id: `auth-${row.capability}`,
        title: row.title,
        purpose: 'Requested or implied mutating action',
        depends_on: steps.map(item => item.step_id).slice(-1),
        required_capabilities: [row.capability],
        required_evidence: [],
        expected_output: 'Blocked pending Commander approval',
        reversible: false,
        approval_required: true,
        risk_level: 'HIGH',
        status: 'BLOCKED_BY_AUTHORITY',
        required: true,
        blocked_reason: 'Authority does not permit this action. Step retained.',
      }), contract))
    }
  }
  return extras
}

export function planWithAtlas(input: {
  contract: MissionContractV1
  now?: string
}): AtlasPlanGraph {
  let steps: AtlasPlanStep[]
  switch (input.contract.mission_class) {
    case 'ENGINEERING_MISSION':
    case 'INCIDENT_RESPONSE':
    case 'RISK_REVIEW':
      steps = engineeringSteps(input.contract)
      break
    case 'DEEP_RESEARCH':
    case 'CURRENT_INTEL':
      steps = /run (?:them )?in parallel|parallel research/i.test(input.contract.commander_wording)
        ? independentResearchSteps()
        : researchSteps()
      break
    case 'SYSTEM_STATUS':
      steps = statusSteps()
      break
    case 'ARCHITECTURE_REVIEW':
    case 'DECISION_SUPPORT':
    case 'ANALYTICAL_COMPARISON':
      steps = decisionSteps()
      break
    default:
      steps = statusSteps()
  }
  steps = [...steps, ...injectUnauthorizedRequired(input.contract, steps)].map(item => markUnauthorized(item, input.contract))
  if (input.contract.explicit_exclusions.includes('system mutation')) {
    steps = steps.map(item => item.required_capabilities.some(cap => /commit|push|deploy|foundry|file\.write/.test(cap))
      ? { ...item, status: 'BLOCKED_BY_AUTHORITY', blocked_reason: 'Commander excluded system mutation', approval_required: true }
      : item)
  }
  const groups = new Map<string, string[]>()
  for (const item of steps) {
    if (item.parallel_group) {
      const list = groups.get(item.parallel_group) ?? []
      list.push(item.step_id)
      groups.set(item.parallel_group, list)
    }
  }
  const hard = steps.flatMap(item => item.depends_on.map(dep => ({ from: dep, to: item.step_id })))
  const blockers = steps.filter(item => item.status.startsWith('BLOCKED')).map(item => `${item.step_id}:${item.status}`)
  return Object.freeze({
    schema: ATLAS_PLAN_SCHEMA,
    mission_id: input.contract.mission_id,
    role: 'ATLAS',
    provider_kind: 'deterministic',
    steps,
    parallelizable_groups: [...groups.values()].filter(group => group.length > 1),
    hard_dependencies: hard,
    blockers,
    created_at: input.now ?? new Date().toISOString(),
  })
}

export function stepEvidenceSatisfied(step: AtlasPlanStep, evidenceClasses: readonly string[]): boolean {
  return step.required_evidence.every(item => evidenceClasses.includes(item))
}

export function markStepVerified(step: AtlasPlanStep, evidenceClasses: readonly string[]): AtlasPlanStep {
  if (!stepEvidenceSatisfied(step, evidenceClasses)) {
    return Object.freeze({ ...step, status: 'BLOCKED_BY_EVIDENCE', blocked_reason: 'Required evidence classes missing' })
  }
  if (step.status === 'BLOCKED_BY_AUTHORITY' || step.status === 'BLOCKED_BY_RISK') return step
  return Object.freeze({ ...step, status: 'READY' })
}
