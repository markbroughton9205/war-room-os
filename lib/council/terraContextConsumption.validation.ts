import { pathToFileURL } from 'node:url'
import { consumeTerraContextForDecree, type TerraContextRefLike } from './terraContextConsumption'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runTerraContextConsumptionValidation(): CaseResult[] {
  const cases: CaseResult[] = []

  {
    const ref: TerraContextRefLike = { current: 'Lagos, Nigeria — 6.5244, 3.3792' }
    const first = consumeTerraContextForDecree(ref, undefined)
    cases.push(check(
      'terra_01_first_read_returns_pinned_context',
      first === 'Lagos, Nigeria — 6.5244, 3.3792',
      JSON.stringify({ first }),
    ))
    cases.push(check(
      'terra_02_ref_cleared_immediately_after_read',
      ref.current === null,
      JSON.stringify({ current: ref.current }),
    ))
    const second = consumeTerraContextForDecree(ref, undefined)
    cases.push(check(
      'terra_03_second_decree_gets_no_stale_context',
      second === null,
      JSON.stringify({ second }),
    ))
  }

  {
    // A 'continue' turn (synthetic follow-up, not a new Commander decree) must neither consume nor
    // clear a pending Terra selection — a real decree submitted right after it should still see it.
    const ref: TerraContextRefLike = { current: 'Terra pin B' }
    const duringContinue = consumeTerraContextForDecree(ref, 'continue')
    cases.push(check(
      'terra_04_continue_mode_does_not_consume',
      duringContinue === null,
      JSON.stringify({ duringContinue }),
    ))
    cases.push(check(
      'terra_05_continue_mode_leaves_ref_intact',
      ref.current === 'Terra pin B',
      JSON.stringify({ current: ref.current }),
    ))
    const nextRealDecree = consumeTerraContextForDecree(ref, undefined)
    cases.push(check(
      'terra_06_next_real_decree_still_sees_it',
      nextRealDecree === 'Terra pin B',
      JSON.stringify({ nextRealDecree }),
    ))
    cases.push(check(
      'terra_07_cleared_after_the_real_decree_consumes_it',
      ref.current === null,
      JSON.stringify({ current: ref.current }),
    ))
  }

  {
    // No pin selected at all — must stay honestly null, never fabricate context.
    const ref: TerraContextRefLike = { current: null }
    const result = consumeTerraContextForDecree(ref, undefined)
    cases.push(check(
      'terra_08_no_pin_returns_null_not_fabricated',
      result === null,
      JSON.stringify({ result }),
    ))
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraContextConsumptionValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Terra context consumption validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
