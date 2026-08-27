/**
 * Deterministic regression suite for the stale-request/idempotency guard shared by
 * TerraShell.tsx's activateCoordinate and useTerraRelatedIntelligence.ts. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/requestSequence.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { isTerraRequestStale } from './requestSequence'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('matching_sequence_is_not_stale', isTerraRequestStale(1, 1) === false, 'sequence 1 vs latest 1'))
  results.push(check('older_sequence_is_stale', isTerraRequestStale(1, 2) === true, 'sequence 1 vs latest 2 (a newer request was issued)'))

  // Out-of-order arrival: Commander selects event A (sequence 1) then event B (sequence 2) before
  // A's response arrives. A's late response must be recognized as stale even though it arrives
  // after B's request was issued, not just after B's response.
  results.push(check('late_arriving_first_request_is_stale_once_superseded', isTerraRequestStale(1, 2) === true, 'A (seq 1) arriving after B (seq 2) was issued'))
  results.push(check('second_request_response_is_not_stale', isTerraRequestStale(2, 2) === false, 'B (seq 2) arriving as the latest issued request'))

  return results
}

export function runTerraRequestSequenceValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraRequestSequenceValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra requestSequence validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
