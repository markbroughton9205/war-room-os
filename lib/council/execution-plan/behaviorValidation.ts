import { BrainSelectionEngine } from '../brain-selection'
import { CouncilDecisionEngine } from '../routing'
import { CouncilExecutionPlanner } from './CouncilExecutionPlanner'
import type { BehaviorValidationResult, ExecutionPlan } from './types'

type BehaviorCase = {
  commanderInput: string
  expectedIntent?: string
  expectedEntities?: string[]
  expectedSkills?: string[]
  expectedApproval?: boolean
  expectedBlocked?: boolean
  check: (plan: ExecutionPlan) => string[]
}

const hasAny = (observed: string[], expected: string[]): boolean =>
  expected.some(value => observed.includes(value))

const behaviorCases: BehaviorCase[] = [
  {
    commanderInput: 'hello families',
    expectedIntent: 'unknown',
    expectedSkills: ['synthesis'],
    expectedApproval: false,
    expectedBlocked: true,
    check: plan => [
      ...(plan.executionAllowed === false ? [] : ['executionAllowed must be false']),
      ...(plan.executionSteps.length <= 4 ? [] : ['casual greeting should not create a heavy council plan']),
      ...(plan.executionSteps.some(step => step.actionType === 'synthesize') ? [] : ['expected synthesize step']),
    ],
  },
  {
    commanderInput: 'build me a login system',
    expectedIntent: 'implementation',
    expectedEntities: ['engineer', 'architect'],
    expectedSkills: ['implementation_planning', 'technical_execution_planning'],
    expectedApproval: true,
    expectedBlocked: true,
    check: plan => [
      ...(plan.executionSteps.some(step => step.actionType === 'propose_action') ? [] : ['expected propose_action step']),
      ...(plan.safetyChecks.some(check => check.checkId === 'approval_required') ? [] : ['expected approval safety check']),
    ],
  },
  {
    commanderInput: 'what’s happening with fuel prices lately',
    expectedIntent: 'research',
    expectedSkills: ['internet_awareness', 'research_review'],
    expectedApproval: true,
    expectedBlocked: true,
    check: plan => [
      ...(plan.safetyChecks.some(check => check.checkId === 'live_research_not_executed')
        ? []
        : ['expected live research blocked safety check']),
      ...(plan.fallbackPlan.steps.some(step => step.includes('live research')) ? [] : ['expected live research fallback']),
    ],
  },
  {
    commanderInput: 'is this message a scam?',
    expectedIntent: 'risk',
    expectedEntities: ['skeptic'],
    expectedSkills: ['risk_analysis', 'scam_detection'],
    expectedApproval: false,
    expectedBlocked: false,
    check: plan => [
      ...(plan.executionSteps.some(step => step.actionType === 'critique' || step.actionType === 'reason')
        ? []
        : ['expected critique or reason step']),
      ...(plan.selectedBrainCandidateId === 'static-council-rules'
        ? ['static-only candidate should not be primary for scam reasoning if below capability floor']
        : []),
    ],
  },
  {
    commanderInput: 'write an outreach message',
    expectedIntent: 'communication',
    expectedEntities: ['strategist'],
    expectedSkills: ['writing', 'synthesis'],
    expectedApproval: false,
    expectedBlocked: false,
    check: plan => [
      ...(plan.executionSteps.some(step => step.actionType === 'draft' || step.actionType === 'propose_action')
        ? []
        : ['expected draft/propose_action step']),
      ...(plan.safetyChecks.some(check => check.label === 'No external side effects') ? [] : ['expected no-send safety check']),
    ],
  },
  {
    commanderInput: 'run full council',
    expectedIntent: 'coordination',
    expectedApproval: true,
    expectedBlocked: true,
    check: plan => [
      ...(plan.selectedEntityIds.length > 1 ? [] : ['expected multi-entity plan']),
      ...(plan.safetyChecks.some(check => check.checkId === 'approval_required') ? [] : ['expected approval required']),
      ...(plan.executionAllowed === false ? [] : ['executionAllowed must be false']),
    ],
  },
  {
    commanderInput: 'scout income opportunities',
    expectedIntent: 'research',
    expectedEntities: ['scout', 'strategist'],
    expectedSkills: ['opportunity_sensing', 'internet_awareness'],
    expectedApproval: true,
    expectedBlocked: true,
    check: plan => [
      ...(plan.safetyChecks.some(check => check.checkId === 'live_research_not_executed')
        ? []
        : ['expected live/current data block']),
      ...(plan.executionAllowed === false ? [] : ['executionAllowed must be false']),
    ],
  },
  {
    commanderInput: 'fix this bug',
    expectedIntent: 'implementation',
    expectedEntities: ['engineer', 'architect', 'skeptic'],
    expectedApproval: true,
    expectedBlocked: true,
    check: plan => [
      ...(plan.safetyChecks.some(check => check.checkId === 'repo_mutation_disabled')
        ? []
        : ['expected repo mutation disabled safety check']),
      ...(plan.executionSteps.some(step => step.actionType === 'propose_action') ? [] : ['expected propose_action step']),
    ],
  },
]

function validateCase(testCase: BehaviorCase): BehaviorValidationResult {
  const routingEngine = new CouncilDecisionEngine()
  const brainEngine = new BrainSelectionEngine()
  const executionPlanner = new CouncilExecutionPlanner()
  const routingNote = routingEngine.decide({
    message: testCase.commanderInput,
    routingId: `validation_routing_${testCase.commanderInput.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
    timestamp: '2026-07-07T00:00:00.000Z',
  })
  const brainRecommendation = brainEngine.recommend({
    routingNote,
    commanderMessage: testCase.commanderInput,
    recommendationId: `validation_brain_${routingNote.routingId}`,
    createdAt: '2026-07-07T00:00:00.000Z',
  })
  const plan = executionPlanner.plan({
    commanderMessage: testCase.commanderInput,
    routingNote,
    brainRecommendation,
    executionPlanId: `validation_execution_${routingNote.routingId}`,
    createdAt: '2026-07-07T00:00:00.000Z',
  })
  const notes = [
    ...(testCase.expectedIntent && plan.intent !== testCase.expectedIntent
      ? [`expected intent ${testCase.expectedIntent}, observed ${plan.intent}`]
      : []),
    ...(testCase.expectedEntities && !hasAny(plan.selectedEntityIds, testCase.expectedEntities)
      ? [`expected one of entities ${testCase.expectedEntities.join(', ')}`]
      : []),
    ...(testCase.expectedSkills && !hasAny(plan.selectedSkillIds, testCase.expectedSkills)
      ? [`expected one of skills ${testCase.expectedSkills.join(', ')}`]
      : []),
    ...(testCase.expectedApproval !== undefined && plan.approvalRequired !== testCase.expectedApproval
      ? [`expected approval ${testCase.expectedApproval}, observed ${plan.approvalRequired}`]
      : []),
    ...(testCase.expectedBlocked !== undefined && Boolean(plan.blockedReason) !== testCase.expectedBlocked
      ? [`expected blocked ${testCase.expectedBlocked}, observed ${Boolean(plan.blockedReason)}`]
      : []),
    ...testCase.check(plan),
  ]

  return {
    commanderInput: testCase.commanderInput,
    expectedIntent: testCase.expectedIntent,
    observedIntent: plan.intent,
    expectedEntities: testCase.expectedEntities,
    observedEntities: plan.selectedEntityIds,
    expectedSkills: testCase.expectedSkills,
    observedSkills: plan.selectedSkillIds,
    expectedApproval: testCase.expectedApproval,
    observedApproval: plan.approvalRequired,
    expectedExecutionAllowed: false,
    observedExecutionAllowed: plan.executionAllowed,
    expectedBlocked: testCase.expectedBlocked,
    observedBlocked: Boolean(plan.blockedReason),
    result: notes.length === 0 ? 'PASS' : 'FAIL',
    notes,
  }
}

export function runExecutionPlanBehaviorValidation(): BehaviorValidationResult[] {
  return behaviorCases.map(validateCase)
}
