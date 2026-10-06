import assert from 'node:assert/strict'
import { localDecisionSchemaForTools, FOUNDRY_LOCAL_DECISION_SCHEMA } from './foundryLocalModelRuntime'
const before = JSON.stringify(FOUNDRY_LOCAL_DECISION_SCHEMA)
const restricted = localDecisionSchemaForTools([{ name: 'file.read' }, { name: 'file.read' }, { name: 'lint.run' }])
assert.deepEqual(('tool' in restricted.properties ? restricted.properties.tool.anyOf.map(tool => tool.properties.name.enum[0]) : []), ['file.read', 'lint.run'])
const none = localDecisionSchemaForTools([])
assert.deepEqual(none.properties.decision.enum, ['REPLAN', 'COMPLETE', 'BLOCKED'])
assert.equal('tool' in none.properties, false)
assert.equal(none.additionalProperties, false)
assert.equal(FOUNDRY_LOCAL_DECISION_SCHEMA.properties.tool.properties.args.additionalProperties, true, 'local grammar must allow the catalog arguments inside tool.args; broker validates them')
assert.equal(FOUNDRY_LOCAL_DECISION_SCHEMA.properties.blocker.minLength, 1, 'empty blockers cannot satisfy decision contract')
assert.equal(JSON.stringify(FOUNDRY_LOCAL_DECISION_SCHEMA), before, 'per-turn schema must not mutate the shared catalog')
console.log('PASS local decoding excludes unexposed tools and TOOL decisions for empty catalogs without mutating shared schema')

const real = localDecisionSchemaForTools([{ name: 'code.owners', args: { query: 'string' }, required: ['query'] }, { name: 'terminal.execute', args: { operation: 'object' }, required: ['operation'] }])
assert.equal('tool' in real.properties, true)
if ('tool' in real.properties) {
 const owner = real.properties.tool.anyOf[0]
 assert.deepEqual(owner.properties.args.required, ['query'])
 assert.deepEqual(owner.properties.args.properties?.query, { type: 'string' })
 assert.equal(owner.properties.args.additionalProperties, false)
 const operation = real.properties.tool.anyOf[1].properties.args.properties?.operation as { required: string[]; properties: Record<string, unknown> }
 assert.deepEqual(operation.required, ['id'])
 assert.ok(operation.properties.targets)
}
console.log('PASS per-tool decoder branches require catalog arguments and typed operation objects')
