import type {
  ActionRequest,
  AutoEligibilityDecision,
  AutoEligibilityReason,
} from './types'

const VALIDATION_TIME = '2026-07-07T12:00:00.000Z'

const ALLOWED_ACTIONS = [
  'mark_reminder_read',
  'tag_memory',
  'summarize_text',
  'format_text',
]

const ALLOWED_TARGETS: Record<string, string> = {
  mark_reminder_read: 'reminder',
  tag_memory: 'memory',
  summarize_text: 'text',
  format_text: 'text',
}

const ALLOWED_PARAMETERS: Record<string, string[]> = {
  mark_reminder_read: [],
  tag_memory: ['tag'],
  summarize_text: ['text'],
  format_text: ['text', 'presentationOnly'],
}

export class AutoModeEligibilityClassifier {
  classify(actionRequest: ActionRequest, createdAt = VALIDATION_TIME): AutoEligibilityDecision {
    const bundledDecisions = actionRequest.bundledActions.map(action =>
      this.classifySingle(action, createdAt)
    )

    if (actionRequest.bundledActions.length > 0) {
      const ineligibleBundleMember = bundledDecisions.find(decision => !decision.independentlyEligible)
      const duplicateAction = this.findDuplicateBundledAction(actionRequest.bundledActions)

      if (duplicateAction) {
        return this.buildDecision({
          actionRequest,
          createdAt,
          reason: 'duplicate_bundled_action',
          message: 'Bundled duplicate actions are not auto-eligible because double-application risk must be reviewed manually.',
          independentlyEligible: false,
          bundledDecisions,
          extraPath: [
            'Request contained bundled actions.',
            `Duplicate bundled action detected for ${duplicateAction}.`,
            'Entire bundle was rejected; no partial or repeated auto-application is allowed.',
          ],
        })
      }

      if (ineligibleBundleMember) {
        return this.buildDecision({
          actionRequest,
          createdAt,
          reason: 'bundled_action_not_independently_eligible',
          message: `Bundled action ${ineligibleBundleMember.actionType} is not independently auto-eligible.`,
          independentlyEligible: false,
          bundledDecisions,
          extraPath: [
            'Request contained bundled actions.',
            `Bundled member ${ineligibleBundleMember.actionType} failed independent eligibility.`,
            'Entire bundle was rejected; no decomposed partial approval is allowed.',
          ],
        })
      }

      return this.buildDecision({
        actionRequest,
        createdAt,
        reason: 'bundles_manual_by_default',
        message: 'All bundled actions are independently eligible, but bundles still require manual approval in Phase 46J.',
        independentlyEligible: false,
        bundledDecisions,
        extraPath: [
          'Request contained bundled actions.',
          'Every bundled member was checked independently.',
          'Policy defaults bundled actions to manual review unless a future phase explicitly allows them.',
        ],
      })
    }

    return this.classifySingle(actionRequest, createdAt)
  }

  private classifySingle(
    actionRequest: ActionRequest,
    createdAt: string
  ): AutoEligibilityDecision {
    if (!ALLOWED_ACTIONS.includes(actionRequest.actionType)) {
      return this.buildDecision({
        actionRequest,
        createdAt,
        reason: 'unknown_action_type',
        message: `${actionRequest.actionType} is not in the literal auto-mode allowlist.`,
      })
    }

    if (
      actionRequest.actionType === 'tag_memory' &&
      actionRequest.targetType !== 'memory'
    ) {
      return this.buildDecision({
        actionRequest,
        createdAt,
        reason: 'scope_not_allowed',
        message: 'tag_memory can only target memory scope.',
      })
    }

    if (actionRequest.targetType !== ALLOWED_TARGETS[actionRequest.actionType]) {
      return this.buildDecision({
        actionRequest,
        createdAt,
        reason: 'wrong_target_type',
        message: `${actionRequest.actionType} requires targetType ${ALLOWED_TARGETS[actionRequest.actionType]}.`,
      })
    }

    if (!actionRequest.targetId || actionRequest.targetId.trim().length === 0) {
      return this.buildDecision({
        actionRequest,
        createdAt,
        reason: 'missing_target_id',
        message: `${actionRequest.actionType} requires a concrete targetId.`,
      })
    }

    const parameterIssue = this.validateParameters(actionRequest)
    if (parameterIssue) {
      return this.buildDecision({
        actionRequest,
        createdAt,
        reason: parameterIssue.reason,
        message: parameterIssue.message,
      })
    }

    return this.buildDecision({
      actionRequest,
      createdAt,
      reason: 'allowed_single_reversible_action',
      message: `${actionRequest.actionType} is a single reversible fake-sandbox action.`,
      independentlyEligible: true,
      extraPath: [
        'Action matched the literal allowlist.',
        'Target type, targetId, and parameter shape passed strict checks.',
        'No bundled actions were present.',
      ],
    })
  }

  private validateParameters(
    actionRequest: ActionRequest
  ): { reason: AutoEligibilityReason; message: string } | null {
    const allowedParameters = ALLOWED_PARAMETERS[actionRequest.actionType] ?? []
    const actualParameters = Object.keys(actionRequest.parameters)
    const unexpectedParameter = actualParameters.find(
      parameter => !allowedParameters.includes(parameter)
    )

    if (unexpectedParameter) {
      return {
        reason: 'unexpected_parameter',
        message: `Unexpected parameter ${unexpectedParameter} is not allowed for ${actionRequest.actionType}.`,
      }
    }

    if (
      actionRequest.actionType === 'tag_memory' &&
      typeof actionRequest.parameters.tag !== 'string'
    ) {
      return {
        reason: 'missing_required_parameter',
        message: 'tag_memory requires a string tag parameter.',
      }
    }

    if (
      actionRequest.actionType === 'tag_memory' &&
      this.containsExecutableLookingContent(actionRequest.parameters.tag)
    ) {
      return {
        reason: 'unsafe_parameter_content',
        message: 'Tag content resembles executable or command-like input.',
      }
    }

    if (
      (actionRequest.actionType === 'summarize_text' ||
        actionRequest.actionType === 'format_text') &&
      typeof actionRequest.parameters.text !== 'string'
    ) {
      return {
        reason: 'missing_required_parameter',
        message: `${actionRequest.actionType} requires a text parameter.`,
      }
    }

    if (
      actionRequest.actionType === 'summarize_text' &&
      this.sourceRequestsExternalAction(actionRequest.parameters.text)
    ) {
      return {
        reason: 'source_requests_external_action',
        message: 'Source text asks the system to take an action instead of only summarize.',
      }
    }

    if (
      actionRequest.actionType === 'format_text' &&
      actionRequest.parameters.presentationOnly !== true
    ) {
      return {
        reason: 'semantic_change_risk',
        message: 'format_text requires presentationOnly: true to prove meaning is preserved.',
      }
    }

    return null
  }

  private buildDecision(input: {
    actionRequest: ActionRequest
    createdAt: string
    reason: AutoEligibilityReason
    message: string
    independentlyEligible?: boolean
    bundledDecisions?: AutoEligibilityDecision[]
    extraPath?: string[]
  }): AutoEligibilityDecision {
    const autoEligible = input.reason === 'allowed_single_reversible_action'
    const decisionPath = [
      `Structured ActionRequest received for ${input.actionRequest.actionType}.`,
      `Target evaluated as ${input.actionRequest.targetType}:${input.actionRequest.targetId ?? 'none'}.`,
      ...(input.extraPath ?? [`Rejected because ${input.reason}.`]),
    ]

    return {
      decisionId: `auto_eligibility_${input.actionRequest.actionType}_${input.createdAt}`,
      actionType: input.actionRequest.actionType,
      status: autoEligible ? 'eligible' : 'not_eligible',
      autoEligible,
      reason: input.reason,
      message: input.message,
      independentlyEligible: input.independentlyEligible ?? autoEligible,
      checkedBundledActions: input.bundledDecisions ?? [],
      decisionPath,
      createdAt: input.createdAt,
    }
  }

  private containsExecutableLookingContent(value: unknown): boolean {
    if (typeof value !== 'string') return false

    return /\b(rm\s+-rf|curl\s+|powershell|cmd\.exe|<script|DROP\s+TABLE|deploy|send\s+message)\b/i.test(value)
  }

  private sourceRequestsExternalAction(value: unknown): boolean {
    if (typeof value !== 'string') return false

    return /\b(send|delete|deploy|transfer|withdraw|email|text|call|submit|apply|purchase|pay)\b/i.test(value)
  }

  private findDuplicateBundledAction(actions: ActionRequest[]): string | null {
    const seen = new Set<string>()

    for (const action of actions) {
      const key = `${action.actionType}:${action.targetType}:${action.targetId ?? 'none'}`
      if (seen.has(key)) return key
      seen.add(key)
    }

    return null
  }
}
