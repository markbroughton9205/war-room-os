// Execute the actual pure grouping function from the page without mounting its unrelated UI.
// This is behavioral grouping coverage, not browser or persistence-service proof.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'councilOperationGroupKey')
assert.ok(declaration, 'Production grouping function must exist')
const compiled = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { councilOperationGroupKey: group } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const old = { id: 'old-decree', messageType: 'decree', roundRequestId: 'old-round' }
const current = { id: 'new-decree', messageType: 'decree', roundRequestId: 'new-round' }
const late = { id: 'late-response', messageType: 'response', councilProgress: { logicalRequestId: 'old-round' } }
assert.equal(group(late, [old, current, late]), 'turn:old-decree')
const restored = { id: 'restored-response', messageType: 'response', roundRequestId: 'old-round' }
assert.equal(group(restored, [old, current, restored]), 'turn:old-decree')
assert.equal(group(restored, [current, restored]), 'orphan:restored-response')
const f2f = { ...late, familyDeliberationTurn: { session_id: 'shared-session' } }
assert.equal(group(f2f, [old, current, f2f]), 'deliberation:shared-session:turn:old-decree')
const newReply = { ...f2f, id: 'new-response', councilProgress: { logicalRequestId: 'new-round' } }
assert.notEqual(group(f2f, [old, current, f2f, newReply]), group(newReply, [old, current, f2f, newReply]))
console.log('Council round pairing: 5/5 PASS (late response, restored identity, orphan isolation, family identity, same-session distinct rounds)')
