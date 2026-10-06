/**
 * Disagreement resolution validation: real self-review/independent-verdict combinations, then mutation checks.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as disagreementModule from './foundryReviewDisagreement'
import type { Phase6Finding } from './foundryPhase6Types'
import { runMutation, type Mutation } from './foundryMutationHarness'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }
const ROOT = resolveRepoRoot()

const provenFinding: Phase6Finding = { findingId: 'f1', severity: 'BLOCKING', claim: 'a real gap', evidenceRefs: [], affectedFiles: [], confidenceClass: 'DIRECTLY_PROVEN', actionability: 'REPAIR' }
const probeFinding: Phase6Finding = { findingId: 'f2', severity: 'BLOCKING', claim: 'maybe a gap', evidenceRefs: [], affectedFiles: [], confidenceClass: 'PLAUSIBLE_NEEDS_PROBE', actionability: 'PROBE' }
const unsupportedFinding: Phase6Finding = { findingId: 'f3', severity: 'ADVISORY', claim: 'unsupported', evidenceRefs: [], affectedFiles: [], confidenceClass: 'UNSUPPORTED', actionability: 'NONE' }

type Module = typeof disagreementModule

function scenarios(module: Module): string[] {
  const failed: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failed.push(name) }

  const agreement = module.resolveDisagreement({ selfReviewRecommendation: 'COMPLETE', selfReviewFindings: [], independentRecommendation: 'COMPLETE', independentFindings: [] })
  expect('no_disagreement_when_both_sides_agree', agreement === null)

  const independentProvenWins = module.resolveDisagreement({
    selfReviewRecommendation: 'COMPLETE', selfReviewFindings: [],
    independentRecommendation: 'REPAIR_NEEDED', independentFindings: [provenFinding],
  })
  expect('directly_proven_finding_resolves_to_repair', independentProvenWins?.status === 'DISAGREEMENT_RESOLVED' && independentProvenWins.resolution === 'REPAIR_NEEDED')

  const selfProvenWins = module.resolveDisagreement({
    selfReviewRecommendation: 'REPAIR_NEEDED', selfReviewFindings: [provenFinding],
    independentRecommendation: 'COMPLETE', independentFindings: [],
  })
  expect('a_directly_proven_self_review_finding_also_resolves_to_repair', selfProvenWins?.status === 'DISAGREEMENT_RESOLVED' && selfProvenWins.resolution === 'REPAIR_NEEDED')

  const needsProbe = module.resolveDisagreement({
    selfReviewRecommendation: 'COMPLETE', selfReviewFindings: [],
    independentRecommendation: 'REPAIR_NEEDED', independentFindings: [probeFinding],
  })
  expect('only_plausible_evidence_asks_for_a_probe_not_an_immediate_verdict', needsProbe?.status === 'DISAGREEMENT_PROBE')

  const onlyUnsupported = module.resolveDisagreement({
    selfReviewRecommendation: 'REPAIR_NEEDED', selfReviewFindings: [unsupportedFinding],
    independentRecommendation: 'COMPLETE', independentFindings: [],
  })
  expect('only_unsupported_findings_resolve_to_complete', onlyUnsupported?.status === 'DISAGREEMENT_RESOLVED' && onlyUnsupported.resolution === 'COMPLETE')

  const probeThenFail = module.resolveDisagreementAfterProbe(needsProbe!, { findingId: 'p', severity: 'BLOCKING', claim: 'probe found it', evidenceRefs: [], affectedFiles: [], confidenceClass: 'DIRECTLY_PROVEN', actionability: 'REPAIR' })
  expect('a_probe_that_finds_the_defect_resolves_to_repair', probeThenFail.status === 'DISAGREEMENT_RESOLVED' && probeThenFail.resolution === 'REPAIR_NEEDED')

  const probeThenClear = module.resolveDisagreementAfterProbe(needsProbe!, null)
  expect('a_probe_that_finds_nothing_resolves_to_complete', probeThenClear.status === 'DISAGREEMENT_RESOLVED' && probeThenClear.resolution === 'COMPLETE')

  // A probe result of null would flip an open DISAGREEMENT_PROBE to COMPLETE; feeding it to an already-RESOLVED (REPAIR_NEEDED)
  // record must leave that resolution untouched — proving the function does not reopen a settled disagreement for a later call.
  const alreadyResolvedIgnoresAnotherProbe = module.resolveDisagreementAfterProbe(independentProvenWins!, null)
  expect('an_already_resolved_disagreement_does_not_reopen_for_a_new_probe', alreadyResolvedIgnoresAnotherProbe.status === 'DISAGREEMENT_RESOLVED' && alreadyResolvedIgnoresAnotherProbe.resolution === 'REPAIR_NEEDED')

  return failed
}

async function main() {
  const failedReal = scenarios(disagreementModule)
  const names = ['no_disagreement_when_both_sides_agree', 'directly_proven_finding_resolves_to_repair', 'a_directly_proven_self_review_finding_also_resolves_to_repair', 'only_plausible_evidence_asks_for_a_probe_not_an_immediate_verdict', 'only_unsupported_findings_resolve_to_complete', 'a_probe_that_finds_the_defect_resolves_to_repair', 'a_probe_that_finds_nothing_resolves_to_complete', 'an_already_resolved_disagreement_does_not_reopen_for_a_new_probe']
  for (const name of names) check(`S_${name}`, !failedReal.includes(name))

  const src = readFileSync(path.join(ROOT, 'lib/native-builder/foundryReviewDisagreement.ts'), 'utf8')
  check('W_the_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(src), '')
  check('W_never_resolves_by_a_fixed_side_winning', !/selfReviewRecommendation\s*===\s*.COMPLETE.\s*\?|independentRecommendation\s*===\s*.COMPLETE.\s*\?\s*.COMPLETE./.test(src), '')

  const file = path.join(ROOT, 'lib/native-builder/foundryReviewDisagreement.ts')
  const mutations: Mutation[] = [
    { name: 'agreement_now_always_flagged_as_disagreement', from: 'if (input.selfReviewRecommendation === input.independentRecommendation) return null', to: 'if (false as boolean) return null' },
    { name: 'strong_evidence_no_longer_forces_repair', from: 'if (RANK[best.confidenceClass] >= RANK.STRONGLY_SUPPORTED) {', to: 'if (false as boolean) {' },
    { name: 'plausible_evidence_skips_the_probe_and_resolves_immediately', from: "if (best.confidenceClass === 'PLAUSIBLE_NEEDS_PROBE') {", to: 'if (false as boolean) {' },
    { name: 'probe_result_ignored_after_probe', from: "if (probeFinding && RANK[probeFinding.confidenceClass] >= RANK.STRONGLY_SUPPORTED && probeFinding.severity === 'BLOCKING') {", to: 'if (false as boolean) {' },
    { name: 'resolved_disagreement_reopens_for_any_later_probe', from: "if (record.status !== 'DISAGREEMENT_PROBE') return record", to: 'if (false as boolean) return record' },
  ]
  for (const mutation of mutations) {
    const outcome = await runMutation<Module>(file, mutation, scenarios)
    check(`M_${mutation.name}_is_caught`, outcome.caught, outcome.failed.slice(0, 2).join(' | '))
  }

  const failed = results.filter(r => !r.pass)
  console.log(`DISAGREEMENT_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
