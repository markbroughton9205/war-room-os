/**
 * Reviewer acceptance basis. Pure: the reviewer may only judge against the request and explicit acceptance criteria; a raw contract
 * line is never an acceptance sentence; a claim that maps to no criterion, or the same handled claim again while tests pass, cannot chase repairs.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { acceptanceBasis, reviewClaimDecision, reviewClaimKey, reviewClaimSupport, reviewerContract, setAsideNote, significantWords, testsGreenAtCurrentGeneration } from './foundryAcceptanceBasis'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const REQUEST = 'Update item status filtering and expose it through the API and the UI'
// The normalized Proof C contract: one raw field constant and two acceptance sentences.
const cContract = 'FILTER_FIELD = "status"\nACCEPTANCE_CLOSED = "status closed returns only closed rows"\nACCEPTANCE_BOARD = "the board lists every row the API returns for the status"\n'
// The Proof F contract convention.
const fContract = 'FILTER_FIELD = "status"\nACCEPTANCE_CLOSED = "status closed returns only closed rows"\nACCEPTANCE_UI = "the UI function forwards status"\n'
// The old, un-normalized Proof C contract: a bare constant, no acceptance sentence at all.
const bareContract = 'FILTER_FIELD = "status"\n'

// Sentences the local reviewer really produced, quoted from the recorded runs.
const CHASE_CLAIMS = [
  'STATUS fail: The acceptance sentence \'FILTER_FIELD = "status"\' is not implemented in the backend/api.py and frontend/board.py files.',
  'STATUS fail: The acceptance sentence \'FILTER_FIELD = "status"\' is implemented in the contract, but it is not fully reflected in the backend and frontend code.',
  'STATUS fail: The acceptance sentence \'FILTER_FIELD = "status"\' is implemented in the contract, but it is not used in the backend or frontend code.',
]
const F_CLAIM = 'STATUS fail: ACCEPTANCE_CLOSED (status closed returns only closed rows) is not implemented, ACCEPTANCE_UI (the UI function forwards status) is not implemented'

function main() {
  const c = acceptanceBasis({ request: REQUEST, acceptance: [REQUEST], contracts: [cContract] })
  const f = acceptanceBasis({ request: REQUEST, acceptance: [REQUEST], contracts: [fContract] })
  const bare = acceptanceBasis({ request: REQUEST, acceptance: [REQUEST], contracts: [bareContract] })

  // ---- A. a raw contract line does not become an acceptance criterion
  check('A_explicit_acceptance_sentences_are_read_from_the_contract', c.explicit.map(item => item.id).join() === 'ACCEPTANCE_CLOSED,ACCEPTANCE_BOARD', c.explicit.map(item => item.id).join())
  check('A_the_raw_field_constant_is_context_and_never_a_criterion', c.contextNames.join() === 'FILTER_FIELD' && !c.criteria.some(item => /FILTER_FIELD/.test(item)), c.criteria.join(' | '))
  check('A_the_request_is_always_the_first_criterion', c.criteria[0] === REQUEST && bare.criteria.join() === REQUEST, '')
  check('A_a_contract_with_no_acceptance_sentence_adds_none', bare.explicit.length === 0 && bare.contextNames.join() === 'FILTER_FIELD', '')
  check('A_the_reviewer_is_shown_the_request_and_numbered_criteria_only', /^REQUEST Update item/.test(reviewerContract(c)) && /ACCEPTANCE 1\. status closed returns only closed rows/.test(reviewerContract(c)) && !/FILTER_FIELD/.test(reviewerContract(c)) && reviewerContract(c).length <= 400, reviewerContract(c))
  for (const [index, claim] of CHASE_CLAIMS.entries()) {
    const support = reviewClaimSupport(claim, c)
    check(`A_recorded_chase_claim_${index + 1}_quoting_the_raw_constant_is_unsupported`, !support.supported && support.reason === 'raw_contract_literal', support.reason)
    check(`A_recorded_chase_claim_${index + 1}_is_unsupported_even_against_a_bare_contract`, !reviewClaimSupport(claim, bare).supported, '')
  }
  check('A_a_claim_matching_no_criterion_is_unsupported', reviewClaimSupport('STATUS fail: the colour scheme is ugly and the logo is small', c).reason === 'matches_no_criterion', '')
  check('A_comments_and_definitions_are_not_read_as_context_names', acceptanceBasis({ request: 'x y z', contracts: ['def normalize_status(v):\n    return v\nclass A:\n    pass\nimport os\n'] }).contextNames.length === 0, '')
  check('A_a_comment_in_the_acceptance_convention_is_an_acceptance_sentence', acceptanceBasis({ request: 'r', contracts: ['# Acceptance: closed rows are shown last\nX = 1\n'] }).explicit[0]?.sentence === 'closed rows are shown last', '')

  // ---- B. a real explicit acceptance criterion can still reopen work
  check('B_naming_an_acceptance_criterion_is_supported', reviewClaimSupport(F_CLAIM, f).supported && reviewClaimSupport(F_CLAIM, f).reason === 'names_an_acceptance_criterion', '')
  check('B_a_claim_restating_a_criterion_in_words_is_supported', reviewClaimSupport('STATUS fail: filtering by closed returns open rows too, so closed rows only is not met', c).supported, '')
  check('B_a_claim_about_the_request_itself_is_supported', reviewClaimSupport('STATUS fail: the UI does not show the filtered API rows', c).supported, '')
  check('B_a_claim_naming_a_numbered_acceptance_line_is_supported', reviewClaimSupport("STATUS fail: Acceptance 1 is not met (only 'open' status is filtered), Acceptance 2 is met", f).supported && reviewClaimSupport('STATUS fail: acceptance criterion 2 is not met', f).supported, '')
  check('B_a_number_beyond_the_criteria_is_not_a_criterion', !reviewClaimSupport('STATUS fail: Acceptance 7 is not met', bare).supported, '')
  const fresh = reviewClaimDecision({ claim: F_CLAIM, basis: f, earlierClaims: [], testsGreenNow: true, filesMeetCriteria: true })
  check('B_a_supported_first_claim_reopens_even_when_tests_are_green', fresh.decision === 'REOPEN', fresh.decision)
  check('B_the_proof_f_reviewer_claim_still_reopens_work', reviewClaimDecision({ claim: F_CLAIM, basis: f, earlierClaims: [], testsGreenNow: false, filesMeetCriteria: false }).decision === 'REOPEN', '')

  // ---- C. green tests and met criteria: an unsupported or already-handled claim cannot start a chase
  const chase = reviewClaimDecision({ claim: CHASE_CLAIMS[0], basis: c, earlierClaims: [], testsGreenNow: true, filesMeetCriteria: true })
  check('C_the_recorded_chase_claim_is_set_aside_on_first_sight', chase.decision === 'SET_ASIDE_UNSUPPORTED', chase.decision)
  const key = reviewClaimKey(F_CLAIM)
  const again = reviewClaimDecision({ claim: F_CLAIM, basis: f, earlierClaims: [key], testsGreenNow: true, filesMeetCriteria: true })
  check('C_the_same_supported_claim_again_with_green_tests_and_met_criteria_is_settled', again.decision === 'SET_ASIDE_SETTLED', again.decision)
  const reworded = reviewClaimDecision({ claim: 'STATUS fail: ACCEPTANCE_CLOSED (status closed returns only closed rows) is not implemented, and ACCEPTANCE_UI is not implemented', basis: f, earlierClaims: [key], testsGreenNow: true, filesMeetCriteria: true })
  check('C_the_same_complaint_in_other_words_is_still_recognised', reworded.decision === 'SET_ASIDE_SETTLED', reworded.decision)
  check('C_a_chase_bounded_to_one_rework_per_claim', (() => { let earlier: string[] = []; let reopened = 0; for (let round = 0; round < 6; round += 1) { const verdict = reviewClaimDecision({ claim: F_CLAIM, basis: f, earlierClaims: earlier, testsGreenNow: true, filesMeetCriteria: true }); if (verdict.decision === 'REOPEN') { reopened += 1; earlier = [...earlier, verdict.key] } } return reopened === 1 })(), '')

  // ---- D. new contradictory evidence can still reopen work
  check('D_a_different_supported_claim_reopens', reviewClaimDecision({ claim: 'STATUS fail: the board does not list every row the API returns for the status', basis: c, earlierClaims: [key], testsGreenNow: true, filesMeetCriteria: true }).decision === 'REOPEN', '')
  check('D_the_same_claim_reopens_when_the_files_do_not_meet_the_criteria', reviewClaimDecision({ claim: F_CLAIM, basis: f, earlierClaims: [key], testsGreenNow: true, filesMeetCriteria: false }).decision === 'REOPEN', '')
  check('D_the_same_claim_reopens_when_the_tests_are_not_green', reviewClaimDecision({ claim: F_CLAIM, basis: f, earlierClaims: [key], testsGreenNow: false, filesMeetCriteria: true }).decision === 'REOPEN', '')
  const receipt = (result: string, gen: number) => ({ command: 'python3 -m unittest', result, testedMutationGeneration: gen })
  check('D_green_tests_count_only_at_the_current_generation', testsGreenAtCurrentGeneration({ mutationGeneration: 3, testReceipts: [receipt('PASSED', 3)] }) && !testsGreenAtCurrentGeneration({ mutationGeneration: 4, testReceipts: [receipt('PASSED', 3)] }) && !testsGreenAtCurrentGeneration({ mutationGeneration: 3, testReceipts: [receipt('FAILED', 3)] }) && testsGreenAtCurrentGeneration({ mutationGeneration: 2, testReceipts: [receipt('PASSED_SCOPED', 2)] }) && !testsGreenAtCurrentGeneration({ mutationGeneration: 0, testReceipts: [] }), '')

  // ---- plain language and wiring
  check('P_the_set_aside_notes_are_plain_language', [setAsideNote('SET_ASIDE_UNSUPPORTED'), setAsideNote('SET_ASIDE_SETTLED')].every(text => text.length > 20 && !/SET_ASIDE|REOPEN|ACCEPTANCE_|debug-/.test(text)), '')
  check('P_significant_words_ignore_filler', significantWords('The status is not implemented in the API').join() === 'api', significantWords('The status is not implemented in the API').join())
  const runtime = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8')
  check('W_the_reviewer_is_given_the_acceptance_basis_not_the_raw_contract_file', runtime.includes("contractText: current.role === 'REVIEWER' ? reviewerContract(acceptanceBasis("), '')
  check('W_a_reviewer_claim_is_decided_before_it_can_reopen_work', ['reviewClaimDecision({', 'testsGreenNow: testsGreenAtCurrentGeneration(state)', "if (verdict.decision !== 'REOPEN')", 'state.reviewedClaims = [...(state.reviewedClaims ?? []), claimKey]'].every(part => runtime.includes(part)), '')
  check('W_a_set_aside_claim_is_recorded_and_explained', runtime.includes('REVIEW_SET_ASIDE') && runtime.includes('setAsideNote(setAside)'), '')
  const specialist = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryEngineeringSpecialist.ts'), 'utf8')
  check('W_the_reviewer_prompt_names_the_request_and_numbered_acceptance_lines_only', specialist.includes('each numbered ACCEPTANCE line in CONTRACT') && specialist.includes('a constant or label in SOURCE is not'), '')
  const campaign = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryEngineeringCampaign.ts'), 'utf8')
  check('W_reviewed_claims_persist_with_the_campaign_record', campaign.includes('reviewedClaims?: string[]'), '')
  const module = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryAcceptanceBasis.ts'), 'utf8')
  check('W_the_acceptance_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(module), '')

  const failed = results.filter(r => !r.pass)
  console.log(`ACCEPTANCE_BASIS_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
main()
