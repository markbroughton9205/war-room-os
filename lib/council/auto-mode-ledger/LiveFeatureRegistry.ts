import type {
  LiveFeatureReadinessResult,
  LiveFeatureRegistryEntry,
  RegisteredFutureLiveActionType,
} from './types'

export const LIVE_FEATURE_REGISTRY: LiveFeatureRegistryEntry[] = [
  {
    actionType: 'mark_apple_reminder_read',
    targetSystem: 'apple_reminders',
    executionBridge: 'iphone_shortcut',
    enabled: true,
    executionAllowed: true,
    draftOnly: false,
    sendsMessage: false,
    mutatesRealSystem: true,
    requiresDurableLedger: true,
    requiresExplicitExecutionApproval: true,
    requiresManualTrigger: true,
    notes: 'Only executable 46L live action; still manual iPhone Shortcut mediated.',
  },
  disabledFuture('mark_apple_reminder_unread', 'apple_reminders', 'iphone_shortcut', false),
  disabledFuture('create_apple_reminder_draft_packet', 'apple_reminders', 'iphone_shortcut', true),
  disabledFuture('add_apple_note_draft_packet', 'apple_notes', 'iphone_shortcut', true),
  disabledFuture('create_calendar_event_draft_packet', 'apple_calendar', 'server_oauth_rest_future', true),
  disabledFuture('create_text_message_draft_packet', 'apple_messages', 'iphone_shortcut', true),
]

export function validateLiveFeatureRegistry(
  registry: LiveFeatureRegistryEntry[] = LIVE_FEATURE_REGISTRY
): LiveFeatureReadinessResult {
  const violations: string[] = []
  const executableLiveActions = registry
    .filter(entry => entry.enabled && entry.executionAllowed)
    .map(entry => entry.actionType)
    .filter((actionType): actionType is 'mark_apple_reminder_read' => actionType === 'mark_apple_reminder_read')
  const disabledFutureActions = registry
    .filter(entry => entry.actionType !== 'mark_apple_reminder_read')
    .map(entry => entry.actionType as RegisteredFutureLiveActionType)

  for (const entry of registry) {
    if (entry.actionType !== 'mark_apple_reminder_read' && (entry.enabled || entry.executionAllowed)) {
      violations.push(`${entry.actionType} must remain disabled in 46L.`)
    }
    if (entry.actionType === 'create_text_message_draft_packet') {
      if (!entry.draftOnly) violations.push('create_text_message_draft_packet must be draft-only.')
      if (entry.sendsMessage !== false) violations.push('create_text_message_draft_packet must not send messages.')
    }
  }

  if (executableLiveActions.length !== 1 || executableLiveActions[0] !== 'mark_apple_reminder_read') {
    violations.push('Only mark_apple_reminder_read may be executable in 46L.')
  }

  return {
    ready: violations.length === 0,
    executableLiveActions,
    disabledFutureActions,
    violations,
  }
}

function disabledFuture(
  actionType: RegisteredFutureLiveActionType,
  targetSystem: LiveFeatureRegistryEntry['targetSystem'],
  executionBridge: LiveFeatureRegistryEntry['executionBridge'],
  draftOnly: boolean
): LiveFeatureRegistryEntry {
  return {
    actionType,
    targetSystem,
    executionBridge,
    enabled: false,
    executionAllowed: false,
    draftOnly,
    sendsMessage: false,
    mutatesRealSystem: false,
    requiresDurableLedger: true,
    requiresExplicitExecutionApproval: true,
    requiresManualTrigger: true,
    notes: 'Registered for future readiness only. No execution is allowed in 46L.',
  }
}
