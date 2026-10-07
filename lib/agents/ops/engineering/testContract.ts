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
