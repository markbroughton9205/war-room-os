import type {
  RedTeamCoderIssue,
  RedTeamCoderRecommendedAgent,
  RedTeamCoderRepairPlan,
} from './types'

const DEFAULT_VERIFICATION_STEPS = [
  'Send "hello" in Live Council and confirm at least one family responds.',
  'Send a second message immediately and confirm loading clears again.',
  'Confirm failed providers produce non-blocking system notes only.',
  '.\\node_modules\\.bin\\eslint.CMD app components lib --max-warnings=0',
  '.\\node_modules\\.bin\\tsc.CMD --noEmit',
  'Open the dev app and confirm the chat input remains usable.',
]

function commonFiles(...files: string[]): string[] {
  return [...new Set(files)]
}

function recommendedAgentFor(issue: RedTeamCoderIssue): RedTeamCoderRecommendedAgent {
  if (issue.code === 'layout_regression' || issue.code === 'input_stuck_disabled') return 'Cursor'
  if (issue.code === 'duplicate_system_notes') return 'Claude'
  if (issue.code === 'browser_console_error' || issue.code === 'hydration_error') return 'Codex'
  return 'Codex'
}

export function createRepairPlan(issue: RedTeamCoderIssue): RedTeamCoderRepairPlan {
  const base = {
    issueId: issue.issueId,
    severity: issue.severity,
    detectedAt: issue.detectedAt,
    symptom: issue.symptom,
    approvalRequired: true as const,
    recommendedAgent: recommendedAgentFor(issue),
  }

  if (issue.code === 'chat_response_timeout') {
    return {
      ...base,
      suspectedFiles: commonFiles('app/page.tsx', 'app/api/chat/route.ts', 'lib/council/liveChatPipeline.ts', 'lib/council/familyRoster.ts'),
      likelyCause: 'The client orchestration loop may be waiting on a blocked provider, missing fallback success, or not appending returned family text.',
      recommendedFix: 'Trace submitDecree from user append through provider requests, ensure each provider has its own timeout, and guarantee loading clears in finally after partial success or failure.',
      verificationSteps: DEFAULT_VERIFICATION_STEPS,
    }
  }

  if (issue.code === 'fallback_not_invoked' || issue.code === 'provider_blocking') {
    return {
      ...base,
      suspectedFiles: commonFiles('app/page.tsx', 'app/api/providers/health/route.ts', 'app/api/chat/route.ts', 'lib/engine-control/router.ts'),
      likelyCause: 'Provider health or routing may be treated as a hard block instead of a degraded state with another available family.',
      recommendedFix: 'Keep each provider failure isolated, route around unavailable providers, and invoke the first functional fallback family before ending the turn.',
      verificationSteps: DEFAULT_VERIFICATION_STEPS,
    }
  }

  if (issue.code === 'provider_timeout' || issue.code === 'api_chat_failure') {
    return {
      ...base,
      suspectedFiles: commonFiles('app/page.tsx', 'app/api/chat/route.ts', 'app/api/grok/chat/route.ts', 'lib/ai'),
      likelyCause: 'A provider request may be timing out or returning an error without a bounded client fallback path.',
      recommendedFix: 'Add or verify per-provider AbortController timeouts, append a single system note for the failed provider, and continue the family loop.',
      verificationSteps: DEFAULT_VERIFICATION_STEPS,
    }
  }

  if (issue.code === 'gemini_generate_content_failure') {
    return {
      ...base,
      suspectedFiles: commonFiles('app/page.tsx', 'app/api/chat/route.ts', 'lib/engine-control/status.ts'),
      likelyCause: 'Gemini unavailable or generateContent failures may be surfacing repeatedly instead of being skipped after one non-blocking note.',
      recommendedFix: 'Confirm Gemini backoff state is latched after failure and does not prevent ChatGPT, Claude, or Grok from responding.',
      verificationSteps: DEFAULT_VERIFICATION_STEPS,
    }
  }

  if (issue.code === 'input_stuck_disabled') {
    return {
      ...base,
      suspectedFiles: commonFiles('app/page.tsx', 'components/council/useCouncilSession.ts'),
      likelyCause: 'A loading, awaiting-response, or abort-controller state may not be cleared after a provider failure or timeout.',
      recommendedFix: 'Audit all submit and continuation paths for finally blocks that reset loading, typing indicators, awaiting response state, and abort controllers.',
      verificationSteps: DEFAULT_VERIFICATION_STEPS,
    }
  }

  if (issue.code === 'duplicate_system_notes') {
    return {
      ...base,
      suspectedFiles: commonFiles('app/page.tsx', 'components/council/councilSessionReducer.ts', 'lib/council/messageIds.ts'),
      likelyCause: 'System note dedupe may be bypassed by direct message append paths or repeated tool/provider status notices.',
      recommendedFix: 'Route repeated system notes through the deduped action path and keep generated IDs unique while suppressing repeated identical content.',
      verificationSteps: DEFAULT_VERIFICATION_STEPS,
    }
  }

  if (issue.code === 'layout_regression') {
    return {
      ...base,
      suspectedFiles: commonFiles('app/page.tsx', 'components/war-room', 'components/council'),
      likelyCause: 'Chat scroll refs, composer placement, or shell overflow constraints may have regressed.',
      recommendedFix: 'Verify the Live Council message container owns its internal scroll and that Go to latest never calls window scrolling.',
      verificationSteps: DEFAULT_VERIFICATION_STEPS,
    }
  }

  return {
    ...base,
    suspectedFiles: commonFiles('app/page.tsx', 'app/api/chat/route.ts', 'components/war-room'),
    likelyCause: 'A browser runtime or hydration error may be interrupting the visible council response flow.',
    recommendedFix: 'Inspect the reported console or hydration error, repair the failing component boundary, and re-run chat smoke tests.',
    verificationSteps: DEFAULT_VERIFICATION_STEPS,
  }
}

export function createLatestRepairPlan(issues: RedTeamCoderIssue[]): RedTeamCoderRepairPlan | null {
  if (issues.length === 0) return null
  const rank = { critical: 4, error: 3, warn: 2, info: 1 }
  const sorted = [...issues].sort((a, b) => rank[b.severity] - rank[a.severity])
  return createRepairPlan(sorted[0])
}
