import { pathToFileURL } from 'node:url'
import { shouldAcceptCouncilAsyncResult } from './asyncGuards'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const base = {
  mounted: true,
  expectedSessionId: 'session-active',
  activeSessionId: 'session-active',
  expectedDecreeRound: 12,
  activeDecreeRound: 12,
  expectedConversationId: 'conversation-active',
  activeConversationId: 'conversation-active',
  expectedFlowMode: 'full_council',
  activeFlowMode: 'full_council',
}

export function runCouncilAsyncGuardValidation(): CaseResult[] {
  return [
    check(
      'async_guard_01_accepts_current_session_round_conversation',
      shouldAcceptCouncilAsyncResult(base) === true,
      'current mounted session/round/conversation accepted',
    ),
    check(
      'async_guard_02_rejects_unmounted_component',
      shouldAcceptCouncilAsyncResult({ ...base, mounted: false }) === false,
      'stale async completion after unmount rejected',
    ),
    check(
      'async_guard_03_rejects_session_switch_during_persistence_restore',
      shouldAcceptCouncilAsyncResult({ ...base, activeSessionId: 'session-newer' }) === false,
      'restore result for old session rejected',
    ),
    check(
      'async_guard_04_rejects_active_provider_after_newer_round',
      shouldAcceptCouncilAsyncResult({ ...base, activeDecreeRound: 13 }) === false,
      'provider result from superseded round rejected',
    ),
    check(
      'async_guard_05_rejects_stale_fetch_after_selecting_new_conversation',
      shouldAcceptCouncilAsyncResult({ ...base, activeConversationId: 'conversation-newer' }) === false,
      'fetch result for old conversation rejected',
    ),
    check(
      'async_guard_06_rejects_mode_sensitive_switch',
      shouldAcceptCouncilAsyncResult({ ...base, activeFlowMode: 'stable_group', modeSensitive: true }) === false,
      'mode-sensitive async result rejected after mode switch',
    ),
    check(
      'async_guard_07_allows_mode_switch_when_result_not_mode_sensitive',
      shouldAcceptCouncilAsyncResult({ ...base, activeFlowMode: 'stable_group', modeSensitive: false }) === true,
      'non-mode-sensitive result remains valid for same session/round',
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCouncilAsyncGuardValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`\nCouncil async guard validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
