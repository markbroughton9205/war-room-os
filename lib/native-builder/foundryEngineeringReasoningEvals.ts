/**
 * Reasoning-quality evaluations.
 * Each case has several plausible patches. A superficial patch fails the independent verifier.
 * hiddenAnswer is an oracle marker for leak checks. It is not engineering memory.
 */
import type { FoundryReasoningCase, FoundryReasoningModel } from './foundryEngineeringReasoning'
import type { FoundryReasoningHypothesis, FoundryReasoningObservation } from './foundryEngineeringReasoningTypes'

function observation(id: string, text: string, facts: FoundryReasoningObservation['facts']): FoundryReasoningObservation {
  return { id, text, facts }
}

function hypothesis(
  id: string,
  statement: string,
  cites: string[],
  claimFacts: FoundryReasoningHypothesis['claimFacts'],
  files: Record<string, string>,
): FoundryReasoningHypothesis {
  return { id, statement, cites, claimFacts, files }
}

const ambiguousVerify = `
import { createCart } from './cart.mjs'
const accepted = createCart()
accepted.add(2)
accepted.add(3)
if (accepted.total() !== 5) throw new Error('accepted prices must sum')
const mixed = createCart()
mixed.add(4)
mixed.add(9, { quarantine: true })
if (mixed.total() !== 4) throw new Error('quarantine must not change the total')
`

const regressionVerify = `
import { loadUser } from './user.mjs'
import { readFileSync } from 'node:fs'
const user = loadUser()
if (!Object.prototype.hasOwnProperty.call(user, 'name') || Object.prototype.hasOwnProperty.call(user, 'Name')) {
  throw new Error('contract field must stay name')
}
const test = readFileSync(new URL('./user.test.mjs', import.meta.url), 'utf8')
if (!test.includes('user.name') || test.includes('user.Name') || test.includes('assert.ok(true)')) {
  throw new Error('regression: test still targets the old field')
}
`

const performanceVerify = `
import { buildIndex } from './scan.mjs'
const records = []
for (let i = 0; i < 40; i += 1) records.push({ id: i })
records.splice(10, 0, { id: 5 })
const result = buildIndex(records)
if (result.size !== 40) throw new Error('duplicate id must collapse')
if (result.scans >= 80) throw new Error('nested scan budget exceeded')
`

const concurrencyVerify = `
import { begin } from './session.mjs'
const first = begin('ada')
const second = begin('bea')
if (first.name() !== 'ada' || second.name() !== 'bea') throw new Error('shared current user')
`

const specVerify = `
import { readRecords, writeRecord } from './store.mjs'
writeRecord('data.jsonl', { email: 'a@b.co' })
const rows = readRecords('data.jsonl')
if (rows.length !== 2 || rows[1].email !== 'a@b.co') throw new Error('jsonl append')
`

const legacyVerify = `
import { parseLegacy } from './legacy.mjs'
if (parseLegacy.length !== 1) throw new Error('signature')
if (parseLegacy('  Ada Lovelace  ') !== 'Ada Lovelace') throw new Error('legacy case')
`

const multiVerify = `
import { parse } from './parser.mjs'
import { save, titles } from './store.mjs'
const parsed = parse('{"title":"Ada"}')
if (typeof parsed === 'string' || parsed.title !== 'Ada') throw new Error('parser contract')
const db = []
save(db, '{"title":"Ada"}')
if (titles(db)[0] !== 'Ada') throw new Error('store double parse')
`

const integrationVerify = `
import { payload } from './client.mjs'
import { readEmail } from './server.mjs'
const body = payload('a@b.co')
if (body.email !== 'a@b.co') throw new Error('client contract')
if (readEmail(body) !== 'a@b.co') throw new Error('server field')
`

const architectureVerify = `
import { createUser, inviteUser } from './routes.mjs'
import { readFileSync } from 'node:fs'
if (createUser({ email: 'a@b' }).ok || inviteUser({ email: 'a@b' }).ok) throw new Error('dot required')
if (!createUser({ email: 'a@b.co' }).ok || !inviteUser({ email: 'a@b.co' }).ok) throw new Error('valid email')
const source = readFileSync(new URL('./routes.mjs', import.meta.url), 'utf8')
if (!source.includes('function isValidEmail') || source.includes("includes('@')")) throw new Error('duplicated rule')
`

export function reasoningCapabilityCases(): FoundryReasoningCase[] {
  return [
    {
      caseId: 'REASON-AMBIGUOUS-BUG',
      capabilityClass: 'AMBIGUOUS_BUG',
      difficulty: 'D3',
      symptom: 'Cart total stays 0 after add(). Quarantined prices must not affect the total.',
      constraints: ['Do not weaken the behavioral check.', 'Keep both accepted and quarantined prices.'],
      files: {
        'cart.mjs': `export function createCart() {
  const items = []
  const discarded = []
  return {
    add(price) { discarded.push(price) },
    total() { return items.reduce((sum, price) => sum + price, 0) },
  }
}
`,
      },
      observations: [
        observation('obs-discard', 'add() always pushes onto discarded and ignores the quarantine option. total() sums items.', {
          writeTarget: 'discarded',
          quarantineHonored: false,
          defectSurface: 'behavior',
        }),
      ],
      uncertainties: ['Which collection is the accepted-price ledger?'],
      predictedFailureModes: ['Summing the quarantine list counts prices the caller excluded.'],
      hiddenAnswer: 'GRAD_HIDDEN_AMBIGUOUS_BUG',
      verifySource: ambiguousVerify,
      hypotheses: [
        hypothesis('h1', 'Change the test to assert true.', ['obs-discard'], { defectSurface: 'test' }, {
          'cart.test.mjs': 'import assert from "node:assert"\nassert.ok(true)\n',
        }),
        hypothesis('h2', 'Sum discarded prices in total().', ['obs-discard'], { writeTarget: 'discarded', quarantineHonored: false, defectSurface: 'behavior' }, {
          'cart.mjs': `export function createCart() {
  const discarded = []
  return {
    add(price) { discarded.push(price) },
    total() { return discarded.reduce((sum, price) => sum + price, 0) },
  }
}
`,
        }),
        hypothesis('h3', 'Push accepted prices to items and quarantined prices to discarded.', ['obs-discard'], { writeTarget: 'discarded', quarantineHonored: false, defectSurface: 'behavior' }, {
          'cart.mjs': `export function createCart() {
  const items = []
  const discarded = []
  return {
    add(price, options) {
      if (options?.quarantine) discarded.push(price)
      else items.push(price)
    },
    total() { return items.reduce((sum, price) => sum + price, 0) },
  }
}
`,
        }),
      ],
    },
    {
      caseId: 'REASON-MISLEADING-REGRESSION',
      capabilityClass: 'MISLEADING_REGRESSION',
      difficulty: 'D3',
      symptom: 'user.test.mjs fails saying name is missing. The sealed contract field is name.',
      constraints: ['Do not rename the contract field.', 'Update the stale assertion.'],
      files: {
        'user.mjs': 'export function loadUser() { return { name: "Ada" } }\n',
        'user.test.mjs': `import { loadUser } from './user.mjs'
const user = loadUser()
if (user.Name !== 'Ada') throw new Error('name missing')
`,
      },
      observations: [
        observation('obs-contract', 'The contract field is name. The failing test reads user.Name.', {
          contractField: 'name',
          testReads: 'Name',
          defectSurface: 'contract',
        }),
      ],
      uncertainties: ['Is the test stale, or did the payload field change?'],
      predictedFailureModes: ['Renaming the payload to Name satisfies the stale test and breaks the contract.'],
      hiddenAnswer: 'GRAD_HIDDEN_MISLEADING_REGRESSION',
      verifySource: regressionVerify,
      hypotheses: [
        hypothesis('h1', 'Replace the test with assert true.', ['obs-contract'], { defectSurface: 'test' }, {
          'user.test.mjs': 'import assert from "node:assert"\nassert.ok(true)\n',
        }),
        hypothesis('h2', 'Return Name from loadUser so the current test passes.', ['obs-contract'], { contractField: 'name', testReads: 'Name', defectSurface: 'contract' }, {
          'user.mjs': 'export function loadUser() { return { Name: "Ada" } }\n',
        }),
        hypothesis('h3', 'Assert user.name and leave the payload field on the contract.', ['obs-contract'], { contractField: 'name', testReads: 'Name', defectSurface: 'contract' }, {
          'user.test.mjs': `import { loadUser } from './user.mjs'
const user = loadUser()
if (user.name !== 'Ada') throw new Error('name missing')
`,
        }),
      ],
    },
    {
      caseId: 'REASON-PERFORMANCE',
      capabilityClass: 'PERFORMANCE_BOTTLENECK',
      difficulty: 'D2',
      symptom: 'buildIndex scans the whole list on every insert and recounts duplicate ids.',
      constraints: ['Do not raise a scan limit.', 'Collapse duplicate ids.'],
      files: {
        'scan.mjs': `export function buildIndex(records) {
  const list = []
  let scans = 0
  for (const record of records) {
    scans += list.length
    if (!list.some(item => item.id === record.id)) list.push(record)
  }
  return { size: list.length, scans }
}
`,
      },
      observations: [
        observation('obs-scan', 'Each insert scans every prior row. A limit constant is not the defect.', {
          algorithm: 'nested-scan',
          limitConstant: false,
          defectSurface: 'performance',
        }),
      ],
      uncertainties: ['Is the cost the scan, or a too-small limit?'],
      predictedFailureModes: ['Remembering only the last id misses a non-adjacent duplicate.'],
      hiddenAnswer: 'GRAD_HIDDEN_PERFORMANCE',
      verifySource: performanceVerify,
      hypotheses: [
        hypothesis('h1', 'Raise LIMIT so the nested scan is allowed.', ['obs-scan'], { limitConstant: true, defectSurface: 'performance' }, {
          'scan.mjs': `const LIMIT = 1000000
export function buildIndex(records) {
  const list = []
  let scans = 0
  for (const record of records) {
    scans += list.length
    if (scans > LIMIT) break
    if (!list.some(item => item.id === record.id)) list.push(record)
  }
  return { size: list.length, scans }
}
`,
        }),
        hypothesis('h2', 'Skip an id only when it matches the previous row.', ['obs-scan'], { algorithm: 'nested-scan', limitConstant: false, defectSurface: 'performance' }, {
          'scan.mjs': `export function buildIndex(records) {
  const list = []
  let last = null
  for (const record of records) {
    if (record.id === last) continue
    list.push(record)
    last = record.id
  }
  return { size: list.length, scans: 0 }
}
`,
        }),
        hypothesis('h3', 'Track seen ids in a set and stop scanning the full list.', ['obs-scan'], { algorithm: 'nested-scan', limitConstant: false, defectSurface: 'performance' }, {
          'scan.mjs': `export function buildIndex(records) {
  const seen = new Set()
  for (const record of records) seen.add(record.id)
  return { size: seen.size, scans: 0 }
}
`,
        }),
      ],
    },
    {
      caseId: 'REASON-CONCURRENCY',
      capabilityClass: 'CONCURRENCY_STATE',
      difficulty: 'D3',
      symptom: 'begin() overwrites a shared current user, so the first session reads the second user.',
      constraints: ['Each begin() call must keep its own user.', 'Do not drop the second call.'],
      files: {
        'session.mjs': `let current = null
export function begin(user) {
  current = user
  return { name: () => current }
}
`,
      },
      observations: [
        observation('obs-shared', 'begin() writes a module-level current and both sessions read it.', {
          sharedMutable: true,
          defectSurface: 'behavior',
        }),
      ],
      uncertainties: ['Is the fix a lock, a queue, or a value captured per call?'],
      predictedFailureModes: ['Returning the last queued user still shares one cell.'],
      hiddenAnswer: 'GRAD_HIDDEN_CONCURRENCY',
      verifySource: concurrencyVerify,
      hypotheses: [
        hypothesis('h1', 'Ignore a second begin() once current is set.', ['obs-shared'], { sharedMutable: true, defectSurface: 'behavior' }, {
          'session.mjs': `let current = null
export function begin(user) {
  if (!current) current = user
  return { name: () => current }
}
`,
        }),
        hypothesis('h2', 'Push users onto a list and read the last one.', ['obs-shared'], { sharedMutable: true, defectSurface: 'behavior' }, {
          'session.mjs': `const sessions = []
export function begin(user) {
  sessions.push(user)
  return { name: () => sessions[sessions.length - 1] }
}
`,
        }),
        hypothesis('h3', 'Return the user captured by that begin() call.', ['obs-shared'], { sharedMutable: true, defectSurface: 'behavior' }, {
          'session.mjs': `export function begin(user) {
  return { name: () => user }
}
`,
        }),
      ],
    },
    {
      caseId: 'REASON-INCOMPLETE-SPEC',
      capabilityClass: 'INCOMPLETE_SPEC',
      difficulty: 'D2',
      symptom: 'The request says store the record. Existing data.jsonl is one JSON object per line.',
      constraints: ['Match the existing file format.', 'Do not replace prior rows.'],
      files: {
        'data.jsonl': '{"email":"old@b.co"}\n',
        'store.mjs': `import { appendFileSync, existsSync, readFileSync } from 'node:fs'
export function readRecords(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line))
}
export function writeRecord(file, record) {
  appendFileSync(file, record.email + '\\n')
}
`,
      },
      observations: [
        observation('obs-jsonl', 'data.jsonl already stores one JSON object per line. writeRecord appends a bare email.', {
          format: 'jsonl',
          defectSurface: 'behavior',
        }),
      ],
      uncertainties: ['The request does not name a format. The existing file does.'],
      predictedFailureModes: ['Rewriting the file as one JSON array drops or breaks the line reader.'],
      hiddenAnswer: 'GRAD_HIDDEN_INCOMPLETE_SPEC',
      verifySource: specVerify,
      hypotheses: [
        hypothesis('h1', 'Overwrite the file with a CSV row.', ['obs-jsonl'], { format: 'csv', defectSurface: 'behavior' }, {
          'store.mjs': `import { writeFileSync, existsSync, readFileSync } from 'node:fs'
export function readRecords(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line))
}
export function writeRecord(file, record) {
  writeFileSync(file, 'email\\n' + record.email + '\\n')
}
`,
        }),
        hypothesis('h2', 'Replace the file with a pretty JSON array of the new record.', ['obs-jsonl'], { format: 'jsonl', defectSurface: 'behavior' }, {
          'store.mjs': `import { writeFileSync, existsSync, readFileSync } from 'node:fs'
export function readRecords(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line))
}
export function writeRecord(file, record) {
  writeFileSync(file, JSON.stringify([record], null, 2))
}
`,
        }),
        hypothesis('h3', 'Append one JSON line and leave existing lines in place.', ['obs-jsonl'], { format: 'jsonl', defectSurface: 'behavior' }, {
          'store.mjs': `import { appendFileSync, existsSync, readFileSync } from 'node:fs'
export function readRecords(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line))
}
export function writeRecord(file, record) {
  appendFileSync(file, JSON.stringify(record) + '\\n')
}
`,
        }),
      ],
    },
    {
      caseId: 'REASON-LEGACY',
      capabilityClass: 'LEGACY_MODIFICATION',
      difficulty: 'D3',
      symptom: 'parseLegacy uppercases trimmed input. Callers depend on a one-argument signature and mixed case.',
      constraints: ['Do not change parseLegacy arity.', 'Trim surrounding spaces.'],
      files: {
        'legacy.mjs': `export function parseLegacy(input) {
  return normalize(input)
}
function normalize(input) {
  return String(input).trim().toUpperCase()
}
`,
      },
      observations: [
        observation('obs-signature', 'parseLegacy is a one-argument export. normalize() uppercases after trim.', {
          signatureArity: 1,
          preserveCase: true,
          defectSurface: 'behavior',
        }),
      ],
      uncertainties: ['Can the helper change without touching the export signature?'],
      predictedFailureModes: ['Adding a mode argument changes Function.length for existing callers.'],
      hiddenAnswer: 'GRAD_HIDDEN_LEGACY',
      verifySource: legacyVerify,
      hypotheses: [
        hypothesis('h1', 'Add a preserveCase parameter to parseLegacy.', ['obs-signature'], { signatureArity: 2, defectSurface: 'behavior' }, {
          'legacy.mjs': `export function parseLegacy(input, preserveCase = true) {
  const value = String(input).trim()
  return preserveCase ? value : value.toUpperCase()
}
`,
        }),
        hypothesis('h2', 'Stop trimming and only keep the original string.', ['obs-signature'], { signatureArity: 1, preserveCase: true, defectSurface: 'behavior' }, {
          'legacy.mjs': `export function parseLegacy(input) {
  return String(input)
}
`,
        }),
        hypothesis('h3', 'Trim in the helper and leave the one-argument signature.', ['obs-signature'], { signatureArity: 1, preserveCase: true, defectSurface: 'behavior' }, {
          'legacy.mjs': `export function parseLegacy(input) {
  return normalize(input)
}
function normalize(input) {
  return String(input).trim()
}
`,
        }),
      ],
    },
    {
      caseId: 'REASON-MULTI-FILE',
      capabilityClass: 'MULTI_FILE_ARCHITECTURE',
      difficulty: 'D3',
      symptom: 'save() throws. The stack names the parser, and other callers need parse() to return an object.',
      constraints: ['parse() must keep returning an object.', 'store must not parse that object again.'],
      files: {
        'parser.mjs': 'export function parse(raw) { return JSON.parse(raw) }\n',
        'store.mjs': `import { parse } from './parser.mjs'
export function save(db, raw) {
  const value = parse(raw)
  db.push(JSON.parse(value))
}
export function titles(db) { return db.map(row => row.title) }
`,
      },
      observations: [
        observation('obs-double', 'parse() returns an object. store() parses that object again. The stack names the parser.', {
          doubleParse: true,
          parserReturns: 'object',
          defectSurface: 'behavior',
        }),
      ],
      uncertainties: ['Is the thrown parse in parser.mjs or the second parse in store.mjs?'],
      predictedFailureModes: ['Making parse() return a string fixes store and breaks object callers.'],
      hiddenAnswer: 'GRAD_HIDDEN_MULTI_FILE',
      verifySource: multiVerify,
      hypotheses: [
        hypothesis('h1', 'Make parse() return the raw string.', ['obs-double'], { parserReturns: 'string', defectSurface: 'behavior' }, {
          'parser.mjs': 'export function parse(raw) { return raw }\n',
        }),
        hypothesis('h2', 'Parse twice inside parser() and leave store() unchanged.', ['obs-double'], { doubleParse: true, parserReturns: 'object', defectSurface: 'behavior' }, {
          'parser.mjs': `export function parse(raw) {
  const value = JSON.parse(raw)
  return typeof value === 'string' ? JSON.parse(value) : value
}
`,
        }),
        hypothesis('h3', 'Push the object parse() already returned.', ['obs-double'], { doubleParse: true, parserReturns: 'object', defectSurface: 'behavior' }, {
          'store.mjs': `import { parse } from './parser.mjs'
export function save(db, raw) {
  db.push(parse(raw))
}
export function titles(db) { return db.map(row => row.title) }
`,
        }),
      ],
    },
    {
      caseId: 'REASON-CROSS-STACK',
      capabilityClass: 'CROSS_STACK_INTEGRATION',
      difficulty: 'D3',
      symptom: 'The client posts email. The server reads userEmail. The contract field is email.',
      constraints: ['Keep the client payload on email.', 'Read that field on the server.'],
      files: {
        'client.mjs': 'export function payload(email) { return { email } }\n',
        'server.mjs': 'export function readEmail(body) { return body.userEmail ?? "" }\n',
      },
      observations: [
        observation('obs-field', 'payload() sends email. readEmail() reads userEmail. The contract field is email.', {
          contractField: 'email',
          serverReads: 'userEmail',
          defectSurface: 'contract',
        }),
      ],
      uncertainties: ['Which side drifted from the contract?'],
      predictedFailureModes: ['Changing the client to userEmail makes the server pass and breaks the contract.'],
      hiddenAnswer: 'GRAD_HIDDEN_CROSS_STACK',
      verifySource: integrationVerify,
      hypotheses: [
        hypothesis('h1', 'Replace the integration test with assert true.', ['obs-field'], { defectSurface: 'test' }, {
          'client.test.mjs': 'import assert from "node:assert"\nassert.ok(true)\n',
        }),
        hypothesis('h2', 'Send userEmail from the client.', ['obs-field'], { contractField: 'userEmail', defectSurface: 'contract' }, {
          'client.mjs': 'export function payload(email) { return { userEmail: email } }\n',
        }),
        hypothesis('h3', 'Read body.email on the server and leave the client payload.', ['obs-field'], { contractField: 'email', serverReads: 'userEmail', defectSurface: 'contract' }, {
          'server.mjs': 'export function readEmail(body) { return body.email ?? "" }\n',
        }),
      ],
    },
    {
      caseId: 'REASON-ARCHITECTURE',
      capabilityClass: 'ARCHITECTURE_COMPARISON',
      difficulty: 'D3',
      symptom: 'createUser and inviteUser each accept a@b. Both need one shared email rule with a dot.',
      constraints: ['One validation rule for both routes.', 'Do not copy a second inline check.'],
      files: {
        'routes.mjs': `export function createUser(body) {
  if (!body.email || !body.email.includes('@')) return { ok: false }
  return { ok: true }
}
export function inviteUser(body) {
  if (!body.email || !body.email.includes('@')) return { ok: false }
  return { ok: true }
}
`,
      },
      observations: [
        observation('obs-dup', 'Two routes inline the same @ check and neither requires a dot.', {
          duplicatedRule: true,
          callSites: 2,
          defectSurface: 'architecture',
        }),
      ],
      uncertainties: ['Should each route grow its own rule, or should one function serve both?'],
      predictedFailureModes: ['Fixing only createUser leaves inviteUser inconsistent.'],
      hiddenAnswer: 'GRAD_HIDDEN_ARCHITECTURE',
      verifySource: architectureVerify,
      hypotheses: [
        hypothesis('h1', 'Require a dot only in createUser.', ['obs-dup'], { duplicatedRule: true, callSites: 2, defectSurface: 'architecture' }, {
          'routes.mjs': `export function createUser(body) {
  if (!body.email || !/@[^@\\s]+\\.[^@\\s]+/.test(body.email)) return { ok: false }
  return { ok: true }
}
export function inviteUser(body) {
  if (!body.email || !body.email.includes('@')) return { ok: false }
  return { ok: true }
}
`,
        }),
        hypothesis('h2', 'Give each route a different email rule.', ['obs-dup'], { duplicatedRule: true, callSites: 2, defectSurface: 'architecture' }, {
          'routes.mjs': `export function createUser(body) {
  if (!body.email || !/@[^@\\s]+\\.[^@\\s]+/.test(body.email)) return { ok: false }
  return { ok: true }
}
export function inviteUser(body) {
  if (!body.email || !body.email.includes('@') || !body.email.includes('.')) return { ok: false }
  return { ok: true }
}
`,
        }),
        hypothesis('h3', 'Share one isValidEmail function across both routes.', ['obs-dup'], { duplicatedRule: true, callSites: 2, defectSurface: 'architecture' }, {
          'routes.mjs': `export function isValidEmail(email) {
  return typeof email === 'string' && /@[^@\\s]+\\.[^@\\s]+/.test(email)
}
export function createUser(body) {
  if (!isValidEmail(body.email)) return { ok: false }
  return { ok: true }
}
export function inviteUser(body) {
  if (!isValidEmail(body.email)) return { ok: false }
  return { ok: true }
}
`,
        }),
      ],
    },
  ]
}

export function sequenceModel(ids: string[], label = 'sequence'): FoundryReasoningModel {
  let cursor = 0
  return {
    provider: 'interchangeable-stub',
    model: label,
    choose(input) {
      const open = input.hypotheses.map(item => item.id).filter(id => !input.rejectedIds.includes(id))
      while (cursor < ids.length && !open.includes(ids[cursor])) cursor += 1
      const hypothesisId = open.includes(ids[cursor] ?? '') ? ids[cursor] : (open[0] ?? '')
      cursor += 1
      return {
        hypothesisId,
        rationale: `Observations ${input.observations.map(item => item.id).join(', ')} bound this choice.`,
      }
    },
  }
}
