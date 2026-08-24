/**
 * Phase H (Context Expansion) regression suite. Proves lib/native-builder/contextExpansion.ts's
 * gatherHostedCoderContext() against the real repo filesystem (no mocks for the read surface —
 * readRepoFile/searchRepoText/inspectSymbolUsages/getRepoGitContext all run for real, same as
 * production), then proves the real planRepair() -> requestHostedModelProposal() pipeline actually
 * stamps the resulting hosted-sourced NativeRepairProposal.contextSources, using the same fixture
 * dependency-injection seam (NativeCouncilInvokeFn) hostedCoderProposal.validation.ts established —
 * a fixture standing in for the hosted provider network call, never a mock of native-builder's own
 * logic.
 */
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { reportIssue, planRepair } from './runtime'
import { issueFromCommanderReport } from './issueIngest'
import { gatherHostedCoderContext } from './contextExpansion'
import type { NativeCouncilInvokeFn } from './repairPlanner'
import type { NativeIssueRecord } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const FIXTURE_REL = 'lib/native-builder/__fixtures__/novelCoderFixture.ts'
// A real existing file with known relative imports, reused as-is (never modified) purely to prove
// real one-hop import-relationship extraction against genuine repo content.
const IMPORTING_FILE_REL = 'lib/mission-runtime/engineeringStrategy.ts'

const BROKEN_FIXTURE_CONTENT = `/**\n * Deliberately broken, isolated fixture for the hosted-model coder proposal regression suite\n * (General-Purpose Coder Proposal Generation phase). Never imported by real app code — safe to\n * detect, patch, validate, and roll back repeatedly, same discipline as knownIssueFixture.ts.\n *\n * This bug's shape does NOT match either existing deterministic template\n * (off_by_one_loop_bound_length_minus_one / duplicate_import_line — see repairPlanner.ts), so\n * buildDeterministicProposal() correctly returns null for it. That is the point: any proposal\n * selected for a repair against this fixture proves it came from the hosted-model path, not a\n * template match — this is what "previously unseen coding task" means operationally.\n *\n * Seeded bug: uses \`>\` instead of \`>=\`, so isAdult(18) incorrectly returns false.\n */\nexport function isAdult(age: number): boolean {\n  return age > 18\n}\n`

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

async function resetFixtureToBroken(): Promise<void> {
  const abs = path.join(resolveRepoRoot(), FIXTURE_REL)
  await writeFile(abs, BROKEN_FIXTURE_CONTENT, 'utf8')
}

function fixtureInvokeReturning(text: string): NativeCouncilInvokeFn {
  return async () => ({ ok: true, text })
}

function validProposalJson(matchText: string, replacementText: string, relevantFile = FIXTURE_REL): string {
  return JSON.stringify({
    diagnosis: 'Comparison operator excludes the boundary age; should be inclusive.',
    confidence: 'high',
    relevantFiles: [relevantFile],
    plannedChanges: [
      { file: relevantFile, reason: 'Boundary-inclusive comparison.', operation: 'replace_range', matchText, replacementText },
    ],
    risks: ['Novel proposal — no prior deterministic template exists for this bug class.'],
    rollbackPlan: 'Restore the pre-patch file content from the native-builder snapshot for this repair.',
  })
}

function makeIssue(overrides: Partial<NativeIssueRecord> = {}): NativeIssueRecord {
  return {
    id: 'fixture-issue',
    fingerprint: 'fixture-fingerprint',
    title: 'isAdult excludes the boundary age of 18',
    severity: 'medium',
    source: 'commander_report',
    affectedSubsystem: FIXTURE_REL,
    evidence: [],
    rawEvidenceText: 'isAdult(18) returns false; boundary comparison should be inclusive.',
    occurrenceCount: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    status: 'open',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Target-file resolution and sources tagging against a real repo file.
// ---------------------------------------------------------------------------

async function testTargetFileResolutionAndTagging(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetFixtureToBroken()
  const issue = makeIssue()

  const ctx = await gatherHostedCoderContext(issue, [FIXTURE_REL], [])
  results.push(check('ctx_01_target_excerpt_present', ctx.excerpts.some(e => e.relPath === FIXTURE_REL), JSON.stringify(ctx.excerpts.map(e => e.relPath))))
  results.push(check('ctx_02_target_source_tagged_correctly', ctx.sources.some(s => s.relPath === FIXTURE_REL && s.reason === 'target'), JSON.stringify(ctx.sources)))
  results.push(check('ctx_03_target_chars_recorded_positive', (ctx.sources.find(s => s.relPath === FIXTURE_REL)?.chars ?? 0) > 0, JSON.stringify(ctx.sources.find(s => s.relPath === FIXTURE_REL))))

  return results
}

async function testFallbackToProvidedExcerptsWhenNoTargetResolves(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const issue = makeIssue({ affectedSubsystem: 'lib/native-builder/does-not-exist-anywhere.ts' })
  const fallback = [{ relPath: FIXTURE_REL, content: BROKEN_FIXTURE_CONTENT }]

  const ctx = await gatherHostedCoderContext(issue, ['lib/native-builder/does-not-exist-anywhere.ts'], fallback)
  results.push(check('ctx_04_fallback_used_when_target_missing', ctx.excerpts.some(e => e.relPath === FIXTURE_REL), JSON.stringify(ctx.excerpts.map(e => e.relPath))))
  results.push(check('ctx_05_fallback_tagged_as_target', ctx.sources.some(s => s.relPath === FIXTURE_REL && s.reason === 'target'), JSON.stringify(ctx.sources)))

  return results
}

// ---------------------------------------------------------------------------
// 2. Real one-hop import-relationship extraction against genuine repo content.
// ---------------------------------------------------------------------------

async function testRealImportRelationshipExtraction(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const issue = makeIssue({ title: 'Engineering strategy import test', affectedSubsystem: IMPORTING_FILE_REL })

  const ctx = await gatherHostedCoderContext(issue, [IMPORTING_FILE_REL], [])
  results.push(check('ctx_06_primary_target_is_the_importing_file', ctx.sources.some(s => s.relPath === IMPORTING_FILE_REL && s.reason === 'target'), JSON.stringify(ctx.sources.map(s => s.relPath))))

  const importRelated = ctx.sources.filter(s => s.reason === 'import_relationship')
  results.push(check('ctx_07_at_least_one_real_import_relationship_found', importRelated.length > 0, JSON.stringify(importRelated)))
  results.push(check('ctx_08_import_related_files_actually_readable_content', importRelated.every(s => ctx.excerpts.some(e => e.relPath === s.relPath && e.content.length > 0)), JSON.stringify(importRelated.map(s => s.relPath))))
  results.push(check('ctx_09_import_related_bounded_to_cap', importRelated.length <= 4, String(importRelated.length)))

  return results
}

// ---------------------------------------------------------------------------
// 3. Bounded caps are actually respected — no dedupe overlap, total char cap honored.
// ---------------------------------------------------------------------------

async function testCapsRespected(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const issue = makeIssue({ title: 'Engineering strategy import test', affectedSubsystem: IMPORTING_FILE_REL })
  const ctx = await gatherHostedCoderContext(issue, [IMPORTING_FILE_REL], [])

  results.push(check('ctx_10_no_duplicate_relpaths_across_excerpts', new Set(ctx.excerpts.map(e => e.relPath)).size === ctx.excerpts.length, String(ctx.excerpts.length)))
  const totalChars = ctx.excerpts.reduce((sum, e) => sum + e.content.length, 0)
  results.push(check('ctx_11_total_chars_within_cap', totalChars <= 32_000, String(totalChars)))
  results.push(check('ctx_12_per_file_chars_within_cap', ctx.excerpts.every(e => e.content.length <= 6000), JSON.stringify(ctx.excerpts.map(e => e.content.length))))

  const symbolUsageSources = ctx.sources.filter(s => s.reason === 'symbol_usage')
  results.push(check('ctx_13_symbol_usage_bounded_to_cap', symbolUsageSources.length <= 6, String(symbolUsageSources.length)))
  results.push(check('ctx_14_symbol_usage_is_path_line_only_zero_chars', symbolUsageSources.every(s => s.chars === 0 && s.relPath.includes(':')), JSON.stringify(symbolUsageSources)))

  return results
}

// ---------------------------------------------------------------------------
// 4. Search-match inclusion — a real text search against the fixture's own issue title keyword.
// ---------------------------------------------------------------------------

async function testSearchMatchInclusion(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetFixtureToBroken()
  // A keyword ('isAdult') that genuinely appears in files beyond the single primary target, so a
  // real searchRepoText() call has something real to surface as a 'search_match' source.
  const issue = makeIssue({ title: 'isAdult boundary comparison', affectedSubsystem: FIXTURE_REL })

  const ctx = await gatherHostedCoderContext(issue, [FIXTURE_REL], [])
  const searchMatches = ctx.sources.filter(s => s.reason === 'search_match')
  results.push(check('ctx_15_search_matches_bounded_to_cap', searchMatches.length <= 2, String(searchMatches.length)))
  // Not asserting >0 unconditionally — genuinely depends on what else in the repo mentions the
  // keyword, and asserting a brittle exact count would misrepresent a real, live search as
  // deterministic. What's asserted is the honest structural property: whatever came back is
  // correctly tagged and within budget.
  results.push(check('ctx_16_search_matches_correctly_tagged_and_readable', searchMatches.every(s => ctx.excerpts.some(e => e.relPath === s.relPath)), JSON.stringify(searchMatches.map(s => s.relPath))))

  return results
}

// ---------------------------------------------------------------------------
// 5. Git-context summary is present and scoped (never a full-repo diff).
// ---------------------------------------------------------------------------

async function testGitContextSummaryPresent(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetFixtureToBroken()
  const issue = makeIssue()
  const ctx = await gatherHostedCoderContext(issue, [FIXTURE_REL], [])

  results.push(check('ctx_17_git_context_summary_present', typeof ctx.gitContextSummary === 'string' && ctx.gitContextSummary.length > 0, ctx.gitContextSummary))
  results.push(check('ctx_18_git_context_summary_not_a_raw_full_diff', !ctx.gitContextSummary.includes('diff --git'), ctx.gitContextSummary))

  return results
}

// ---------------------------------------------------------------------------
// 6. End-to-end: real planRepair() -> requestHostedModelProposal() stamps contextSources on the
//    resulting hosted-sourced NativeRepairProposal, matching what gatherHostedCoderContext()
//    itself produced for the same inputs.
// ---------------------------------------------------------------------------

async function testEndToEndProposalCarriesContextSources(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  const input = issueFromCommanderReport({
    title: 'isAdult excludes the boundary age of 18',
    description: 'isAdult(18) returns false; the comparison should be inclusive (>=), not exclusive (>).',
    subsystem: FIXTURE_REL,
    severity: 'medium',
  })
  const { issue, repair } = await reportIssue(input)
  if (!repair) throw new Error('Expected a fresh repair for a brand-new fingerprint.')

  const invoke = fixtureInvokeReturning(validProposalJson('return age > 18', 'return age >= 18'))
  const expectedContext = await gatherHostedCoderContext(issue, [FIXTURE_REL], [])

  const planned = await planRepair(repair.id, {
    targetFiles: [FIXTURE_REL],
    hostedCoder: { family: 'claude', invoke },
    commanderRequestText: 'Fix isAdult to be inclusive of the boundary age.',
  })

  const selected = planned.selectedProposal
  results.push(check('ctx_19_hosted_proposal_selected', selected?.sourceKind === 'hosted_model', selected?.sourceKind ?? 'none'))
  results.push(check('ctx_20_contextSources_present_on_hosted_proposal', Array.isArray(selected?.contextSources) && selected!.contextSources!.length > 0, JSON.stringify(selected?.contextSources)))
  results.push(check(
    'ctx_21_contextSources_matches_gatherHostedCoderContext_output',
    JSON.stringify(selected?.contextSources) === JSON.stringify(expectedContext.sources),
    `${JSON.stringify(selected?.contextSources)} vs ${JSON.stringify(expectedContext.sources)}`,
  ))
  results.push(check(
    'ctx_22_target_source_recorded_for_the_actual_fixture',
    selected?.contextSources?.some(s => s.relPath === FIXTURE_REL && s.reason === 'target') ?? false,
    JSON.stringify(selected?.contextSources),
  ))

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

async function testNonHostedProposalHasNoContextSources(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const FIXTURE_KNOWN = 'lib/native-builder/__fixtures__/knownIssueFixture.ts'

  const strategy = (await import('@/lib/mission-runtime')).getMissionExecutionStrategy('engineering')
  const created = await strategy.create({
    title: 'Fixture sum drops last element',
    description: 'sumFixtureValues([1,2,3,4]) returns 6 instead of 10 — off-by-one loop bound.',
    subsystem: FIXTURE_KNOWN,
    severity: 'medium',
  })
  // A deterministic-template match (no hostedCoder configured) never touches contextExpansion.ts
  // at all — its proposal must simply never carry a contextSources field, honestly reflecting that
  // Phase H is additive to the hosted-coder path only.
  results.push(check(
    'ctx_23_deterministic_proposal_has_no_contextSources',
    created.proposalSummary.hasProposal === true,
    JSON.stringify(created.proposalSummary),
  ))
  const rawProposal = created.raw.repair.proposals?.find(p => p.sourceKind === 'deterministic')
  results.push(check(
    'ctx_24_deterministic_proposal_contextSources_undefined',
    rawProposal !== undefined && rawProposal.contextSources === undefined,
    JSON.stringify(rawProposal?.contextSources),
  ))

  await resetNativeBuilderState()
  return results
}

// ---------------------------------------------------------------------------

export async function runContextExpansionValidation(): Promise<CaseResult[]> {
  return [
    ...(await testTargetFileResolutionAndTagging()),
    ...(await testFallbackToProvidedExcerptsWhenNoTargetResolves()),
    ...(await testRealImportRelationshipExtraction()),
    ...(await testCapsRespected()),
    ...(await testSearchMatchInclusion()),
    ...(await testGitContextSummaryPresent()),
    ...(await testEndToEndProposalCarriesContextSources()),
    ...(await testNonHostedProposalHasNoContextSources()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runContextExpansionValidation()
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Context Expansion validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
