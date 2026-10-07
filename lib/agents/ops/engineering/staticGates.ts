import ts from 'typescript'
import path from 'node:path'

/**
 * Cross-reference gates that run BEFORE a reply is written. Each one is pure static analysis of the proposed file against ground truth in the workspace,
 * and returns a precise, evidence-bearing message (never a guess):
 *   - undefinedNames: identifiers the file uses but never declares/imports (the model called countEvents() without importing it);
 *   - routeShadowing: a literal route registered after a prefix route that already matches it (read-all swallowed by startsWith('/api/x/'));
 *   - domIds / missingDomIds: element ids a client script reads that the page does not contain.
 */
const AMBIENT = 'declare const process: any; declare const Buffer: any; declare const require: any; declare const module: any; declare const global: any;\n'

export function undefinedNames(rel: string, text: string): string[] {
  if (!/\.(m?js|cjs)$/.test(rel)) return []
  const name = path.posix.join('/virtual', rel.replace(/[^\w./-]/g, '_'))
  const amb = '/virtual/ambient.d.ts'
  const files = new Map<string, string>([[name, text], [amb, AMBIENT]])
  const opts: ts.CompilerOptions = { allowJs: true, checkJs: true, noEmit: true, noResolve: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], skipLibCheck: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }
  const host = ts.createCompilerHost(opts, true)
  const origRead = host.readFile.bind(host), origExists = host.fileExists.bind(host), origSf = host.getSourceFile.bind(host)
  host.fileExists = (f) => files.has(f) || origExists(f)
  host.readFile = (f) => files.get(f) ?? origRead(f)
  host.getSourceFile = (f, lv, onErr, ...rest) => (files.has(f) ? ts.createSourceFile(f, files.get(f)!, lv, true) : origSf(f, lv, onErr, ...rest))
  const program = ts.createProgram([name, amb], opts, host)
  const sf = program.getSourceFile(name)
  if (!sf) return []
  const found = new Set<string>()
  for (const d of program.getSemanticDiagnostics(sf)) {
    if (d.code !== 2304 && d.code !== 2552) continue
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ')
    const m = /Cannot find name '([^']+)'/.exec(msg)
    if (m) found.add(m[1])
  }
  return [...found]
}

export type Route = { kind: 'literal' | 'prefix' | 'regex'; pattern: string; method: string | null; line: number; end: number; returns: boolean; matches: (p: string) => boolean }
const METHOD_RE = /\b(?:req\.)?method\s*===?\s*['"]([A-Z]+)['"]/
const unesc = (s: string) => s.replace(/\\\//g, '/').replace(/\\([.\-])/g, '$1')
/** Every HTTP route a dispatcher registers by testing the request path: literal ===, startsWith prefix, regex test/exec/match (also through a const alias), with its method and handler span. */
export function routeTable(text: string): Route[] {
  const lines = text.split('\n')
  const alias = new Map<string, string>()
  for (const ln of lines) { const m = /\b(?:const|let)\s+(\w+)\s*=\s*(?:\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\n\\\[])+)\/\w*\.(?:exec|test)\(\s*[\w.]*pathname|[\w.]*pathname\.match\(\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\n\\\[])+)\/\w*\s*\))/.exec(ln); if (m) alias.set(m[1], m[2] ?? m[3]) }
  const out: Route[] = []
  const span = (i: number): { end: number; returns: boolean } => {
    const ln = lines[i]
    let depth = 0, started = false, end = i
    for (let k = i; k < Math.min(lines.length, i + 80); k++) { for (const ch of lines[k]) { if (ch === '{') { depth += 1; started = true } else if (ch === '}') depth -= 1 } end = k; if (started && depth <= 0) break; if (!started && k === i && !/\{\s*$/.test(ln)) break }
    return { end, returns: /\breturn\b/.test(lines.slice(i, end + 1).join('\n')) }
  }
  lines.forEach((ln, i) => {
    if (!/\bif\s*\(/.test(ln)) return
    const method = METHOD_RE.exec(ln)?.[1] ?? null
    const { end, returns } = span(i)
    const add = (kind: Route['kind'], pattern: string, matches: (p: string) => boolean) => out.push({ kind, pattern, method, line: i + 1, end: end + 1, returns, matches })
    if (!/pathname|\.test\(|\.exec\(|\.match\(/.test(ln) && ![...alias.keys()].some((a) => new RegExp(`\\bif\\s*\\(\\s*!?${a}\\b`).test(ln))) return
    let found = false
    for (const m of ln.matchAll(/pathname\s*===?\s*['"]([^'"]+)['"]/g)) { found = true; add('literal', m[1], (p) => p === m[1]) }
    for (const m of ln.matchAll(/pathname\.startsWith\(\s*['"]([^'"]+)['"]\s*\)/g)) { found = true; add('prefix', m[1], (p) => p.startsWith(m[1])) }
    for (const m of ln.matchAll(/\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\n\\\[])+)\/\w*\.test\(\s*[\w.]*pathname\s*\)/g)) { found = true; try { const re = new RegExp(m[1]); add('regex', m[1], (p) => re.test(p)) } catch { /* not a usable regex */ } }
    for (const [a, src] of alias) if (new RegExp(`\\bif\\s*\\(\\s*!?${a}\\b`).test(ln) && !found) { found = true; try { const re = new RegExp(src); add('regex', src, (p) => re.test(p)) } catch { /* ignore */ } }
  })
  return out.filter((r, i) => !out.slice(0, i).some((e) => e.end > e.line && r.line > e.line && r.line <= e.end))
}
const sampleOf = (r: Route): string[] => {
  if (r.kind === 'literal') return [r.pattern]
  if (r.kind === 'prefix') return []
  const src = r.pattern.replace(/^\^/, '').replace(/\$$/, '')
  const fill = (s: string, optional: boolean): string => unesc(s.replace(/\((?:\?:)?([^()]*)\)(\?)?/g, (_m, g: string, q?: string) => (q && !optional ? '' : /\\d/.test(g) ? '1' : /\[\^\/\]/.test(g) ? 'x' : g.includes('|') ? g.split('|')[0].replace(/^\\\//, '/') : g.replace(/^\\\//, '/'))))
  return [...new Set([fill(src, false), fill(src, true)])].filter((p) => { try { return new RegExp(r.pattern).test(p) } catch { return false } })
}
const methodsCompatible = (a: string | null, b: string | null) => !a || !b || a === b
export type RouteFinding = { kind: 'PREFIX_SHADOWS' | 'PARAM_SHADOWS' | 'DUPLICATE'; hidden: string; hiding: string; hiddenLine: number; hidingLine: number }
/** A later route that an EARLIER, returning route already matches (specific hidden by a broad prefix; fixed path hidden by a parameter route; the same route registered twice). */
export function routeFindings(rel: string, text: string): RouteFinding[] {
  if (!/\.(m?js|ts)$/.test(rel)) return []
  const rs = routeTable(text)
  const out: RouteFinding[] = []
  rs.forEach((c, j) => {
    for (const i of rs.slice(0, j).keys()) {
      const e = rs[i]
      if (!methodsCompatible(e.method, c.method) || !e.returns) continue
      if (e.kind === c.kind && e.pattern === c.pattern && e.method === c.method) { out.push({ kind: 'DUPLICATE', hidden: c.pattern, hiding: e.pattern, hiddenLine: c.line, hidingLine: e.line }); break }
      if (e.kind === 'literal') continue
      const samples = sampleOf(c)
      if (c.kind === 'prefix' || !samples.length) continue
      if (e.kind === 'prefix' && c.kind === 'literal' && c.pattern === e.pattern.replace(/\/$/, '')) continue
      if (samples.some((s) => e.matches(s))) { out.push({ kind: e.kind === 'prefix' ? 'PREFIX_SHADOWS' : 'PARAM_SHADOWS', hidden: c.pattern, hiding: e.pattern, hiddenLine: c.line, hidingLine: e.line }); break }
    }
  })
  return out
}
/** Back-compatible view of routeFindings for the shadowing cases. */
export function routeShadowing(rel: string, text: string): { literal: string; prefix: string; literalLine: number; prefixLine: number }[] {
  return routeFindings(rel, text).filter((f) => f.kind !== 'DUPLICATE').map((f) => ({ literal: f.hidden, prefix: f.hiding, literalLine: f.hiddenLine, prefixLine: f.hidingLine }))
}
/** "POST /api/x/:id/read" mentioned in the acceptance contract -> method + concrete sample path. */
export function acceptanceRoutes(acceptance: string[]): { method: string; path: string; sample: string }[] {
  const seen = new Set<string>(), out: { method: string; path: string; sample: string }[] = []
  for (const a of acceptance) for (const m of a.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-/.:]+)/g)) {
    const path = m[2].replace(/[.:]+$/, ''); const k = `${m[1]} ${path}`; if (seen.has(k)) continue; seen.add(k)
    out.push({ method: m[1], path, sample: path.replace(/:\w+/g, '1') })
  }
  return out
}
/** Routes the contract names that the dispatcher cannot serve: not registered, registered under another method, or hidden by an earlier route. Only meaningful for a file that really is a path dispatcher. */
export function contractRouteProblems(rel: string, text: string, acceptance: string[], clientTexts: string[] = []): string[] {
  if (!/\.(m?js|ts)$/.test(rel)) return []
  const rs = routeTable(text)
  if (rs.length < 3) return []
  const problems: string[] = []
  for (const ar of acceptanceRoutes(acceptance)) {
    const hits = rs.filter((r) => r.matches(ar.sample))
    if (!hits.length) { problems.push(`the contract requires ${ar.method} ${ar.path} but no route in this file matches ${ar.sample}`); continue }
    const ok = hits.filter((r) => methodsCompatible(r.method, ar.method))
    if (!ok.length) { problems.push(`${ar.path} is registered only for ${[...new Set(hits.map((h) => h.method))].join('/')}, but the contract requires ${ar.method}`); continue }
    const first = hits.find((r) => methodsCompatible(r.method, ar.method) && r.returns)
    if (first && first.kind !== 'literal' && ok.some((r) => r.kind === 'literal' && r.line > first.line)) problems.push(`${ar.method} ${ar.path} is answered first by the ${first.kind} route ${first.pattern} (line ${first.line})`)
  }
  for (const js of clientTexts) for (const m of js.matchAll(/fetch\(\s*['"`](\/[^'"`?$]+)(?:\$\{[^}]*\}[^'"`?]*)?['"`]\s*,\s*\{[^}]*method:\s*['"](\w+)['"]/g)) {
    const hits = rs.filter((r) => r.matches(m[1]) || r.matches(m[1] + '1'))
    if (hits.length && !hits.some((r) => methodsCompatible(r.method, m[2].toUpperCase()))) problems.push(`the page calls ${m[2].toUpperCase()} ${m[1]} but the server only registers it for ${[...new Set(hits.map((h) => h.method))].join('/')}`)
  }
  return problems
}
/** Every HTTP status the acceptance contract requires (4xx/5xx) must be reachable: a literal in the server/service code, or a status/code taken from a thrown error. */
export function statusReachability(files: Record<string, string>, acceptance: string[]): string[] {
  const codes = [...new Set(acceptance.flatMap((a) => [...a.matchAll(/\b([45]\d\d)\b/g)].map((m) => m[1])))]
  const code = Object.entries(files).filter(([p]) => /\.m?js$/.test(p) && !/^(test|node_modules|public)\//.test(p)).map(([, t]) => t).join('\n')
  const mapped = /\b(?:reply|send|respond|writeHead|status)\s*\([^)\n]*\b(?:err|e|error)\.(?:status|statusCode|code)\b/.test(code)
  return codes.filter((c) => !new RegExp(`\\b${c}\\b`).test(code) && !mapped)
}
/** Plain JS/ESM syntax errors, found before the file is written (a missing paren must never reach the verifier). */
export function syntaxProblems(rel: string, text: string): string[] {
  if (!/\.(m?js|cjs)$/.test(rel)) return []
  const r = ts.transpileModule(text, { reportDiagnostics: true, fileName: rel.replace(/\.cjs$/, '.js'), compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
  return (r.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).slice(0, 3).map((d) => { const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null; return `${pos ? `line ${pos.line + 1}: ` : ''}${ts.flattenDiagnosticMessageText(d.messageText, ' ')}` })
}
/** An existing export that used module state S and now uses a NEWLY introduced module state N instead (a legacy endpoint silently re-pointed at the new feature's data). */
export function legacyStateDrift(rel: string, before: string, after: string): { fn: string; was: string; now: string }[] {
  if (!/\.(m?js|ts)$/.test(rel) || !before.trim()) return []
  const analyse = (text: string) => {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true)
    const state = new Set<string>(), fns = new Map<string, Set<string>>()
    for (const st of sf.statements) if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrayLiteralExpression(d.initializer) || ts.isObjectLiteralExpression(d.initializer) || ts.isNewExpression(d.initializer) || ts.isCallExpression(d.initializer))) state.add(d.name.text)
    for (const st of sf.statements) {
      const exported = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (!exported || !ts.isFunctionDeclaration(st) || !st.name || !st.body) continue
      const refs = new Set<string>()
      const walk = (n: ts.Node) => { const prop = n.parent && ((ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) || (ts.isPropertyAssignment(n.parent) && n.parent.name === n)); if (ts.isIdentifier(n) && !prop && state.has(n.text)) refs.add(n.text); ts.forEachChild(n, walk) }
      walk(st.body)
      fns.set(st.name.text, refs)
    }
    return { state, fns }
  }
  const b = analyse(before), a = analyse(after)
  const out: { fn: string; was: string; now: string }[] = []
  for (const [fn, was] of b.fns) {
    const now = a.fns.get(fn); if (!now || !was.size) continue
    const dropped = [...was].filter((s) => !now.has(s)), added = [...now].filter((s) => !b.state.has(s))
    if (dropped.length && added.length && ![...was].some((s) => now.has(s))) out.push({ fn, was: dropped.join(','), now: added.join(',') })
  }
  return out
}

export function domIds(js: string): string[] {
  return [...new Set([...js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))]
}
export function missingDomIds(html: string, ids: string[]): string[] {
  return ids.filter((id) => !new RegExp(`\\bid\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(html))
}
