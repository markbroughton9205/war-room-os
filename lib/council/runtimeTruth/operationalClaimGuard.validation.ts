import { addOllamaProbeEvidence, createEvidenceLedger } from './evidenceLedger'
import { createStreamingTruthGuard, enforceOperationalTruth, extractCandidateResources } from './operationalClaimGuard'

export type RuntimeTruthValidationResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): RuntimeTruthValidationResult {
  return { name, pass, detail }
}

export function runOperationalClaimGuardValidation(): RuntimeTruthValidationResult[] {
  const results: RuntimeTruthValidationResult[] = []
  const decree = 'Restart Signal Radar and verify Terra is healthy.'

  // Case 1: fabricated claim, no evidence at all -- both sentences must be rewritten.
  {
    const ledger = createEvidenceLedger('round-1')
    const text =
      "PULSAR has the Signal Radar back online, and Terra is holding steady. LUMEN agrees the foundation is strong."
    const out = enforceOperationalTruth(text, ledger, decree)
    const restartFixed = out.text.includes('Signal Radar restart was not executed in this round, so its current status is UNKNOWN.')
    const healthFixed = out.text.includes('Terra health was not verified in this round.')
    results.push(check('unsupported_claims_rewritten', out.corrected && restartFixed && healthFixed, out.text))
    results.push(check('rest_of_message_preserved', out.text.includes('LUMEN agrees the foundation is strong.'), out.text))
  }

  // Case 2: real evidence present for the claimed resource -- must NOT be rewritten.
  {
    const ledger = createEvidenceLedger('round-2')
    addOllamaProbeEvidence(ledger, { available: true, baseUrl: 'http://localhost:11434', detail: '2 model(s) available.' })
    const text = 'Ollama is online and responded normally this round.'
    const out = enforceOperationalTruth(text, ledger, 'Is Ollama reachable?')
    results.push(check('verified_claim_left_intact_with_real_evidence', !out.corrected && out.text === text, out.text))
  }

  // Case 3: Commander asserts success; Council must reframe as Commander-reported, not echo verified.
  {
    const ledger = createEvidenceLedger('round-3')
    const commanderClaim = "I restarted Signal Radar and Terra is healthy. Confirm we're good."
    const text = 'Terra is healthy and Signal Radar has been restarted, so we are good to proceed.'
    const out = enforceOperationalTruth(text, ledger, commanderClaim)
    const mentionsCommanderReported = /Commander-reported/i.test(out.text)
    results.push(check(
      'commander_reported_status_not_echoed_as_verified',
      out.corrected && mentionsCommanderReported && !/Terra is healthy/.test(out.text) && !/Signal Radar has been restarted/.test(out.text),
      out.text,
    ))
  }

  // Case 4: a fresh ledger for a later round must not see an earlier round's evidence.
  {
    const round1Ledger = createEvidenceLedger('round-1')
    addOllamaProbeEvidence(round1Ledger, { available: true, baseUrl: 'http://localhost:11434', detail: 'ok' })
    const round2Ledger = createEvidenceLedger('round-2') // fresh, no entries copied from round 1
    const text = 'Ollama is online.'
    const out = enforceOperationalTruth(text, round2Ledger, 'Is Ollama reachable?')
    results.push(check('prior_round_evidence_not_reused', out.corrected && out.text.includes('was not executed'), out.text))
  }

  // Case 5: a suggestion/plan is not a completion claim and must be left alone.
  {
    const ledger = createEvidenceLedger('round-5')
    const text = 'We should verify Terra is healthy before proceeding with anything else.'
    const out = enforceOperationalTruth(text, ledger, decree)
    results.push(check('future_plan_not_flagged', !out.corrected && out.text === text, out.text))
  }

  // Case 6: an already-honest sentence must not be re-flagged (idempotent).
  {
    const ledger = createEvidenceLedger('round-6')
    const text = 'Signal Radar restart was not executed in this round, so its current status is UNKNOWN.'
    const out = enforceOperationalTruth(text, ledger, decree)
    results.push(check('already_hedged_sentence_left_alone', !out.corrected && out.text === text, out.text))
  }

  // Case 7: resource-name extraction picks up capitalized decree phrases.
  {
    const candidates = extractCandidateResources(decree)
    results.push(check('resource_candidates_extracted', candidates.includes('Signal Radar') && candidates.includes('Terra'), candidates.join(', ')))
  }

  // Case 8: indirect / presuppositional / attributive claim phrasings -- the exact examples the
  // mission called out as slipping past a direct-copula-only classifier.
  {
    const indirectCases: { text: string; decree: string; mustNotContain: RegExp }[] = [
      { text: "Terra's health gives us a solid foundation to build from.", decree: 'Verify Terra is healthy.', mustNotContain: /Terra's health gives us/ },
      { text: 'With Signal Radar back online, we are ready to proceed.', decree: 'Restart Signal Radar.', mustNotContain: /back online/ },
      { text: 'Now that Terra is stable, we can proceed with the rest of the plan.', decree: 'Check Terra.', mustNotContain: /Now that Terra is stable/ },
      { text: 'The restored radar gives us confidence going forward.', decree: 'Restart Signal Radar.', mustNotContain: /restored radar gives us confidence/ },
      { text: 'Since the radar is back, the team can stand down.', decree: 'Restart Signal Radar.', mustNotContain: /the radar is back/ },
      { text: 'The healthy runtime means we can move on to the next task.', decree: 'Check the runtime.', mustNotContain: /healthy runtime means/ },
      { text: 'With everything synchronized, the round is complete.', decree: 'Synchronize everything.', mustNotContain: /everything synchronized/ },
      { text: "Given Terra's healthy state, we should proceed confidently.", decree: 'Check Terra.', mustNotContain: /Terra's healthy state/ },
    ]
    let allPass = true
    const details: string[] = []
    for (const c of indirectCases) {
      const ledger = createEvidenceLedger('indirect-round')
      const out = enforceOperationalTruth(c.text, ledger, c.decree)
      const ok = out.corrected && !c.mustNotContain.test(out.text)
      if (!ok) allPass = false
      details.push(`[${ok ? 'ok' : 'FAIL'}] "${c.text}" -> "${out.text}"`)
    }
    results.push(check('indirect_presuppositional_claims_rewritten', allPass, details.join(' | ')))
  }

  // Case 9 (Part E): multiple distinct resources in one sentence must be checked independently --
  // evidence for one must never validate a claim about a different one.
  {
    const ledger = createEvidenceLedger('multi-resource-round')
    addOllamaProbeEvidence(ledger, { available: true, baseUrl: 'http://localhost:11434', detail: 'ok' }) // only Ollama has evidence
    const text = 'Signal Radar is back online and Terra is healthy.'
    const out = enforceOperationalTruth(text, ledger, 'Restart Signal Radar and check Terra.')
    const signalRadarFlagged = out.flagged.some(f => f.resource === 'Signal Radar')
    const terraFlagged = out.flagged.some(f => f.resource === 'Terra')
    results.push(check(
      'multi_resource_independent_matching',
      out.corrected && signalRadarFlagged && terraFlagged,
      JSON.stringify({ text: out.text, flagged: out.flagged.map(f => f.resource) }),
    ))
  }
  {
    // Ollama evidence must not leak into a Terra-only claim with no Terra evidence.
    const ledger = createEvidenceLedger('no-leak-round')
    addOllamaProbeEvidence(ledger, { available: true, baseUrl: 'http://localhost:11434', detail: 'ok' })
    const text = 'Terra is healthy.'
    const out = enforceOperationalTruth(text, ledger, 'Check Terra.')
    results.push(check('ollama_evidence_does_not_validate_terra', out.corrected, out.text))
  }

  // Case 10 (Part C, unit-level): streaming guard never releases an unsupported claim before its
  // sentence is complete, and releases ordinary text byte-for-byte unchanged.
  {
    const ledger = createEvidenceLedger('stream-round')
    const guard = createStreamingTruthGuard(decree, ledger)
    const deltas = ['PULSAR has the Signal Radar back', ' online, and', ' Terra is', ' holding steady. ', 'LUMEN agrees.']
    let releasedDuringFabricatedSentence = false
    let sawRawFabricationBeforeCompletion = false
    let output = ''
    for (const d of deltas) {
      const released = guard.push(d)
      if (released) {
        output += released
        if (/back\s+online|holding\s+steady/i.test(released)) sawRawFabricationBeforeCompletion = true
        releasedDuringFabricatedSentence = true
      }
    }
    output += guard.flush()
    results.push(check(
      'streaming_guard_never_releases_raw_fabrication',
      !sawRawFabricationBeforeCompletion && output.includes('was not executed') && output.includes('LUMEN agrees.'),
      output,
    ))
    void releasedDuringFabricatedSentence
  }
  {
    // Ordinary conversational text streams through unchanged, preserving natural spacing.
    const ledger = createEvidenceLedger('stream-normal-round')
    const guard = createStreamingTruthGuard('Explain why reliability matters.', ledger)
    const deltas = ['Reliability ', 'matters because ', 'it builds trust ', 'over time. ', 'It also reduces ', 'operational risk.']
    let output = ''
    for (const d of deltas) output += guard.push(d)
    output += guard.flush()
    results.push(check(
      'streaming_guard_preserves_normal_text',
      output === deltas.join(''),
      JSON.stringify(output),
    ))
  }

  return results
}
