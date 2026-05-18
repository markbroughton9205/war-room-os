export type RedTeamCoderSeverity = 'info' | 'warn' | 'error' | 'critical'

export type RedTeamCoderStatus = 'idle' | 'watching' | 'issue_detected' | 'repair_planned' | 'error'

export type RedTeamCoderRecommendedAgent = 'Codex' | 'Cursor' | 'Claude' | 'Red Team'

export type RedTeamCoderProviderStatus =
  | 'online'
  | 'standby'
  | 'degraded'
  | 'error'
  | 'not_connected'
  | 'unknown'
  | string

export type RedTeamCoderSignal = {
  conversationId?: string | null
  lastRaelMessageId?: string | null
  lastRaelMessageAt?: string | null
  lastFamilyResponseAt?: string | null
  familiesResponded?: string[]
  loading?: boolean
  inputDisabled?: boolean
  providerStatuses?: Record<string, RedTeamCoderProviderStatus>
  systemNotes?: string[]
  apiChatFailures?: { status?: number; message?: string; at?: string }[]
  consoleErrors?: string[]
  hydrationErrors?: string[]
  timeoutMs?: number
  fallbackAttempted?: boolean
  scrollInputOk?: boolean
}

export type RedTeamCoderIssueCode =
  | 'chat_response_timeout'
  | 'input_stuck_disabled'
  | 'provider_blocking'
  | 'provider_timeout'
  | 'api_chat_failure'
  | 'duplicate_system_notes'
  | 'gemini_generate_content_failure'
  | 'fallback_not_invoked'
  | 'layout_regression'
  | 'browser_console_error'
  | 'hydration_error'

export type RedTeamCoderIssue = {
  issueId: string
  code: RedTeamCoderIssueCode
  severity: RedTeamCoderSeverity
  detectedAt: string
  symptom: string
  evidence: string[]
}

export type RedTeamCoderRepairPlan = {
  issueId: string
  severity: RedTeamCoderSeverity
  detectedAt: string
  symptom: string
  suspectedFiles: string[]
  likelyCause: string
  recommendedFix: string
  verificationSteps: string[]
  approvalRequired: true
  recommendedAgent: RedTeamCoderRecommendedAgent
}

export type RedTeamCoderDiagnosisResult = {
  status: RedTeamCoderStatus
  issues: RedTeamCoderIssue[]
  latestRepairPlan: RedTeamCoderRepairPlan | null
  actionQueued?: boolean
  actionId?: string | null
  persistence?: 'available' | 'unavailable'
  message?: string
}
