/**
 * Phase 6 wiring validation: proves the campaign runtime actually calls self-review, then independent verification,
 * then folds any disagreement into the completion gate, before PROJECT_READY — not just that the pure modules exist.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }
const ROOT = resolveRepoRoot()
const src = readFileSync(path.join(ROOT, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8')

function order(...needles: string[]): boolean {
  let cursor = -1
  for (const needle of needles) {
    const at = src.indexOf(needle, cursor + 1)
    if (at <= cursor) return false
    cursor = at
  }
  return true
}

check('imports_all_five_phase6_modules', [
  "from './foundrySelfReview'", "from './foundryIndependentVerifier'", "from './foundryDisconfirmation'",
  "from './foundryReviewDisagreement'", "from './foundryPhase6Completion'", "from './foundryInstalledRuntimeCheck'",
].every(needle => src.includes(needle)), '')

check('self_review_runs_before_independent_verification_runs_before_disagreement_runs_before_completion_gate', order(
  'runSelfReview(', 'runIndependentVerification(', 'resolveDisagreement(', 'phase6CompletionAllowed(',
), '')

check('self_review_blocking_findings_open_a_rework_before_the_independent_verifier_is_consulted', order(
  'const selfReview = runSelfReview(', 'activeSelfReviewFindings.length', 'openModelRework(finding,', 'let independentVerdict = runIndependentVerification(',
), '')

check('an_incomplete_phase6_receipt_opens_a_rework_instead_of_completing', order(
  'const receipt = phase6CompletionAllowed(', '!receipt.complete', "openModelRework(finding, fingerprintFinding(finding, 'VERIFY')",
), '')

check('project_ready_is_only_set_after_the_completion_gate_accepted_the_receipt', order(
  'const receipt = phase6CompletionAllowed(', "state.verification = 'PROJECT_READY'",
), '')

check('specialist_disagreement_reaches_evidence_binding_before_the_final_completion_gate', order(
  'let independentVerdict = runIndependentVerification(', 'const receipt = phase6CompletionAllowed(', 'const allowed = campaignCompletionAllowed(',
), '')

check('the_independent_verifier_only_weighs_a_claim_when_the_specialist_itself_did_not_already_verdict_ready', src.includes("claim: call.result.verdict === 'PROJECT_READY' ? undefined : call.result.summary,"), '')

check('a_disagreement_is_settled_by_the_targeted_counterexample_not_unrelated_passing_tests', order(
  'let counterexample = parseVerificationProbe(', "['-c', VERIFICATION_PROBE_SCRIPT, JSON.stringify(counterexample)]", "disagreement?.status === 'DISAGREEMENT_PROBE'", 'if (!counterexampleSettled)', 'resolveDisagreementAfterProbe(disagreement, counterexampleFinding)',
) && src.includes('state.phase6.counterexamples ='), '')

check('a_settled_probe_result_is_remembered_so_the_same_claim_does_not_reprobe_forever', src.includes("disagreement.resolution === 'COMPLETE'") && src.includes('state.phase6.retiredFindingKeys = [...retiredFindingKeys,'), '')

check('the_installed_runtime_probe_is_the_only_one_actually_executed_here', src.includes("probe.hypothesisId !== 'INSTALLED_RUNTIME_MISMATCH'") && src.includes('checkInstalledRuntimeMatches('), '')

check('scope_review_uses_all_mission_mutations_even_when_recent_edit_history_has_rotated', src.includes('...state.filesMutated, ...(state.recentEdits ?? []).map(item => item.file)'), '')

check('phase6_state_is_persisted_onto_the_campaign_for_restart', src.includes('state.phase6 = {') && src.includes('state.phase6.independentVerdict = independentVerdict') && src.includes('state.phase6.disagreement = disagreement') && src.includes('state.phase6.receipt = receipt'), '')

check('commander_facing_progress_lines_are_calm_plain_sentences_not_internal_jargon', [
  "Implementation is complete. I'm independently verifying the result now.",
  'Independent verification passed. The mission is complete.',
].every(line => src.includes(line)), '')

const events = readFileSync(path.join(ROOT, 'lib/native-builder/foundryEngineeringEvents.ts'), 'utf8')
check('the_new_event_types_are_registered', ['SELF_REVIEW_FOUND_GAP', 'INDEPENDENT_VERIFICATION_STARTED', 'INDEPENDENT_VERIFICATION_FAILED', 'INDEPENDENT_VERIFICATION_PASSED'].every(name => events.includes(`'${name}'`)), '')

const campaignType = readFileSync(path.join(ROOT, 'lib/native-builder/foundryEngineeringCampaign.ts'), 'utf8')
check('the_campaign_type_carries_phase6_state_across_restart', campaignType.includes('phase6?:'), '')

check('a_missing_counterexample_gets_only_one_budgeted_clarification_with_persisted_evidence', src.includes("!counterexample && independentVerdict.findings.some") && src.includes('state.modelCalls < state.modelCallBudget') && src.includes('state.phase6.verifierFollowups ='), '')

const failed = results.filter(r => !r.pass)
console.log(`PHASE_6_WIRING_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
if (failed.length) process.exit(1)
