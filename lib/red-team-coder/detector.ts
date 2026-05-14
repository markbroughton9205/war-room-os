import type {
  RedTeamCoderIssue,
  RedTeamCoderIssueCode,
  RedTeamCoderSeverity,
  RedTeamCoderSignal,
} from './types'

export const RED_TEAM_CODER_RESPONSE_TIMEOUT_MS = 45_000

function stableHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function parseTime(value?: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function includesAny(value: string, needles: string[]): boolean {
  const lower = value.toLowerCase()
  return needles.some(needle => lower.includes(needle))
}

function makeIssue(
  code: RedTeamCoderIssueCode,
  severity: RedTeamCoderSeverity,
  symptom: string,
  evidence: string[],
  detectedAt: string,
): RedTeamCoderIssue {
  return {
    issueId: `${code}-${stableHash(`${code}:${symptom}`)}`,
    code,
    severity,
    detectedAt,
    symptom,
    evidence,
  }
}

function findDuplicateSystemNotes(notes: string[]): string[] {
  const counts = new Map<string, number>()
  for (const note of notes) {
    const key = note.trim().toLowerCase()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([note]) => note)
}

function providerIsUnavailable(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    normalized === 'unknown'
    || normalized === 'not_connected'
    || normalized === 'error'
    || normalized === 'unavailable'
    || normalized === 'offline'
  )
}

export function detectRedTeamCoderIssues(signal: RedTeamCoderSignal, nowMs = Date.now()): RedTeamCoderIssue[] {
  const detectedAt = new Date(nowMs).toISOString()
  const timeoutMs = signal.timeoutMs ?? RED_TEAM_CODER_RESPONSE_TIMEOUT_MS
  const issues: RedTeamCoderIssue[] = []
  const lastRaelAt = parseTime(signal.lastRaelMessageAt)
  const lastFamilyAt = parseTime(signal.lastFamilyResponseAt)
  const noFamilyAfterRael = Boolean(lastRaelAt && (!lastFamilyAt || lastFamilyAt < lastRaelAt))

  if (lastRaelAt && noFamilyAfterRael && nowMs - lastRaelAt >= timeoutMs) {
    issues.push(makeIssue(
      'chat_response_timeout',
      'critical',
      "Ra'el message sent but no family response arrived within the response timeout.",
      [
        `lastRaelMessageAt=${signal.lastRaelMessageAt}`,
        `lastFamilyResponseAt=${signal.lastFamilyResponseAt ?? 'none'}`,
        `timeoutMs=${timeoutMs}`,
      ],
      detectedAt,
    ))

    if (signal.fallbackAttempted === false) {
      issues.push(makeIssue(
        'fallback_not_invoked',
        'error',
        'No fallback family appears to have been invoked after the primary response path stalled.',
        ['fallbackAttempted=false', `familiesResponded=${(signal.familiesResponded ?? []).join(',') || 'none'}`],
        detectedAt,
      ))
    }
  }

  if (signal.inputDisabled && lastRaelAt && nowMs - lastRaelAt >= timeoutMs) {
    issues.push(makeIssue(
      'input_stuck_disabled',
      'critical',
      'Command input appears disabled after the response timeout window.',
      [`inputDisabled=${String(signal.inputDisabled)}`, `loading=${String(signal.loading)}`],
      detectedAt,
    ))
  }

  const providerEntries = Object.entries(signal.providerStatuses ?? {})
  if (providerEntries.length > 0 && providerEntries.every(([, status]) => providerIsUnavailable(String(status)))) {
    issues.push(makeIssue(
      'provider_blocking',
      'error',
      'All reported council providers are unavailable, unknown, or errored.',
      providerEntries.map(([provider, status]) => `${provider}=${String(status)}`),
      detectedAt,
    ))
  }

  const notes = signal.systemNotes ?? []
  if (notes.some(note => includesAny(note, ['timed out', 'timeout', 'response timed out']))) {
    issues.push(makeIssue(
      'provider_timeout',
      'error',
      'A provider or council response timeout was reported in system notes.',
      notes.filter(note => includesAny(note, ['timed out', 'timeout'])).slice(-4),
      detectedAt,
    ))
  }

  const failures = signal.apiChatFailures ?? []
  if (failures.length > 0) {
    issues.push(makeIssue(
      'api_chat_failure',
      'error',
      '/api/chat reported one or more failures.',
      failures.slice(-4).map(failure => `${failure.status ?? 'unknown'} ${failure.message ?? ''}`.trim()),
      detectedAt,
    ))
  }

  const duplicateNotes = findDuplicateSystemNotes(notes)
  if (duplicateNotes.length > 0) {
    issues.push(makeIssue(
      'duplicate_system_notes',
      'warn',
      'Repeated identical system notes were detected in the council thread.',
      duplicateNotes.slice(0, 5),
      detectedAt,
    ))
  }

  if (notes.some(note => includesAny(note, ['gemini', 'generatecontent', 'generate content']))) {
    issues.push(makeIssue(
      'gemini_generate_content_failure',
      'warn',
      'Gemini generated an unavailable or generateContent failure note.',
      notes.filter(note => includesAny(note, ['gemini', 'generatecontent', 'generate content'])).slice(-4),
      detectedAt,
    ))
  }

  if (signal.scrollInputOk === false) {
    issues.push(makeIssue(
      'layout_regression',
      'error',
      'Chat scroll or input anchor health check failed.',
      ['scrollInputOk=false'],
      detectedAt,
    ))
  }

  const consoleErrors = signal.consoleErrors ?? []
  if (consoleErrors.length > 0) {
    issues.push(makeIssue(
      'browser_console_error',
      'error',
      'Browser console errors were reported during chat operation.',
      consoleErrors.slice(-5),
      detectedAt,
    ))
  }

  const hydrationErrors = signal.hydrationErrors ?? []
  if (hydrationErrors.length > 0) {
    issues.push(makeIssue(
      'hydration_error',
      'critical',
      'Hydration errors were reported during War Room render.',
      hydrationErrors.slice(-5),
      detectedAt,
    ))
  }

  return issues
}
