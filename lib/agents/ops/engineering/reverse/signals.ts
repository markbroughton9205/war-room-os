import ts from 'typescript'

/**
 * Per-file deterministic signals the existing code index does not carry: HTTP method exports and status codes, fetch call sites, persistence calls, state vocabularies,
 * UI handlers. Every signal carries its line so it can be cited as evidence. Pure: takes source text, returns data.
 */
export type FetchCall = { url: string; method: string; line: number; enclosing: string | null; dynamic: boolean }
export type PersistCall = { api: string; op: 'create' | 'change' | 'read' | 'delete' | 'ui-state' | 'browser-storage' | 'db' | 'env'; target: string; line: number; enclosing: string | null }
export type StateUnion = { name: string; values: string[]; line: number }
export type StateAssign = { field: string; value: string; line: number }
export type UiSurface = { label: string; event: string; handler: string | null; line: number; testId?: string; calls: string[] }
export type FileSignals = {
  methods: { method: string; line: number }[]
  statuses: { status: number; line: number }[]
  actions: { value: string; line: number }[]
  fetches: FetchCall[]
  persist: PersistCall[]
  unions: StateUnion[]
  assigns: StateAssign[]
  ui: UiSurface[]
  testIds: { id: string; line: number }[]
  /** function name -> identifiers it calls (intra-file call graph, names only) */
  calls: Record<string, string[]>
  external: string[]
  dynamicImports: number
}

const HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const FS_WRITE = new Set(['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'mkdir', 'renameSync', 'rename', 'copyFileSync', 'copyFile'])
const FS_DELETE = new Set(['rmSync', 'rm', 'unlinkSync', 'unlink', 'rmdirSync'])
const FS_READ = new Set(['readFileSync', 'readFile', 'readdirSync', 'readdir', 'existsSync'])
const STATE_NAME = /(state|status|phase|stage|mode|kind)$/i
const STATE_FIELD = /^(state|status|phase|stage)$/i
const DB_CALL = /^(from|insert|upsert|update|delete|select|rpc)$/

const SECRETISH = /(key|token|secret|passw|credential|bearer|auth)/i
/** Persisted evidence must not carry secrets: drop query strings and credentials from URLs, and mask secret-looking targets. */
const cleanUrl = (u: string) => u.replace(/\/\/[^/@\s]+@/, '//').split('?')[0].split('#')[0]
const cleanTarget = (t: string) => (SECRETISH.test(t) ? '[redacted]' : t.replace(/\/\/[^/@\s]+@/, '//').split('?')[0]).slice(0, 60)
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises'])

const kindFor = (rel: string) => (rel.endsWith('.tsx') ? ts.ScriptKind.TSX : rel.endsWith('.jsx') ? ts.ScriptKind.JSX : rel.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)

function litText(n: ts.Node | undefined, src: ts.SourceFile): { text: string; dynamic: boolean } | null {
  if (!n) return null
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return { text: n.text, dynamic: false }
  if (ts.isTemplateExpression(n)) return { text: n.head.text + n.templateSpans.map((s) => '{}' + s.literal.text).join(''), dynamic: true }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = litText(n.left, src), r = litText(n.right, src)
    if (l && !r) return { text: l.text + '{}', dynamic: true }
    if (l && r) return { text: l.text + r.text, dynamic: l.dynamic || r.dynamic }
  }
  return null
}

export function scanSignals(rel: string, content: string): FileSignals {
  const src = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true, kindFor(rel))
  const fsNames = new Set<string>(), fsNs = new Set<string>()
  const out: FileSignals = { methods: [], statuses: [], actions: [], fetches: [], persist: [], unions: [], assigns: [], ui: [], testIds: [], calls: Object.create(null) as Record<string, string[]>, external: [], dynamicImports: 0 }
  const line = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1
  const isRoute = /(^|\/)route\.(t|j)sx?$/.test(rel)
  const fnStack: string[] = []
  const enclosing = () => fnStack[fnStack.length - 1] ?? null
  const addCall = (name: string) => { const f = enclosing(); if (!f) return; (out.calls[f] ??= []); if (!out.calls[f].includes(name)) out.calls[f].push(name) }
  const calleeName = (e: ts.Expression): string | null => ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null
  const rootName = (e: ts.Expression): string => ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? rootName(e.expression) : ts.isCallExpression(e) ? rootName(e.expression) : ''

  const jsxAttr = (el: ts.JsxOpeningLikeElement, name: string) => el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === name)
  const attrText = (a: ts.JsxAttribute | undefined) => {
    if (!a?.initializer) return null
    if (ts.isStringLiteral(a.initializer)) return a.initializer.text
    if (ts.isJsxExpression(a.initializer) && a.initializer.expression) return litText(a.initializer.expression, src)?.text ?? null
    return null
  }

  const visit = (node: ts.Node) => {
    // function-like containers (named by declaration or by the const they are assigned to)
    let pushed = false
    if (ts.isFunctionDeclaration(node) && node.name) { fnStack.push(node.name.text); pushed = true }
    else if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) { fnStack.push(node.parent.name.text); pushed = true }
    else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) { fnStack.push(node.name.text); pushed = true }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const s = node.moduleSpecifier.text
      if (FS_MODULES.has(s) && node.importClause?.namedBindings) {
        const nb = node.importClause.namedBindings
        if (ts.isNamespaceImport(nb)) fsNs.add(nb.name.text)
        else for (const el of nb.elements) fsNames.add((el.propertyName ?? el.name).text === el.name.text ? el.name.text : el.name.text)
      }
      if (FS_MODULES.has(s) && node.importClause?.name) fsNs.add(node.importClause.name.text)
      if (!s.startsWith('.') && !s.startsWith('@/') && !out.external.includes(s)) out.external.push(s)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) out.dynamicImports += 1

    if (isRoute) {
      if (ts.isFunctionDeclaration(node) && node.name && HTTP.has(node.name.text) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) out.methods.push({ method: node.name.text, line: line(node) })
      if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name) && HTTP.has(d.name.text)) out.methods.push({ method: d.name.text, line: line(d) })
    }
    // status codes: { status: 409 } in an object literal
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'status' && ts.isNumericLiteral(node.initializer)) {
      const n = Number(node.initializer.text); if (n >= 100 && n < 600) out.statuses.push({ status: n, line: line(node) })
    }
    // action vocabulary: action === 'literal' (route dispatch) and switch cases on it
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)) {
      const lt = ts.isStringLiteral(node.right) ? node.right : ts.isStringLiteral(node.left) ? node.left : null
      const other = lt === node.right ? node.left : node.right
      if (lt && isRoute && /action|type|kind|op/i.test(other.getText(src))) out.actions.push({ value: lt.text, line: line(node) })
    }
    // fetch(url, { method })
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
      const u = litText(node.arguments[0], src)
      let method = 'GET'
      const opts = node.arguments[1]
      if (opts && ts.isObjectLiteralExpression(opts)) for (const p of opts.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'method') method = litText(p.initializer, src)?.text.toUpperCase() ?? 'UNKNOWN'
      if (u) out.fetches.push({ url: cleanUrl(u.text), method, line: line(node), enclosing: enclosing(), dynamic: u.dynamic })
      else out.fetches.push({ url: '(non-literal)', method, line: line(node), enclosing: enclosing(), dynamic: true })
    }
    // calls
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression)
      if (name) addCall(name)
      const root = rootName(node.expression)
      if (name && ts.isPropertyAccessExpression(node.expression)) {
        const arg0 = litText(node.arguments[0], src)?.text ?? ''
        const api = `${root}.${name}`
        const isFs = fsNs.has(root) || /^(fs|fsp|promises|fsPromises)$/.test(root) && (fsNs.size > 0 || fsNames.size > 0 || true)
        if (FS_WRITE.has(name) && isFs) out.persist.push({ api, op: /^(mkdir|rename|copy)/.test(name) ? 'change' : name.startsWith('append') ? 'change' : 'create', target: cleanTarget(arg0 || node.arguments[0]?.getText(src) || ''), line: line(node), enclosing: enclosing() })
        else if (FS_DELETE.has(name) && isFs) out.persist.push({ api, op: 'delete', target: cleanTarget(node.arguments[0]?.getText(src) ?? ''), line: line(node), enclosing: enclosing() })
        else if (FS_READ.has(name) && isFs) out.persist.push({ api, op: 'read', target: cleanTarget(node.arguments[0]?.getText(src) ?? ''), line: line(node), enclosing: enclosing() })
        else if ((root === 'localStorage' || root === 'sessionStorage') && /^(setItem|removeItem|getItem)$/.test(name)) out.persist.push({ api, op: 'browser-storage', target: cleanTarget(arg0), line: line(node), enclosing: enclosing() })
        else if (DB_CALL.test(name) && /^(supabase\w*|prisma|db|sb)$/i.test(root)) out.persist.push({ api, op: 'db', target: cleanTarget(arg0), line: line(node), enclosing: enclosing() })
      } else if (name && ts.isIdentifier(node.expression)) {
        if (!fsNames.has(name) && (FS_WRITE.has(name) || FS_DELETE.has(name) || FS_READ.has(name))) { /* a local function that merely shares an fs name is not persistence */ }
        else if (FS_WRITE.has(name)) out.persist.push({ api: name, op: /^(mkdir|rename|copy)/.test(name) ? 'change' : name.startsWith('append') ? 'change' : 'create', target: cleanTarget(node.arguments[0]?.getText(src) ?? ''), line: line(node), enclosing: enclosing() })
        else if (FS_DELETE.has(name)) out.persist.push({ api: name, op: 'delete', target: cleanTarget(node.arguments[0]?.getText(src) ?? ''), line: line(node), enclosing: enclosing() })
        else if (FS_READ.has(name)) out.persist.push({ api: name, op: 'read', target: cleanTarget(node.arguments[0]?.getText(src) ?? ''), line: line(node), enclosing: enclosing() })
        else if (name === 'useState' || name === 'useReducer') {
          const decl = node.parent
          const nm = ts.isVariableDeclaration(decl) && ts.isArrayBindingPattern(decl.name) && decl.name.elements[0] && ts.isBindingElement(decl.name.elements[0]) ? decl.name.elements[0].name.getText(src) : ''
          out.persist.push({ api: name, op: 'ui-state', target: nm, line: line(node), enclosing: enclosing() })
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.getText(src) === 'process.env') out.persist.push({ api: 'process.env', op: 'env', target: node.name.text, line: line(node), enclosing: enclosing() })
    // state vocabularies: type X = 'A' | 'B' | ...
    if (ts.isTypeAliasDeclaration(node) && ts.isUnionTypeNode(node.type) && STATE_NAME.test(node.name.text)) {
      const values = node.type.types.flatMap((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : []))
      if (values.length >= 2) out.unions.push({ name: node.name.text, values, line: line(node) })
    }
    // const X_STATES = ['A','B']
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /(STATES|STATUSES|PHASES|STAGES)$/i.test(node.name.text) && node.initializer) {
      const init = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer
      if (ts.isArrayLiteralExpression(init)) { const values = init.elements.flatMap((e) => (ts.isStringLiteral(e) ? [e.text] : [])); if (values.length >= 2) out.unions.push({ name: node.name.text, values, line: line(node) }) }
    }
    // assignments of a literal to a state-like field
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && STATE_FIELD.test(node.name.text) && ts.isStringLiteral(node.initializer)) out.assigns.push({ field: node.name.text, value: node.initializer.text, line: line(node) })
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && STATE_FIELD.test(node.left.name.text) && ts.isStringLiteral(node.right)) out.assigns.push({ field: node.left.name.text, value: node.right.text, line: line(node) })

    // UI: elements with an event handler, and every data-testid
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tid = jsxAttr(node, 'data-testid'); const testId = attrText(tid) ?? undefined
      if (testId) out.testIds.push({ id: testId, line: line(node) })
      for (const ev of ['onClick', 'onSubmit', 'onChange']) {
        const a = jsxAttr(node, ev); if (!a?.initializer || !ts.isJsxExpression(a.initializer) || !a.initializer.expression) continue
        const ex = a.initializer.expression
        let handler: string | null = null; const calls: string[] = []
        if (ts.isIdentifier(ex)) handler = ex.text
        else if (ts.isArrowFunction(ex) || ts.isFunctionExpression(ex)) {
          const walk = (n: ts.Node) => { if (ts.isCallExpression(n)) { const c = calleeName(n.expression); if (c) calls.push(c) } ts.forEachChild(n, walk) }
          walk(ex.body)
          handler = calls[0] ?? null
        }
        let label = attrText(jsxAttr(node, 'aria-label')) ?? attrText(jsxAttr(node, 'placeholder')) ?? ''
        if (!label && ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent)) label = node.parent.children.map((c) => (ts.isJsxText(c) ? c.text : '')).join('').replace(/\s+/g, ' ').trim()
        out.ui.push({ label: label.slice(0, 80) || (testId ?? `${node.tagName.getText(src)} ${ev}`), event: ev, handler, line: line(node), testId, calls })
      }
    }
    ts.forEachChild(node, visit)
    if (pushed) fnStack.pop()
  }
  visit(src)
  return out
}

/** Names reachable from `start` through the intra-file call graph (including start). */
export function reachableFns(calls: Record<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>([start]); const q = [start]
  while (q.length) { const f = q.shift()!; for (const c of calls[f] ?? []) if (!seen.has(c)) { seen.add(c); q.push(c) } }
  return seen
}
