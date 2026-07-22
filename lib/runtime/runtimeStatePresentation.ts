export const RUNTIME_STATE_KINDS = [
  'loading',
  'ready',
  'healthy_empty',
  'waiting_for_first_run',
  'not_configured',
  'unavailable',
  'failed',
  'stale',
  'unknown',
] as const

export type RuntimeStateKind = (typeof RUNTIME_STATE_KINDS)[number]

export type RuntimeStatePresentation = {
  state: RuntimeStateKind
  label: string
  explanation: string
  lastUpdated?: string | null
  reasonCode?: string | null
  nextAction?: string | null
  retryPermitted: boolean
  isDefect: boolean
}

type AnalyticsRuntimeInput = {
  loading: boolean
  requestFailed: boolean
  hasSnapshot: boolean
  configurationPresent: boolean
  persistenceAvailable?: boolean
  migrationStatus?: 'READY' | 'MIGRATION_REQUIRED' | 'UNAVAILABLE'
  latestScanStatus?: 'completed' | 'partial' | 'failed' | null
  latestScanCompletedAt?: string | null
  resultCount?: number
  staleResultCount?: number
  maxAgeDays?: number
}

type ApprovalsRuntimeInput = {
  loading: boolean
  requestFailed: boolean
  hasSnapshot: boolean
  configurationPresent: boolean
  persistenceAvailable?: boolean
  actionCount?: number
  generatedAt?: string | null
}

function state(
  value: RuntimeStateKind,
  label: string,
  explanation: string,
  options: Partial<Omit<RuntimeStatePresentation, 'state' | 'label' | 'explanation'>> = {},
): RuntimeStatePresentation {
  return {
    state: value,
    label,
    explanation,
    lastUpdated: options.lastUpdated ?? null,
    reasonCode: options.reasonCode ?? null,
    nextAction: options.nextAction ?? null,
    retryPermitted: options.retryPermitted ?? false,
    isDefect: options.isDefect ?? false,
  }
}

export function analyticsRuntimePresentation(input: AnalyticsRuntimeInput): RuntimeStatePresentation {
  if (input.loading && !input.hasSnapshot) {
    return state('loading', 'Loading analytics', 'Retrieving the latest saved signal snapshot.', {
      reasonCode: 'INITIAL_LOAD',
    })
  }
  if (input.requestFailed) {
    return state('failed', 'Analytics request failed', 'The latest analytics request did not complete. No replacement data was generated.', {
      reasonCode: 'SIGNAL_REQUEST_FAILED',
      nextAction: 'Retry the existing analytics request.',
      retryPermitted: true,
      isDefect: true,
    })
  }
  if (!input.configurationPresent) {
    return state('not_configured', 'Analytics not configured', 'The public project connection required to read saved signal results is not configured locally.', {
      reasonCode: 'PUBLIC_PROJECT_CONFIGURATION_MISSING',
      nextAction: 'Open approved configuration guidance.',
    })
  }
  if (!input.hasSnapshot) {
    return state('unknown', 'Analytics state unknown', 'No analytics response is available, so the runtime condition cannot be verified.', {
      reasonCode: 'NO_SIGNAL_SNAPSHOT',
      nextAction: 'Refresh status.',
      retryPermitted: true,
      isDefect: true,
    })
  }
  if (input.migrationStatus === 'MIGRATION_REQUIRED') {
    return state('not_configured', 'Signal storage requires configuration', 'The required signal tables are not available to the application.', {
      reasonCode: 'SIGNAL_SCHEMA_REQUIRED',
      nextAction: 'Ask an authorized administrator to review the signal schema guidance.',
    })
  }
  if (!input.persistenceAvailable || input.migrationStatus === 'UNAVAILABLE') {
    return state('unavailable', 'Saved analytics unavailable', 'The application could not load the saved signal store. No signal results are being inferred.', {
      reasonCode: 'SIGNAL_PERSISTENCE_UNAVAILABLE',
      nextAction: 'Refresh status after the configured service is available.',
      retryPermitted: true,
    })
  }
  if (!input.latestScanStatus) {
    return state('waiting_for_first_run', 'Waiting for first signal scan', 'Signal storage is available, but no completed scan has been recorded yet.', {
      reasonCode: 'NO_COMPLETED_SIGNAL_SCAN',
      nextAction: 'Run the existing bounded signal scan when authorized.',
      retryPermitted: true,
    })
  }
  if (input.latestScanStatus === 'failed') {
    return state('failed', 'Latest signal scan failed', 'The most recent recorded scan failed and did not produce a trusted replacement result.', {
      lastUpdated: input.latestScanCompletedAt,
      reasonCode: 'LATEST_SIGNAL_SCAN_FAILED',
      nextAction: 'Retry the existing bounded scan.',
      retryPermitted: true,
      isDefect: true,
    })
  }
  const completedAt = input.latestScanCompletedAt ? Date.parse(input.latestScanCompletedAt) : Number.NaN
  const maxAgeMs = (input.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000
  const scanIsStale = Number.isFinite(completedAt) && Date.now() - completedAt > maxAgeMs
  if (scanIsStale || ((input.resultCount ?? 0) === 0 && (input.staleResultCount ?? 0) > 0)) {
    return state('stale', 'Analytics data is stale', 'Only expired or archival signal evidence is available; it is not presented as current intelligence.', {
      lastUpdated: input.latestScanCompletedAt,
      reasonCode: 'NO_CURRENT_SIGNAL_RESULTS',
      nextAction: 'Run the existing bounded signal scan when authorized.',
      retryPermitted: true,
    })
  }
  if ((input.resultCount ?? 0) === 0) {
    return state('healthy_empty', 'Analytics healthy — no current signals', 'The latest scan completed successfully and returned no current source-backed signals.', {
      lastUpdated: input.latestScanCompletedAt,
      reasonCode: 'COMPLETED_SCAN_EMPTY',
      nextAction: 'Refresh or run another bounded scan when new source data is expected.',
      retryPermitted: true,
    })
  }
  return state('ready', 'Analytics ready', 'Current source-backed signal results are available.', {
    lastUpdated: input.latestScanCompletedAt,
    reasonCode: 'CURRENT_SIGNAL_RESULTS_AVAILABLE',
    retryPermitted: true,
  })
}

export function approvalsRuntimePresentation(input: ApprovalsRuntimeInput): RuntimeStatePresentation {
  if (input.loading && !input.hasSnapshot) {
    return state('loading', 'Loading approvals', 'Retrieving the current approval and operator queue state.', {
      reasonCode: 'INITIAL_LOAD',
    })
  }
  if (input.requestFailed) {
    return state('failed', 'Approvals request failed', 'The current approval state could not be loaded. No approval decision was changed.', {
      reasonCode: 'APPROVAL_REQUEST_FAILED',
      nextAction: 'Retry the existing status request.',
      retryPermitted: true,
      isDefect: true,
    })
  }
  if (!input.configurationPresent) {
    return state('not_configured', 'Approvals not configured', 'The public project connection required to read approval records is not configured locally.', {
      reasonCode: 'PUBLIC_PROJECT_CONFIGURATION_MISSING',
      nextAction: 'Open approved configuration guidance.',
    })
  }
  if (!input.hasSnapshot) {
    return state('unknown', 'Approval state unknown', 'No approval response is available, so the queue state cannot be verified.', {
      reasonCode: 'NO_APPROVAL_SNAPSHOT',
      nextAction: 'Refresh status.',
      retryPermitted: true,
      isDefect: true,
    })
  }
  if (!input.persistenceAvailable) {
    return state('unavailable', 'Approval history unavailable', 'The approval workspace loaded, but its persistent records could not be read.', {
      lastUpdated: input.generatedAt,
      reasonCode: 'APPROVAL_PERSISTENCE_UNAVAILABLE',
      nextAction: 'Refresh after the configured persistence service is available.',
      retryPermitted: true,
    })
  }
  if ((input.actionCount ?? 0) === 0) {
    return state('healthy_empty', 'Approvals healthy — queue empty', 'Approval data loaded successfully and no actions are currently awaiting review.', {
      lastUpdated: input.generatedAt,
      reasonCode: 'NO_PENDING_APPROVALS',
      nextAction: 'Refresh when a new approval is expected.',
      retryPermitted: true,
    })
  }
  return state('ready', 'Approvals ready', 'Approval data loaded successfully and reviewable actions are available.', {
    lastUpdated: input.generatedAt,
    reasonCode: 'APPROVALS_AVAILABLE',
    retryPermitted: true,
  })
}

export function emptySectionPresentation(
  overall: RuntimeStatePresentation,
  sectionName: string,
): RuntimeStatePresentation {
  if (overall.state !== 'ready' && overall.state !== 'healthy_empty') return overall
  return state('healthy_empty', `${sectionName}: none found`, `The latest completed analysis found no ${sectionName.toLowerCase()} in the current source-backed result set.`, {
    lastUpdated: overall.lastUpdated,
    reasonCode: `EMPTY_${sectionName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
    nextAction: overall.nextAction,
    retryPermitted: overall.retryPermitted,
  })
}
