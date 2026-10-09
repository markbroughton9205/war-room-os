import { contractOverlap, testCalls, tokens } from './testContract'

/**
 * Contract-grounded test authoring. Every generated test must map to an acceptance criterion; this module records the mapping (criterion_id, behavior, expected_result,
 * source, confidence) and produces the reviewer feedback for tests that map to none. It never edits a test; it only classifies and challenges.
 */
export type TestGrounding = { name: string; criterion_id: number | null; behavior: string; expected_result: string; source: string; confidence: 'TAGGED' | 'INFERRED' | 'NONE' }
const TAG = /\[C(\d{1,2})\]|\bcriterion\s*#?(\d{1,2})\b/i

export function groundTests(rel: string, text: string, acceptance: string[], source: string): TestGrounding[] {
  return testCalls(rel, text).map((c) => {
    const tagged = TAG.exec(c.name) ?? TAG.exec(c.text.slice(0, 400))
    const tag = tagged ? Number(tagged[1] ?? tagged[2]) : null
    const expected = /(?:assert(?:\.\w+)*|strictEqual|deepStrictEqual|equal|ok|throws|rejects)\s*\(([^\n]{0,120})/.exec(c.text)?.[1]?.trim() ?? 'n/a'
    if (tag && tag >= 1 && tag <= acceptance.length) return { name: c.name, criterion_id: tag, behavior: acceptance[tag - 1].slice(0, 120), expected_result: expected, source, confidence: 'TAGGED' as const }
    const ov = contractOverlap(`${c.name}\n${c.text}`, acceptance)
    const ranked = acceptance.map((a, i) => { const s = new Set(tokens(a)), t = new Set(tokens(`${c.name}\n${c.text}`)); let n = 0; for (const w of s) if (t.has(w)) n += 1; return { i, r: s.size ? n / s.size : 0 } }).sort((x, y) => y.r - x.r)
    const unique = ranked.length > 0 && ranked[0].r >= 0.25 && (!ranked[1] || ranked[1].r < ranked[0].r)
    return unique && ov.criterion !== null ? { name: c.name, criterion_id: ov.criterion + 1, behavior: acceptance[ov.criterion].slice(0, 120), expected_result: expected, source, confidence: 'INFERRED' as const } : { name: c.name, criterion_id: null, behavior: c.name, expected_result: expected, source, confidence: 'NONE' as const }
  })
}
/** The reviewer's challenge: tests with no contract basis, with an exact instruction. Null when every test is grounded. */
export function ungroundedChallenge(g: TestGrounding[], acceptanceCount: number): string | null {
  const none = g.filter((x) => x.confidence === 'NONE')
  if (!none.length) return null
  return `these test cases map to NO numbered acceptance criterion: ${none.map((x) => `"${x.name}"`).join('; ')}. Every test must prove exactly one of the ${acceptanceCount} numbered criteria and its name must start with [C<number>]. Remove the tests that have no criterion, or ground them, and do not assert exact error wording, ids, ordering or anything the criteria do not state.`
}
export const groundingSummary = (g: TestGrounding[]) => ({ tests: g.length, tagged: g.filter((x) => x.confidence === 'TAGGED').length, inferred: g.filter((x) => x.confidence === 'INFERRED').length, ungrounded: g.filter((x) => x.confidence === 'NONE').length })
