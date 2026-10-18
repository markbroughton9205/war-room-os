/**
 * Structural, range-aware edits. A change to a 300-line file is made as a change to the few lines it concerns: the unrelated bytes are never regenerated.
 *
 * Operations (the worker replies with fenced blocks; Foundry applies them by AST range / exact anchor and refuses anything ambiguous):
 *   REPLACE_SYMBOL      ```replace-symbol NAME   — replaces the top-level declaration NAME (function / const / class), keeping its `export`
 *   INSERT_SYMBOL       ```insert-after NAME | ```insert-before NAME | ```insert-end — adds a declaration beside another one
 *   ADD_IMPORT          ```add-import           — adds import statements that are not there yet (merging names into an existing import of the same module)
 *   CHANGE_EXPRESSION   ```change-in NAME       — SEARCH/REPLACE confined to the range of ONE symbol (the SEARCH text only has to be unique inside it)
 *   ADD_HANDLER_BRANCH  ```insert-before-line / ```insert-after-line with `ANCHOR: <exact line>` — a new branch next to an existing route line
 *   ADD_DIRECTORY_GUARD / CHANGE_STATUS / MOVE_ROUTE: deterministic Foundry edits (repairMissingStorageDir, attachContractStatuses, routeEdit.ts), not model replies.
 * UPDATE_SCHEMA_FIELD has no meaning in these schema-less ES modules and is not implemented.
 */
import ts from 'typescript'

export type StructOp =
  | { op: 'REPLACE_SYMBOL'; name: string; code: string }
  | { op: 'INSERT_SYMBOL'; where: 'after' | 'before' | 'end'; name: string | null; code: string }
  | { op: 'ADD_IMPORT'; code: string }
  | { op: 'CHANGE_EXPRESSION'; name: string; search: string; replace: string }
  | { op: 'ADD_HANDLER_BRANCH'; where: 'after' | 'before'; anchor: string; code: string }

const NAME = '[A-Za-z_$][\\w$]*'
export function parseStructOps(text: string): StructOp[] {
  const ops: StructOp[] = []
  for (const m of text.matchAll(new RegExp('```replace-symbol[ \\t]+(' + NAME + ')[ \\t]*\\n([\\s\\S]*?)```', 'g'))) ops.push({ op: 'REPLACE_SYMBOL', name: m[1], code: m[2].replace(/\s+$/, '') })
  for (const m of text.matchAll(new RegExp('```insert-(after|before)[ \\t]+(' + NAME + ')[ \\t]*\\n([\\s\\S]*?)```', 'g'))) ops.push({ op: 'INSERT_SYMBOL', where: m[1] as 'after' | 'before', name: m[2], code: m[3].replace(/\s+$/, '') })
  for (const m of text.matchAll(/```insert-end[ \t]*\n([\s\S]*?)```/g)) ops.push({ op: 'INSERT_SYMBOL', where: 'end', name: null, code: m[1].replace(/\s+$/, '') })
  for (const m of text.matchAll(/```add-import[ \t]*\n([\s\S]*?)```/g)) ops.push({ op: 'ADD_IMPORT', code: m[1].replace(/\s+$/, '') })
  for (const m of text.matchAll(new RegExp('```change-in[ \\t]+(' + NAME + ')[ \\t]*\\n<<<<<<< SEARCH\\n([\\s\\S]*?)\\n=======\\n([\\s\\S]*?)\\n>>>>>>> REPLACE[ \\t]*\\n?```', 'g'))) ops.push({ op: 'CHANGE_EXPRESSION', name: m[1], search: m[2], replace: m[3] })
  for (const m of text.matchAll(/```insert-(after|before)-line[ \t]*\nANCHOR:[ \t]*(.*)\n([\s\S]*?)```/g)) ops.push({ op: 'ADD_HANDLER_BRANCH', where: m[1] as 'after' | 'before', anchor: m[2].replace(/\s+$/, ''), code: m[3].replace(/\s+$/, '') })
  return ops
}
export const hasStructOps = (text: string) => /```(?:replace-symbol|insert-(?:after|before|end)|add-import|change-in|insert-(?:after|before)-line)\b/.test(text)

type Decl = { name: string; start: number; end: number; exported: boolean }
/** Top-level declarations by name with exact source ranges (start at the declaration itself, leading comments/blank lines are not part of it). */
export function topLevelDecls(rel: string, text: string): Decl[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true)
  const out: Decl[] = []
  for (const st of sf.statements) {
    const exported = !!(ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.push({ name: st.name.text, start: st.getStart(sf), end: st.getEnd(), exported })
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push({ name: d.name.text, start: st.getStart(sf), end: st.getEnd(), exported })
  }
  return out
}
const uniqueDecl = (decls: Decl[], name: string): Decl | string => {
  const f = decls.filter((d) => d.name === name)
  return f.length === 1 ? f[0] : f.length === 0 ? `no top-level declaration named ${name} (top-level names: ${decls.map((d) => d.name).slice(0, 12).join(', ') || 'none'})` : `${name} is declared ${f.length} times at the top level`
}
const parses = (rel: string, text: string): string | null => {
  const r = ts.transpileModule(text, { reportDiagnostics: true, fileName: rel.replace(/\.m?js$/, '.mjs'), compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
  const d = (r.diagnostics ?? []).find((x) => x.category === ts.DiagnosticCategory.Error)
  return d ? ts.flattenDiagnosticMessageText(d.messageText, ' ') : null
}
const importedNames = (code: string): { from: string; names: string[]; def: string | null; ns: string | null; sideEffect: boolean }[] =>
  [...code.matchAll(/^\s*import\s+(?:(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+))?\s*from\s*)?['"]([^'"]+)['"]\s*;?/gm)].map((m) => ({ from: m[4], def: m[1] ?? null, names: (m[2] ?? '').split(',').map((x) => x.trim()).filter(Boolean), ns: m[3] ?? null, sideEffect: !m[1] && m[2] === undefined && !m[3] }))

export type StructResult = { ok: true; content: string; applied: StructOp['op'][] } | { ok: false; reason: string }
/** Applies the ops in order, each against the result of the previous one; a refusal names the exact reason. The result must still parse. */
export function applyStructOps(rel: string, current: string, ops: StructOp[]): StructResult {
  let out = current
  const applied: StructOp['op'][] = []
  for (const op of ops) {
    if (op.op === 'ADD_IMPORT') {
      const want = importedNames(op.code)
      if (!want.length) return { ok: false, reason: 'add-import: the block contains no import statement' }
      for (const w of want) {
        const have = importedNames(out).find((h) => h.from === w.from)
        if (have && !w.sideEffect) {
          const missing = w.names.filter((n) => !have.names.map((x) => x.split(/\s+as\s+/)[0]).includes(n.split(/\s+as\s+/)[0]))
          if (!missing.length && (!w.def || have.def === w.def)) continue
          const m = new RegExp(`^(\\s*import\\s+[^;\\n]*?\\{)([^}]*)(\\}[^;\\n]*from\\s*['"]${w.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"][^\\n]*)$`, 'm').exec(out)
          if (m && missing.length) { out = out.replace(m[0], `${m[1]} ${[...have.names, ...missing].join(', ')} ${m[3]}`); applied.push('ADD_IMPORT'); continue }
          return { ok: false, reason: `add-import: ${w.from} is already imported in a shape that cannot take ${missing.join(', ') || w.def}; edit the existing import line with a change-in/SEARCH block` }
        }
        if (have && w.sideEffect) continue
        const stmts = [...out.matchAll(/^\s*import\b[^\n]*$/gm)]
        const line = `import ${w.def ? w.def + (w.names.length ? ', ' : '') : ''}${w.ns ? `* as ${w.ns}` : w.names.length ? `{ ${w.names.join(', ')} }` : ''}${w.def || w.ns || w.names.length ? ' from ' : ''}'${w.from}'`
        if (stmts.length) { const last = stmts[stmts.length - 1]; const at = last.index! + last[0].length; out = out.slice(0, at) + '\n' + line + out.slice(at) } else out = line + '\n' + out
        applied.push('ADD_IMPORT')
      }
      continue
    }
    if (op.op === 'REPLACE_SYMBOL') {
      const d = uniqueDecl(topLevelDecls(rel, out), op.name)
      if (typeof d === 'string') return { ok: false, reason: `replace-symbol ${op.name}: ${d}` }
      // import statements inside the replacement are hoisted to the import section (merged), never left in the middle of the declaration
      const importLines = [...op.code.matchAll(/^[ \t]*import\b[^\n]*$/gm)].map((m) => m[0])
      let code = op.code
      if (importLines.length) {
        code = code.replace(/^[ \t]*import\b[^\n]*\n?/gm, '').replace(/^\s+/, '')
        const imp = applyStructOps(rel, out, [{ op: 'ADD_IMPORT', code: importLines.join('\n') }])
        if (imp.ok) out = imp.content
        else if (imp.reason !== 'the structural edits change nothing') return { ok: false, reason: `replace-symbol ${op.name}: ${imp.reason}` }
        applied.push('ADD_IMPORT')
      }
      const again = uniqueDecl(topLevelDecls(rel, out), op.name)
      if (typeof again === 'string') return { ok: false, reason: `replace-symbol ${op.name}: ${again}` }
      const declared = topLevelDecls(rel, code).find((x) => x.name === op.name)
      if (!declared) return { ok: false, reason: `replace-symbol ${op.name}: the replacement does not declare ${op.name}` }
      // keep the export of the replaced declaration: the keyword goes on THAT declaration, wherever it is in the block
      if (again.exported && !declared.exported) code = code.slice(0, declared.start) + 'export ' + code.slice(declared.start)
      out = out.slice(0, again.start) + code + out.slice(again.end)
      applied.push('REPLACE_SYMBOL'); continue
    }
    if (op.op === 'INSERT_SYMBOL') {
      if (op.where === 'end') { out = out.replace(/\s*$/, '') + '\n\n' + op.code + '\n'; applied.push('INSERT_SYMBOL'); continue }
      const d = uniqueDecl(topLevelDecls(rel, out), op.name!)
      if (typeof d === 'string') return { ok: false, reason: `insert-${op.where} ${op.name}: ${d}` }
      out = op.where === 'after' ? out.slice(0, d.end) + '\n\n' + op.code + out.slice(d.end) : out.slice(0, d.start) + op.code + '\n\n' + out.slice(d.start)
      applied.push('INSERT_SYMBOL'); continue
    }
    if (op.op === 'CHANGE_EXPRESSION') {
      const d = uniqueDecl(topLevelDecls(rel, out), op.name)
      if (typeof d === 'string') return { ok: false, reason: `change-in ${op.name}: ${d}` }
      const body = out.slice(d.start, d.end)
      const n = op.search.length ? body.split(op.search).length - 1 : 0
      // the text is not inside that symbol: when it appears EXACTLY once in the whole file, the worker named the wrong symbol and the edit is unambiguous anyway
      if (n === 0 && op.search.length && out.split(op.search).length - 1 === 1) { out = out.replace(op.search, () => op.replace); applied.push('CHANGE_EXPRESSION'); continue }
      if (n === 0) return { ok: false, reason: `change-in ${op.name}: SEARCH text not found inside ${op.name} (first line: "${op.search.split('\n')[0].slice(0, 80)}")` }
      if (n > 1) return { ok: false, reason: `change-in ${op.name}: SEARCH text appears ${n} times inside ${op.name}; include more surrounding lines` }
      out = out.slice(0, d.start) + body.replace(op.search, () => op.replace) + out.slice(d.end)
      applied.push('CHANGE_EXPRESSION'); continue
    }
    if (op.op === 'ADD_HANDLER_BRANCH') {
      const lines = out.split('\n')
      const idx = lines.map((l, i) => (l.trim() === op.anchor.trim() ? i : -1)).filter((i) => i >= 0)
      if (idx.length !== 1) return { ok: false, reason: `insert-${op.where}-line: the ANCHOR line ${idx.length ? `appears ${idx.length} times` : 'was not found'}: "${op.anchor.slice(0, 80)}" (it must match one existing line exactly)` }
      const indent = /^\s*/.exec(lines[idx[0]])![0]
      const block = op.code.split('\n').map((l, i) => (i === 0 || !l.trim() ? l : (/^\s/.test(l) ? l : indent + l))).map((l, i) => (i === 0 ? indent + l.replace(/^\s+/, '') : l))
      if (op.where === 'before') lines.splice(idx[0], 0, ...block); else {
        // after a block-opening anchor the new branch goes after the whole block, not inside it
        let end = idx[0], depth = 0, started = false
        for (let k = idx[0]; k < lines.length; k++) { for (const ch of lines[k]) { if (ch === '{') { depth += 1; started = true } else if (ch === '}') depth -= 1 } end = k; if (!started || depth <= 0) break }
        lines.splice(end + 1, 0, ...block)
      }
      out = lines.join('\n'); applied.push('ADD_HANDLER_BRANCH'); continue
    }
  }
  if (out === current) return { ok: false, reason: 'the structural edits change nothing' }
  const names = topLevelDecls(rel, out).map((d) => d.name)
  const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
  if (twice.length) return { ok: false, reason: `the structural edits declare ${twice.join(', ')} more than once at the top level; a replace-symbol block replaces ONLY the symbol it names (give each other changed symbol its own replace-symbol block, or leave it out), and it must not repeat declarations that already exist` }
  const bad = parses(rel, out)
  if (bad) return { ok: false, reason: `the structural edits produce a file that does not parse: ${bad}` }
  return { ok: true, content: out, applied }
}
/** Share of the file that the structural edits left byte-identical (1 = untouched). */
export function preservedShare(before: string, after: string): number {
  if (!before) return 0
  let p = 0; while (p < before.length && p < after.length && before[p] === after[p]) p++
  let s = 0; while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++
  return Math.min(1, (p + s) / before.length)
}
