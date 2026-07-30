/**
 * Regression suite for the field-specific readiness fix in `mergeRefreshedContext` (repair.ts):
 * a refresh that only supplies some fields must never promote the *other*, un-refreshed fields
 * to 'ready', and must never replace their cached value either — property presence (not
 * truthiness/`??`) is what decides whether a field was actually addressed by a given refresh.
 */
import { pathToFileURL } from 'node:url'
import { mergeRefreshedContext } from './repair'
import type { CanonicalGapSnapshot, GapFinderContext, RuntimeRefreshResult } from '../gapFinder'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const STALE_CANONICAL: CanonicalGapSnapshot = {
  providers: [{ family: 'chatgpt', label: 'OpenAI · ChatGPT · rate limited', configured: true, availability: 'RATE_LIMITED', health: 'degraded', connectionStatus: 'error' }],
}

function baseCtx(overrides: Partial<GapFinderContext> = {}): GapFinderContext {
  return {
    visibleMessages: [],
    providerConnection: { claude: 'not_connected' },
    canonicalStatus: STALE_CANONICAL,
    canonicalStatusUnavailable: false,
    runtimeReadiness: { providerConnection: 'pending', canonicalStatus: 'pending' },
    ...overrides,
  }
}

export function runRefreshMergeValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // --- A: ok:true, providerConnection present, canonicalStatus omitted ------------------------
  const providerOnlyRefresh: RuntimeRefreshResult = {
    ok: true,
    providerConnection: { claude: 'online' },
    // canonicalStatus deliberately omitted — this refresh never touched it.
  }
  const mergedA = mergeRefreshedContext(baseCtx(), providerOnlyRefresh)
  results.push(
    check(
      'refresh_merge_A1_untouched_canonicalStatus_not_promoted_to_ready',
      mergedA.runtimeReadiness?.canonicalStatus === 'pending',
      `canonicalStatus readiness=${mergedA.runtimeReadiness?.canonicalStatus} (must stay 'pending' — this refresh never supplied canonicalStatus)`,
    ),
  )
  results.push(
    check(
      'refresh_merge_A2_stale_canonicalStatus_value_preserved_not_replaced',
      mergedA.canonicalStatus === STALE_CANONICAL,
      `canonicalStatus is the same stale object reference — not silently replaced or cleared`,
    ),
  )
  results.push(
    check(
      'refresh_merge_A3_supplied_providerConnection_is_promoted_to_ready',
      mergedA.runtimeReadiness?.providerConnection === 'ready' && mergedA.providerConnection?.claude === 'online',
      `providerConnection readiness=${mergedA.runtimeReadiness?.providerConnection} value=${JSON.stringify(mergedA.providerConnection)}`,
    ),
  )

  // --- B: ok:true, canonicalStatus explicitly present — replaced and marked ready -------------
  const freshCanonical: CanonicalGapSnapshot = {
    providers: [{ family: 'chatgpt', label: 'OpenAI · ChatGPT · live connected', configured: true, availability: 'CONNECTED', health: 'healthy', connectionStatus: 'online' }],
  }
  const canonicalSuppliedRefresh: RuntimeRefreshResult = {
    ok: true,
    canonicalStatus: freshCanonical,
    canonicalStatusUnavailable: false,
  }
  const mergedB = mergeRefreshedContext(baseCtx(), canonicalSuppliedRefresh)
  results.push(
    check(
      'refresh_merge_B1_canonicalStatus_replaced_with_fresh_value',
      mergedB.canonicalStatus === freshCanonical,
      `canonicalStatus is the fresh object, not the stale one`,
    ),
  )
  results.push(
    check(
      'refresh_merge_B2_canonical_readiness_becomes_ready',
      mergedB.runtimeReadiness?.canonicalStatus === 'ready',
      `canonicalStatus readiness=${mergedB.runtimeReadiness?.canonicalStatus}`,
    ),
  )
  results.push(
    check(
      'refresh_merge_B3_untouched_providerConnection_readiness_preserved',
      mergedB.runtimeReadiness?.providerConnection === 'pending',
      `providerConnection readiness=${mergedB.runtimeReadiness?.providerConnection} (must stay 'pending' — this refresh never supplied providerConnection)`,
    ),
  )

  // --- C: ok:true, canonicalStatus explicitly null — a meaningful checked-and-empty result ----
  const nullCanonicalRefresh: RuntimeRefreshResult = {
    ok: true,
    canonicalStatus: null,
    canonicalStatusUnavailable: false,
  }
  const mergedC = mergeRefreshedContext(baseCtx(), nullCanonicalRefresh)
  results.push(
    check(
      'refresh_merge_C1_explicit_null_replaces_stale_value',
      mergedC.canonicalStatus === null,
      `canonicalStatus=${JSON.stringify(mergedC.canonicalStatus)} (explicit null must win over the stale cached snapshot, not be treated as "not supplied")`,
    ),
  )
  results.push(
    check(
      'refresh_merge_C2_explicit_null_still_marks_canonical_ready',
      mergedC.runtimeReadiness?.canonicalStatus === 'ready',
      `canonicalStatus readiness=${mergedC.runtimeReadiness?.canonicalStatus} (a checked-and-empty result is still a completed check)`,
    ),
  )
  results.push(
    check(
      'refresh_merge_C3_explicit_null_respects_supplied_unavailable_flag',
      mergedC.canonicalStatusUnavailable === false,
      `canonicalStatusUnavailable=${mergedC.canonicalStatusUnavailable} (explicitly supplied as false alongside null — must not default to true)`,
    ),
  )

  // --- D: partial provider omission — providerConnection omitted entirely ---------------------
  const canonicalOnlyRefresh: RuntimeRefreshResult = {
    ok: true,
    canonicalStatus: freshCanonical,
    canonicalStatusUnavailable: false,
    // providerConnection deliberately omitted.
  }
  const mergedD = mergeRefreshedContext(baseCtx(), canonicalOnlyRefresh)
  results.push(
    check(
      'refresh_merge_D1_omitted_providerConnection_not_promoted_to_ready',
      mergedD.runtimeReadiness?.providerConnection === 'pending',
      `providerConnection readiness=${mergedD.runtimeReadiness?.providerConnection} (must not be promoted without a supplied value)`,
    ),
  )
  results.push(
    check(
      'refresh_merge_D2_omitted_providerConnection_value_preserved',
      mergedD.providerConnection?.claude === 'not_connected',
      `providerConnection=${JSON.stringify(mergedD.providerConnection)} (must keep the prior cached value, not clear or replace it)`,
    ),
  )

  // --- E: ok:true, providerConnection explicitly set to undefined (property present, value
  // undefined) — must be treated identically to omission, never as "supplied." ------------------
  const explicitUndefinedProviderRefresh: RuntimeRefreshResult = {
    ok: true,
    providerConnection: undefined,
  }
  const mergedE = mergeRefreshedContext(baseCtx(), explicitUndefinedProviderRefresh)
  results.push(
    check(
      'refresh_merge_E1_explicit_undefined_providerConnection_preserves_cached_value',
      mergedE.providerConnection?.claude === 'not_connected',
      `providerConnection=${JSON.stringify(mergedE.providerConnection)} (an explicit undefined must not replace the cached value)`,
    ),
  )
  results.push(
    check(
      'refresh_merge_E2_explicit_undefined_providerConnection_preserves_prior_readiness',
      mergedE.runtimeReadiness?.providerConnection === 'pending',
      `providerConnection readiness=${mergedE.runtimeReadiness?.providerConnection} (an explicit undefined must not be promoted to 'ready')`,
    ),
  )

  // --- F: ok:true, canonicalStatus explicitly set to undefined — same rule: property present,
  // value undefined, must count as "not supplied," including canonicalStatusUnavailable. --------
  const explicitUndefinedCanonicalRefresh: RuntimeRefreshResult = {
    ok: true,
    canonicalStatus: undefined,
    canonicalStatusUnavailable: true,
  }
  const mergedF = mergeRefreshedContext(baseCtx(), explicitUndefinedCanonicalRefresh)
  results.push(
    check(
      'refresh_merge_F1_explicit_undefined_canonicalStatus_preserves_cached_value',
      mergedF.canonicalStatus === STALE_CANONICAL,
      `canonicalStatus is still the stale cached object — an explicit undefined must not replace it`,
    ),
  )
  results.push(
    check(
      'refresh_merge_F2_explicit_undefined_canonicalStatus_preserves_prior_readiness',
      mergedF.runtimeReadiness?.canonicalStatus === 'pending',
      `canonicalStatus readiness=${mergedF.runtimeReadiness?.canonicalStatus} (an explicit undefined must not be promoted to 'ready')`,
    ),
  )
  results.push(
    check(
      'refresh_merge_F3_explicit_undefined_canonicalStatus_preserves_canonicalStatusUnavailable',
      mergedF.canonicalStatusUnavailable === false,
      `canonicalStatusUnavailable=${mergedF.canonicalStatusUnavailable} (must keep the prior value; the refresh's canonicalStatusUnavailable:true must be ignored since canonicalStatus itself was not actually supplied)`,
    ),
  )

  // --- G: cross-check — null and undefined for the same field must produce opposite outcomes --
  results.push(
    check(
      'refresh_merge_G1_null_and_undefined_canonicalStatus_are_distinguished',
      mergedC.runtimeReadiness?.canonicalStatus === 'ready' && mergedF.runtimeReadiness?.canonicalStatus === 'pending',
      `null-supplied readiness=${mergedC.runtimeReadiness?.canonicalStatus} vs undefined-supplied readiness=${mergedF.runtimeReadiness?.canonicalStatus} (must differ — null is an explicit result, undefined is "not supplied")`,
    ),
  )

  // --- Sanity: a refresh addressing neither field leaves both untouched -----------------------
  const neitherRefresh: RuntimeRefreshResult = { ok: true }
  const mergedNeither = mergeRefreshedContext(baseCtx(), neitherRefresh)
  results.push(
    check(
      'refresh_merge_sanity_refresh_touching_neither_field_changes_neither_readiness',
      mergedNeither.runtimeReadiness?.providerConnection === 'pending'
        && mergedNeither.runtimeReadiness?.canonicalStatus === 'pending'
        && mergedNeither.canonicalStatus === STALE_CANONICAL,
      `readiness=${JSON.stringify(mergedNeither.runtimeReadiness)}`,
    ),
  )

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runRefreshMergeValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Refresh merge field-readiness validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
