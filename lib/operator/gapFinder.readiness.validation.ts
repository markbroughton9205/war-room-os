/**
 * Negative-proof suite for Workstream 1 (self-repair validation reliability, Phase 2):
 * async-sourced fields (providerConnection, memory.persistenceAvailable, internetUsable) must
 * never produce a failure gap while the authoritative source is still loading or unchecked, and
 * a genuine unhealthy value must still be caught once the load resolves.
 */
import { pathToFileURL } from 'node:url'
import { auditBrokenSilentUi } from './selfAudit/brokenSilentUi'
import { resolveOperatorGaps, type GapFinderContext } from './gapFinder'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function baseCtx(overrides: Partial<GapFinderContext> = {}): GapFinderContext {
  return { visibleMessages: [], ...overrides }
}

const PROVIDER_STRIP_GAP_ID = 'self-audit-provider-strip-not-connected'
const MEMORY_OFFLINE_GAP_ID = 'self-audit-memory-persistence-offline'
const INTERNET_GAP_TITLE = 'Optional live research source — not required for Stable Group Chat'

function hasGap(gaps: ReturnType<typeof resolveOperatorGaps>, id: string): boolean {
  return gaps.some(g => g.id === id)
}

export function runGapFinderReadinessValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // --- providerConnection ---------------------------------------------------------------
  const allNotConnected = { claude: 'not_connected', chatgpt: 'not_connected', grok: 'not_connected' } as const

  // A1: demonstrate the OLD behavior (calling the audit module directly, unguarded) would
  // classify a still-loading default as broken.
  const oldBehaviorGaps = auditBrokenSilentUi({ visibleMessages: [], providerConnection: allNotConnected })
  results.push(
    check(
      'readiness_a1_old_behavior_flagged_unresolved_load_as_broken',
      oldBehaviorGaps.some(g => g.id === PROVIDER_STRIP_GAP_ID),
      `auditBrokenSilentUi(unguarded) gaps=${JSON.stringify(oldBehaviorGaps.map(g => g.id))}`,
    ),
  )

  // A2: new behavior — same providerConnection value, but the load is held unresolved
  // (runtimeReadiness: 'pending'). No failure gap should be emitted.
  const pendingCtx = baseCtx({
    providerConnection: allNotConnected,
    runtimeReadiness: { providerConnection: 'pending' },
  })
  const pendingGaps = resolveOperatorGaps(pendingCtx)
  results.push(
    check(
      'readiness_a2_pending_provider_connection_emits_no_failure_gap',
      !hasGap(pendingGaps, PROVIDER_STRIP_GAP_ID),
      `gaps=${JSON.stringify(pendingGaps.map(g => g.id))}`,
    ),
  )

  // A3: the check itself errored (fetch failed) — also must not emit the failure gap, and must
  // not be silently treated as success either (no gap present at all, not a fabricated "healthy" one).
  const erroredCtx = baseCtx({
    providerConnection: allNotConnected,
    runtimeReadiness: { providerConnection: 'error' },
  })
  const erroredGaps = resolveOperatorGaps(erroredCtx)
  results.push(
    check(
      'readiness_a3_errored_provider_check_emits_no_failure_gap',
      !hasGap(erroredGaps, PROVIDER_STRIP_GAP_ID),
      `gaps=${JSON.stringify(erroredGaps.map(g => g.id))}`,
    ),
  )

  // A4: once the load resolves ('ready') with a real unhealthy value, the gap must fire.
  const readyUnhealthyCtx = baseCtx({
    providerConnection: allNotConnected,
    runtimeReadiness: { providerConnection: 'ready' },
  })
  const readyUnhealthyGaps = resolveOperatorGaps(readyUnhealthyCtx)
  results.push(
    check(
      'readiness_a4_ready_and_unhealthy_still_emits_failure_gap',
      hasGap(readyUnhealthyGaps, PROVIDER_STRIP_GAP_ID),
      `gaps=${JSON.stringify(readyUnhealthyGaps.map(g => g.id))}`,
    ),
  )

  // A5: ready + healthy must not fabricate a failure gap either (sanity check on the normal path).
  const readyHealthyCtx = baseCtx({
    providerConnection: { claude: 'online', chatgpt: 'online', grok: 'online' },
    runtimeReadiness: { providerConnection: 'ready' },
  })
  const readyHealthyGaps = resolveOperatorGaps(readyHealthyCtx)
  results.push(
    check(
      'readiness_a5_ready_and_healthy_emits_no_failure_gap',
      !hasGap(readyHealthyGaps, PROVIDER_STRIP_GAP_ID),
      `gaps=${JSON.stringify(readyHealthyGaps.map(g => g.id))}`,
    ),
  )

  // --- memory.persistenceAvailable -------------------------------------------------------
  // B1: pending — persistenceAvailable defaults to false pre-fix; must not fire while pending.
  const memPendingCtx = baseCtx({
    memory: { persistenceAvailable: false, memoryCount: 5 },
    runtimeReadiness: { persistence: 'pending' },
  })
  const memPendingGaps = resolveOperatorGaps(memPendingCtx)
  results.push(
    check(
      'readiness_b1_pending_persistence_emits_no_failure_gap',
      !hasGap(memPendingGaps, MEMORY_OFFLINE_GAP_ID),
      `gaps=${JSON.stringify(memPendingGaps.map(g => g.id))}`,
    ),
  )

  // B2: ready + genuinely false — must still fire.
  const memReadyCtx = baseCtx({
    memory: { persistenceAvailable: false, memoryCount: 5 },
    runtimeReadiness: { persistence: 'ready' },
  })
  const memReadyGaps = resolveOperatorGaps(memReadyCtx)
  results.push(
    check(
      'readiness_b2_ready_and_offline_still_emits_failure_gap',
      hasGap(memReadyGaps, MEMORY_OFFLINE_GAP_ID),
      `gaps=${JSON.stringify(memReadyGaps.map(g => g.id))}`,
    ),
  )

  // --- internetUsable ----------------------------------------------------------------------
  // C1: pending — internetUsable defaults to false pre-fix; must not fire while pending.
  const netPendingCtx = baseCtx({
    internetUsable: false,
    runtimeReadiness: { internet: 'pending' },
  })
  const netPendingGaps = resolveOperatorGaps(netPendingCtx)
  results.push(
    check(
      'readiness_c1_pending_internet_emits_no_failure_gap',
      !netPendingGaps.some(g => g.title === INTERNET_GAP_TITLE),
      `gaps=${JSON.stringify(netPendingGaps.map(g => g.title))}`,
    ),
  )

  // C2: ready + genuinely false — must still fire.
  const netReadyCtx = baseCtx({
    internetUsable: false,
    runtimeReadiness: { internet: 'ready' },
  })
  const netReadyGaps = resolveOperatorGaps(netReadyCtx)
  results.push(
    check(
      'readiness_c2_ready_and_unusable_still_emits_gap',
      netReadyGaps.some(g => g.title === INTERNET_GAP_TITLE),
      `gaps=${JSON.stringify(netReadyGaps.map(g => g.title))}`,
    ),
  )

  // D1: no runtimeReadiness supplied at all (a caller that doesn't opt in) preserves prior
  // behavior exactly — real classifications still flow through unnormalized.
  const noReadinessCtx = baseCtx({ providerConnection: allNotConnected })
  const noReadinessGaps = resolveOperatorGaps(noReadinessCtx)
  results.push(
    check(
      'readiness_d1_no_readiness_supplied_preserves_prior_behavior',
      hasGap(noReadinessGaps, PROVIDER_STRIP_GAP_ID),
      `gaps=${JSON.stringify(noReadinessGaps.map(g => g.id))}`,
    ),
  )

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runGapFinderReadinessValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Gap finder readiness validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
