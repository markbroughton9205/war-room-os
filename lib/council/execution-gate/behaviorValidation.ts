import { BrainSelectionEngine } from '../brain-selection'
import { CouncilExecutionPlanner } from '../execution-plan'
import { CouncilDecisionEngine } from '../routing'
import { ApprovedExecutionPreviewBuilder } from './ApprovedExecutionPreviewBuilder'
import type { ApprovedExecutionPreview, BlockedExecutionType, GateBehaviorValidationResult } from './types'

type GateBehaviorCase = {
  commanderInput: string
  expectedBlockedTypes: BlockedExecutionType[]
  expectedApprovalRequired?: boolean
  check?: (preview: ApprovedExecutionPreview) => string[]
}

const baseExpectedBlockedTypes: BlockedExecutionType[] = [
  'provider_call',
  'tool_call',
  'database_mutation',
  'repo_mutation',
  'message_send',
  'payment_action',
  'deployment_action',
  'live_research',
  'memory_write',
  'external_side_effect',
  'auto_mode_action',
]

// ExecutionGate.decide() always blocks the full ALL_BLOCKED_EXECUTION_TYPES set
// regardless of commander message content -- that is Phase 46F's actual, correct,
// maximally-conservative behavior (nothing is ever selectively unblocked). Every
// case below therefore expects the full list, and validateCase() checks exact set
// equality rather than a subset, so a future regression that narrowed blocking to
// only "relevant" types would fail this test instead of passing trivially.
const gateBehaviorCases: GateBehaviorCase[] = [
  { commanderInput: 'hello families', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'build me a login system', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'what’s happening with fuel prices lately', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'is this message a scam?', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: false },
  { commanderInput: 'write an outreach message', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: false },
  { commanderInput: 'run full council', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'scout income opportunities', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'fix this bug', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'send this email to Jasmine', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'update Supabase with this', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'deploy this to Vercel', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
  { commanderInput: 'commit and push this', expectedBlockedTypes: baseExpectedBlockedTypes, expectedApprovalRequired: true },
]

function buildPreview(commanderInput: string): ApprovedExecutionPreview {
  const routingEngine = new CouncilDecisionEngine()
  const brainEngine = new BrainSelectionEngine()
  const executionPlanner = new CouncilExecutionPlanner()
  const previewBuilder = new ApprovedExecutionPreviewBuilder()
  const routingNote = routingEngine.decide({
    message: commanderInput,
    routingId: `gate_validation_routing_${commanderInput.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
    timestamp: '2026-07-07T00:00:00.000Z',
  })
  const brainRecommendation = brainEngine.recommend({
    routingNote,
    commanderMessage: commanderInput,
    recommendationId: `gate_validation_brain_${routingNote.routingId}`,
    createdAt: '2026-07-07T00:00:00.000Z',
  })
  const executionPlan = executionPlanner.plan({
    commanderMessage: commanderInput,
    routingNote,
    brainRecommendation,
    executionPlanId: `gate_validation_execution_${routingNote.routingId}`,
    createdAt: '2026-07-07T00:00:00.000Z',
  })

  return previewBuilder.build({
    executionPlan,
    previewId: `gate_validation_preview_${executionPlan.executionPlanId}`,
    createdAt: '2026-07-07T00:00:00.000Z',
  })
}

// Exact set equality, not a subset check: flags both a missing expected type
// (blocking narrowed) and an unexpected extra type (blocking widened/malformed),
// so either direction of drift from the full-block list fails the test.
function blockedTypesMismatchNotes(
  expected: BlockedExecutionType[],
  observed: BlockedExecutionType[],
): string[] {
  const expectedSet = new Set(expected)
  const observedSet = new Set(observed)
  return [
    ...expected.filter(type => !observedSet.has(type)).map(type => `missing expected blocked type ${type}`),
    ...observed.filter(type => !expectedSet.has(type)).map(type => `unexpected blocked type ${type} observed`),
  ]
}

function validateCase(testCase: GateBehaviorCase): GateBehaviorValidationResult {
  const preview = buildPreview(testCase.commanderInput)
  const observedBlockedTypes = preview.executionGateDecision.blockedExecutionTypes
  const notes = [
    ...blockedTypesMismatchNotes(testCase.expectedBlockedTypes, observedBlockedTypes),
    ...(testCase.expectedApprovalRequired !== undefined && preview.approvalRequired !== testCase.expectedApprovalRequired
      ? [`expected approval ${testCase.expectedApprovalRequired}, observed ${preview.approvalRequired}`]
      : []),
    ...(preview.executionAllowed === false ? [] : ['executionAllowed must be false']),
    ...(preview.liveExecutionEnabled === false ? [] : ['liveExecutionEnabled must be false']),
    ...(preview.autoModePolicy.autoModeEnabled === false ? [] : ['autoModeEnabled must be false']),
    ...(preview.autoModePolicy.allowedAutoActionTypes.length === 0 ? [] : ['allowedAutoActionTypes must be empty']),
    ...(testCase.check ? testCase.check(preview) : []),
  ]

  return {
    commanderInput: testCase.commanderInput,
    expectedBlockedTypes: testCase.expectedBlockedTypes,
    observedBlockedTypes,
    expectedApprovalRequired: testCase.expectedApprovalRequired,
    observedApprovalRequired: preview.approvalRequired,
    expectedAutoModeEnabled: false,
    observedAutoModeEnabled: preview.autoModePolicy.autoModeEnabled,
    expectedExecutionAllowed: false,
    observedExecutionAllowed: preview.executionAllowed,
    expectedLiveExecutionEnabled: false,
    observedLiveExecutionEnabled: preview.liveExecutionEnabled,
    result: notes.length === 0 ? 'PASS' : 'FAIL',
    notes,
  }
}

export function runExecutionGateBehaviorValidation(): GateBehaviorValidationResult[] {
  return gateBehaviorCases.map(validateCase)
}
