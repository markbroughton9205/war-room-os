/** Reliability regressions for direct application builds; not Phase 7 application acceptance. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer as createHttpServer } from 'node:http'
import { runWithWorkspaceRoot } from '../repo/workspaceContext'
import { buildRepoMap } from './repoMap'
import { executeFoundryAction, parseFoundryActions } from './foundryActions'
import { captureApplicationCheckpoint, restoreApplicationCheckpoint } from './foundryApplicationCheckpoint'
import { applicationAcceptanceLedgerComplete, deriveApplicationMission, hasApplicationAcceptanceLedger, initialApplicationBuildState } from './foundryApplicationMission'
import { isExplicitDirectApplicationRequest } from './foundryApplicationMission'
import { applicationContractTestDefects, applicationSourceDefects, applicationSourceSnapshot, applicationTestDefects, applicationValidationPreflightDefects, preferredMissingWebSourcePath, prioritizeApplicationSourceRepair } from './foundryApplicationReview'
import { normalizeCliAcceptancePlan } from './foundryApplicationCliVerification'
import { webAcceptancePlanDefects, webEvidenceKinds } from './foundryApplicationWebVerification'
import { apiJsonPointer, apiPlanContractDefects, apiVerificationEnvironment, bindApiPlanCriteria, normalizeApiCountMapAssertions, normalizeApiDomainErrorAssertions, normalizeApiMalformedBodies } from './foundryApplicationApiVerification'
import { requestOllamaStreamingCompletion } from './ollamaClient'
import { extractJsonObject, recoverWhitespaceTruncatedAppendJson } from './localCoder'
import { apiRuntimeRepairGuidance, applicationFailureSignature, applicationTestRepairMode, existingImportBindings, existingTopLevelBindings, focusedApplicationDependencyContext, focusedApplicationSourceActionSchema, focusedApplicationTestActionSchema, isDuplicateFailureLoop, sourceActionFailureSignature, sourceMutationWouldChange } from './foundryLoop'

async function isolated(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'foundry-application-reliability-'))
  try { await runWithWorkspaceRoot(root, () => run(root)) } finally { await rm(root, { recursive: true, force: true }) }
}

test('explicit real existing application work routes to direct application execution', () => {
  assert.equal(isExplicitDirectApplicationRequest('Extend this real existing persistent notes API with tags'), true)
  assert.equal(isExplicitDirectApplicationRequest('Diagnose and repair this genuine failed existing persistent notes API candidate.'), true)
  assert.equal(isExplicitDirectApplicationRequest('Fix a failing unit test in this repository'), false)
})

test('partial independent API evidence activates destructive-repair checkpoint protection', () => {
  const state = initialApplicationBuildState({ missionId: 'm', commanderGoal: 'api', projectType: 'api', existingOrGreenfield: 'existing', runtime: 'node', packageManager: 'none', language: 'JavaScript', entrypoints: [], acceptanceCriteria: ['api'], requiredFeatures: [], persistenceRequirements: [], runtimeRequirements: ['api'], testRequirements: [], verificationRequirements: [], forbiddenActions: [] })
  assert.equal(hasApplicationAcceptanceLedger(state), false)
  state.apiAcceptanceLedger = { sourceDigest: 'a', passedSteps: ['create'], failedSteps: ['update'], evidenceRef: 'receipt.json' }
  assert.equal(hasApplicationAcceptanceLedger(state), true)
  assert.equal(applicationAcceptanceLedgerComplete(state.apiAcceptanceLedger), false)
  state.apiAcceptanceLedger.failedSteps = []
  assert.equal(applicationAcceptanceLedgerComplete(state.apiAcceptanceLedger), true)
  assert.equal(applicationAcceptanceLedgerComplete(state.apiAcceptanceLedger, 'a'), true)
  assert.equal(applicationAcceptanceLedgerComplete(state.apiAcceptanceLedger, 'stale'), false)
})

test('destructive regression history survives unrelated source-progress resets', () => {
  const regressions: string[] = []
  const ordinaryFailures: string[] = ['old-source-error']
  const signature = 'destructive-test-regression:node_test:5/10'
  assert.equal(isDuplicateFailureLoop(regressions, signature, 2), false)
  regressions.push(signature)
  ordinaryFailures.length = 0
  assert.equal(isDuplicateFailureLoop(regressions, signature, 2), true)
})

test('application failure signatures ignore nondeterministic test durations and workspace paths', () => {
  const result = (stdout: string) => [{ operation: { id: 'node_test' as const }, ok: false, exitCode: 1, stdout, stderr: '', durationMs: 1, ranAt: '', timedOut: false }]
  const first = applicationFailureSignature(result('✖ GET /health (5066.068337ms)\nError at /tmp/run-a/test.mjs:40'))
  const second = applicationFailureSignature(result('✖ GET /health (4999.120001ms)\nError at /tmp/run-b/test.mjs:40'))
  assert.equal(first, second)
})

test('serialized application batches skip duplicate creates and choose material edits', () => {
  const sources = [{ file: 'tags.mjs', text: 'export const tag = 1\n' }, { file: 'server.mjs', text: 'const ready = false\n' }]
  assert.equal(sourceMutationWouldChange({ type: 'CREATE_FILE', path: 'tags.mjs', content: 'duplicate' }, sources), false)
  assert.equal(sourceMutationWouldChange({ type: 'PATCH_FILE', path: 'server.mjs', matchText: 'false', replacementText: 'true' }, sources), true)
})

test('product source rejects local named imports absent from the target module', () => {
  const defects = applicationSourceDefects([
    { file: 'server.mjs', role: 'source', text: `import { normalizeTags } from './tags.mjs'; normalizeTags([])` },
    { file: 'tags.mjs', role: 'source', text: `export function normalizeTag(tag) { return tag }` },
  ], 'api')
  assert.ok(defects.some(defect => /imports normalizeTags.*does not export/.test(defect)))
  const missing = applicationSourceDefects([
    { file: 'server.mjs', role: 'source', text: `import { normalizeTag } from './tag.js'; normalizeTag('A')` },
    { file: 'tags.mjs', role: 'source', text: `export function normalizeTag(tag) { return tag }` },
  ], 'api')
  assert.ok(missing.some(defect => /imports missing local module \.\/tag\.js/.test(defect)))
})

test('existing API recovery preserves explicit module integration and route-level test obligations', () => {
  const goal = 'Repair the integration mismatch between the server and its separate tag module. Strengthen real HTTP integration tests for GET /notes?tag=<tag>, GET /tags, and invalid tag input.'
  const missing = applicationSourceDefects([
    { file: 'server.mjs', role: 'source', text: `const normalizeTag = value => value.trim().toLowerCase()` },
    { file: 'tags.mjs', role: 'source', text: `export const normalizeTag = value => value.trim().toLowerCase()` },
    { file: 'test.mjs', role: 'test', text: `test('health', () => fetch('/health'))` },
  ], 'api', goal)
  assert.ok(missing.some(defect => /no product source imports a local module/.test(defect)))
  const missingTests = applicationContractTestDefects([
    { file: 'test.mjs', role: 'test', text: `test('health', () => fetch('/health'))` },
  ], 'api', goal)
  assert.ok(missingTests.some(defect => /\/notes\?tag=<tag>/.test(defect)))
  assert.ok(missingTests.some(defect => /\/tags/.test(defect)))
  assert.ok(missingTests.some(defect => /invalid tag input/.test(defect)))
  const complete = applicationSourceDefects([
    { file: 'server.mjs', role: 'source', text: `import { normalizeTag } from './tags.mjs'; normalizeTag('Tag')` },
    { file: 'tags.mjs', role: 'source', text: `export const normalizeTag = value => value.trim().toLowerCase()` },
    { file: 'test.mjs', role: 'test', text: `test('tag filter and invalid tag', () => { fetch('/notes?tag=tag'); fetch('/tags') })` },
  ], 'api', goal)
  assert.equal(complete.filter(defect => /separate product module/.test(defect)).length, 0)
  assert.equal(applicationContractTestDefects([
    { file: 'test.mjs', role: 'test', text: `test('tag filter and invalid tag', () => { fetch('/notes?tag=tag'); fetch('/tags') })` },
  ], 'api', goal).length, 0)
})

test('API acceptance rejects generic CRUD that omits explicit tag behavior', () => {
  const criteria = ['Normalized tags, GET /notes?tag=<tag> filtering, GET /tags persisted counts, and invalid tag handling.']
  const generic = { entrypoint: 'server.mjs', healthPath: '/health', criteria, steps: [
    { name: 'create', action: 'request' as const, method: 'POST', path: '/notes', body: { title: 'A', tags: ['tag'] }, status: 201, jsonChecks: [{ pointer: '/tags', equals: ['tag'] }] },
  ] }
  const defects = apiPlanContractDefects(generic, criteria)
  assert.ok(defects.some(defect => /explicit Commander route \/notes\?tag=<tag>/.test(defect)))
  assert.ok(defects.some(defect => /explicit Commander route \/tags/.test(defect)))
  assert.ok(defects.some(defect => /invalid-tag/.test(defect)))
  assert.ok(defects.some(defect => /normalization/.test(defect)))
})

test('focused product repair schema pins replacement to the reviewed source path', () => {
  const schema = focusedApplicationSourceActionSchema('server.mjs') as any
  assert.equal(schema.properties.actions.items.properties.path.const, 'server.mjs')
  assert.equal(schema.properties.actions.maxItems, 1)
})

test('focused product repair includes authoritative source for a broken local named import', () => {
  const sources = [
    { file: 'server.mjs', role: 'source', text: `import { normalizeTags } from './tags.mjs'` },
    { file: 'tags.mjs', role: 'source', text: `export const normalizeTag = value => value.trim().toLowerCase()` },
    { file: 'test.mjs', role: 'test', text: 'test()' },
  ]
  const context = focusedApplicationDependencyContext('server.mjs', sources, [
    'Product source server.mjs imports normalizeTags from tags.mjs, but that local module does not export it.',
  ])
  assert.match(context, /DEPENDENCY FILE tags\.mjs/)
  assert.match(context, /export const normalizeTag/)
  assert.doesNotMatch(context, /test\.mjs/)
  const missingContext = focusedApplicationDependencyContext('server.mjs', sources, [
    `Product source server.mjs imports missing local module ./tag.js. Use the exact path of an existing product module and its actual exported names.`,
  ])
  assert.match(missingContext, /DEPENDENCY FILE tags\.mjs/)
  assert.match(missingContext, /normalizeTag/)
})

test('failed real API observations become concrete domain-validation and collection repair guidance', () => {
  const guidance = apiRuntimeRepairGuidance(JSON.stringify([
    { path: '/notes', status: 400, expectedStatus: 400, checks: [{ equals: 'Tags must be non-empty strings', actual: 'Malformed JSON' }] },
    { path: '/notes?tag=missing', status: 404, expectedStatus: 200, checks: [{ equals: [] }] },
  ]))
  assert.match(guidance, /validate every supplied collection element/)
  assert.match(guidance, /HTTP 200 and an empty JSON array/)
})

test('local model timeout remains armed while a response stream is stalled', async () => {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/x-ndjson' })
    response.write('{"response":"partial","done":false}\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const previous = process.env.OLLAMA_BASE_URL
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${address.port}`
  try {
    const started = Date.now()
    const result = await requestOllamaStreamingCompletion({ model: 'test', prompt: 'stall', timeoutMs: 50 })
    assert.equal(result.ok, false)
    assert.ok(Date.now() - started < 2000)
  } finally {
    if (previous === undefined) delete process.env.OLLAMA_BASE_URL
    else process.env.OLLAMA_BASE_URL = previous
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('API structural repair uses bounded patches while web keeps coherent replacement', () => {
  assert.equal(applicationTestRepairMode('api'), 'incremental-patch')
  assert.equal(applicationTestRepairMode('web'), 'whole-file-replacement')
})

test('focused test repair schema permits one bounded mutation on the current test path', () => {
  const schema = focusedApplicationTestActionSchema('server.test.mjs') as any
  assert.equal(schema.properties.actions.maxItems, 1)
  const variants = schema.properties.actions.items.anyOf
  assert.deepEqual(variants.map((item: any) => item.properties.type.const), ['PATCH_FILE', 'APPEND_FILE'])
  assert.equal(variants[0].properties.path.const, 'server.test.mjs')
  assert.equal(variants[1].properties.content.maxLength, 5000)
  assert.equal(variants[1].properties.content.pattern, '^test\\([\\s\\S]*\\}\\);$')
})

test('whitespace-only truncation after a complete append block recovers the structured action', () => {
  const raw = '{"summary":"add restart","actions":[{"type":"APPEND_FILE","path":"server.test.mjs","content":"test(\\"restart\\", async () => {\\n  assert.equal(1, 1)\\n});\\n\\n\\n'
  const recovered = recoverWhitespaceTruncatedAppendJson(raw) as any
  assert.equal(recovered.actions[0].type, 'APPEND_FILE')
  assert.match(recovered.actions[0].content, /test\("restart"/)
  assert.deepEqual(extractJsonObject(raw), recovered)
})

test('truncated append recovery keeps only the first requested registered test block', () => {
  const raw = '{"summary":"bounded","actions":[{"type":"APPEND_FILE","path":"server.test.mjs","content":"test(\\"one\\", () => {\\n  assert.equal(1, 1)\\n});\\nimport fs from \\"node:fs\\"'
  const recovered = recoverWhitespaceTruncatedAppendJson(raw) as any
  assert.match(recovered.actions[0].content, /test\("one"/)
  assert.doesNotMatch(recovered.actions[0].content, /import fs/)
})

test('truncated append recovery rejects content without a complete registered test block', () => {
  const raw = '{"summary":"bad","actions":[{"type":"APPEND_FILE","path":"server.test.mjs","content":"test(\\"one\\", () => {\\n  assert.equal(1, 1)'
  assert.equal(recoverWhitespaceTruncatedAppendJson(raw), null)
})

test('source-action failure signatures ignore randomized syntax-preflight directories', () => {
  const first = sourceActionFailureSignature('PATCH_FILE', 'SOURCE_SYNTAX_REJECTED: /tmp/foundry-source-preflight-Ab12/test.mjs:17 Identifier already declared')
  const second = sourceActionFailureSignature('PATCH_FILE', 'SOURCE_SYNTAX_REJECTED: /tmp/foundry-source-preflight-Zx99/test.mjs:17 Identifier already declared')
  assert.equal(first, second)
})


test('focused repairs receive every already-bound ESM import name', () => {
  const source = `import assert from 'node:assert/strict'
import { dirname, join as pathJoin } from 'node:path'
import * as fs from 'node:fs'`
  assert.deepEqual(existingImportBindings(source), ['assert', 'dirname', 'fs', 'pathJoin'])
})

test('focused repairs receive existing top-level declarations as protected names', () => {
  const source = `import assert from 'node:assert/strict'
const serverFile = 'server.mjs'
let child
function reservePort() {}
class Harness {}`
  assert.deepEqual(existingTopLevelBindings(source), ['Harness', 'assert', 'child', 'reservePort', 'serverFile'])
})

test('malformed JavaScript is rejected before it can replace working source', async () => isolated(async root => {
  const file = path.join(root, 'cli.mjs')
  await writeFile(file, 'console.log("working")\n')
  const result = await executeFoundryAction({ type: 'PATCH_FILE', path: 'cli.mjs', matchText: 'console.log("working")', replacementText: 'const broken =', reason: 'candidate repair' }, { repairId: 'syntax-preflight' })
  assert.equal(result.ok, false)
  assert.match(result.detail, /SOURCE_SYNTAX_REJECTED/)
  assert.equal(await readFile(file, 'utf8'), 'console.log("working")\n')
}))

test('identical patch anchors and replacements are rejected as no-op model churn', async () => isolated(async root => {
  await writeFile(path.join(root, 'test.mjs'), "import { assert } from 'node:assert/strict'\n")
  const result = await executeFoundryAction({ type: 'PATCH_FILE', path: 'test.mjs', matchText: "import { assert } from 'node:assert/strict'", replacementText: "import { assert } from 'node:assert/strict'", reason: 'fix assertion import' }, { repairId: 'no-op-patch' })
  assert.equal(result.ok, false)
  assert.match(result.detail, /PATCH_FILE_NO_OP/)
}))

test('patch execution preserves source outside the exact edit even when model reads are compact', async () => isolated(async root => {
  const prefix = Array.from({ length: 900 }, (_, index) => `export const value${index} = ${index}`).join('\n')
  const original = `${prefix}\nexport const target = 'before'\nexport const tail = 'preserved'\n`
  await writeFile(path.join(root, 'large.mjs'), original)
  const result = await executeFoundryAction({ type: 'PATCH_FILE', path: 'large.mjs', matchText: "export const target = 'before'", replacementText: "export const target = 'after'", reason: 'bounded exact edit' }, { repairId: 'full-file-patch' })
  assert.equal(result.ok, true, result.detail)
  const current = await readFile(path.join(root, 'large.mjs'), 'utf8')
  assert.equal(current, original.replace("export const target = 'before'", "export const target = 'after'"))
  assert.match(current, /export const value899 = 899/)
  assert.match(current, /export const tail = 'preserved'/)
}))


test('guarded append adds a complete test block without rewriting accepted tests', async () => isolated(async root => {
  const original = `import test from 'node:test'
test('one', () => {})
`
  await writeFile(path.join(root, 'test.mjs'), original)
  const appended = `test('two', () => {
  if (1 !== 1) throw new Error('broken')
})`
  const result = await executeFoundryAction({ type: 'APPEND_FILE', path: 'test.mjs', content: appended, reason: 'add missing acceptance case' }, { repairId: 'append-test' })
  assert.equal(result.ok, true, result.detail)
  assert.equal(await readFile(path.join(root, 'test.mjs'), 'utf8'), `${original}
${appended}
`)
  const rejected = await executeFoundryAction({ type: 'APPEND_FILE', path: 'test.mjs', content: `test('bad', () => {`, reason: 'invalid append' }, { repairId: 'append-test' })
  assert.equal(rejected.ok, false)
  assert.match(rejected.detail, /SOURCE_SYNTAX_REJECTED/)
  const duplicate = await executeFoundryAction({ type: 'APPEND_FILE', path: 'test.mjs', content: appended, reason: 'duplicate retry' }, { repairId: 'append-test' })
  assert.equal(duplicate.ok, false)
  assert.match(duplicate.detail, /DUPLICATE_TEST_CASE/)
}))

test('guarded whole-file replacement requires an existing file, a reason, and syntax-valid complete source', async () => isolated(async root => {
  const invalid = parseFoundryActions({ actions: [{ type: 'REPLACE_FILE', path: 'cli.mjs', content: 'console.log("next")\n' }] })
  assert.equal(invalid.ok, false)
  const missing = await executeFoundryAction({ type: 'REPLACE_FILE', path: 'missing.mjs', content: 'console.log("next")\n', reason: 'structural repair' }, { repairId: 'replace-file' })
  assert.equal(missing.ok, false)
  await writeFile(path.join(root, 'cli.mjs'), 'console.log("working")\n')
  const malformed = await executeFoundryAction({ type: 'REPLACE_FILE', path: 'cli.mjs', content: 'const broken =', reason: 'structural repair' }, { repairId: 'replace-file' })
  assert.equal(malformed.ok, false)
  assert.equal(await readFile(path.join(root, 'cli.mjs'), 'utf8'), 'console.log("working")\n')
  const replaced = await executeFoundryAction({ type: 'REPLACE_FILE', path: 'cli.mjs', content: 'console.log("next")\n', reason: 'structural repair' }, { repairId: 'replace-file' })
  assert.equal(replaced.ok, true, replaced.detail)
  assert.equal(await readFile(path.join(root, 'cli.mjs'), 'utf8'), 'console.log("next")\n')
}))

test('whole-file replacement cannot change product source into a test suite', async () => isolated(async root => {
  await writeFile(path.join(root, 'cli.mjs'), 'console.log("product")\n')
  const result = await executeFoundryAction({ type: 'REPLACE_FILE', path: 'cli.mjs', content: 'import test from "node:test"\ntest("fake product", () => {})\n', reason: 'mistaken test repair' }, { repairId: 'source-role' })
  assert.equal(result.ok, false)
  assert.match(result.detail, /SOURCE_ROLE_REJECTED/)
  assert.equal(await readFile(path.join(root, 'cli.mjs'), 'utf8'), 'console.log("product")\n')
}))

test('a product path cannot be created with node:test code', async () => isolated(async root => {
  const result = await executeFoundryAction({ type: 'CREATE_FILE', path: 'cli.mjs', content: 'import test from "node:test"\ntest("fake product", () => {})\n', reason: 'mistaken product source' }, { repairId: 'create-source-role' })
  assert.equal(result.ok, false)
  assert.match(result.detail, /SOURCE_ROLE_REJECTED/)
  await assert.rejects(readFile(path.join(root, 'cli.mjs'), 'utf8'))
}))

test('CREATE_FILE supports a new bounded nested source directory', async () => isolated(async root => {
  const result = await executeFoundryAction({ type: 'CREATE_FILE', path: 'public/index.html', content: '<!doctype html><title>Direct</title>\n', reason: 'real application document' }, { repairId: 'nested-create' })
  assert.equal(result.ok, true, result.detail)
  assert.equal(await readFile(path.join(root, 'public/index.html'), 'utf8'), '<!doctype html><title>Direct</title>\n')
}))

test('serialized web mutations prioritize missing product roles before another server rewrite', () => {
  const serverOnly = [{ file: 'server.mjs', role: 'source' as const, text: 'createServer(() => {})' }]
  const candidates = [
    { path: 'server.mjs', content: 'replacement server' },
    { path: 'index.html', content: '<!doctype html><h1>Focus Board</h1>' },
    { path: 'styles.css', content: 'body{}' },
  ]
  assert.equal(preferredMissingWebSourcePath(serverOnly, candidates), 'index.html')
  const withDocument = [...serverOnly, { file: 'index.html', role: 'source' as const, text: '<!doctype html>' }]
  assert.equal(preferredMissingWebSourcePath(withDocument, candidates), 'styles.css')
})

test('exported helpers without registered tests fail the application test gate', () => {
  const defects = applicationTestDefects([{ file: 'test.mjs', role: 'test', text: 'export function check() { expect(1).toBe(1) }' }], 'node')
  assert.ok(defects.some(defect => /do not register executable tests/.test(defect)))
})

test('placeholder document assertions are rejected before they can drive product regressions', () => {
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text: `import test from 'node:test'; import assert from 'node:assert/strict'; test('document', async()=>{assert.match(await response.text(), /Identifying Body Content/); // Adjust the regex to match the actual content})` }], 'node', 'web')
  assert.ok(defects.some(defect => /placeholder expected value/.test(defect)))
})

test('a descriptive test name does not make a concrete product assertion a placeholder', () => {
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text: `import test from 'node:test'; import assert from 'node:assert/strict'; test('document has identifying body content', async()=>{const response={text:async()=>'<h1>Personal Focus Board</h1>'};assert.match(await response.text(), /Personal Focus Board/)})` }], 'node', 'web')
  assert.ok(!defects.some(defect => /placeholder expected value/.test(defect)))
})

test('CLI tests that change the shared test-runner cwd fail the application test gate', () => {
  const defects = applicationTestDefects([{ file: 'cli.test.mjs', role: 'test', text: 'import test from "node:test"\nimport assert from "node:assert/strict"\ntest("works", () => { process.chdir("/tmp/shared"); assert.ok(true) })' }], 'node')
  assert.ok(defects.some(defect => /never use process\.chdir/.test(defect)))
})

test('CLI tests cannot import assertions from node:test or call an imported chdir', () => {
  const text = 'import { test, assert } from "node:test"\nimport { chdir } from "node:process"\nimport { mkdtempSync } from "node:fs"\nimport { spawnSync } from "node:child_process"\ntest("works", () => { const cwd = mkdtempSync("/tmp/app-"); spawnSync(process.execPath, ["cli.mjs"], { cwd }); chdir(cwd); assert.ok(true) })'
  const defects = applicationTestDefects([{ file: 'cli.test.mjs', role: 'test', text }], 'node', 'cli')
  assert.ok(defects.some(defect => /assertion helpers from node:test/.test(defect)))
})

test('CLI tests must use real spawnSync status and discover generated identifiers', () => {
  const text = 'import test from "node:test"\nimport assert from "node:assert/strict"\nimport { spawnSync } from "node:child_process"\nimport { mkdtempSync } from "node:fs"\nimport { join } from "node:path"\nimport { tmpdir } from "node:os"\ntest("works", () => { const cwd = mkdtempSync(join(tmpdir(), "app-")); const result = spawnSync(process.execPath, ["cli.mjs", "finish", "1695964800000"], { cwd }); assert.equal(result.exitCode, 0) })'
  const defects = applicationTestDefects([{ file: 'cli.test.mjs', role: 'test', text }], 'node', 'cli')
  assert.ok(defects.some(defect => /exitCode from spawnSync/.test(defect)))
  const statusFixed = text.replace('result.exitCode', 'result.status')
  const idDefects = applicationTestDefects([{ file: 'cli.test.mjs', role: 'test', text: statusFixed }], 'node', 'cli')
  assert.ok(idDefects.some(defect => /hard-code a generated identifier/.test(defect)))
})

test('CLI tests keep temporary persistence outside the reviewed source workspace', () => {
  const text = 'import test from "node:test"\nimport assert from "node:assert/strict"\nimport { spawnSync } from "node:child_process"\nimport { mkdtempSync } from "node:fs"\ntest("works", () => { const cwd = mkdtempSync("app-"); const result = spawnSync(process.execPath, ["cli.mjs"], { cwd }); assert.equal(result.status, 0) })'
  const defects = applicationTestDefects([{ file: 'cli.test.mjs', role: 'test', text }], 'node', 'cli')
  assert.ok(defects.some(defect => /relative temporary directories/.test(defect)))
})

test('CLI test cases cannot share one top-level temporary persistence directory', () => {
  const text = 'import test from "node:test"\nimport assert from "node:assert/strict"\nconst tempDir = await fs.mkdtemp("/tmp/app-")\ntest("one", () => assert.ok(tempDir))\ntest("two", () => assert.ok(tempDir))'
  const defects = applicationTestDefects([{ file: 'cli.test.mjs', role: 'test', text }], 'node')
  assert.ok(defects.some(defect => /share one top-level temporary data directory/.test(defect)))
})

test('CLI tests must use the real executable and temporary working directories', () => {
  const text = 'import test from "node:test"\nimport assert from "node:assert/strict"\ntest("one", () => assert.ok(true))'
  const defects = applicationTestDefects([{ file: 'cli.test.mjs', role: 'test', text }], 'node', 'cli')
  assert.ok(defects.some(defect => /real entrypoint|temporary working directories/.test(defect)))
})

test('CLI product source cannot hide persistence in a shared temp path or execute child processes', () => {
  const text = 'import { spawnSync } from "node:child_process"\nimport { tmpdir } from "node:os"\nconst data = tmpdir()\nconst args = process.argv.slice(2)\nconst command = args[1]\nfunction parseArgs(args) { const command = args[1] }\nparseArgs(process.argv)\n'
  const defects = applicationSourceDefects([{ file: 'cli.mjs', role: 'source', text }], 'cli')
  assert.equal(defects.length, 4)
})

test('CLI product validates raw identifiers before numeric conversion', () => {
  const text = 'function finishBook(id) {}\nconst args = process.argv\nfinishBook(parseInt(args[3]))\n'
  const defects = applicationSourceDefects([{ file: 'cli.mjs', role: 'source', text }], 'cli')
  assert.ok(defects.some(defect => /parses an identifier before/.test(defect)))
})

test('web tests must await port reservation, readiness, and owned child shutdown', () => {
  const broken = `import test, { after } from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
let port = 3000
const reservation = createServer()
reservation.listen(0, '127.0.0.1', () => { port = reservation.address().port; reservation.close() })
const child = spawn(process.execPath, ['server.mjs'], { env: { PORT: String(port) } })
const output = child.stdout.toString()
after(() => child.kill('SIGINT'))
test('stop server', async () => { await fetch('http://127.0.0.1:' + port + '/health'); child.kill('SIGINT') })`
  const defects = applicationTestDefects([{ file: 'test.mjs', role: 'test', text: broken }], 'node', 'web')
  assert.ok(defects.some(defect => /await a complete ephemeral-port reservation/.test(defect)))
  assert.ok(defects.some(defect => /asynchronous ChildProcess/.test(defect)))
  assert.ok(defects.some(defect => /wait for the spawned server/.test(defect)))
  assert.ok(defects.some(defect => /terminate the shared server inside a test case/.test(defect)))
  assert.ok(defects.some(defect => /clean owned-process shutdown/.test(defect)))
})

test('API tests require real CRUD, dynamic lifecycle, and negative HTTP behavior', () => {
  const text = `import { test } from 'node:test'; test('health',async()=>{const response=await fetch('/health');assert.equal(response.status,200)})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /spawn the real server/.test(defect)))
  assert.ok(defects.some(defect => /dynamic loopback port/.test(defect)))
  assert.ok(defects.some(defect => /create and update/.test(defect)))
  assert.ok(defects.some(defect => /invalid-ID/.test(defect)))
})

test('API tests reject nonexistent fetch imports and source-adjacent restart data', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { fetch } from 'node:http'; import { spawn } from 'node:child_process'; test('api', async()=>{spawn(process.execPath,['server.mjs']); const response=await fetch('/notes',{method:'POST'}); await fetch('/notes/1',{method:'PATCH'}); assert.equal(response.status,400); assert.equal(response.status,404)}); before(()=>{}); after(()=>{})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /nonexistent Node built-in export/.test(defect)))
  assert.ok(defects.some(defect => /temporary data directory/.test(defect)))
  assert.ok(defects.some(defect => /real owned server restart/.test(defect)))
})


test('API tests allow node:http createServer with global fetch', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { createServer } from 'node:http'; const fetch=globalThis.fetch; before(()=>{}); after(()=>{}); test('health',async()=>{const response=await fetch('/health'); assert.equal(response.status,200)})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(!defects.some(defect => /nonexistent Node built-in export/.test(defect)))
})

test('API tests recognize real HTTP verbs passed through one fetch helper', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; async function request(path, method){ return fetch(path,{method}) } before(()=>{}); after(()=>{}); test('crud',async()=>{await request('/notes','POST'); await request('/notes/1','PATCH'); assert.ok(true)})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(!defects.some(defect => /real create and update/.test(defect)))
})

test('API tests reject dynamic imports of nonexistent node fetch', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; before(()=>{}); after(()=>{}); test('api',async()=>{const {fetch}=await import('node:fetch'); assert.ok(fetch)})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /nonexistent Node built-in export/.test(defect)))
})


test('API tests may pass isolated persistence through DATA_PATH', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { mkdtemp } from 'node:fs/promises'; import { tmpdir } from 'node:os'; let child; before(async()=>{const root=await mkdtemp(tmpdir()); child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_PATH:root+'/notes.json'}})}); after(()=>{}); test('api',()=>assert.ok(child))`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(!defects.some(defect => /temporary data directory/.test(defect)))
})


test('API tests reject duplicate startup and cleanup ownership hooks', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; before(()=>{}); before(()=>{}); after(()=>{}); after(()=>{}); test('api',()=>assert.ok(true))`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /exactly one before/.test(defect)))
  assert.ok(defects.some(defect => /exactly one after/.test(defect)))
  assert.ok(!defects.some(defect => /bounded graceful-shutdown hooks/.test(defect)))
})

test('API tests reject cleanup state scoped only inside before', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; before(async()=>{const tempDir=await mkdtemp(tmpdir()); child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_FILE:tempDir+'/data.json'}})}); after(async()=>{const exited=once(child,'exit'); child.kill('SIGTERM'); await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),10))]); await rm(tempDir,{recursive:true})}); test('api',()=>assert.ok(true))`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /tempDir outside the before/.test(defect)))
})

test('API tests reject reassigned const persistence paths and leaked temporary directories', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
const dataFilePath='./data.json';
before(async()=>{const tempDir=await mkdtemp(tmpdir()); dataFilePath=join(tempDir,'data.json'); child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_FILE:dataFilePath}})}); after(async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),10))])}); test('api',()=>assert.ok(true))`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /top-level const/.test(defect)))
  assert.ok(defects.some(defect => /never remove/.test(defect)))
})

test('API restart proof rejects order-dependent data[0] assertions', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; before(()=>{}); after(()=>{}); test('restart retains data',async()=>{child=spawn(process.execPath,['server.mjs'],{env:{DATA_FILE:dataFile}}); child.kill('SIGTERM'); child=spawn(process.execPath,['server.mjs'],{env:{DATA_FILE:dataFile}}); const data=await (await fetch('/notes')).json(); assert.equal(data[0].title,'Test Note')})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /data\[0\]/.test(defect)))
})

test('bounded patches reject copied existing top-level helpers outside the match', async () => isolated(async root => {
  const original = `const entry='server.mjs'\nasync function reservePort() { return 1 }\ntest('health',()=>{})\n`
  await writeFile(path.join(root, 'test.mjs'), original)
  const result = await executeFoundryAction({ type: 'PATCH_FILE', path: 'test.mjs', matchText: `const entry='server.mjs'`, replacementText: `const entry='server.mjs'\nasync function reservePort() { return 2 }` }, { repairId: 'duplicate-binding' })
  assert.equal(result.ok, false)
  assert.match(result.detail, /PATCH_FILE_DUPLICATE_BINDING.*reservePort/)
  assert.equal(await readFile(path.join(root, 'test.mjs'), 'utf8'), original)
}))

test('API tests keep restart assertions out of cleanup and preserve runner cwd', () => {
  const text = `import { test, before, after } from 'node:test'; import { spawn } from 'node:child_process'; before(()=>process.chdir('/tmp')); after(async()=>{child.kill('SIGTERM'); await Promise.race([once(child,'exit'), setTimeout(5000)]); child=spawn(process.execPath,['server.mjs'])}); test('api',()=>{})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /strict assertion module/.test(defect)))
  assert.ok(defects.some(defect => /working directory/.test(defect)))
  assert.ok(defects.some(defect => /cleanup restarts/.test(defect)))
  assert.ok(defects.some(defect => /rejecting bounded timeout/.test(defect)))
})


test('API cleanup review does not scan into a later restart test', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; after(async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),10))])
}); test('restart persistence',async()=>{child=spawn(process.execPath,['server.mjs'],{env:{DATA_FILE:dataFile}})})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(!defects.some(defect => /cleanup restarts/.test(defect)))
  assert.ok(!defects.some(defect => /shutdown race does not include/.test(defect)))
})


test('API tests distinguish malformed JSON from a valid JSON string and cover whitespace titles', () => {
  const text = `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('errors',async()=>{await fetch('/notes',{method:'POST',body:JSON.stringify('invalid json')}); assert.equal(response.status,400); assert.equal(response.status,404)})`
  const defects = applicationTestDefects([{ file: 'api.test.mjs', role: 'test', text }], 'node', 'api')
  assert.ok(defects.some(defect => /genuinely malformed JSON/.test(defect)))
  assert.ok(defects.some(defect => /whitespace-only title/.test(defect)))
})

test('API source rejects uuid package use when the native randomUUID is sufficient', () => {
  for (const text of [
    `import { v4 as uuidv4 } from 'uuid'; import { createServer } from 'node:http'; const server=createServer(()=>uuidv4()); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())`,
    `import { createServer } from 'node:http'; const server=createServer(()=>uuidv4()); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())`,
  ]) {
    const defects = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text }], 'api')
    assert.ok(defects.some(defect => /randomUUID/.test(defect)))
  }
})

test('validation preflight blocks product-source defects before running green tests', () => {
  const sources = [
    { file: 'server.mjs', role: 'source' as const, text: `import { createServer } from 'node:http'; import { v4 as uuidv4 } from 'uuid'; const server=createServer(()=>uuidv4()); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())` },
    { file: 'server.test.mjs', role: 'test' as const, text: `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; test('real',()=>assert.ok(true)); before(()=>{}); after(()=>{})` },
  ]
  const defects = applicationValidationPreflightDefects(sources, 'node', 'api')
  assert.ok(defects.sourceDefects.some(defect => /randomUUID/.test(defect)))
  assert.ok(defects.all.includes(defects.sourceDefects[0]))
})

test('API product defects are repaired before missing or broken tests', () => {
  assert.equal(prioritizeApplicationSourceRepair('api', ['undeclared dependency']), true)
  assert.equal(prioritizeApplicationSourceRepair('api', []), false)
  assert.equal(prioritizeApplicationSourceRepair('web', ['missing browser source']), false)
})

test('independent API plans bind evidence to every executor-owned contract criterion', () => {
  const plan = bindApiPlanCriteria({ entrypoint: 'server.mjs', healthPath: '/health', criteria: ['model paraphrase'], steps: [{ name: 'health', action: 'request', path: '/health', status: 200 }] }, ['exact A', 'exact B'])
  assert.deepEqual(plan.criteria, ['exact A', 'exact B'])
})

test('API count-map plans do not require removed keys to survive as historical zero counts', () => {
  const generated = {
    entrypoint: 'server.mjs', healthPath: '/health', criteria: [], steps: [
      { name: 'initial counts', action: 'request', method: 'GET', path: '/tags', status: 200, jsonChecks: [{ pointer: '/alpha', equals: 1 }] },
      { name: 'updated counts', action: 'request', method: 'GET', path: '/tags', status: 200, jsonChecks: [{ pointer: '/alpha', equals: 0 }, { pointer: '/beta', equals: 1 }] },
    ],
  } as const
  const plan = normalizeApiCountMapAssertions(generated as any, ['return each current tag with its real persisted note count'])
  assert.deepEqual(plan.steps[1].jsonChecks, [{ pointer: '/beta', equals: 1 }])
  const retained = normalizeApiCountMapAssertions(generated as any, ['retain historical tags with zero-count entries'])
  assert.deepEqual(retained.steps[1].jsonChecks, [{ pointer: '/alpha', equals: 0 }, { pointer: '/beta', equals: 1 }])
})

test('API plans send malformed string fixtures as raw bytes rather than valid JSON strings', () => {
  const plan = normalizeApiMalformedBodies({
    entrypoint: 'server.mjs', healthPath: '/health', criteria: [], steps: [
      { name: 'malformed JSON', action: 'request', method: 'POST', path: '/items', body: 'not-json', status: 400 },
    ],
  })
  assert.equal(plan.steps[0].body, undefined)
  assert.equal(plan.steps[0].rawBody, 'not-json')
})

test('API verifier accepts the common slash spelling for the whole JSON response', () => {
  assert.deepEqual(apiJsonPointer([], '/'), [])
  assert.deepEqual(apiJsonPointer({ items: [] }, ''), { items: [] })
  assert.deepEqual(apiJsonPointer({ items: [] }, '/items'), [])
})

test('API plans do not classify valid JSON domain errors as malformed JSON', () => {
  const plan = normalizeApiDomainErrorAssertions({
    entrypoint: 'server.mjs', healthPath: '/health', criteria: [], steps: [
      { name: 'invalid tag input', action: 'request', method: 'POST', path: '/notes', body: { tags: ['bad tag!'] }, status: 400, jsonChecks: [{ pointer: '/error', equals: 'Malformed JSON' }] },
    ],
  })
  assert.deepEqual(plan.steps[0].jsonChecks, [])
})

test('independent API runtime owns one isolated persistence file across restarts', () => {
  const env = apiVerificationEnvironment(43123, '/tmp/api-proof', { PATH: '/bin', NODE_ENV: 'test' })
  assert.equal(env.PORT, '43123')
  assert.equal(env.DATA_FILE, '/tmp/api-proof/acceptance-data.json')
  assert.equal(env.PATH, '/bin')
})

test('a partial lifecycle-hook patch is syntax-rejected without changing accepted source', async () => isolated(async root => {
  const source = `import { after } from 'node:test'
after(async () => {
  child.kill('SIGTERM')
})
`
  await writeFile(path.join(root, 'test.mjs'), source)
  const result = await executeFoundryAction({ type: 'PATCH_FILE', path: 'test.mjs', matchText: 'after(async () => {', replacementText: `after(async () => {
  child.kill('SIGTERM')
})`, reason: 'bad partial hook repair' }, { repairId: 'partial-hook' })
  assert.equal(result.ok, false)
  assert.match(result.detail, /SOURCE_SYNTAX_REJECTED/)
  assert.equal(await readFile(path.join(root, 'test.mjs'), 'utf8'), source)
}))

test('web tests cannot resolve the server from the project parent', () => {
  const text = `import { test } from 'node:test'; import { fileURLToPath } from 'node:url'; import { dirname, join } from 'node:path'; const sourceDir=join(dirname(fileURLToPath(import.meta.url)),'..'); const serverPath=join(sourceDir,'server.mjs'); test('path',()=>{})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(defects.some(defect => /parent of the project/.test(defect)))
})

test('web port reservation accepts address port destructuring inside the close-owned promise', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { spawn } from 'node:child_process'; import { createServer } from 'node:net'; import { once } from 'node:events'; async function reservePort(){return new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const { port }=server.address();server.close(()=>resolve(port))})})} let child,port; before(async()=>{port=await reservePort();child=spawn(process.execPath,['/server.mjs'],{env:{...process.env,PORT:String(port)}});for(let i=0;i<2;i+=1){try{await fetch('http://127.0.0.1:'+port+'/health');break}catch{}await new Promise(r=>setTimeout(r,1))}});after(async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),10))])});test('document',async()=>{const response=await fetch('http://127.0.0.1:'+port+'/');assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/text\\/html/i);const body=await response.text();assert.match(body,/Personal Focus Board/)})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(!defects.some(defect => /complete ephemeral-port reservation/.test(defect)))
})

test('web tests reject unbounded readiness and unbounded shutdown waits', () => {
  const text = `import { test, before, after } from 'node:test'; import { spawn } from 'node:child_process'; import { once } from 'node:events'; let child; async function waitForHealth(){setTimeout(()=>{throw new Error('timeout')},5000);while(true){try{await fetch('http://127.0.0.1:1/health')}catch{}await new Promise(r=>setTimeout(r,10))}} before(async()=>{child=spawn(process.execPath,['server.mjs']);await waitForHealth()}); after(async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await exited}); test('x',()=>{})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(defects.some(defect => /unbounded while\(true\)/.test(defect)))
  assert.ok(defects.some(defect => /independent setTimeout/.test(defect)))
  assert.ok(defects.some(defect => /bounded fallback/.test(defect)))
})

test('web readiness must retry transient connection refusal', () => {
  const text = `import { test } from 'node:test'; async function waitForHealth(){const deadline=Date.now()+5000;while(Date.now()<deadline){const response=await fetch('http://127.0.0.1:1/health');if(response.ok)return;await new Promise(r=>setTimeout(r,10))}throw new Error('timeout')} test('x',()=>{})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(defects.some(defect => /transient connection failures/.test(defect)))
})

test('web test cases cannot await top-level registration', () => {
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text: `import { test } from 'node:test'; await test('one', async()=>{}); await test('two', async()=>{})` }], 'node', 'web')
  assert.ok(defects.some(defect => /await top-level test/.test(defect)))
})

test('web tests enforce the canonical health response contract', () => {
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text: `test('health',async()=>{const response=await fetch('/health');assert.deepEqual(await response.json(),{ success: true })})` }], 'node', 'web')
  assert.ok(defects.some(defect => /noncanonical health payload/.test(defect)))
})

test('web tests reject unresolved Node server helpers and browser-only UI simulation', () => {
  const text = `import { test, before, after } from 'node:test'; import { spawn } from 'node:child_process'; import { once } from 'node:events'; let child; before(async()=>{const reservation=createServer();child=spawn(process.execPath,['server.mjs'])}); after(async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),10))])}); test('ui',()=>{const doc=new DOMParser().parseFromString('<p>x</p>','text/html');localStorage.setItem('x',doc.body.textContent)})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(defects.some(defect => /without importing it/.test(defect)))
  assert.ok(defects.some(defect => /browser-only APIs/.test(defect)))
  assert.ok(defects.some(defect => /assumes the child exists/.test(defect)))
})

test('web server source keeps browser storage in the browser and closes on SIGTERM', () => {
  const text = `import http from 'node:http'
const tasks = JSON.parse(localStorage.getItem('tasks') || '[]')
const server = http.createServer(() => {})
server.listen(process.env.PORT, '127.0.0.1')`
  const defects = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text }], 'web')
  assert.ok(defects.some(defect => /browser localStorage/.test(defect)))
  assert.ok(defects.some(defect => /graceful owned-process shutdown/.test(defect)))
})

test('web server registers SIGTERM on the process rather than the HTTP server', () => {
  const text = `import { createServer } from 'node:http'; const server=createServer(()=>{}); server.on('SIGTERM',()=>server.close()); server.listen(process.env.PORT,'127.0.0.1')`
  const defects = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text }], 'web')
  assert.ok(defects.some(defect => /SIGTERM is a process signal/.test(defect)))
})

test('web server source cannot embed the application document', () => {
  const text = `import http from 'node:http'; const server=http.createServer((req,res)=>res.end(\`<!doctype html><html><body>App</body></html>\`)); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())`
  const defects = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text }], 'web')
  assert.ok(defects.some(defect => /embeds the application document/.test(defect)))
})

test('web server source converts import.meta.url before joining static paths', () => {
  const invalid = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text: `import { createServer } from 'node:http'; import { join } from 'node:path'; const root=join(import.meta.url,'..','public'); const server=createServer(()=>{}); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())` }], 'web')
  assert.ok(invalid.some(defect => /treats import\.meta\.url as a filesystem path/.test(defect)))
  const valid = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text: `import { createServer } from 'node:http'; import { dirname, join } from 'node:path'; import { fileURLToPath } from 'node:url'; const root=join(dirname(fileURLToPath(import.meta.url)),'public'); const server=createServer(()=>{}); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())` }], 'web')
  assert.ok(!valid.some(defect => /treats import\.meta\.url as a filesystem path/.test(defect)))
})

test('web server source keeps health routing consistent with static path normalization', () => {
  const invalid = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text: `import { createServer } from 'node:http'; const server=createServer((req,res)=>{const pathname=req.url==='/'?'/index.html':req.url.slice(1);if(pathname==='/health')res.end('ok')});server.listen(process.env.PORT,'127.0.0.1');process.on('SIGTERM',()=>server.close())` }], 'web')
  assert.ok(invalid.some(defect => /strips the request's leading slash/.test(defect)))
  assert.ok(invalid.some(defect => /still begins with/.test(defect)))
})

test('web server source must serve the reviewed static source layout', () => {
  const defects = applicationSourceDefects([
    { file: 'server.mjs', role: 'source', text: `import { createServer } from 'node:http'; import { join } from 'node:path'; const publicDir=join(sourceDir,'public'); const server=createServer(()=>{});server.listen(process.env.PORT,'127.0.0.1');process.on('SIGTERM',()=>server.close())` },
    { file: 'index.html', role: 'source', text: `<!doctype html><html><link href="styles.css"><script src="app.js"></script></html>` },
    { file: 'styles.css', role: 'source', text: `body{display:block}` },
    { file: 'app.js', role: 'source', text: `document.body.dataset.saved=localStorage.getItem('x') ?? ''` },
  ], 'web')
  assert.ok(defects.some(defect => /invented public directory/.test(defect)))
})

test('web server source cannot write success headers twice around static I/O', () => {
  const defects = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text: `import { createServer } from 'node:http'; const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});import('node:fs/promises').then(fs=>fs.readFile('index.html').then(body=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(body)}))});server.listen(process.env.PORT,'127.0.0.1');process.on('SIGTERM',()=>server.close())` }], 'web')
  assert.ok(defects.some(defect => /writes a success response before static-file I\/O/.test(defect)))
})

test('web server static I/O review ignores a completed health response', () => {
  const text = `import { createServer } from 'node:http'; import { readFileSync } from 'node:fs'; const server=createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}try{const body=readFileSync('index.html');res.writeHead(200,{'Content-Type':'text/html'});res.end(body)}catch{res.writeHead(404);res.end()}});server.listen(process.env.PORT,'127.0.0.1');process.on('SIGTERM',()=>server.close())`
  const defects = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text }], 'web')
  assert.ok(!defects.some(defect => /writes a success response before static-file I\/O/.test(defect)))
})

test('web source review distinguishes const comparison from reassignment', () => {
  const valid = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text: `import http from 'node:http'; const kind='html'; if(kind === 'html'){}; const server=http.createServer(()=>{}); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())` }], 'web')
  assert.ok(!valid.some(defect => /reassigns a const/.test(defect)))
  const invalid = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text: `import http from 'node:http'; const filePath='index.html'; filePath = 'app.html'; const server=http.createServer(()=>{}); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())` }], 'web')
  assert.ok(invalid.some(defect => /reassigns a const/.test(defect)))
})

test('a valid web lifecycle test satisfies the structural ownership gate', () => {
  const text = `import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
let child, port
async function reservePort() { return new Promise((resolve, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(error => error ? reject(error) : resolve(value)) }) }) }
async function waitForHealth() { for (let attempt = 0; attempt < 40; attempt += 1) { try { const response = await fetch('http://127.0.0.1:' + port + '/health'); if (response.ok) return } catch {} await new Promise(resolve => setTimeout(resolve, 25)) } throw new Error('timeout') }
before(async () => { port = await reservePort(); child = spawn(process.execPath, ['/absolute/server.mjs'], { env: { ...process.env, PORT: String(port) } }); await waitForHealth() })
after(async () => { if (!child) return; const exited = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), 1000))]) })
test('health', async () => { const response = await fetch('http://127.0.0.1:' + port + '/health'); assert.equal(response.status, 200) })
test('document', async () => { const response = await fetch('http://127.0.0.1:' + port + '/'); assert.equal(response.status, 200); assert.match(response.headers.get('content-type') || '', /text\\/html/i); const body = await response.text(); assert.match(body, /Personal Focus Board/) })`
  assert.deepEqual(applicationTestDefects([{ file: 'test.mjs', role: 'test', text }], 'node', 'web'), [])
})

test('web structural review recognizes a named node:http request import as real HTTP', () => {
  const text = `import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
async function reservePort(){ return new Promise(resolve => { const probe=createServer(); probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port))}) }) }
const port=await reservePort(); const child=spawn(process.execPath,['/server.mjs'],{env:{PORT:String(port)}})
async function ready(){for(let i=0;i<5;i+=1){await new Promise((resolve,reject)=>request('http://127.0.0.1:'+port+'/health',resolve).on('error',reject));await new Promise(resolve=>setTimeout(resolve,1));return}throw new Error('timeout')}
await ready(); after(async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await exited}); test('health',async()=>{const response=await new Promise((resolve,reject)=>request('http://127.0.0.1:'+port+'/health',resolve).on('error',reject));assert.equal(response.statusCode,200)})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(!defects.some(defect => /do not send real HTTP requests/.test(defect)))
})

test('web structural review rejects exit-before-readiness and hook-context cleanup', () => {
  const text = `import { test, after } from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
async function reservePort(){return new Promise(resolve=>{const probe=createServer();probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port))})})}
async function runServer(){return new Promise(resolve=>{const child=spawn(process.execPath,['/server.mjs']);child.on('exit',()=>resolve(child))})}
const port=await reservePort();const child=await runServer();async function ready(){for(let i=0;i<2;i+=1){await fetch('http://127.0.0.1:'+port+'/health');await new Promise(resolve=>setTimeout(resolve,1));return}throw new Error('timeout')}
await ready();after(async child=>{child.kill('SIGTERM');child.once('exit',()=>{})});test('health',async t=>{t.pass('ok')})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(defects.some(defect => /waits for the spawned server to exit/.test(defect)))
  assert.ok(defects.some(defect => /hook context parameter/.test(defect)))
  assert.ok(defects.some(defect => /no t.pass assertion/.test(defect)))
})

test('web structural review requires registered hooks and cleanup-local timeouts', () => {
  const text = `import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
async function reservePort(){return new Promise(resolve=>{const probe=createServer();probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port))})})}
let child;const port=await reservePort();child=spawn(process.execPath,['/server.mjs'],{env:{PORT:String(port)}});for(let i=0;i<2;i+=1){try{await fetch('http://127.0.0.1:'+port+'/health');break}catch{}await new Promise(resolve=>setTimeout(resolve,1))}
const shutdownTimeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),1000));export const before=async()=>{};export const after=async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,shutdownTimeout])};test('health',async()=>{const r=await fetch('http://127.0.0.1:'+port+'/health');if(!r.ok)throw new Error('bad')})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(defects.some(defect => /register real node:test before\/after/.test(defect)))
  assert.ok(defects.some(defect => /export functions named before\/after/.test(defect)))
  assert.ok(defects.some(defect => /module scope/.test(defect)))
})

test('each lifecycle test file must register a test so its owned child can be cleaned up', () => {
  const valid = `import { test } from 'node:test'; test('one', () => { if (!true) throw new Error('bad') })`
  const placeholder = `import { before, after } from 'node:test'; import { spawn } from 'node:child_process'; let child; before(() => { child = spawn(process.execPath, ['/server.mjs']) }); after(() => child.kill('SIGTERM'))`
  const defects = applicationTestDefects([
    { file: 'server.test.mjs', role: 'test', text: valid },
    { file: 'browser.test.mjs', role: 'test', text: placeholder },
  ], 'node', 'web')
  assert.ok(defects.some(defect => /browser\.test\.mjs starts lifecycle work but registers no executable tests/.test(defect)))
})

test('web source review rejects Node imports in browser code and missing static-asset routing', () => {
  const defects = applicationSourceDefects([
    { file: 'server.mjs', role: 'source', text: `import http from 'node:http'; const server=http.createServer((req,res)=>res.end(readFileSync('index.html'))); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())` },
    { file: 'index.html', role: 'source', text: `<link rel="stylesheet" href="styles.css"><script src="app.js"></script>` },
    { file: 'app.js', role: 'source', text: `import { readFileSync } from 'node:fs'; document.body.textContent=localStorage.getItem('x')` },
  ], 'web')
  assert.ok(defects.some(defect => /Browser JavaScript imports Node built-ins/.test(defect)))
  assert.ok(defects.some(defect => /does not route and serve those real assets/.test(defect)))
})

test('web source review rejects browser assets detached from the application document', () => {
  const defects = applicationSourceDefects([
    { file: 'server.mjs', role: 'source', text: `import http from 'node:http'; const server=http.createServer((req,res)=>res.end()); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())` },
    { file: 'index.html', role: 'source', text: `<!doctype html><html><body><h1>Focus Board</h1></body></html>` },
    { file: 'app.js', role: 'source', text: `document.body.dataset.saved=localStorage.getItem('tasks') ?? ''` },
    { file: 'styles.css', role: 'source', text: `body { display: block }` },
  ], 'web')
  assert.ok(defects.some(defect => /document does not load it/.test(defect) && /browser source/.test(defect)))
  assert.ok(defects.some(defect => /document does not load it/.test(defect) && /stylesheet/.test(defect)))
})

test('web source review reports every missing separate surface role', () => {
  const defects = applicationSourceDefects([{ file: 'server.mjs', role: 'source', text: `import { createServer } from 'node:http'; const server=createServer(()=>{}); server.listen(process.env.PORT,'127.0.0.1'); process.on('SIGTERM',()=>server.close())` }], 'web')
  assert.ok(defects.some(defect => /separate real HTML document/.test(defect)))
  assert.ok(defects.some(defect => /separate real stylesheet/.test(defect)))
  assert.ok(defects.some(defect => /separate real browser JavaScript/.test(defect)))
})

test('web source review directs document identity mismatches to the HTML', () => {
  const defects = applicationSourceDefects([
    { file: 'index.html', role: 'source', text: `<!doctype html><html><h1>Focus Board</h1></html>` },
    { file: 'server.test.mjs', role: 'test', text: `test('document',async()=>{const body=await response.text();assert.match(body,/Personal Focus Board/)})` },
  ], 'web')
  assert.ok(defects.some(defect => /does not contain the concrete product identity/.test(defect) && /Personal Focus Board/.test(defect)))
})

test('web acceptance plans reject empty assertions and omitted contract interactions', () => {
  const defects = webAcceptancePlanDefects({ entrypoint: 'server.mjs', healthPath: '/health', criteria: ['goal'], steps: [
    { name: 'load', action: 'goto' },
    { name: 'empty', action: 'checkText', selector: '#list', text: '' },
    { name: 'type', action: 'fill', selector: '#title', value: 'Example' },
    { name: 'save', action: 'click', selector: '#save' },
    { name: 'reload', action: 'reload' },
    { name: 'restart', action: 'restart' },
    { name: 'mobile', action: 'viewport', width: 390, height: 844 },
  ] }, 'Require blank validation, completed tasks, open completed and all filter states, visible totals, reload and restart persistence.')
  assert.ok(defects.some(defect => /empty expected string/.test(defect)))
  assert.ok(defects.some(defect => /blank-input submission/.test(defect)))
  assert.ok(defects.some(defect => /completion interaction/.test(defect)))
  assert.ok(defects.some(defect => /open, completed, and all filters/.test(defect)))
  assert.ok(defects.some(defect => /totals\/count/.test(defect)))
  assert.ok(defects.some(defect => /after reload/.test(defect)))
  assert.ok(defects.some(defect => /after runtime restart/.test(defect)))
})

test('real web verification maps health and document traffic to required API evidence', () => {
  assert.deepEqual(webEvidenceKinds(['ui', 'api', 'persistence', 'restart', 'shutdown'], true), ['ui', 'api', 'persistence', 'restart', 'shutdown'])
})

test('web tests must assert a real document response and cannot fake browser automation', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { spawn } from 'node:child_process'; import { createServer } from 'node:net'; import { once } from 'node:events'; async function reserve(){return new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})};let child;const port=await reserve();child=spawn(process.execPath,['/server.mjs']);before(async()=>{for(let i=0;i<2;i+=1){await fetch('http://127.0.0.1:'+port+'/health');await new Promise(r=>setTimeout(r,1));return}});after(async()=>{const x=once(child,'exit');child.kill('SIGTERM');await x});const getBrowser=async()=>({goto:async()=>{},evaluate:async()=>{}});test('health',async()=>{const r=await fetch('http://127.0.0.1:'+port+'/health');assert.equal(r.status,200)})`
  const defects = applicationTestDefects([{ file: 'browser.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(defects.some(defect => /exercise health only/.test(defect)))
  assert.ok(defects.some(defect => /fake or placeholder browser automation/.test(defect)))
})

test('web document review accepts an escaped text/html assertion regex', () => {
  const text = `import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { spawn } from 'node:child_process'; import { createServer } from 'node:net'; import { once } from 'node:events'; async function reserve(){return new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})};let child;let port;before(async()=>{port=await reserve();child=spawn(process.execPath,['/server.mjs']);for(let i=0;i<2;i+=1){try{await fetch('http://127.0.0.1:'+port+'/health');break}catch{}await new Promise(r=>setTimeout(r,1))}});after(async()=>{const x=once(child,'exit');child.kill('SIGTERM');await x});test('document',async()=>{const r=await fetch('http://127.0.0.1:'+port+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\\/html/);assert.match(await r.text(),/Focus Board/)})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(!defects.some(defect => /exercise health only/.test(defect)))
})

test('web document review rejects tests weakened to a broken response', () => {
  const text = `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('document',async()=>{const r=await fetch('http://127.0.0.1:1/');assert.equal(r.headers.get('content-type'),'text/plain');const body=await r.text();assert.match(body,/Personal Focus Board/)})`
  const defects = applicationTestDefects([{ file: 'server.test.mjs', role: 'test', text }], 'node', 'web')
  assert.ok(defects.some(defect => /weaken the document contract/.test(defect)))
})

test('CLI acceptance plans order empty reads first and capture generated IDs before use', () => {
  const plan = normalizeCliAcceptancePlan({
    entrypoint: 'cli.mjs', criteria: ['criterion'], steps: [
      { name: 'create', args: ['add', 'A'], exitCode: 0, fileChecks: [{ path: 'data.json', pointer: '/0/title', equals: 'A' }] },
      { name: 'empty list', args: ['list'], exitCode: 0, stdoutIncludes: ['No records found.'] },
      { name: 'update', args: ['finish', '{{recordId}}'], exitCode: 0 },
    ],
  })
  assert.equal(plan.steps[0].name, 'empty list')
  assert.deepEqual(plan.steps[1].captures, [{ name: 'recordId', path: 'data.json', pointer: '/0/id' }])
})

test('an exact pre-edit checkpoint restores every reviewed source file', async () => isolated(async root => {
  await writeFile(path.join(root, 'cli.mjs'), 'console.log("working")\n')
  await writeFile(path.join(root, 'test.mjs'), 'import test from "node:test"\nimport assert from "node:assert/strict"\ntest("works",()=>assert.ok(true))\n')
  const state = initialApplicationBuildState(deriveApplicationMission({ missionId: 'checkpoint-test', goal: 'Build a CLI.', map: await buildRepoMap() }))
  state.sourceDigest = (await applicationSourceSnapshot()).digest
  state.testedDigest = state.sourceDigest
  state.pendingCheckpoint = await captureApplicationCheckpoint(state)
  await writeFile(path.join(root, 'cli.mjs'), 'console.log("regressed")\n')
  await writeFile(path.join(root, 'extra.json'), '{"unwanted":true}\n')
  await restoreApplicationCheckpoint(state)
  assert.equal(await readFile(path.join(root, 'cli.mjs'), 'utf8'), 'console.log("working")\n')
  await assert.rejects(readFile(path.join(root, 'extra.json'), 'utf8'))
  assert.equal((await applicationSourceSnapshot()).digest, state.sourceDigest)
}))
