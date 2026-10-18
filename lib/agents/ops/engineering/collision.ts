import ts from 'typescript'
import type { WorkspaceIndex } from './workspaceIndex'

/**
 * Declaration/import collision diagnosis. When a reply declares a name that it also imports (or declares twice), the reply is rejected BEFORE
 * it is written, and the model is shown the actual facts: every import it wrote with the real exports of each module, and each colliding
 * declaration's signature (flagging a declaration that calls its own name: it would recurse forever instead of reaching the import).
 * Nothing is renamed mechanically: a rename that changes which function a call reaches is a semantic decision, so the model makes it, with evidence.
 */
export function collisionFacts(rel: string, text: string, names: string[], idx: WorkspaceIndex): string {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const imports: string[] = []
  const decls: string[] = []
  const names_ = new Set(names)
  const callsSelf = (n: ts.Node, name: string) => { let hit = false; const v = (x: ts.Node) => { if (hit) return; if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === name) { hit = true; return } ts.forEachChild(x, v) }; v(n); return hit }
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      const spec = st.moduleSpecifier.text
      const resolved = Object.values(idx.files).find((f) => spec.startsWith('.') && f.path.replace(/\.m?[jt]sx?$/, '') === spec.replace(/^\.\.?\//, '').replace(/^(\.\.\/)+/, '').replace(/\.m?[jt]sx?$/, '')) ?? Object.values(idx.files).find((f) => spec.startsWith('.') && f.path.endsWith(spec.replace(/^(\.\.?\/)+/, '')))
      const bound = st.importClause.namedBindings.elements.map((e) => e.name.text)
      const clash = bound.filter((n) => names_.has(n))
      imports.push(`  import { ${bound.join(', ')} } from '${spec}'${resolved ? `   // ${resolved.path} really exports: ${resolved.exports.join(', ') || 'nothing'}` : ''}${clash.length ? `   // <- ${clash.join(', ')} collides with a declaration below` : ''}`)
    }
    const nm = ts.isFunctionDeclaration(st) && st.name ? st.name.text : ts.isClassDeclaration(st) && st.name ? st.name.text : null
    if (nm && names_.has(nm)) {
      const header = text.slice(st.getStart(sf), Math.min(st.getEnd(), st.getStart(sf) + 160)).split('\n')[0]
      decls.push(`  ${header}${callsSelf(st, nm) ? `   // <- this body calls ${nm}(...) which resolves to THIS declaration, so it recurses forever; it can never reach the imported ${nm}` : ''}`)
    }
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && names_.has(d.name.text)) decls.push(`  ${text.slice(st.getStart(sf), Math.min(st.getEnd(), st.getStart(sf) + 140)).split('\n')[0]}`)
  }
  return [`Your imports:\n${imports.join('\n') || '  (none)'}`, `Your colliding declarations:\n${decls.join('\n') || '  (none)'}`, `Fix: keep the imported function and give your NEW function a different name (for example a name that says what the new code adds), or import the original under an alias with "as" and call the alias from your new code. Do not declare a name you import.`].join('\n')
}
export const isCollisionProblem = (problem: string) => problem.startsWith('your version declares')
