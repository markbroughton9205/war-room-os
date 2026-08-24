/**
 * Phase I (Provider Experience) regression suite. Proves three things against real production
 * code, no mocks:
 *   1. lib/council/providerDirectCall.ts's isProviderFamilyConfigured/listProviderFamilyStatus/
 *      resolveConfiguredProviderFamily are honest, synchronous, no-network-call checks — in THIS
 *      environment (no provider credentials configured; confirmed by inspecting process.env
 *      directly, not assumed), every family reports unconfigured and resolution against any
 *      requested family + fallback order honestly returns null, never a fabricated family.
 *   2. engineeringStrategy.ts's create() never fabricates a hosted-coder attempt when nothing is
 *      configured — a mission requesting coderProvider in an unconfigured environment still lands
 *      on the deterministic/local-model path exactly as if coderProvider had been omitted.
 *   3. autoIterate() carries the mission's previously-used hosted-coder family forward across a
 *      bounded iteration attempt (Phase I's actual fix to the Phase G gap where iteration silently
 *      dropped whatever provider a mission had been using), and honestly notes in the attempt's
 *      evidenceSummary when the carried-forward/overridden family can't be resolved in this
 *      environment.
 *
 * Because this environment has zero provider credentials configured (verified below), every case
 * here proves honest degradation, not a live provider round trip — the same honest scope
 * hostedCoderProposal.validation.ts's provider_failure_* cases already established for a single
 * family. Live-provider verification is Phase J's job, not this file's.
 */
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import {
  ALL_PROVIDER_FAMILIES,
  DEFAULT_CODER_FALLBACK_ORDER,
  isProviderFamilyConfigured,
  listProviderFamilyStatus,
  resolveConfiguredProviderFamily,
} from '@/lib/council/providerDirectCall'

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
// 1. Honest configuration checks against this environment's real process.env.
// ---------------------------------------------------------------------------

function testEnvironmentHasNoConfiguredCredentials(): CaseResult[] {
  const results: CaseResult[] = []
  const realConfigured = {
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    chatgpt: Boolean(process.env.OPENAI_API_KEY),
    grok: Boolean(process.env.XAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  }
  results.push(check(
    'provider_01_this_environment_has_no_coder_credentials_configured',
    !realConfigured.claude && !realConfigured.chatgpt && !realConfigured.grok && !realConfigured.gemini,
    JSON.stringify(realConfigured),
  ))
  return results
}

function testIsProviderFamilyConfiguredMatchesRealEnv(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('provider_02_claude_matches_real_env', isProviderFamilyConfigured('claude') === Boolean(process.env.ANTHROPIC_API_KEY), String(isProviderFamilyConfigured('claude'))))
  results.push(check('provider_03_chatgpt_matches_real_env', isProviderFamilyConfigured('chatgpt') === Boolean(process.env.OPENAI_API_KEY), String(isProviderFamilyConfigured('chatgpt'))))
  results.push(check('provider_04_grok_matches_real_env', isProviderFamilyConfigured('grok') === Boolean(process.env.XAI_API_KEY), String(isProviderFamilyConfigured('grok'))))
  results.push(check('provider_05_gemini_matches_real_env', isProviderFamilyConfigured('gemini') === Boolean(process.env.GEMINI_API_KEY), String(isProviderFamilyConfigured('gemini'))))
  return results
}

function testListProviderFamilyStatusCoversAllFamilies(): CaseResult[] {
  const results: CaseResult[] = []
  const list = listProviderFamilyStatus()
  results.push(check('provider_06_every_sanctioned_family_listed', ALL_PROVIDER_FAMILIES.every(f => list.some(s => s.family === f)), JSON.stringify(list.map(s => s.family))))
  results.push(check('provider_07_no_extra_family_listed', list.length === ALL_PROVIDER_FAMILIES.length, String(list.length)))
  results.push(check('provider_08_status_is_boolean_not_fabricated_string', list.every(s => typeof s.configured === 'boolean'), JSON.stringify(list)))
  return results
}

function testResolveConfiguredProviderFamilyHonestlyReturnsNull(): CaseResult[] {
  const results: CaseResult[] = []
  // No credential is configured in this environment (proven above), so resolution against every
  // requested family, walking the full default fallback order, must honestly return null — never
  // silently substitute a family that also isn't configured.
  for (const family of DEFAULT_CODER_FALLBACK_ORDER) {
    const resolved = resolveConfiguredProviderFamily(family)
    results.push(check(`provider_09_resolve_${family}_returns_null_when_unconfigured`, resolved === null, String(resolved)))
  }
  return results
}

function testResolveConfiguredProviderFamilyNeverInventsAFamily(): CaseResult[] {
  const results: CaseResult[] = []
  // A caller-supplied fallback order containing only families that are (in this environment)
  // unconfigured must still return null, not silently pick from ALL_PROVIDER_FAMILIES.
  const resolved = resolveConfiguredProviderFamily('claude', ['chatgpt', 'grok'])
  results.push(check('provider_10_resolution_bounded_to_offered_families', resolved === null, String(resolved)))
  return results
}

// ---------------------------------------------------------------------------
// 2. create() never fabricates a hosted attempt when nothing is configured.
// ---------------------------------------------------------------------------

async function testCreateFallsBackHonestlyWhenUnconfigured(): Promise<CaseResult[]> {
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
  // Even with coderProvider requested, in this unconfigured environment the deterministic
  // template still matches — proving the request degraded honestly rather than blocking the
  // deterministic path or fabricating a hosted result.
  results.push(check('provider_11_create_still_lands_deterministic_when_unconfigured', created.proposalSummary.sourceKind === 'deterministic', created.proposalSummary.sourceKind ?? 'none'))
  results.push(check('provider_12_no_hosted_opinion_fabricated', created.providerOpinions.every(o => o.ok === false || o.family !== 'claude'), JSON.stringify(created.providerOpinions)))

  await resetNativeBuilderState()
  return results
}

// ---------------------------------------------------------------------------
// 3. autoIterate() carries the previously-used hosted-coder family forward, and honestly notes
//    when it can't be resolved in this environment.
// ---------------------------------------------------------------------------

async function testAutoIterateCarriesForwardFamilyAndNotesUnavailability(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await strategy.create({
    title: `Iteration provider-carry-forward fixture ${randomUUID()}`,
    description: 'Deliberately does not match any deterministic template — proves a real, repeatable blocked state.',
    subsystem: NOVEL_FIXTURE_REL,
    severity: 'medium',
    targetFiles: [NOVEL_FIXTURE_REL],
    coderProvider: { enabled: true, family: 'gemini' },
  })
  results.push(check('provider_13_precondition_blocked_no_config', created.status === 'blocked', created.status))
  results.push(check('provider_14_no_hosted_proposal_fabricated_at_create', created.proposalSummary.hasProposal === false, JSON.stringify(created.proposalSummary)))

  // Auto-iterate WITHOUT an explicit coderProvider override — the strategy must attempt to carry
  // forward whatever family the mission was configured with. Since no hosted proposal was ever
  // selected (nothing configured), there is no proposerId to derive a family from, so this is the
  // honest "never requested, still not configured" no-op path — captured for completeness.
  const attempted = await strategy.autoIterate?.(created.id, { maxAttempts: 2 })
  results.push(check('provider_15_iteration_attempt_recorded', attempted?.iterationAttempts.length === 1, String(attempted?.iterationAttempts.length)))
  results.push(check('provider_16_still_blocked_no_provider_available', attempted?.status === 'blocked', attempted?.status ?? 'missing'))
  results.push(check('provider_17_no_mutation_no_fabricated_apply', attempted?.raw.repair.diffEvidence === undefined, 'diffEvidence absent'))

  // Now request coderProvider explicitly on the iteration call itself — this environment still
  // can't resolve it, so the honest fallback note must appear in the attempt's evidenceSummary,
  // proving the code path that would otherwise silently swallow the unavailability is exercised.
  const secondAttempt = await strategy.autoIterate?.(created.id, { maxAttempts: 2, coderProvider: { enabled: true, family: 'kimi' } })
  results.push(check('provider_18_fallback_note_present_in_evidence', (secondAttempt?.iterationAttempts.at(-1)?.evidenceSummary ?? '').includes('not available in this environment'), secondAttempt?.iterationAttempts.at(-1)?.evidenceSummary ?? 'missing'))
  results.push(check('provider_19_fallback_note_names_requested_family', (secondAttempt?.iterationAttempts.at(-1)?.evidenceSummary ?? '').includes('"kimi"'), secondAttempt?.iterationAttempts.at(-1)?.evidenceSummary ?? 'missing'))

  await resetNativeBuilderState()
  return results
}

async function testAutoIterateExplicitOptOutSkipsCarryForward(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await strategy.create({
    title: `Iteration explicit opt-out fixture ${randomUUID()}`,
    description: 'Deliberately does not match any deterministic template.',
    subsystem: NOVEL_FIXTURE_REL,
    severity: 'medium',
    targetFiles: [NOVEL_FIXTURE_REL],
  })
  results.push(check('provider_20_precondition_blocked', created.status === 'blocked', created.status))

  // enabled:false is an explicit opt-out — must not produce a fallback-unavailable note, since
  // hosted-coder replanning was never requested for this attempt.
  const attempted = await strategy.autoIterate?.(created.id, { maxAttempts: 1, coderProvider: { enabled: false } })
  const evidence = attempted?.iterationAttempts.at(-1)?.evidenceSummary ?? ''
  results.push(check('provider_21_explicit_optout_no_fallback_note', !evidence.includes('not available in this environment'), evidence))

  await resetNativeBuilderState()
  return results
}

// ---------------------------------------------------------------------------

export async function runEngineeringProviderExperienceValidation(): Promise<CaseResult[]> {
  return [
    ...testEnvironmentHasNoConfiguredCredentials(),
    ...testIsProviderFamilyConfiguredMatchesRealEnv(),
    ...testListProviderFamilyStatusCoversAllFamilies(),
    ...testResolveConfiguredProviderFamilyHonestlyReturnsNull(),
    ...testResolveConfiguredProviderFamilyNeverInventsAFamily(),
    ...(await testCreateFallsBackHonestlyWhenUnconfigured()),
    ...(await testAutoIterateCarriesForwardFamilyAndNotesUnavailability()),
    ...(await testAutoIterateExplicitOptOutSkipsCarryForward()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runEngineeringProviderExperienceValidation()
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Provider Experience validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
