import { pathToFileURL } from 'node:url'
import { consumeTerraContextForDecree, type TerraContextRefLike } from './terraContextConsumption'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runTerraContextConsumptionValidation(): CaseResult[] {
  const cases: CaseResult[] = []

  {
    const live: TerraContextRefLike = { current: 'Lagos, Nigeria — 6.5244, 3.3792' }
    const consumed: TerraContextRefLike = { current: null }
    const first = consumeTerraContextForDecree(live, consumed, undefined)
    cases.push(check(
      'terra_01_first_read_returns_pinned_context',
      first === 'Lagos, Nigeria — 6.5244, 3.3792',
      JSON.stringify({ first }),
    ))
    cases.push(check(
      'terra_02_consumed_signature_recorded_after_first_read',
      consumed.current === 'Lagos, Nigeria — 6.5244, 3.3792',
      JSON.stringify({ consumed: consumed.current }),
    ))
    const second = consumeTerraContextForDecree(live, consumed, undefined)
    cases.push(check(
      'terra_03_second_decree_gets_no_stale_context_when_selection_unchanged',
      second === null,
      JSON.stringify({ second }),
    ))
  }

  {
    // The real bug this regression guards: GodsEyeCommandCenter's TerraCouncilContextBridge keeps
    // `liveRef` continuously re-written by an unrelated background effect (layerCoverage polling)
    // even when the Commander's actual selection hasn't changed — confirmed live, a naive
    // "clear ref on read" design failed here because the mirror re-wrote the same text back into
    // the ref before the next decree was submitted. Simulate exactly that: the live ref keeps
    // getting reassigned to an identical string between two decrees.
    const live: TerraContextRefLike = { current: 'Berlin, Germany — 52.51739, 13.39613' }
    const consumed: TerraContextRefLike = { current: null }
    const first = consumeTerraContextForDecree(live, consumed, undefined)
    live.current = 'Berlin, Germany — 52.51739, 13.39613' // background mirror re-writes the same text
    const second = consumeTerraContextForDecree(live, consumed, undefined)
    cases.push(check(
      'terra_04_unrelated_background_rewrite_of_identical_text_does_not_leak',
      first === 'Berlin, Germany — 52.51739, 13.39613' && second === null,
      JSON.stringify({ first, second }),
    ))
  }

  {
    // A genuinely new selection after one was already consumed must still reach the next decree.
    const live: TerraContextRefLike = { current: 'Berlin, Germany — 52.51739, 13.39613' }
    const consumed: TerraContextRefLike = { current: null }
    consumeTerraContextForDecree(live, consumed, undefined)
    live.current = 'Tokyo, Japan — 35.67686, 139.76389'
    const afterNewPin = consumeTerraContextForDecree(live, consumed, undefined)
    cases.push(check(
      'terra_05_genuinely_new_selection_still_reaches_the_next_decree',
      afterNewPin === 'Tokyo, Japan — 35.67686, 139.76389',
      JSON.stringify({ afterNewPin }),
    ))
  }

  {
    // A 'continue' turn (synthetic follow-up, not a new Commander decree) must neither consume nor
    // mark the selection as consumed — a real decree submitted right after it should still see it.
    const live: TerraContextRefLike = { current: 'Terra pin B' }
    const consumed: TerraContextRefLike = { current: null }
    const duringContinue = consumeTerraContextForDecree(live, consumed, 'continue')
    cases.push(check(
      'terra_06_continue_mode_does_not_consume',
      duringContinue === null,
      JSON.stringify({ duringContinue }),
    ))
    cases.push(check(
      'terra_07_continue_mode_does_not_mark_consumed',
      consumed.current === null,
      JSON.stringify({ consumed: consumed.current }),
    ))
    const nextRealDecree = consumeTerraContextForDecree(live, consumed, undefined)
    cases.push(check(
      'terra_08_next_real_decree_still_sees_it',
      nextRealDecree === 'Terra pin B',
      JSON.stringify({ nextRealDecree }),
    ))
  }

  {
    // No pin selected at all — must stay honestly null, never fabricate context.
    const live: TerraContextRefLike = { current: null }
    const consumed: TerraContextRefLike = { current: null }
    const result = consumeTerraContextForDecree(live, consumed, undefined)
    cases.push(check(
      'terra_09_no_pin_returns_null_not_fabricated',
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
