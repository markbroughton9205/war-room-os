import { pathToFileURL } from 'node:url'
import { validateProviderResponseIntegrity } from '@/lib/providers/responseIntegrity'
import { applyCouncilRenderGate } from '@/lib/council/councilRenderGate'
import { classifyGatheredProviderText } from '@/lib/council/liveGatherClassification'
import { responseSuccessfulForRuntime } from '@/lib/council/liveGatherClassification'
import { isSuccessfulVisibleMessage } from '@/lib/council/messagePersistenceFilter'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

/**
 * Permanent regression suite: Response Integrity Hardening (2026-08-24).
 *
 * Covers every structural response-completion shape known to have triggered a false DEGRADED
 * classification during the Council Runtime Stability Overhaul (a225696, 1340f2c, and the two
 * hardening commits from this session), plus every genuine-failure shape that must still be
 * caught. For every completion case this verifies the full chain a real Council round exercises:
 * validateProviderResponseIntegrity -> applyCouncilRenderGate -> classifyGatheredProviderText ->
 * isSuccessfulVisibleMessage (synthesis/display eligibility) -> responseSuccessfulForRuntime
 * (memory-proposal eligibility). A regression in any layer of that chain fails this suite.
 */
export function runStructuralCompletionValidation(): CaseResult[] {
  const results: CaseResult[] = []
  // An ANALYSIS-classified decree keeps every case on the strict, non-relaxed-casual path —
  // the path where the original bug (and both hardening gaps found this session) actually lived.
  const decree = 'Give me the deployment findings and current status, verified against telemetry.'

  const completionCases: Record<string, string> = {
    sentence_ending:
      'Analysis shows the mount-time reconciliation fetch races ahead of the persist write, therefore the query window never advances past the first page of history, which is the primary finding.',
    bullet_list:
      'Findings: because the mount-time reconciliation fetch races ahead of the persist write, the evidence shows the following synthesis of risk and recommended action for this deploy window:\n- Rollback plan verified against the prior release tag\n- Provider health checks all reported healthy at dispatch time\n- Recommended action: proceed with the 3pm deploy window',
    numbered_list:
      'Plan for this deploy window, based on verified evidence from the last three release cycles and current provider health telemetry:\n1. Ship the response-integrity fix to production\n2. Monitor Council render-gate logs for the next two hours\n3. Report back with any residual false-degraded cases',
    markdown_table:
      'Provider health summary compiled from this round\'s dispatch, verified against runtime telemetry and cross-checked against the audit log for consistency because no discrepancies were found:\n| Provider | Status |\n| --- | --- |\n| Claude | Responded |\n| ChatGPT | Responded |\n| Grok | Timed out |',
    fenced_code_block:
      'Here is the corrected router configuration, verified against the live dispatch trace and the provider adapter contract before this synthesis was finalized:\n```json\n{"provider": "claude", "status": "complete", "confidence": 0.92}\n```',
    heading:
      'Decision summary because the evidence review confirms no active harm observed and risk assessment aligns with prior Claude analysis with no contradiction found across sources:\n## Recommended Action\nProceed with deployment at the scheduled window.',
    blockquote_punctuated:
      'Root cause analysis complete because the evidence trail was cross-checked against three independent runtime logs before this conclusion was reached:\n> Confirmed by three independent monitoring sources. No discrepancy was found.',
    html_list:
      'Deployment checklist compiled from the release runbook, verified against the current pipeline state before this synthesis was finalized for the Commander:\n<ul><li>Build passed</li><li>Tests passed</li><li>Rollback plan verified</li></ul>',
    json_object:
      'Structured provider health payload captured at dispatch time, verified against the runtime trace and included here exactly as received from the adapter layer:\n{"provider": "claude", "status": "complete", "confidence": 0.92, "families": ["claude", "chatgpt", "grok"]}',
    yaml_block:
      'Deployment configuration snapshot verified against the current environment before this round was finalized, included here for the audit trail because no drift was detected:\nprovider: claude\nstatus: complete\nconfidence: 0.92',
    xml_block:
      'Structured audit record generated from the runtime trace and verified against the schema before inclusion in this synthesis, because the prior format produced parsing errors downstream:\n<result><provider>claude</provider><status>complete</status></result>',
    markdown_checklist:
      'Release checklist verified against the runbook and cross-checked with the on-call engineer before this round was finalized for the Commander review process:\n- [x] Build passed\n- [x] Tests passed\n- [ ] Manual QA pending',
  }

  for (const [name, text] of Object.entries(completionCases)) {
    const integrity = validateProviderResponseIntegrity(text, { councilMode: true })
    const gated = applyCouncilRenderGate('claude', text, { decreeText: decree })
    const classified = classifyGatheredProviderText(gated.displayText || null, gated)
    const synthesisEligible = isSuccessfulVisibleMessage({
      content: classified.textOut ?? undefined,
      responseSuccessful: classified.runtime === 'RESPONDED',
      providerRuntime: classified.runtime,
    })
    const memoryEligible = responseSuccessfulForRuntime(classified.runtime)

    results.push(check(
      `completion_${name}`,
      integrity.integrity_status === 'COMPLETE'
      && gated.degraded === false
      && gated.renderable === true
      && classified.runtime === 'RESPONDED'
      && classified.textOut === text
      && synthesisEligible === true
      && memoryEligible === true,
      JSON.stringify({
        integrity_status: integrity.integrity_status,
        degraded: gated.degraded,
        renderable: gated.renderable,
        runtime: classified.runtime,
        textPreserved: classified.textOut === text,
        synthesisEligible,
        memoryEligible,
      }),
    ))
  }

  // Genuine failures — the structural allowances above must never become a truncation bypass.
  // These are intentionally NOT run through the full chain's success assertions; they only assert
  // non-COMPLETE / non-RESPONDED / not synthesis-or-memory-eligible.
  const failureCases: Record<string, string> = {
    truncated_sentence:
      'Operational and responding normally on this turn, but noting for the record that several prior turns came back as fallback or incomplete rather than a real response and the active risk is exactly',
    truncated_json:
      'Structured provider health payload captured at dispatch time, verified against the runtime trace and included here exactly as received from the adapter layer:\n{"provider": "claude", "status": "comple',
    truncated_markdown_table:
      'Provider health summary compiled from this round\'s dispatch, verified against runtime telemetry and cross-checked against the audit log for consistency because no discrepancies were found:\n| Provider | Status |\n| --- | --- |\n| Claude | Respon',
    truncated_code_block:
      'Here is the corrected router configuration, verified against the live dispatch trace and the provider adapter contract before this synthesis was finalized:\n```json\n{"provider": "claude", "status": "comp',
    stream_terminated_before_finish:
      'Analysis shows the mount-time reconciliation fetch races ahead of the persist write, and the root cause is that the retry',
    malformed_structured_output:
      'Structured provider health payload captured at dispatch time, verified against the runtime trace and included here exactly as received from the adapter layer:\n{"provider": "claude" "status": "complete"}',
    // Intentionally NOT a "fix" case — see the module comment on endsWithStructuralElement: an
    // unpunctuated blockquote quotes prose, and prose lacking its own terminator is still a
    // genuine truncation signal, unlike a bare list/table/fence marker.
    unpunctuated_blockquote_still_flagged:
      'Root cause analysis complete because the evidence trail was cross-checked against three independent runtime logs before this conclusion was reached:\n> Confirmed by three independent monitoring sources with no discrepancy found',
  }

  for (const [name, text] of Object.entries(failureCases)) {
    const integrity = validateProviderResponseIntegrity(text, { councilMode: true })
    const gated = applyCouncilRenderGate('claude', text, { decreeText: decree })
    const classified = classifyGatheredProviderText(gated.displayText || null, gated)
    const synthesisEligible = isSuccessfulVisibleMessage({
      content: classified.textOut ?? undefined,
      responseSuccessful: classified.runtime === 'RESPONDED',
      providerRuntime: classified.runtime,
    })
    const memoryEligible = responseSuccessfulForRuntime(classified.runtime)

    results.push(check(
      `failure_${name}`,
      integrity.integrity_status !== 'COMPLETE'
      && gated.degraded === true
      && gated.renderable === false
      && classified.runtime !== 'RESPONDED'
      && synthesisEligible === false
      && memoryEligible === false,
      JSON.stringify({
        integrity_status: integrity.integrity_status,
        degraded: gated.degraded,
        renderable: gated.renderable,
        runtime: classified.runtime,
        synthesisEligible,
        memoryEligible,
      }),
    ))
  }

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runStructuralCompletionValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Structural completion validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
