import ts from 'typescript'

/**
 * Contract-subordinate tests. The authoritative feature contract is the acceptance list (plus the independent verifier). A model-written test is
 * useful only insofar as it exercises that contract. Behaviour the model INVENTED (an exact error wording, a field it decided to add, ordering the
 * spec never fixed) must not be able to block an implementation that satisfies the real acceptance criteria.
 */
export const STOP = new Set('the and for with that this from when into each only have their them then than also does not are was were will can may any all its but you your has had how not one two per via out use used using been being must should within without after before every other such more most some over under same new via'.split(' '))
export const tokens = (t: string): string[] => (t.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).filter((w) => !STOP.has(w))

/** The test obligations handed to the model: each acceptance criterion is a thing to prove, and nothing beyond it may be asserted. */
export function testObligations(acceptance: string[]): string {
  return [
    'TEST OBLIGATIONS (the contract). Write tests that prove THESE behaviours and nothing else:',
    ...acceptance.map((a, i) => `  ${i + 1}. ${a}`),
    'Rules for the tests: assert only what an obligation above states (status codes, field names and values it names, counts, persistence). Do NOT assert exact error-message wording, key/field ordering, timestamps, ids beyond "numeric and increasing", or any behaviour the obligations do not state. A test whose expectation is not in the list will be removed if it fails.',
  ].join('\n')
}

/** How strongly a failing test's name/body is tied to some acceptance criterion (shared meaningful words). */
export function contractOverlap(testText: string, acceptance: string[]): { overlap: number; criterion: number | null } {
  const t = new Set(tokens(testText))
  let best = 0, at: number | null = null
  acceptance.forEach((a, i) => { const s = new Set(tokens(a)); let n = 0; for (const w of s) if (t.has(w)) n += 1; const r = s.size ? n / s.size : 0; if (r > best) { best = r; at = i } })
  return { overlap: Math.round(best * 100) / 100, criterion: at }
}

type Found = { name: string; start: number; end: number; text: string }
function testCalls(rel: string, text: string): Found[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const out: Found[] = []
  const visit = (n: ts.Node) => {
    if (ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)) {
      const c = n.expression
      const callee = ts.isIdentifier(c.expression) ? c.expression.text : ts.isPropertyAccessExpression(c.expression) && ts.isIdentifier(c.expression.expression) ? c.expression.expression.text : ''
      const first = c.arguments[0]
      if (/^(test|it)$/.test(callee) && first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) out.push({ name: first.text, start: n.getStart(sf), end: n.getEnd(), text: text.slice(n.getStart(sf), n.getEnd()) })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}
export const testNames = (rel: string, text: string): string[] => testCalls(rel, text).map((t) => t.name)

export type Quarantined = { name: string; overlap: number; criterion: number | null; reason: string }
/** Remove the named failing test cases from a test file. Refuses (returns null) unless at least `minKeep` named tests remain. */
export function quarantineTests(rel: string, text: string, failing: string[], acceptance: string[], minKeep = 1): { content: string; removed: Quarantined[]; kept: string[] } | null {
  const calls = testCalls(rel, text)
  const hit = calls.filter((c) => failing.some((f) => f.trim() === c.name.trim()))
  if (!hit.length) return null
  const keptCalls = calls.filter((c) => !hit.includes(c))
  if (keptCalls.length < minKeep) return null
  let out = text
  for (const c of [...hit].sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + `// QUARANTINED (no contract basis, failed against the independently verified implementation): ${c.name}` + out.slice(c.end)
  return { content: out, removed: hit.map((c) => ({ name: c.name, ...contractOverlap(`${c.name}\n${c.text}`, acceptance), reason: 'failed only in the test file after the implementation passed independent acceptance' })), kept: keptCalls.map((c) => c.name) }
}

/**
 * Assertion-level quarantine for a test case that mixes contract-grounded and ungrounded assertions: only the failing assertion statements (by the reported line) are
 * disabled, the case and its remaining assertions stay. Refuses unless at least one assert remains in the file. Reviewable: every disabled line is returned.
 */
export function quarantineAssertions(rel: string, text: string, lines: number[]): { content: string; removed: { line: number; code: string }[] } | null {
  if (!lines.length) return null
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true)
  const stmts: ts.ExpressionStatement[] = []
  const walk = (n: ts.Node) => { if (ts.isExpressionStatement(n) && /\bassert\b/.test(n.expression.getText(sf).slice(0, 40))) stmts.push(n); ts.forEachChild(n, walk) }
  walk(sf)
  const hit = stmts.filter((st) => { const a = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1, b = sf.getLineAndCharacterOfPosition(st.getEnd()).line + 1; return lines.some((l) => l >= a && l <= b) })
  if (!hit.length || stmts.length - hit.length < 1) return null
  let out = text
  for (const st of [...hit].sort((a, b) => b.getStart(sf) - a.getStart(sf))) out = out.slice(0, st.getStart(sf)) + `// QUARANTINED ASSERTION (no contract basis; failed against the independently verified implementation): ${st.getText(sf).replace(/\s+/g, ' ').slice(0, 100)}` + out.slice(st.getEnd())
  return { content: out, removed: hit.map((st) => ({ line: sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1, code: st.getText(sf).replace(/\s+/g, ' ').slice(0, 100) })) }
}

export type ContractCorrection = { line: number; from: number; to: number; criterion: number; testName: string; code: string }
export type ContractCorrectionResult = { content: string; corrections: ContractCorrection[]; refused: string[] }
const STATUS_CODE = /(?<![\w./-])([1-5]\d\d)(?![\w./-])/g
const statusCodesIn = (t: string): number[] => [...t.matchAll(STATUS_CODE)].map((m) => Number(m[1]))
const EQ_ASSERT = /^assert(?:\.strict)?\.(equal|strictEqual|deepEqual|deepStrictEqual)$/

/**
 * Deterministic correction of a model-written HTTP status assertion that CLEARLY contradicts the authoritative acceptance contract, applied before any quarantine.
 * An assertion is rewritten only when ALL of these hold; any doubt is a refusal (fail closed, the assertion is left for quarantine / honest failure):
 *   - it is a two-argument equality assert with a status-like expression (`status`, `statusCode`) on one side and a bare 3-digit literal N on the other;
 *   - node's own failure report gives the literal N and the observed value M (the independently verified implementation's behaviour);
 *   - the enclosing test case maps to exactly ONE acceptance criterion (top overlap >= 0.25, strictly above the runner-up);
 *   - that criterion names exactly ONE status code and it is M, and N is named by NO criterion at all (so the contract itself says the test is wrong, never a guess).
 * It changes one literal and never removes, loosens or reorders an assertion, so the number of assertions is unchanged.
 */
export function correctContractAssertions(rel: string, text: string, failures: { line: number | null; actual: string | null; expected: string | null }[], acceptance: string[]): ContractCorrectionResult | null {
  const refused: string[] = []
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true)
  const cases = testCalls(rel, text)
  const contractCodes = new Set(acceptance.flatMap(statusCodesIn))
  const edits: { start: number; end: number; to: number; rec: ContractCorrection }[] = []
  const stmts: ts.CallExpression[] = []
  const walk = (n: ts.Node) => { if (ts.isCallExpression(n) && EQ_ASSERT.test(n.expression.getText(sf))) stmts.push(n); ts.forEachChild(n, walk) }
  walk(sf)
  for (const f of failures) {
    if (!f.line) { refused.push('failure has no test-file line'); continue }
    const call = stmts.find((c) => { const a = sf.getLineAndCharacterOfPosition(c.getStart(sf)).line + 1, b = sf.getLineAndCharacterOfPosition(c.getEnd()).line + 1; return f.line! >= a && f.line! <= b })
    if (!call) { refused.push(`line ${f.line}: not a two-argument equality assert`); continue }
    if (call.arguments.length < 2) { refused.push(`line ${f.line}: assert has fewer than two arguments`); continue }
    const [a0, a1] = call.arguments
    const lit0 = ts.isNumericLiteral(a0) && /^\d{3}$/.test(a0.text), lit1 = ts.isNumericLiteral(a1) && /^\d{3}$/.test(a1.text)
    if (lit0 === lit1) { refused.push(`line ${f.line}: not exactly one status literal`); continue }
    const lit = (lit0 ? a0 : a1) as ts.NumericLiteral, other = lit0 ? a1 : a0
    if (!/status/i.test(other.getText(sf))) { refused.push(`line ${f.line}: other operand is not a status expression`); continue }
    const N = Number(lit.text)
    const seen = [f.actual, f.expected].map((v) => (v !== null && /^\d{3}$/.test(v.trim()) ? Number(v.trim()) : null))
    if (seen.includes(null) || !seen.includes(N)) { refused.push(`line ${f.line}: failure report does not carry the literal ${N} and an observed status`); continue }
    const M = seen[0] === N ? seen[1]! : seen[0]!
    if (M === N) { refused.push(`line ${f.line}: observed equals expected`); continue }
    const pos = call.getStart(sf)
    const encl = cases.filter((c) => c.start <= pos && pos <= c.end).sort((x, y) => (x.end - x.start) - (y.end - y.start))[0]
    if (!encl) { refused.push(`line ${f.line}: assertion is outside a test case`); continue }
    const ranked = acceptance.map((a, i) => { const s = new Set(tokens(a)); const t = new Set(tokens(`${encl.name}\n${encl.text}`)); let n = 0; for (const w of s) if (t.has(w)) n += 1; return { i, r: s.size ? n / s.size : 0 } }).sort((x, y) => y.r - x.r)
    if (!ranked.length || ranked[0].r < 0.25 || (ranked[1] && ranked[1].r >= ranked[0].r)) { refused.push(`line ${f.line}: test case "${encl.name}" does not map to exactly one acceptance criterion`); continue }
    const crit = statusCodesIn(acceptance[ranked[0].i])
    if (new Set(crit).size !== 1 || crit[0] !== M) { refused.push(`line ${f.line}: criterion ${ranked[0].i + 1} does not name exactly the observed status ${M}`); continue }
    if (contractCodes.has(N)) { refused.push(`line ${f.line}: ${N} is a status the contract itself names, so the intent is ambiguous`); continue }
    edits.push({ start: lit.getStart(sf), end: lit.getEnd(), to: M, rec: { line: f.line, from: N, to: M, criterion: ranked[0].i + 1, testName: encl.name, code: call.getText(sf).replace(/\s+/g, ' ').slice(0, 100) } })
  }
  if (!edits.length) return refused.length ? { content: text, corrections: [], refused } : null
  let out = text
  for (const e of [...edits].sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + String(e.to) + out.slice(e.end)
  return { content: out, corrections: edits.map((e) => e.rec), refused }
}
