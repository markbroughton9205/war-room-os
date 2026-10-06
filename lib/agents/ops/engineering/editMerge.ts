import ts from 'typescript'

/**
 * A model that is told to APPEND new code often echoes the existing file as well, or re-declares a function it wants to change. Concatenating that
 * produces a certain SyntaxError (duplicate declarations). This merges an append block into the current file at declaration level instead:
 *  - a re-declared top-level function/class/const that is textually identical to the existing one is dropped;
 *  - one that differs REPLACES the existing declaration (the model clearly meant to change it);
 *  - an import whose names are all already imported is dropped; new names from the same module are merged into the existing import;
 *  - everything else is appended. Conflicts that cannot be merged mechanically (same name imported from another module, wrapper under an imported name) are
 *    left in place so the static gates reject them with a precise reason.
 */
const kindOf = (rel: string) => (/\.(tsx|jsx)$/.test(rel) ? ts.ScriptKind.TSX : /\.(mjs|cjs|js)$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
const norm = (t: string) => t.replace(/\s+/g, ' ').trim()

type Decl = { names: string[]; start: number; end: number; text: string }
const declsOf = (sf: ts.SourceFile): Decl[] => {
  const out: Decl[] = []
  for (const st of sf.statements) {
    let names: string[] = []
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) names = [st.name.text]
    else if (ts.isVariableStatement(st)) names = st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []))
    if (names.length) out.push({ names, start: st.getStart(sf), end: st.getEnd(), text: st.getText(sf) })
  }
  return out
}
const importsOf = (sf: ts.SourceFile) => sf.statements.filter(ts.isImportDeclaration).map((st) => {
  const c = st.importClause
  const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.map((e) => e.getText(sf)) : []
  const bound = [...(c?.name ? [c.name.text] : []), ...(c?.namedBindings ? (ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.map((e) => e.name.text) : [c.namedBindings.name.text]) : [])]
  return { st, spec: ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : '', named, bound, hasDefaultOrNs: !!c?.name || (!!c?.namedBindings && !ts.isNamedImports(c.namedBindings)) }
})

export function mergeAppend(rel: string, current: string, appended: string): { content: string; notes: string[] } {
  const notes: string[] = []
  const cur = ts.createSourceFile(rel, current, ts.ScriptTarget.Latest, true, kindOf(rel))
  const add = ts.createSourceFile(rel, appended, ts.ScriptTarget.Latest, true, kindOf(rel))
  const curDecls = declsOf(cur), curImports = importsOf(cur)
  const edits: { start: number; end: number; text: string }[] = []
  const tail: string[] = []
  const boundNow = new Set(curImports.flatMap((i) => i.bound))
  for (const st of add.statements) {
    const text = st.getText(add)
    if (ts.isImportDeclaration(st)) {
      const imp = importsOf(add).find((i) => i.st === st)!
      const missing = imp.bound.filter((n) => !boundNow.has(n))
      if (!missing.length) { notes.push(`dropped import already present: ${imp.spec}`); continue }
      const same = curImports.find((i) => i.spec === imp.spec && !i.hasDefaultOrNs && !imp.hasDefaultOrNs && i.st.importClause?.namedBindings)
      if (same && imp.named.length) {
        const union = [...same.named, ...imp.named.filter((n) => !same.bound.includes(n.split(/\s+as\s+/).pop()!.trim()))]
        const nb = same.st.importClause!.namedBindings!
        edits.push({ start: nb.getStart(cur), end: nb.getEnd(), text: `{ ${union.join(', ')} }` })
        for (const n of imp.bound) boundNow.add(n)
        notes.push(`merged new names into the existing import from ${imp.spec}`)
        continue
      }
      tail.push(text); for (const n of imp.bound) boundNow.add(n); continue
    }
    const d = declsOf(add).find((x) => x.start === st.getStart(add))
    if (d) {
      const existing = curDecls.filter((c) => c.names.some((n) => d.names.includes(n)))
      if (existing.length === 1 && existing[0].names.length === d.names.length && d.names.every((n) => existing[0].names.includes(n))) {
        if (norm(existing[0].text) === norm(d.text)) { notes.push(`dropped echoed declaration ${d.names.join(', ')}`); continue }
        edits.push({ start: existing[0].start, end: existing[0].end, text: d.text }); notes.push(`replaced existing declaration ${d.names.join(', ')}`); continue
      }
    }
    if (norm(current).includes(norm(text)) && text.length > 20) { notes.push('dropped echoed statement'); continue }
    tail.push(text)
  }
  let out = current
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  if (tail.length) out = out.replace(/\s*$/, '\n\n') + tail.join('\n\n') + '\n'
  return { content: out, notes }
}
