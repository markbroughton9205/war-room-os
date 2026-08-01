import { buildLatestSynthesis, selectSynthesisFindings } from './synthesisSummary'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runSynthesisSummaryValidation(): CaseResult[] {
  // 1. Three findings produce a synthesis containing more than the first.
  const three = buildLatestSynthesis(
    ['Claude flags a rollback risk.', 'ChatGPT recommends a daily routine.', 'Gemini notes economic uncertainty.'],
    null,
  )

  // 2. Duplicate findings appear only once (exact and normalized/whitespace duplicates).
  const withDuplicates = selectSynthesisFindings([
    'Claude flags a rollback risk.',
    'Claude flags a rollback risk.',
    '  claude flags a rollback risk.  ',
    'ChatGPT recommends a daily routine.',
  ])

  // 3. Empty findings are ignored.
  const withEmpties = selectSynthesisFindings(['', '   ', 'Real finding one.', '', 'Real finding two.'])

  // 4. A single finding remains unchanged.
  const single = buildLatestSynthesis(['Only one real finding here.'], null)

  // 5. No findings preserves the previous synthesis.
  const previous = 'Previous synthesis text from an earlier round.'
  const noFindings = buildLatestSynthesis([], previous)
  const noFindingsNoPrevious = buildLatestSynthesis([], null)

  // Extra: more than 3 findings are capped at the top 3, in ranked order.
  const capped = selectSynthesisFindings([
    'Finding one.',
    'Finding two.',
    'Finding three.',
    'Finding four.',
    'Finding five.',
  ])

  return [
    check(
      'synthesis_01_three_findings_include_more_than_first',
      typeof three === 'string' && three.includes('ChatGPT') && three.includes('Gemini') && three.includes('Claude'),
      String(three),
    ),
    check(
      'synthesis_02_duplicate_findings_collapse_to_one',
      withDuplicates.length === 2
      && withDuplicates.filter(text => /rollback risk/i.test(text)).length === 1,
      JSON.stringify(withDuplicates),
    ),
    check(
      'synthesis_03_empty_findings_ignored',
      withEmpties.length === 2 && withEmpties.every(text => text.trim().length > 0),
      JSON.stringify(withEmpties),
    ),
    check(
      'synthesis_04_single_finding_unchanged',
      single === 'Only one real finding here.',
      String(single),
    ),
    check(
      'synthesis_05_no_findings_preserves_previous_synthesis',
      noFindings === previous,
      String(noFindings),
    ),
    check(
      'synthesis_06_no_findings_no_previous_stays_null',
      noFindingsNoPrevious === null,
      String(noFindingsNoPrevious),
    ),
    check(
      'synthesis_07_more_than_three_findings_capped_at_top_three_in_order',
      capped.length === 3
      && capped[0] === 'Finding one.'
      && capped[1] === 'Finding two.'
      && capped[2] === 'Finding three.',
      JSON.stringify(capped),
    ),
    check(
      'synthesis_08_result_is_not_a_raw_array_dump',
      typeof three === 'string' && !three.startsWith('[') && !three.includes('","'),
      String(three),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runSynthesisSummaryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Synthesis summary validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
