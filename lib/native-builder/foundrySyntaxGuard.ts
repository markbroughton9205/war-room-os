import ts from 'typescript'

/**
 * `export` and `import` declarations that sit anywhere but a module's top level (or a namespace body). TypeScript's parser accepts them there and only the checker objects, so a
 * statement edit that pastes a whole exported function over one line would otherwise pass as syntactically valid.
 */
function misplacedModuleDeclaration(fileName: string, source: string): { line: number; message: string } | null {
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.jsx$/.test(fileName) ? ts.ScriptKind.JSX : /\.ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, kind)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (found) return
    const exported = ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
    const declaration = exported || ts.isExportDeclaration(node) || ts.isExportAssignment(node) || ts.isImportDeclaration(node)
    if (declaration && !ts.isSourceFile(node.parent) && !ts.isModuleBlock(node.parent)) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!found) return null
  return { line: file.getLineAndCharacterOfPosition(found.getStart(file)).line + 1, message: "'export' and 'import' declarations can only appear at the top level of a module" }
}

/** A parse error in TS/JS source text (null when it parses or the file is not source). Used to refuse an edit that would turn a parseable file into a broken one. */
export function sourceSyntaxProblem(fileName: string, source: string): string | null {
  if (!/\.(?:tsx?|mjs|cjs|jsx?)$/.test(fileName)) return null
  try {
    const result = ts.transpileModule(source, { reportDiagnostics: true, fileName, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    const first = result.diagnostics?.find(item => item.category === ts.DiagnosticCategory.Error)
    if (!first) {
      const misplaced = misplacedModuleDeclaration(fileName, source)
      return misplaced ? `syntax error at line ${misplaced.line}: ${misplaced.message}` : null
    }
    const line = first.file && first.start !== undefined ? first.file.getLineAndCharacterOfPosition(first.start).line + 1 : 0
    return `syntax error${line ? ` at line ${line}` : ''}: ${ts.flattenDiagnosticMessageText(first.messageText, ' ').slice(0, 120)}`
  } catch {
    return null
  }
}
