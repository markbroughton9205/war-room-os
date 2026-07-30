/**
 * Negative-proof suite for Workstream 3 (self-repair validation reliability, Phase 2):
 * Validate Repair must refresh authoritative runtime data before evaluating, never trust an
 * arbitrarily old GapFinderContext snapshot, distinguish "cannot verify" from both pass and
 * fail, and never let overlapping validate calls race each other into an inconsistent result.
 */
import { pathToFileURL } from 'node:url'
import { validateRepair } from './repair'
import type { GapFinderContext, RuntimeRefreshResult } from '../gapFinder'
import type { SelfRepairRecord } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const GAP_ID = 'self-audit-provider-strip-not-connected'

function makeRecord(id: string, state: SelfRepairRecord['state'] = 'IN_PROGRESS'): SelfRepairRecord {
  const now = new Date().toISOString()
  return {
    id,
    gapId: GAP_ID,
    state,
    history: [{ state: 'DETECTED', at: now }],
    plan: {
      id: `repair-plan-gap-${GAP_ID}-${id}`,
      sourceId: GAP_ID,
      sourceType: 'gap',
      title: 'Families show not connected in council strip',
      files: ['app/page.tsx'],
      expectedBehavior: 'Provider strip reflects real connectivity.',
      validationCommands: ['pnpm exec tsc --noEmit'],
      rollback: 'Revert commit.',
      risk: 'medium',
      cursorCommand: 'Align providerHealth.providers labels with canonical-status.',
      createdAt: now,
      updatedAt: now,
    },
  }
}

/** A ctx whose visible providerConnection snapshot is stale — it says "all healthy," which
 * disagrees with what the live endpoint (simulated by `refreshRuntimeData`) currently reports. */
function staleHealthyCtx(refreshRuntimeData?: () => Promise<RuntimeRefreshResult>): GapFinderContext {
  return {
    visibleMessages: [],
    providerConnection: { claude: 'online', chatgpt: 'online', grok: 'online' },
    runtimeReadiness: { providerConnection: 'ready' },
    refreshRuntimeData,
  }
}

export async function runFreshValidationValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  // --- C1: old flow (no refresh) trusts the stale snapshot and reports a false pass ----------
  const staleOnlyCtx = staleHealthyCtx(undefined)
  const oldFlowRecord = makeRecord('old-flow')
  const oldFlowOutcome = await validateRepair(oldFlowRecord, staleOnlyCtx)
  results.push(
    check(
      'fresh_c1_old_flow_trusts_stale_context_and_reports_pass',
      oldFlowOutcome.result.outcome === 'verified',
      `outcome=${oldFlowOutcome.result.outcome} (stale ctx said healthy; no refresh available to catch the disagreement)`,
    ),
  )

  // --- C2: new flow refreshes first; fresh endpoint disagrees (still not_connected) — reports
  // the result the FRESH endpoint supports, not the stale one. ------------------------------
  let freshCallCount = 0
  const disagreeingRefresh = async (): Promise<RuntimeRefreshResult> => {
    freshCallCount += 1
    return {
      ok: true,
      providerConnection: { claude: 'not_connected', chatgpt: 'not_connected', grok: 'not_connected' },
      canonicalStatus: null,
      canonicalStatusUnavailable: false,
    }
  }
  const newFlowRecord = makeRecord('new-flow')
  const newFlowOutcome = await validateRepair(newFlowRecord, staleHealthyCtx(disagreeingRefresh))
  results.push(
    check(
      'fresh_c2_new_flow_refreshes_and_reports_fresh_result_not_stale',
      newFlowOutcome.result.outcome === 'failed' && freshCallCount === 1,
      `outcome=${newFlowOutcome.result.outcome} refreshCalls=${freshCallCount} (fresh endpoint still shows not_connected — stale ctx said healthy)`,
    ),
  )
  results.push(
    check(
      'fresh_c2_new_flow_transitions_state_to_failed',
      newFlowOutcome.snapshot.records.find(r => r.id === newFlowRecord.id)?.state === 'FAILED',
      `state=${newFlowOutcome.snapshot.records.find(r => r.id === newFlowRecord.id)?.state}`,
    ),
  )

  // --- C8: the original incident's exact shape, end-to-end through validateRepair. ------------
  // The starting ctx is the literal INITIAL_PROVIDER_HEALTH default shape (all families
  // 'not_connected', no runtimeReadiness marking it checked) — exactly what app/page.tsx's
  // providerHealth state looks like before loadProviderHealth's first fetch resolves.
  const incidentDefaultCtx = (refreshRuntimeData?: () => Promise<RuntimeRefreshResult>): GapFinderContext => ({
    visibleMessages: [],
    providerConnection: { claude: 'not_connected', chatgpt: 'not_connected', grok: 'not_connected' },
    refreshRuntimeData,
  })

  // C8a: without refresh (the old calling convention), this default is indistinguishable from a
  // real failure — the exact false-positive the original incident reported.
  const incidentOldFlowRecord = makeRecord('incident-old-flow')
  const incidentOldFlowOutcome = await validateRepair(incidentOldFlowRecord, incidentDefaultCtx(undefined))
  results.push(
    check(
      'fresh_c8a_original_incident_default_snapshot_without_refresh_reports_false_failure',
      incidentOldFlowOutcome.result.outcome === 'failed',
      `outcome=${incidentOldFlowOutcome.result.outcome} (the loading-default snapshot, evaluated with no refresh, is indistinguishable from a real outage)`,
    ),
  )

  // C8b: same starting snapshot, but the refresh-first path is available and the live endpoint
  // reveals the providers are actually connected — the false failure must not be reported.
  const incidentHealthyRefresh = async (): Promise<RuntimeRefreshResult> => ({
    ok: true,
    providerConnection: { claude: 'online', chatgpt: 'online', grok: 'online' },
  })
  const incidentFixedRecord = makeRecord('incident-fixed')
  const incidentFixedOutcome = await validateRepair(incidentFixedRecord, incidentDefaultCtx(incidentHealthyRefresh))
  results.push(
    check(
      'fresh_c8b_original_incident_default_snapshot_with_refresh_reports_true_pass',
      incidentFixedOutcome.result.outcome === 'verified',
      `outcome=${incidentFixedOutcome.result.outcome} (same starting snapshot as 8a, but refresh proves the providers are actually connected)`,
    ),
  )

  // C8c: same starting snapshot, but the live endpoint confirms the providers are genuinely still
  // down — the refresh-first path must still correctly report failure, not paper over a real outage.
  const incidentStillBrokenRefresh = async (): Promise<RuntimeRefreshResult> => ({
    ok: true,
    providerConnection: { claude: 'not_connected', chatgpt: 'not_connected', grok: 'not_connected' },
  })
  const incidentStillBrokenRecord = makeRecord('incident-still-broken')
  const incidentStillBrokenOutcome = await validateRepair(incidentStillBrokenRecord, incidentDefaultCtx(incidentStillBrokenRefresh))
  results.push(
    check(
      'fresh_c8c_genuinely_not_connected_provider_still_fails_after_refresh',
      incidentStillBrokenOutcome.result.outcome === 'failed',
      `outcome=${incidentStillBrokenOutcome.result.outcome} (refresh confirms the outage is real — must still report failure, not a fabricated pass)`,
    ),
  )

  // --- C3: refreshed success — fresh endpoint shows the gap is genuinely closed --------------
  const healthyRefresh = async (): Promise<RuntimeRefreshResult> => ({
    ok: true,
    providerConnection: { claude: 'online', chatgpt: 'online', grok: 'online' },
    canonicalStatus: null,
    canonicalStatusUnavailable: false,
  })
  const successRecord = makeRecord('refreshed-success')
  const successOutcome = await validateRepair(successRecord, staleHealthyCtx(healthyRefresh))
  results.push(
    check(
      'fresh_c3_refreshed_success_reports_verified',
      successOutcome.result.outcome === 'verified'
        && successOutcome.snapshot.records.find(r => r.id === successRecord.id)?.state === 'VALIDATED',
      `outcome=${successOutcome.result.outcome} state=${successOutcome.snapshot.records.find(r => r.id === successRecord.id)?.state}`,
    ),
  )

  // --- C4: refreshed confirmed failure — fresh endpoint shows the gap is still open ----------
  const failureRecord = makeRecord('refreshed-failure')
  const failureOutcome = await validateRepair(failureRecord, staleHealthyCtx(disagreeingRefresh))
  results.push(
    check(
      'fresh_c4_refreshed_confirmed_failure_reports_failed',
      failureOutcome.result.outcome === 'failed'
        && failureOutcome.snapshot.records.find(r => r.id === failureRecord.id)?.state === 'FAILED',
      `outcome=${failureOutcome.result.outcome}`,
    ),
  )

  // --- C5: refresh/network failure — reports cannot_verify, state unchanged (not FAILED) -----
  const networkFailRecord = makeRecord('network-fail', 'IN_PROGRESS')
  const throwingRefresh = async (): Promise<RuntimeRefreshResult> => {
    throw new Error('network down')
  }
  const networkFailOutcome = await validateRepair(networkFailRecord, staleHealthyCtx(throwingRefresh))
  results.push(
    check(
      'fresh_c5_refresh_network_failure_reports_cannot_verify',
      networkFailOutcome.result.outcome === 'cannot_verify',
      `outcome=${networkFailOutcome.result.outcome} evidence=${JSON.stringify(networkFailOutcome.result.evidence)}`,
    ),
  )
  results.push(
    check(
      'fresh_c5_cannot_verify_does_not_change_lifecycle_state',
      networkFailOutcome.snapshot.records.find(r => r.id === networkFailRecord.id)?.state === 'IN_PROGRESS',
      `state=${networkFailOutcome.snapshot.records.find(r => r.id === networkFailRecord.id)?.state} (must stay IN_PROGRESS, not become FAILED or VALIDATED)`,
    ),
  )

  // Same proof via an explicit { ok: false } return (not just a thrown error).
  const explicitNotOkRecord = makeRecord('explicit-not-ok', 'HANDED_OFF')
  const notOkRefresh = async (): Promise<RuntimeRefreshResult> => ({ ok: false })
  const explicitNotOkOutcome = await validateRepair(explicitNotOkRecord, staleHealthyCtx(notOkRefresh))
  results.push(
    check(
      'fresh_c5b_explicit_refresh_not_ok_reports_cannot_verify',
      explicitNotOkOutcome.result.outcome === 'cannot_verify'
        && explicitNotOkOutcome.snapshot.records.find(r => r.id === explicitNotOkRecord.id)?.state === 'HANDED_OFF',
      `outcome=${explicitNotOkOutcome.result.outcome}`,
    ),
  )

  // --- C6: repeated validation click protection — two concurrent calls for the SAME record
  // must not race two independent refreshes; the second joins the first's in-flight promise. ---
  let concurrentRefreshCalls = 0
  const raceRecord = makeRecord('race-guard')
  const slowRefresh = async (): Promise<RuntimeRefreshResult> => {
    concurrentRefreshCalls += 1
    await new Promise(resolve => setTimeout(resolve, 25))
    return { ok: true, providerConnection: { claude: 'online', chatgpt: 'online', grok: 'online' } }
  }
  const raceCtx = staleHealthyCtx(slowRefresh)
  const [firstClick, secondClick] = await Promise.all([
    validateRepair(raceRecord, raceCtx),
    validateRepair(raceRecord, raceCtx),
  ])
  results.push(
    check(
      'fresh_c6_overlapping_clicks_share_one_in_flight_refresh',
      concurrentRefreshCalls === 1,
      `refreshCalls=${concurrentRefreshCalls} (must be exactly 1 — second click must join the first, not start its own)`,
    ),
  )
  results.push(
    check(
      'fresh_c6_overlapping_clicks_resolve_to_the_same_result',
      firstClick.result.outcome === secondClick.result.outcome
        && firstClick.result.checkedAt === secondClick.result.checkedAt,
      `first=${JSON.stringify(firstClick.result)} second=${JSON.stringify(secondClick.result)}`,
    ),
  )

  // A later, separate click (after the first has fully resolved) must NOT be blocked forever —
  // the in-flight guard must release once resolved.
  const laterOutcome = await validateRepair(raceRecord, staleHealthyCtx(slowRefresh))
  results.push(
    check(
      'fresh_c6_guard_releases_after_completion_allowing_a_later_click',
      concurrentRefreshCalls === 2,
      `refreshCalls=${concurrentRefreshCalls} (a genuinely later, non-overlapping click must start its own refresh)`,
    ),
  )
  void laterOutcome

  // --- C7: no refreshRuntimeData supplied at all — falls back to evaluating the given context
  // (documented, deliberate fallback for callers/tests that don't support refresh). ------------
  const noRefreshRecord = makeRecord('no-refresh-fallback')
  const noRefreshOutcome = await validateRepair(noRefreshRecord, staleHealthyCtx(undefined))
  results.push(
    check(
      'fresh_c7_no_refresh_function_falls_back_to_given_context',
      noRefreshOutcome.result.outcome === 'verified',
      `outcome=${noRefreshOutcome.result.outcome} (no refreshRuntimeData supplied — must evaluate ctx as given, not hang or error)`,
    ),
  )

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runFreshValidationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Fresh repair validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
