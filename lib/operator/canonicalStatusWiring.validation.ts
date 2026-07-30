/**
 * Negative-proof suite for Workstream 2 (self-repair validation reliability, Phase 2):
 * canonicalStatus-dependent validators (auditProviderUsability, auditPlaceholderValues'
 * canonical branch, findOperatorGaps' subsystem-unavailable branch) must become live in the
 * primary render path from the existing mount-time canonical-status fetch — no manual
 * "Run Self-Audit" click required, and no second independent fetch.
 */
import { pathToFileURL } from 'node:url'
import { resolveOperatorGaps, type CanonicalGapSnapshot, type GapFinderContext } from './gapFinder'
import { deriveProviderHealthFromCanonicalStatus } from '../runtime/providerHealthFromCanonicalStatus'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function baseCtx(overrides: Partial<GapFinderContext> = {}): GapFinderContext {
  return { visibleMessages: [], ...overrides }
}

const MOCK_CANONICAL_RESPONSE: CanonicalGapSnapshot = {
  providers: [
    { family: 'claude', label: 'Anthropic · Claude · live connected', configured: true, availability: 'CONNECTED', health: 'healthy', connectionStatus: 'online' },
    { family: 'chatgpt', label: 'OpenAI · ChatGPT · rate limited', configured: true, availability: 'RATE_LIMITED', health: 'degraded', connectionStatus: 'error' },
    { family: 'grok', label: 'xAI · Grok · not configured', configured: false, availability: 'NOT_CONFIGURED', health: 'unavailable', connectionStatus: 'not_connected' },
  ],
  subsystems: [
    { id: 'engine_control', label: 'Engine Control', health: 'unavailable', missingEvidence: ['Structured engine list missing or empty.'] },
    { id: 'persistence', label: 'Persistence', health: 'healthy' },
  ],
  summary: { health: 'degraded', degradedSubsystems: [], unavailableSubsystems: ['engine_control'] },
}

const INITIAL_DEFAULTS = {
  providers: { claude: 'not_connected', chatgpt: 'not_connected', grok: 'not_connected' } as const,
  labels: { claude: '', chatgpt: '', grok: '' },
}

export function runCanonicalStatusWiringValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // B1: "before fix" — canonicalStatus is simply never populated in the primary context (matches
  // app/page.tsx's old operatorGapFinderContext, which had no canonicalStatus field at all). No
  // manual scan simulated anywhere in this test — this is exactly the primary render path.
  const beforeFixCtx = baseCtx({
    canonicalStatus: undefined,
    canonicalStatusUnavailable: undefined,
  })
  const beforeFixGaps = resolveOperatorGaps(beforeFixCtx)
  const providerRateLimitGapId = 'self-audit-provider-quota-chatgpt'
  const subsystemGapTitle = 'Subsystem unavailable: Engine Control'
  results.push(
    check(
      'canonical_b1_before_fix_provider_condition_dormant',
      !beforeFixGaps.some(g => g.id === providerRateLimitGapId),
      `gaps=${JSON.stringify(beforeFixGaps.map(g => g.id))}`,
    ),
  )
  results.push(
    check(
      'canonical_b1_before_fix_subsystem_condition_dormant',
      !beforeFixGaps.some(g => g.title === subsystemGapTitle),
      `gaps=${JSON.stringify(beforeFixGaps.map(g => g.title))}`,
    ),
  )

  // B2: "after fix" — canonicalStatus populated directly from the mount-time fetch response
  // (no button click, no separate fetch call anywhere in this test), readiness marked 'ready'.
  const afterFixCtx = baseCtx({
    canonicalStatus: MOCK_CANONICAL_RESPONSE,
    canonicalStatusUnavailable: false,
    runtimeReadiness: { canonicalStatus: 'ready' },
  })
  const afterFixGaps = resolveOperatorGaps(afterFixCtx)
  results.push(
    check(
      'canonical_b2_provider_specific_condition_now_live',
      afterFixGaps.some(g => g.id === providerRateLimitGapId),
      `gaps=${JSON.stringify(afterFixGaps.map(g => g.id))}`,
    ),
  )
  results.push(
    check(
      'canonical_b2_subsystem_unavailable_condition_now_live',
      afterFixGaps.some(g => g.title === subsystemGapTitle),
      `gaps=${JSON.stringify(afterFixGaps.map(g => g.title))}`,
    ),
  )

  // B3: "one response feeds both" — the exact same MOCK_CANONICAL_RESPONSE object that produced
  // canonicalStatus above, run through the same reduction loadProviderHealth uses, must yield a
  // providerConnection map whose per-family status agrees with canonicalStatus's connectionStatus
  // field for every family — proving both representations are one derivation of one response,
  // not two independently-fetched snapshots that could disagree.
  const derived = deriveProviderHealthFromCanonicalStatus(MOCK_CANONICAL_RESPONSE, INITIAL_DEFAULTS)
  const agreement = (MOCK_CANONICAL_RESPONSE.providers ?? []).every(
    row => derived.providers[row.family as keyof typeof derived.providers] === row.connectionStatus,
  )
  results.push(
    check(
      'canonical_b3_provider_connection_and_canonical_status_agree_from_one_response',
      agreement,
      `derived=${JSON.stringify(derived.providers)} canonical=${JSON.stringify(MOCK_CANONICAL_RESPONSE.providers?.map(p => ({ family: p.family, connectionStatus: p.connectionStatus })))}`,
    ),
  )

  // B4: canonicalStatusUnavailable true (fetch failed) must still not fabricate a false success —
  // the "cannot load" gap (a distinct, honest gap) should fire instead of silence or a false pass.
  const unavailableCtx = baseCtx({
    canonicalStatus: null,
    canonicalStatusUnavailable: true,
    runtimeReadiness: { canonicalStatus: 'ready' },
  })
  const unavailableGaps = resolveOperatorGaps(unavailableCtx)
  results.push(
    check(
      'canonical_b4_unavailable_fetch_reports_cannot_load_not_success',
      unavailableGaps.some(g => g.id === 'self-audit-provider-canonical-unavailable'),
      `gaps=${JSON.stringify(unavailableGaps.map(g => g.id))}`,
    ),
  )

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCanonicalStatusWiringValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Canonical status wiring validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
