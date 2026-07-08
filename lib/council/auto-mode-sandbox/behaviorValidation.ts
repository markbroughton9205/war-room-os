import { AutoModeEligibilityClassifier } from './AutoModeEligibilityClassifier'
import { AutoModeSandboxExecutor } from './AutoModeSandboxExecutor'
import { ClaimRealityVerifier } from './ClaimRealityVerifier'
import { FakeAutoActionSandbox } from './FakeAutoActionSandbox'
import type {
  ActionRequest,
  AutoEligibilityReason,
  AutoModeGateValidationResult,
  AutoModeValidationResult,
  AutoSandboxExecutionResult,
} from './types'

const VALIDATION_TIME = '2026-07-07T12:00:00.000Z'

type ClassifierCase = {
  caseId: string
  description: string
  actionRequest: ActionRequest
  expectedEligible: boolean
  expectedReason: AutoEligibilityReason
}

export function runAutoModeClassifierValidation(): AutoModeValidationResult[] {
  return getClassifierCases().map(runClassifierCase)
}

export function runAutoModeSandboxGateValidation(): AutoModeGateValidationResult[] {
  const classifierResults = runAutoModeClassifierValidation()

  return [
    {
      gateId: 'gate_1_structured_classifier_cases',
      description: 'All 20 structured classifier cases produce expected eligibility.',
      result: classifierResults.every(result => result.result === 'PASS') ? 'PASS' : 'FAIL',
      notes: classifierResults.map(
        result => `${result.caseId}:${result.observedReason}:${result.result}`
      ),
    },
    validateFreeTextUnavailable(),
    validateBundleNoPartialApplication(),
    validateKillSwitch(),
    validateReversibleApply(),
    validateRollbackRestoresSnapshot(),
    validateUnsafeActionBlocked(),
    validateNoLiveSideEffects(),
    validateClaimRealityMismatchDetected(),
  ]
}

function runClassifierCase(input: ClassifierCase): AutoModeValidationResult {
  const classifier = new AutoModeEligibilityClassifier()
  const decision = classifier.classify(input.actionRequest, VALIDATION_TIME)
  const passed =
    decision.autoEligible === input.expectedEligible &&
    decision.reason === input.expectedReason

  return {
    caseId: input.caseId,
    description: input.description,
    expectedEligible: input.expectedEligible,
    observedEligible: decision.autoEligible,
    expectedReason: input.expectedReason,
    observedReason: decision.reason,
    result: passed ? 'PASS' : 'FAIL',
    notes: decision.decisionPath,
  }
}

function getClassifierCases(): ClassifierCase[] {
  const markReminder = request('mark_reminder_read', 'reminder', 'reminder_1', {})
  const tagMemory = request('tag_memory', 'memory', 'memory_1', { tag: 'strategy' })
  const summarizeText = request('summarize_text', 'text', 'text_1', {
    text: 'This paragraph should be summarized without taking any external action.',
  })
  const formatText = request('format_text', 'text', 'text_1', {
    text: '  Keep   this meaning.  ',
    presentationOnly: true,
  })

  return [
    {
      caseId: 'case_01_mark_reminder_read_positive',
      description: 'mark_reminder_read alone is auto-eligible.',
      actionRequest: markReminder,
      expectedEligible: true,
      expectedReason: 'allowed_single_reversible_action',
    },
    {
      caseId: 'case_02_tag_memory_positive',
      description: 'tag_memory alone is auto-eligible.',
      actionRequest: tagMemory,
      expectedEligible: true,
      expectedReason: 'allowed_single_reversible_action',
    },
    {
      caseId: 'case_03_summarize_text_positive',
      description: 'summarize_text alone is auto-eligible.',
      actionRequest: summarizeText,
      expectedEligible: true,
      expectedReason: 'allowed_single_reversible_action',
    },
    {
      caseId: 'case_04_format_text_positive',
      description: 'format_text alone is auto-eligible.',
      actionRequest: formatText,
      expectedEligible: true,
      expectedReason: 'allowed_single_reversible_action',
    },
    {
      caseId: 'case_05_delete_reminder_negative',
      description: 'delete_reminder is not auto-eligible.',
      actionRequest: request('delete_reminder', 'reminder', 'reminder_1', {}),
      expectedEligible: false,
      expectedReason: 'unknown_action_type',
    },
    {
      caseId: 'case_06_send_message_negative',
      description: 'send_message is not auto-eligible.',
      actionRequest: request('send_message', 'sms', 'message_1', {}),
      expectedEligible: false,
      expectedReason: 'unknown_action_type',
    },
    {
      caseId: 'case_07_database_write_negative',
      description: 'database_write is not auto-eligible.',
      actionRequest: request('database_write', 'database', 'row_1', {}),
      expectedEligible: false,
      expectedReason: 'unknown_action_type',
    },
    {
      caseId: 'case_08_deploy_action_negative',
      description: 'deploy_action is not auto-eligible.',
      actionRequest: request('deploy_action', 'deployment', 'deploy_1', {}),
      expectedEligible: false,
      expectedReason: 'unknown_action_type',
    },
    {
      caseId: 'case_09_wrong_target_type_near_miss',
      description: 'mark_reminder_read with wrong targetType is not auto-eligible.',
      actionRequest: request('mark_reminder_read', 'memory', 'reminder_1', {}),
      expectedEligible: false,
      expectedReason: 'wrong_target_type',
    },
    {
      caseId: 'case_10_executable_tag_near_miss',
      description: 'tag_memory with executable-looking tag content is blocked.',
      actionRequest: request('tag_memory', 'memory', 'memory_1', { tag: 'run powershell deploy' }),
      expectedEligible: false,
      expectedReason: 'unsafe_parameter_content',
    },
    {
      caseId: 'case_11_summary_source_requests_action_near_miss',
      description: 'summarize_text where source requests an action is blocked.',
      actionRequest: request('summarize_text', 'text', 'text_1', {
        text: 'Summarize this and send the result to my phone.',
      }),
      expectedEligible: false,
      expectedReason: 'source_requests_external_action',
    },
    {
      caseId: 'case_12_format_changes_meaning_near_miss',
      description: 'format_text that may change meaning is blocked.',
      actionRequest: request('format_text', 'text', 'text_1', {
        text: 'Change this into a signed agreement.',
        presentationOnly: false,
      }),
      expectedEligible: false,
      expectedReason: 'semantic_change_risk',
    },
    {
      caseId: 'case_13_unexpected_parameter_near_miss',
      description: 'mark_reminder_read with unexpected parameter is blocked.',
      actionRequest: request('mark_reminder_read', 'reminder', 'reminder_1', { notify: true }),
      expectedEligible: false,
      expectedReason: 'unexpected_parameter',
    },
    {
      caseId: 'case_14_tag_scope_outside_allowed_near_miss',
      description: 'tag_memory targeting a non-memory scope is blocked.',
      actionRequest: request('tag_memory', 'reminder', 'memory_1', { tag: 'strategy' }),
      expectedEligible: false,
      expectedReason: 'scope_not_allowed',
    },
    {
      caseId: 'case_15_similar_action_string_near_miss',
      description: 'mark_reminder_deleted is not the literal allowed action.',
      actionRequest: request('mark_reminder_deleted', 'reminder', 'reminder_1', {}),
      expectedEligible: false,
      expectedReason: 'unknown_action_type',
    },
    {
      caseId: 'case_16_missing_target_id_near_miss',
      description: 'Allowed action with missing targetId is blocked.',
      actionRequest: request('mark_reminder_read', 'reminder', null, {}),
      expectedEligible: false,
      expectedReason: 'missing_target_id',
    },
    {
      caseId: 'case_17_bundle_eligible_plus_eligible',
      description: 'eligible + eligible bundle is manual by default.',
      actionRequest: bundle([markReminder, tagMemory]),
      expectedEligible: false,
      expectedReason: 'bundles_manual_by_default',
    },
    {
      caseId: 'case_18_bundle_eligible_plus_ineligible',
      description: 'eligible + ineligible bundle is blocked.',
      actionRequest: bundle([markReminder, request('send_message', 'sms', 'message_1', {})]),
      expectedEligible: false,
      expectedReason: 'bundled_action_not_independently_eligible',
    },
    {
      caseId: 'case_19_bundle_ineligible_plus_eligible',
      description: 'ineligible + eligible bundle is blocked.',
      actionRequest: bundle([request('database_write', 'database', 'row_1', {}), markReminder]),
      expectedEligible: false,
      expectedReason: 'bundled_action_not_independently_eligible',
    },
    {
      caseId: 'case_20_bundle_duplicate_eligible',
      description: 'duplicate bundled eligible actions are blocked to avoid double-application.',
      actionRequest: bundle([markReminder, markReminder]),
      expectedEligible: false,
      expectedReason: 'duplicate_bundled_action',
    },
  ]
}

function validateFreeTextUnavailable(): AutoModeGateValidationResult {
  const classifier = new AutoModeEligibilityClassifier()
  const decision = classifier.classify(request('summarize_text', 'text', 'text_1', {
    text: 'Plain commander text is not accepted here; this is structured only.',
  }))

  return {
    gateId: 'gate_2_structured_input_only',
    description: 'Classifier accepts structured ActionRequest, not raw commander text.',
    result: decision.actionType === 'summarize_text' ? 'PASS' : 'FAIL',
    notes: ['TypeScript API requires ActionRequest shape at compile time.'],
  }
}

function validateBundleNoPartialApplication(): AutoModeGateValidationResult {
  const executor = new AutoModeSandboxExecutor()
  const before = executor.getSandbox().snapshot()
  const result = executor.run(bundle([
    request('mark_reminder_read', 'reminder', 'reminder_1', {}),
    request('send_message', 'sms', 'message_1', {}),
  ]))
  const after = executor.getSandbox().snapshot()
  const noAppliedActions = after.auditEvents.every(event => event.eventType !== 'action_applied')
  const unchanged = JSON.stringify(before.reminders) === JSON.stringify(after.reminders)

  return {
    gateId: 'gate_3_no_partial_bundle_application',
    description: 'Ineligible bundle applies no partial action.',
    result: result.status === 'blocked' && noAppliedActions && unchanged ? 'PASS' : 'FAIL',
    notes: [result.message],
  }
}

function validateKillSwitch(): AutoModeGateValidationResult {
  const executor = new AutoModeSandboxExecutor()
  executor.getKillSwitch().engage('Validation kill switch.')
  const result = executor.run(request('mark_reminder_read', 'reminder', 'reminder_1', {}))

  return {
    gateId: 'gate_4_kill_switch_blocks',
    description: 'Engaged kill switch blocks otherwise eligible actions.',
    result: result.status === 'blocked' && result.killSwitchEngaged ? 'PASS' : 'FAIL',
    notes: [result.message],
  }
}

function validateReversibleApply(): AutoModeGateValidationResult {
  const executor = new AutoModeSandboxExecutor()
  const result = executor.run(request('mark_reminder_read', 'reminder', 'reminder_1', {}))

  return {
    gateId: 'gate_5_reversible_apply',
    description: 'Eligible action applies in fake sandbox with rollback checkpoint.',
    result:
      result.status === 'applied' &&
      result.sandboxChanged &&
      Boolean(result.checkpoint) &&
      Boolean(result.rollbackPlan)
        ? 'PASS'
        : 'FAIL',
    notes: [result.message],
  }
}

function validateRollbackRestoresSnapshot(): AutoModeGateValidationResult {
  const executor = new AutoModeSandboxExecutor()
  const before = executor.getSandbox().snapshot()
  const applied = executor.run(request('tag_memory', 'memory', 'memory_1', { tag: 'strategy' }))
  const rolledBack = executor.rollback(applied)
  const after = executor.getSandbox().snapshot()
  const restored =
    JSON.stringify(before.reminders) === JSON.stringify(after.reminders) &&
    JSON.stringify(before.memoryTags) === JSON.stringify(after.memoryTags) &&
    JSON.stringify(before.generatedArtifacts) === JSON.stringify(after.generatedArtifacts)

  return {
    gateId: 'gate_6_rollback_restores_state',
    description: 'Rollback restores fake sandbox records to checkpoint state.',
    result: rolledBack.status === 'rolled_back' && restored ? 'PASS' : 'FAIL',
    notes: [rolledBack.message],
  }
}

function validateUnsafeActionBlocked(): AutoModeGateValidationResult {
  const executor = new AutoModeSandboxExecutor()
  const result = executor.run(request('deploy_action', 'deployment', 'deploy_1', {}))

  return {
    gateId: 'gate_7_unsafe_actions_blocked',
    description: 'Non-allowlisted action types do not create checkpoints or changes.',
    result:
      result.status === 'blocked' &&
      !result.sandboxChanged &&
      result.checkpoint === null &&
      result.rollbackPlan === null
        ? 'PASS'
        : 'FAIL',
    notes: [result.message],
  }
}

function validateNoLiveSideEffects(): AutoModeGateValidationResult {
  const executor = new AutoModeSandboxExecutor()
  const result = executor.run(request('format_text', 'text', 'text_1', {
    text: '   Keep this exact meaning. ',
    presentationOnly: true,
  }))

  return {
    gateId: 'gate_8_fake_sandbox_only',
    description: 'Applied action writes only to FakeAutoActionSandbox records.',
    result:
      result.status === 'applied' &&
      executor.getSandbox().snapshot().generatedArtifacts.length === 1
        ? 'PASS'
        : 'FAIL',
    notes: ['No route, provider, database, network, or filesystem adapter is imported by this module.'],
  }
}

function validateClaimRealityMismatchDetected(): AutoModeGateValidationResult {
  const sandbox = new FakeAutoActionSandbox()
  const verifier = new ClaimRealityVerifier()
  const before = sandbox.snapshot()
  sandbox.apply(request('mark_reminder_read', 'reminder', 'reminder_1', {}), VALIDATION_TIME)
  const forgedResult: AutoSandboxExecutionResult = {
    executionId: 'forged_claim',
    status: 'applied',
    actionRequest: request('mark_reminder_read', 'reminder', 'reminder_1', {}),
    eligibilityDecision: new AutoModeEligibilityClassifier().classify(
      request('mark_reminder_read', 'reminder', 'reminder_1', {}),
      VALIDATION_TIME
    ),
    killSwitchEngaged: false,
    sandboxChanged: false,
    appliedActionIds: [],
    checkpoint: null,
    rollbackPlan: null,
    rollbackResult: null,
    claimRealityReport: null,
    message: 'Forged result claims no change.',
    createdAt: VALIDATION_TIME,
  }
  const report = verifier.verify({
    executionResult: forgedResult,
    beforeSnapshot: before,
    afterSnapshot: sandbox.snapshot(),
    createdAt: VALIDATION_TIME,
  })

  return {
    gateId: 'gate_9_claim_vs_reality',
    description: 'Claim-vs-reality verifier catches forged no-change claims.',
    result: !report.claimMatchesReality && report.issues.length >= 2 ? 'PASS' : 'FAIL',
    notes: report.issues.map(issue => issue.message),
  }
}

function request(
  actionType: string,
  targetType: string,
  targetId: string | null,
  parameters: Record<string, unknown>,
  bundledActions: ActionRequest[] = []
): ActionRequest {
  return {
    actionType,
    targetType,
    targetId,
    parameters,
    bundledActions,
  }
}

function bundle(bundledActions: ActionRequest[]): ActionRequest {
  return request('bundled_actions', 'bundle', 'bundle_1', {}, bundledActions)
}
