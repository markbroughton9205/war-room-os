import { pathToFileURL } from 'node:url'
import { detectContradictionFromComparison } from './contradictionDetection'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

/**
 * Only the DB-independent early-return branches are validated here (no Supabase required) — the
 * full persistence path (actually writing a contradiction row when agreement is 'conflicting') is
 * exercised by Wave 2's local Postgres+PostgREST live validation, matching Wave 1's pattern of
 * keeping *.validation.ts DB-free and reserving live-DB proof for the local instance.
 */
async function testNonConflictingAgreementNeverCreatesRecord(): Promise<CaseResult[]> {
  const agreements = ['corroborated', 'single_source', 'insufficient_evidence'] as const
  const results: CaseResult[] = []
  for (const agreement of agreements) {
    const outcome = await detectContradictionFromComparison({ subject: 's', agreement, note: 'n' }, 'claim-a', 'claim-b')
    results.push(check(`${agreement}_never_creates_contradiction`, outcome === null, String(outcome)))
  }
  return results
}

export async function runContradictionDetectionValidation(): Promise<CaseResult[]> {
  return [...(await testNonConflictingAgreementNeverCreatesRecord())]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runContradictionDetectionValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Contradiction detection validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
