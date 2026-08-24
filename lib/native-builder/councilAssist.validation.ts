/**
 * Phase E (Council Assist) regression suite. Proves composition rosters/sequencing against real
 * code paths using a controlled fixture invoke function (never a live provider call), and proves
 * end to end through the real engineeringStrategy.councilAssist() that a session is advisory-only:
 * persisted, but never mutating repair.state/proposals/selectedProposal.
 */
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { COUNCIL_ASSIST_COMPOSITIONS, rosterForComposition, requestCouncilAssist, type CouncilAssistInvokeFn } from './councilAssist'
import type { NativeCouncilAssistComposition } from './types'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

function capturingInvoke(): { invoke: CouncilAssistInvokeFn; prompts: { family: string; prompt: string }[] } {
  const prompts: { family: string; prompt: string }[] = []
  const invoke: CouncilAssistInvokeFn = async (family, prompt) => {
    prompts.push({ family, prompt })
    return { ok: true, text: `[${family}] fixture reply`, transportStatus: 200 }
  }
  return { invoke, prompts }
}

function failingInvoke(): CouncilAssistInvokeFn {
  return async () => ({ ok: false, text: '', transportStatus: 'unavailable', error: 'FIXTURE_KEY not configured' })
}

async function testRosters(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(check('composition_01_all_five_present', COUNCIL_ASSIST_COMPOSITIONS.length === 5, String(COUNCIL_ASSIST_COMPOSITIONS.length)))

  const stableGroup = rosterForComposition('stable_group')
  const fullCouncil = rosterForComposition('full_council')
  results.push(check('composition_02_stable_group_full_council_share_roster', JSON.stringify(stableGroup) === JSON.stringify(fullCouncil), JSON.stringify({ stableGroup, fullCouncil })))
  results.push(check('composition_03_stable_group_nonempty', stableGroup.length > 0, String(stableGroup.length)))

  const arch = rosterForComposition('architecture_review')
  const sec = rosterForComposition('security_review')
  const research = rosterForComposition('research_review')
  results.push(check('composition_04_review_rosters_distinct', new Set([JSON.stringify(arch), JSON.stringify(sec), JSON.stringify(research)]).size === 3, JSON.stringify({ arch, sec, research })))
  results.push(check('composition_05_review_rosters_smaller_than_full', arch.length <= stableGroup.length && sec.length <= stableGroup.length && research.length <= stableGroup.length, 'bounded'))

  return results
}

async function testSequencingAndParallelism(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const stableCapture = capturingInvoke()
  const stableSession = await requestCouncilAssist({ title: 'T', description: 'D' }, 'stable_group', stableCapture.invoke)
  results.push(check('sequencing_01_stable_group_calls_full_roster', stableSession.results.length === rosterForComposition('stable_group').length, String(stableSession.results.length)))
  const laterStablePrompt = stableCapture.prompts[stableCapture.prompts.length - 1]?.prompt ?? ''
  results.push(check('sequencing_02_stable_group_later_prompt_includes_prior_replies', stableCapture.prompts.length > 1 && laterStablePrompt.includes('Prior council replies so far'), laterStablePrompt.slice(0, 120)))
  const firstStablePrompt = stableCapture.prompts[0]?.prompt ?? ''
  results.push(check('sequencing_03_stable_group_first_prompt_has_no_prior_replies', !firstStablePrompt.includes('Prior council replies so far'), firstStablePrompt.slice(0, 120)))

  const fullCapture = capturingInvoke()
  await requestCouncilAssist({ title: 'T', description: 'D' }, 'full_council', fullCapture.invoke)
  results.push(check('sequencing_04_full_council_no_prompt_includes_prior_replies', fullCapture.prompts.every(p => !p.prompt.includes('Prior council replies so far')), 'no cross-family dependency'))

  const archCapture = capturingInvoke()
  const archSession = await requestCouncilAssist({ title: 'T', description: 'D' }, 'architecture_review', archCapture.invoke)
  results.push(check('sequencing_05_architecture_review_uses_framing', archCapture.prompts.every(p => p.prompt.includes('systems-architecture assessment')), 'framing present'))
  results.push(check('sequencing_06_architecture_review_roster_matches', JSON.stringify(archSession.roster) === JSON.stringify(rosterForComposition('architecture_review')), JSON.stringify(archSession.roster)))

  return results
}

async function testHonestFailure(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const session = await requestCouncilAssist({ title: 'T', description: 'D' }, 'security_review', failingInvoke())
  results.push(check('failure_01_no_fabricated_success', session.results.every(r => r.ok === false), JSON.stringify(session.results)))
  results.push(check('failure_02_error_text_present', session.results.every(r => Boolean(r.error)), JSON.stringify(session.results.map(r => r.error))))
  return results
}

async function testAdvisoryOnlyEndToEnd(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await strategy.create({
    title: `Council Assist advisory-only fixture ${randomUUID()}`,
    description: 'Proves Council Assist never mutates repair state or proposals.',
    subsystem: 'lib/native-builder/__fixtures__/knownIssueFixture.ts',
    severity: 'medium',
  })

  const beforeState = created.status
  const beforeProposalCount = created.raw.repair.proposals.length
  const beforeSelected = created.proposalSummary.hasProposal

  results.push(check('advisory_01_council_assist_capability_present', typeof strategy.councilAssist === 'function', typeof strategy.councilAssist))

  const withCouncil = await strategy.councilAssist?.(created.id, 'stable_group' as NativeCouncilAssistComposition)
  results.push(check('advisory_02_session_persisted', (withCouncil?.councilAssistSessions.length ?? 0) === 1, String(withCouncil?.councilAssistSessions.length ?? 0)))
  results.push(check('advisory_03_status_unchanged', withCouncil?.status === beforeState, `${beforeState} -> ${withCouncil?.status}`))
  results.push(check('advisory_04_proposal_count_unchanged', (withCouncil?.raw.repair.proposals.length ?? -1) === beforeProposalCount, `${beforeProposalCount} -> ${withCouncil?.raw.repair.proposals.length}`))
  results.push(check('advisory_05_selected_proposal_unchanged', withCouncil?.proposalSummary.hasProposal === beforeSelected, `${beforeSelected} -> ${withCouncil?.proposalSummary.hasProposal}`))

  // Durability: independent re-read (survives "restart" — same discipline as advisoryProviderOpinions).
  const reread = await strategy.get(created.id)
  results.push(check('advisory_06_survives_independent_reread', reread?.councilAssistSessions.length === 1, String(reread?.councilAssistSessions.length)))

  // A second call appends rather than replaces.
  const withSecond = await strategy.councilAssist?.(created.id, 'architecture_review' as NativeCouncilAssistComposition)
  results.push(check('advisory_07_second_session_appends', withSecond?.councilAssistSessions.length === 2, String(withSecond?.councilAssistSessions.length)))
  results.push(check('advisory_08_compositions_distinct', withSecond?.councilAssistSessions.map(s => s.composition).join(',') === 'stable_group,architecture_review', withSecond?.councilAssistSessions.map(s => s.composition).join(',') ?? 'missing'))

  await resetNativeBuilderState()
  return results
}

export async function runCouncilAssistValidation(): Promise<CaseResult[]> {
  return [
    ...(await testRosters()),
    ...(await testSequencingAndParallelism()),
    ...(await testHonestFailure()),
    ...(await testAdvisoryOnlyEndToEnd()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runCouncilAssistValidation()
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Council Assist validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
