/**
 * Generic semantic-binding preservation for anchored edits.
 * Bindings are derived from the actual source region AST — never from a
 * production filename, panel, or fixture-specific patch.
 */
import ts from 'typescript'

const INTRINSIC_IDS = new Set([
  'className', 'class', 'key', 'style', 'id', 'type', 'href', 'src', 'alt', 'role',
  'children', 'title', 'name', 'htmlFor', 'tabIndex', 'width', 'height',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'div', 'span', 'p', 'ul', 'li', 'ol', 'button', 'input', 'form', 'section',
  'article', 'label', 'header', 'footer', 'nav', 'main', 'a', 'img',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'td', 'th', 'thead', 'tbody',
  'Fragment', 'React', 'console', 'window', 'document', 'JSON', 'Math', 'Object',
  'Array', 'String', 'Number', 'Boolean', 'Map', 'Set', 'Promise', 'Error',
  'export', 'return', 'function', 'const', 'let', 'var',
])

const RELEASE_INTENT = /\b(remove|drop|delete|unbind|replace the binding|stop using|no longer (use|render)|don't use|do not use)\b/i

function normalizeBinding(text: string): string {
  return text.replace(/\?\./g, '.').replace(/\s+/g, '').trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wrapAttempts(source: string): string[] {
  const trimmed = source.trim()
  return [
    trimmed,
    `const __foundry = (${trimmed});`,
    `const __foundry = (<>${trimmed}</>);`,
    `function __foundry() { return (${trimmed}); }`,
    `function __foundry() { ${trimmed} }`,
  ]
}

function parseDiagnostics(file: ts.SourceFile): number {
  return ((file as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []).length
}

function parseSnippet(source: string): ts.SourceFile {
  let best: ts.SourceFile | null = null
  let bestDiag = Number.POSITIVE_INFINITY
  for (const text of wrapAttempts(source)) {
    const file = ts.createSourceFile('__foundry_anchor.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const diags = parseDiagnostics(file)
    if (diags < bestDiag) {
      best = file
      bestDiag = diags
      if (diags === 0) break
    }
  }
  return best ?? ts.createSourceFile('__foundry_anchor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function inTypeContext(node: ts.Node): boolean {
  let current: ts.Node | undefined = node
  while (current) {
    if (
      ts.isTypeNode(current)
      || ts.isTypeElement(current)
      || ts.isTypeAliasDeclaration(current)
      || ts.isInterfaceDeclaration(current)
      || ts.isTypeLiteralNode(current)
      || ts.isTypeParameterDeclaration(current)
      || ts.isHeritageClause(current)
      || ts.isImportDeclaration(current)
      || ts.isImportSpecifier(current)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function addBinding(set: Set<string>, raw: string): void {
  const text = normalizeBinding(raw)
  if (!text || text.length < 2) return
  if (INTRINSIC_IDS.has(text)) return
  if (/^['"`]/.test(text)) return
  if (/^\d/.test(text)) return
  set.add(text)
}

function collectFromAst(source: string): string[] {
  const file = parseSnippet(source)
  const found = new Set<string>()
  const visit = (node: ts.Node) => {
    if (inTypeContext(node)) {
      ts.forEachChild(node, visit)
      return
    }
    if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) {
      addBinding(found, node.getText(file))
    }
    if (ts.isCallExpression(node)) {
      const expr = node.expression
      if (ts.isIdentifier(expr)) addBinding(found, expr.text)
      else if (ts.isPropertyAccessExpression(expr) || ts.isPropertyAccessChain(expr)) {
        addBinding(found, expr.getText(file))
      }
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file)
      if (/^on[A-Z]/.test(name)) addBinding(found, name)
    }
    if (ts.isIdentifier(node) && node.parent && ts.isJsxExpression(node.parent) && node.parent.expression === node) {
      addBinding(found, node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...found]
}

function collectFromRegex(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(/\b[A-Za-z_$][\w$]*(?:\?\.[A-Za-z_$][\w$]*)+/g)) {
    addBinding(found, match[0])
  }
  for (const match of source.matchAll(/\bon[A-Z][A-Za-z0-9]*/g)) {
    addBinding(found, match[0])
  }
  for (const match of source.matchAll(/\b(handle[A-Z][A-Za-z0-9]*)\b/g)) {
    addBinding(found, match[1] ?? match[0])
  }
  return [...found]
}

export function extractProtectedBindings(source: string): string[] {
  if (!source.trim()) return []
  const fromAst = collectFromAst(source)
  const merged = fromAst.length ? fromAst : collectFromRegex(source)
  return [...new Set(merged)].sort((a, b) => a.localeCompare(b))
}

export function bindingReleasedByRequest(request: string, binding: string): boolean {
  if (!request.trim() || !RELEASE_INTENT.test(request)) return false
  const parts = binding.split('.').filter(Boolean)
  return parts.some(part => new RegExp(`\\b${escapeRegExp(part)}\\b`, 'i').test(request))
}

export function missingProtectedBindings(anchorText: string, replacementText: string, request = ''): string[] {
  const required = extractProtectedBindings(anchorText).filter(item => !bindingReleasedByRequest(request, item))
  return required.filter(item => {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return !new RegExp(`${escaped}(?![A-Za-z0-9_$])`).test(replacementText)
  })
}

export function presentProtectedBindings(anchorText: string, replacementText: string): string[] {
  return extractProtectedBindings(anchorText).filter(item => {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`${escaped}(?![A-Za-z0-9_$])`).test(replacementText)
  })
}

export function siblingDetailBindings(fileText: string, matchText: string): string[] {
  const used = extractProtectedBindings(matchText)
  const extras: string[] = []
  for (const binding of used) {
    const dot = binding.lastIndexOf('.')
    if (dot <= 0) continue
    const object = binding.slice(0, dot)
    const prop = binding.slice(dot + 1)
    if (/Detail$/i.test(prop)) continue
    const detailProp = `${prop}Detail`
    const full = `${object}.${detailProp}`
    const presentInFile = new RegExp(`\\b${escapeRegExp(detailProp)}\\b`).test(fileText)
      || new RegExp(`${escapeRegExp(object)}\\.${escapeRegExp(detailProp)}`).test(fileText)
    if (presentInFile) extras.push(full)
  }
  return [...new Set(extras)]
}

export function availableObjectFields(fileText: string, windowText: string): string[] {
  const used = extractProtectedBindings(windowText)
  const prefixes = [...new Set(used.map(item => item.split('.')[0]).filter(Boolean))]
  const fields = new Set<string>(used)
  for (const prefix of prefixes) {
    for (const match of fileText.matchAll(new RegExp(`\\b${escapeRegExp(prefix)}\\.([A-Za-z_][\\w]*)`, 'g'))) {
      fields.add(`${prefix}.${match[1]}`)
    }
    for (const binding of used) {
      const prop = binding.slice(binding.lastIndexOf('.') + 1)
      if (!prop || /Detail$/i.test(prop)) continue
      const detailProp = `${prop}Detail`
      if (new RegExp(`\\b${escapeRegExp(detailProp)}\\b`).test(fileText)) {
        fields.add(`${prefix}.${detailProp}`)
      }
    }
  }
  return [...fields].sort((a, b) => a.localeCompare(b))
}

export function hasSelectedBinding(text: string, binding: string): boolean {
  const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}(?![A-Za-z0-9_$])`).test(text)
}

export function formatProtectedBindingRefusal(input: {
  missing: string[]
  present: string[]
  reason: string
  anchorId?: string
  required?: string[]
}): string {
  const required = input.required ?? [...new Set([...input.present, ...input.missing])]
  return [
    'ERROR = INVALID_REPLACEMENT',
    `MISSING_PROTECTED_BINDINGS = [${input.missing.join(', ')}]`,
    `PRESENT_PROTECTED_BINDINGS = [${input.present.join(', ')}]`,
    `CURRENT_REQUIRED_BINDINGS = [${required.join(', ')}]`,
    'EXPECTED_NEXT_ACTION = BOUNDED_RETRY',
    `INVALID_REASON = ${input.reason}`,
    `ANCHOR_ID = ${input.anchorId ?? 'none'}`,
    `MISSING_BINDINGS = [${input.missing.join(', ')}]`,
    'NEXT_ACTION = file.replace_unique',
  ].join('\n')
}
