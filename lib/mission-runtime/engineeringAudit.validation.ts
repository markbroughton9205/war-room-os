/**
 * Phase K (Observability & Audit) regression suite.
 *
 * lib/war-room/auditLog.ts's insertWarRoomAuditLog() is a real network call to Supabase that
 * safely no-ops when client is null — and lib/war-room/persistence.ts's tryWarRoomSupabase()
 * genuinely returns {ok:false} in this environment (no Supabase credentials configured, confirmed
 * below against real process.env, the same honesty discipline
 * engineeringProviderExperience.validation.ts already established for provider credentials). That
 * makes the audit *sink* itself unobservable here without either a live Supabase project or a
 * mocking framework this codebase doesn't use — so this suite proves the two things that ARE
 * directly, honestly verifiable against real code:
 *   1. The pure metadata-shaping functions (buildCouncilAssistAuditMetadata /
 *      buildProviderResolutionAuditMetadata) produce exactly the right shape from real
 *      NativeCouncilAssistSession / provider-resolution inputs — unit-testable without touching
 *      the sink at all.
 *   2. The real AsyncLocalStorage workspaceId plumbing (workspaceContext.ts's new
 *      getActiveWorkspaceId(), threaded through withWorkspace.ts's runInResolvedWorkspace()) is
 *      genuinely scoped to the async context it runs in — set inside, unset outside, never leaking
 *      across sibling calls.
 *   3. End-to-end: every strategy method that now calls logWarRoomRepoAudit (create() with
 *      coderProvider requested, councilAssist(), autoIterate() with coderProvider requested)
 *      completes successfully and returns the correct RuntimeMission — proving the new audit calls
 *      are non-fatal / correctly awaited even when the sink no-ops, not that a row was written
 *      (which Phase K cannot honestly claim in an environment with no Supabase configured).
 */
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getActiveWorkspaceId, runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { buildCouncilAssistAuditMetadata, buildProviderResolutionAuditMetadata } from './engineeringAudit'
import type { NativeCouncilAssistSession } from '@/lib/native-builder/types'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOVEL_FIXTURE_REL = 'lib/native-builder/__fixtures__/novelCoderFixture.ts'

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 0. Environment honesty check — this suite's whole framing depends on it.
// ---------------------------------------------------------------------------

function testSupabaseGenuinelyUnconfiguredHere(): CaseResult[] {
  const result = tryWarRoomSupabase()
  return [check('audit_00_supabase_genuinely_unconfigured_in_this_environment', result.ok === false, JSON.stringify(result))]
}

// ---------------------------------------------------------------------------
// 1. Pure metadata shaping.
// ---------------------------------------------------------------------------

function testBuildCouncilAssistAuditMetadata(): CaseResult[] {
  const results: CaseResult[] = []
  const session: NativeCouncilAssistSession = {
    id: 'session-1',
    composition: 'architecture_review',
    roster: ['claude', 'chatgpt'],
    results: [
      { family: 'claude', ok: false, text: '', error: 'ANTHROPIC_API_KEY not configured', recordedAt: new Date().toISOString() },
      { family: 'chatgpt', ok: false, text: '', error: 'OPENAI_API_KEY not configured', recordedAt: new Date().toISOString() },
    ],
    requestedAt: new Date().toISOString(),
  }
  const meta = buildCouncilAssistAuditMetadata('repair-1', session)
  results.push(check('audit_01_repairId_carried', meta.repairId === 'repair-1', meta.repairId))
  results.push(check('audit_02_composition_carried', meta.composition === 'architecture_review', meta.composition))
  results.push(check('audit_03_roster_carried', JSON.stringify(meta.roster) === JSON.stringify(['claude', 'chatgpt']), JSON.stringify(meta.roster)))
  results.push(check('audit_04_all_families_honestly_failed', meta.okFamilies.length === 0 && meta.failedFamilies.length === 2, JSON.stringify(meta)))
  results.push(check('audit_05_sessionId_carried', meta.sessionId === 'session-1', meta.sessionId))

  // Mixed ok/fail — proves okFamilies/failedFamilies are derived per-result, not all-or-nothing.
  const mixedSession: NativeCouncilAssistSession = {
    ...session,
    results: [
      { family: 'grok', ok: true, text: 'assessment text', recordedAt: new Date().toISOString() },
      { family: 'kimi', ok: false, text: '', error: 'Kimi key missing', recordedAt: new Date().toISOString() },
    ],
  }
  const mixedMeta = buildCouncilAssistAuditMetadata('repair-2', mixedSession)
  results.push(check('audit_06_mixed_ok_families_correct', JSON.stringify(mixedMeta.okFamilies) === JSON.stringify(['grok']), JSON.stringify(mixedMeta.okFamilies)))
  results.push(check('audit_07_mixed_failed_families_correct', JSON.stringify(mixedMeta.failedFamilies) === JSON.stringify(['kimi']), JSON.stringify(mixedMeta.failedFamilies)))

  return results
}

function testBuildProviderResolutionAuditMetadata(): CaseResult[] {
  const results: CaseResult[] = []

  const notRequested = buildProviderResolutionAuditMetadata('repair-3', undefined, null)
  results.push(check('audit_08_not_requested_is_not_degraded', notRequested.requested === false && notRequested.degradedToDeterministic === false, JSON.stringify(notRequested)))

  const requestedButUnresolved = buildProviderResolutionAuditMetadata('repair-4', { enabled: true, family: 'kimi' }, null)
  results.push(check('audit_09_requested_unresolved_is_degraded', requestedButUnresolved.requested === true && requestedButUnresolved.degradedToDeterministic === true, JSON.stringify(requestedButUnresolved)))
  results.push(check('audit_10_requested_family_recorded', requestedButUnresolved.requestedFamily === 'kimi', String(requestedButUnresolved.requestedFamily)))

  const requestedAndResolved = buildProviderResolutionAuditMetadata('repair-5', { enabled: true, family: 'claude' }, 'claude')
  results.push(check('audit_11_requested_and_resolved_not_degraded', requestedAndResolved.degradedToDeterministic === false, JSON.stringify(requestedAndResolved)))
  results.push(check('audit_12_resolvedFamily_recorded', requestedAndResolved.resolvedFamily === 'claude', String(requestedAndResolved.resolvedFamily)))

  const explicitOptOut = buildProviderResolutionAuditMetadata('repair-6', { enabled: false }, null)
  results.push(check('audit_13_explicit_optout_not_degraded', explicitOptOut.requested === false && explicitOptOut.degradedToDeterministic === false, JSON.stringify(explicitOptOut)))

  return results
}

// ---------------------------------------------------------------------------
// 2. Real AsyncLocalStorage workspaceId scoping.
// ---------------------------------------------------------------------------

async function testWorkspaceIdScoping(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  results.push(check('audit_14_unset_outside_any_workspace_run', getActiveWorkspaceId() === undefined, String(getActiveWorkspaceId())))

  const observedInside = await runWithWorkspaceRoot('/tmp/fake-root-for-audit-test', () => getActiveWorkspaceId(), 'ws-abc123')
  results.push(check('audit_15_set_correctly_inside_scoped_run', observedInside === 'ws-abc123', String(observedInside)))

  results.push(check('audit_16_unset_again_after_scoped_run_returns', getActiveWorkspaceId() === undefined, String(getActiveWorkspaceId())))

  // Omitting workspaceId (every pre-Phase-K caller) must not set anything — backward compatible.
  const observedWithoutId = await runWithWorkspaceRoot('/tmp/fake-root-for-audit-test', () => getActiveWorkspaceId())
  results.push(check('audit_17_omitted_workspaceId_stays_unset', observedWithoutId === undefined, String(observedWithoutId)))

  // Two concurrent scoped runs never leak into each other.
  const [a, b] = await Promise.all([
    runWithWorkspaceRoot('/tmp/root-a', async () => {
      await new Promise(r => setTimeout(r, 5))
      return getActiveWorkspaceId()
    }, 'ws-a'),
    runWithWorkspaceRoot('/tmp/root-b', async () => {
      return getActiveWorkspaceId()
    }, 'ws-b'),
  ])
  results.push(check('audit_18_concurrent_scopes_do_not_leak', a === 'ws-a' && b === 'ws-b', `${a}, ${b}`))

  return results
}

// ---------------------------------------------------------------------------
// 3. End-to-end — the new audit call sites don't break the real strategy methods.
// ---------------------------------------------------------------------------

async function testCreateWithCoderProviderCompletesAndAudits(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await strategy.create({
    title: 'Fixture sum drops last element',
    description: 'sumFixtureValues([1,2,3,4]) returns 6 instead of 10 — off-by-one loop bound.',
    subsystem: 'lib/native-builder/__fixtures__/knownIssueFixture.ts',
    severity: 'medium',
    coderProvider: { enabled: true, family: 'claude' },
  })
  results.push(check('audit_19_create_with_coderProvider_completes', created.proposalSummary.hasProposal === true, JSON.stringify(created.proposalSummary)))

  await resetNativeBuilderState()
  return results
}

async function testCouncilAssistCompletesAndAudits(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await strategy.create({
    title: 'Council assist audit fixture',
    description: 'Needs a design review before proceeding.',
    subsystem: 'lib/native-builder/__fixtures__/knownIssueFixture.ts',
    severity: 'medium',
  })
  const withSession = await strategy.councilAssist?.(created.id, 'architecture_review')
  results.push(check('audit_20_councilAssist_completes', (withSession?.councilAssistSessions.length ?? 0) === 1, String(withSession?.councilAssistSessions.length)))
  results.push(check('audit_21_councilAssist_session_has_roster', (withSession?.councilAssistSessions[0]?.roster.length ?? 0) > 0, JSON.stringify(withSession?.councilAssistSessions[0]?.roster)))

  await resetNativeBuilderState()
  return results
}

async function testAutoIterateWithCoderProviderCompletesAndAudits(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await strategy.create({
    title: `Iteration audit fixture ${randomUUID()}`,
    description: 'Deliberately does not match any deterministic template.',
    subsystem: NOVEL_FIXTURE_REL,
    severity: 'medium',
    targetFiles: [NOVEL_FIXTURE_REL],
  })
  results.push(check('audit_22_precondition_blocked', created.status === 'blocked', created.status))

  const attempted = await strategy.autoIterate?.(created.id, { maxAttempts: 1, coderProvider: { enabled: true, family: 'grok' } })
  results.push(check('audit_23_autoIterate_with_coderProvider_completes', attempted?.iterationAttempts.length === 1, String(attempted?.iterationAttempts.length)))
  results.push(check('audit_24_still_blocked_honest_no_config', attempted?.status === 'blocked', attempted?.status ?? 'missing'))

  await resetNativeBuilderState()
  return results
}

// ---------------------------------------------------------------------------

export async function runEngineeringAuditValidation(): Promise<CaseResult[]> {
  return [
    ...testSupabaseGenuinelyUnconfiguredHere(),
    ...testBuildCouncilAssistAuditMetadata(),
    ...testBuildProviderResolutionAuditMetadata(),
    ...(await testWorkspaceIdScoping()),
    ...(await testCreateWithCoderProviderCompletesAndAudits()),
    ...(await testCouncilAssistCompletesAndAudits()),
    ...(await testAutoIterateWithCoderProviderCompletesAndAudits()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runEngineeringAuditValidation()
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Engineering Audit validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
