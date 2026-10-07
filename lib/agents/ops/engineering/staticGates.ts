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

type RouteCond = { kind: 'literal' | 'prefix'; path: string; method: string | null; line: number }
export function routeConditions(text: string): RouteCond[] {
  const out: RouteCond[] = []
  const lines = text.split('\n')
  lines.forEach((ln, i) => {
    if (!/\bif\s*\(/.test(ln) || !/pathname/.test(ln)) return
    const method = /req\.method\s*===\s*['"]([A-Z]+)['"]/.exec(ln)?.[1] ?? null
    const lit = /pathname\s*===\s*['"]([^'"]+)['"]/.exec(ln)?.[1]
    const pre = /pathname\.startsWith\(\s*['"]([^'"]+)['"]\s*\)/.exec(ln)?.[1]
    if (lit) out.push({ kind: 'literal', path: lit, method, line: i + 1 })
    else if (pre) out.push({ kind: 'prefix', path: pre, method, line: i + 1 })
  })
  return out
}
/** A literal route that an EARLIER prefix route also matches (same method or either unspecified) is shadowed. */
export function routeShadowing(rel: string, text: string): { literal: string; prefix: string; literalLine: number; prefixLine: number }[] {
  if (!/\.(m?js|ts)$/.test(rel)) return []
  const conds = routeConditions(text)
  const out: { literal: string; prefix: string; literalLine: number; prefixLine: number }[] = []
  conds.forEach((c, i) => {
    if (c.kind !== 'literal') return
    const pre = conds.slice(0, i).find((p) => p.kind === 'prefix' && c.path.startsWith(p.path) && c.path !== p.path.replace(/\/$/, '') && (!p.method || !c.method || p.method === c.method))
    if (pre) out.push({ literal: c.path, prefix: pre.path, literalLine: c.line, prefixLine: pre.line })
  })
  return out
}

export function domIds(js: string): string[] {
  return [...new Set([...js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))]
}
export function missingDomIds(html: string, ids: string[]): string[] {
  return ids.filter((id) => !new RegExp(`\\bid\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(html))
}
