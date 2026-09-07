import { addOllamaProbeEvidence, createEvidenceLedger } from './evidenceLedger'
import { enforceOperationalTruth, extractCandidateResources } from './operationalClaimGuard'

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
    results.push(check(
      'unsupported_claims_rewritten',
      out.corrected && restartFixed && healthFixed,
      out.text,
    ))
    results.push(check(
      'rest_of_message_preserved',
      out.text.includes('LUMEN agrees the foundation is strong.'),
      out.text,
    ))
  }

  // Case 2: real evidence present for the claimed resource -- must NOT be rewritten.
  {
    const ledger = createEvidenceLedger('round-2')
    addOllamaProbeEvidence(ledger, { available: true, baseUrl: 'http://localhost:11434', detail: '2 model(s) available.' })
    const text = 'Ollama is online and responded normally this round.'
    const out = enforceOperationalTruth(text, ledger, 'Is Ollama reachable?')
    results.push(check(
      'verified_claim_left_intact_with_real_evidence',
      !out.corrected && out.text === text,
      out.text,
    ))
  }

  // Case 3: Commander asserts success; Council must not simply echo it as verified fact.
  {
    const ledger = createEvidenceLedger('round-3')
    const commanderClaim = "I restarted Signal Radar and Terra is healthy. Confirm we're good."
    const text = 'Terra is healthy and Signal Radar has been restarted, so we are good to proceed.'
    const out = enforceOperationalTruth(text, ledger, commanderClaim)
    results.push(check(
      'commander_reported_status_not_echoed_as_verified',
      out.corrected
        && !/Terra is healthy/.test(out.text)
        && !/Signal Radar has been restarted/.test(out.text),
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
    results.push(check(
      'prior_round_evidence_not_reused',
      out.corrected && out.text.includes('was not executed'),
      out.text,
    ))
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
    results.push(check(
      'resource_candidates_extracted',
      candidates.includes('Signal Radar') && candidates.includes('Terra'),
      candidates.join(', '),
    ))
  }

  return results
}
