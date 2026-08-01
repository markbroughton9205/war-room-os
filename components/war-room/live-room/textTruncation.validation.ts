import { truncateAtWordBoundary } from './textTruncation'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// 130 chars, with a space at index 118 and the word "acknowledge" straddling the 120-char cut
// point (index 120 lands inside that word) — a deterministic fixture for "did we split a word."
const STRADDLING_WORD_TEXT =
  'People sometimes resist the advice they asked for simply because accepting it forces them to acknowledge personal shortcomings today.'

const REAL_SYNTHESIS =
  'People sometimes resist the advice they asked for simply because accepting it forces them to acknowledge personal shortcomings or knowledge gaps. It can also be about trust levels; they may question the adviser\'s motives or expertise.'

export function runTextTruncationValidation(): CaseResult[] {
  // 1. Short text remains unchanged.
  const short = truncateAtWordBoundary('A short finding.', 120)

  // 2. Long text truncates at a word boundary — the result (minus ellipsis) must be a strict,
  // whole-word-ending prefix of the original text, never a fragment of a word.
  const long = truncateAtWordBoundary(STRADDLING_WORD_TEXT, 120)
  const longBody = long.slice(0, -1) // strip the ellipsis
  const charAfterBody = STRADDLING_WORD_TEXT[longBody.length]
  const isWholeWordBoundary = STRADDLING_WORD_TEXT.startsWith(longBody) && (charAfterBody === undefined || charAfterBody === ' ')

  // 3. Ellipsis appears only when truncation occurs.
  const untruncated = truncateAtWordBoundary('Exactly fits, no truncation needed here at all today.', 120)
  const truncated = truncateAtWordBoundary(REAL_SYNTHESIS, 50)

  // 4. No trailing space before the ellipsis.
  const spacedNearBoundary = truncateAtWordBoundary('One two three four five six seven eight nine ten    eleven twelve thirteen fourteen fifteen.', 45)

  // 5. A long unbroken token still produces a bounded result (falls back to a hard cut, not an
  // implausibly short one, when no whitespace exists near the limit).
  const noSpaces = truncateAtWordBoundary('x'.repeat(500), 120)

  // 6. Empty text remains empty.
  const empty = truncateAtWordBoundary('', 120)

  // Exact boundary: text exactly at maxLength is unchanged (not treated as "too long").
  const exact = truncateAtWordBoundary('12345', 5)

  return [
    check(
      'trunc_01_short_text_unchanged',
      short === 'A short finding.',
      short,
    ),
    check(
      'trunc_02_long_text_truncates_at_word_boundary_not_mid_word',
      isWholeWordBoundary && long.length < STRADDLING_WORD_TEXT.length,
      `body=${JSON.stringify(longBody)} nextChar=${JSON.stringify(charAfterBody)}`,
    ),
    check(
      'trunc_03_ellipsis_only_when_truncated',
      !untruncated.endsWith('…') && truncated.endsWith('…'),
      `untruncated=${untruncated} truncated=${truncated}`,
    ),
    check(
      'trunc_04_no_trailing_space_before_ellipsis',
      !spacedNearBoundary.includes(' …') && spacedNearBoundary.endsWith('…'),
      spacedNearBoundary,
    ),
    check(
      'trunc_05_long_unbroken_token_bounded',
      noSpaces.length === 121 && noSpaces.endsWith('…'),
      `len=${noSpaces.length}`,
    ),
    check(
      'trunc_06_empty_text_remains_empty',
      empty === '',
      JSON.stringify(empty),
    ),
    check(
      'trunc_07_exact_length_text_unchanged',
      exact === '12345',
      exact,
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTextTruncationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Text truncation validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
