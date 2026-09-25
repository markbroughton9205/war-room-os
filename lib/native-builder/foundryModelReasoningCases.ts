/**
 * Distinct model-driven reasoning fixtures.
 * Hidden verifiers are not seeded into the project the model can read.
 * Superficial overlays are harness evidence only. The model runner must not apply them.
 */
import { createHash } from 'node:crypto'
import type { FoundryCapabilityClass } from './foundryEngineeringReasoningTypes'

export type FoundryModelReasoningCase = {
  caseId: string
  capabilityClass: FoundryCapabilityClass
  difficulty: 'D1' | 'D2' | 'D3'
  trivial: boolean
  symptom: string
  constraints: string[]
  files: Record<string, string>
  writeSet: string[]
  verifySource: string
  hiddenAnswer: string
  superficialFiles: Record<string, string>
  atlasFamily: 'ROOT_CAUSE_DIAGNOSIS' | 'AMBIGUITY_RESOLUTION' | 'CROSS_LAYER_REASONING' | 'REGRESSION_REASONING' | 'PERFORMANCE_DIAGNOSIS' | 'LEGACY_CONSTRAINT_REASONING' | 'TEST_TRUTH_DISCRIMINATION'
}

export const FOUNDRY_MODEL_REASONING_FAST_IDS = [
  'REASON-M2-HOLDS',
  'REASON-M2-INVOICE',
  'REASON-M2-SKU',
] as const

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function modelReasoningVariation(reasoningCase: FoundryModelReasoningCase): { requirementsHash: string; variationHash: string } {
  return {
    requirementsHash: hash(`${reasoningCase.caseId}|${reasoningCase.constraints.join('|')}`),
    variationHash: hash(`${reasoningCase.caseId}|${Object.keys(reasoningCase.files).join('|')}|${reasoningCase.symptom}`),
  }
}

export function modelReasoningCases(): FoundryModelReasoningCase[] {
  return [
    {
      caseId: 'REASON-M2-HOLDS',
      capabilityClass: 'AMBIGUOUS_BUG',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'AMBIGUITY_RESOLUTION',
      symptom: 'Library dueCount stays 0 after place(). A returned copy must not increase dueCount.',
      constraints: ['Two plausible ledgers exist: shelf and returns.', 'Do not make dueCount equal the returns list.'],
      writeSet: ['hold-ledger.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_HOLDS',
      files: {
        'hold-ledger.mjs': `export function createLedger() {
  const shelf = []
  const returns = []
  return {
    place(copyId, options) { returns.push(copyId) },
    dueCount() { return shelf.length },
  }
}
`,
      },
      superficialFiles: {
        'hold-ledger.mjs': `export function createLedger() {
  const returns = []
  return {
    place(copyId) { returns.push(copyId) },
    dueCount() { return returns.length },
  }
}
`,
      },
      verifySource: `import { createLedger } from './hold-ledger.mjs'
const open = createLedger()
open.place('c1')
open.place('c2')
if (open.dueCount() !== 2) throw new Error('accepted copies must be due')
const mixed = createLedger()
mixed.place('c3')
mixed.place('c4', { returned: true })
if (mixed.dueCount() !== 1) throw new Error('place() with returned true increased dueCount')
`,
    },
    {
      caseId: 'REASON-M2-INVOICE',
      capabilityClass: 'MISLEADING_REGRESSION',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'TEST_TRUTH_DISCRIMINATION',
      symptom: 'invoice.test.mjs fails. schema.json seals the payload field as currency. The test currently asserts true.',
      constraints: ['Do not rename the sealed schema field.', 'The test must read invoice.currency.'],
      writeSet: ['invoice.mjs', 'invoice.test.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_INVOICE',
      files: {
        'schema.json': '{"field":"currency"}\n',
        'invoice.mjs': 'export function loadInvoice() { return { currency: "usd" } }\n',
        'invoice.test.mjs': `import assert from 'node:assert/strict'
assert.ok(true)
// previous assertion read invoice.currencyCode
`,
      },
      superficialFiles: {
        'invoice.mjs': 'export function loadInvoice() { return { currencyCode: "usd" } }\n',
        'invoice.test.mjs': `import { loadInvoice } from './invoice.mjs'
const invoice = loadInvoice()
if (invoice.currencyCode !== 'usd') throw new Error('currency missing')
`,
      },
      verifySource: `import { readFileSync } from 'node:fs'
import { loadInvoice } from './invoice.mjs'
const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'))
if (schema.field !== 'currency') throw new Error('contract field must stay currency')
const invoice = loadInvoice()
if (!Object.prototype.hasOwnProperty.call(invoice, 'currency') || Object.prototype.hasOwnProperty.call(invoice, 'currencyCode')) {
  throw new Error('contract field must stay currency')
}
const test = readFileSync(new URL('./invoice.test.mjs', import.meta.url), 'utf8')
if (test.includes('assert.ok(true)')) throw new Error('public test still asserts true')
if (test.includes('currencyCode')) throw new Error('test still reads the stale field')
if (!test.includes('currency')) throw new Error('test does not read the sealed currency field')
await import('./invoice.test.mjs')
`,
    },
    {
      caseId: 'REASON-M2-PARTS',
      capabilityClass: 'PERFORMANCE_BOTTLENECK',
      difficulty: 'D2',
      trivial: false,
      atlasFamily: 'PERFORMANCE_DIAGNOSIS',
      symptom: 'lookup() parses the whole catalog again on every row. Return the matching part and keep parses near one.',
      constraints: ['Do not raise a LIMIT constant.', 'Duplicate ids are not the defect.'],
      writeSet: ['catalog.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_PARTS',
      files: {
        'catalog.mjs': `export function lookup(parts, id) {
  const blob = JSON.stringify(parts)
  let parses = 0
  let found = null
  for (const part of parts) {
    parses += 1
    const again = JSON.parse(blob)
    const hit = again.find(item => item.id === id)
    if (hit && part.id === id) found = hit
  }
  return { part: found, parses }
}
`,
      },
      superficialFiles: {
        'catalog.mjs': `const LIMIT = 1000000
export function lookup(parts, id) {
  const blob = JSON.stringify(parts)
  let parses = 0
  let found = null
  for (const part of parts) {
    parses += 1
    if (parses > LIMIT) break
    const again = JSON.parse(blob)
    if (part.id === id) found = again.find(item => item.id === id)
  }
  return { part: found, parses }
}
`,
      },
      verifySource: `import { lookup } from './catalog.mjs'
const parts = []
for (let i = 0; i < 30; i += 1) parts.push({ id: 'p' + i, bay: i })
const result = lookup(parts, 'p7')
if (!result.part || result.part.id !== 'p7') throw new Error('missing part')
if (result.parses >= 30) throw new Error('repeated parse')
`,
    },
    {
      caseId: 'REASON-M2-ACTOR',
      capabilityClass: 'CONCURRENCY_STATE',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'ROOT_CAUSE_DIAGNOSIS',
      symptom: 'bind() stores the actor in one module variable, so the first workshop handle sees the second actor.',
      constraints: ['Each bind() result must keep its own name.', 'Do not ignore the second bind().'],
      writeSet: ['actor.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_ACTOR',
      files: {
        'actor.mjs': `let actor = null
export function bind(name) {
  actor = name
  return { label: () => actor }
}
`,
      },
      superficialFiles: {
        'actor.mjs': `let actor = null
export function bind(name) {
  if (!actor) actor = name
  return { label: () => actor }
}
`,
      },
      verifySource: `import { bind } from './actor.mjs'
const first = bind('mina')
const second = bind('otto')
if (first.label() !== 'mina' || second.label() !== 'otto') throw new Error('shared actor')
`,
    },
    {
      caseId: 'REASON-M2-EVENTS',
      capabilityClass: 'INCOMPLETE_SPEC',
      difficulty: 'D2',
      trivial: false,
      atlasFamily: 'ROOT_CAUSE_DIAGNOSIS',
      symptom: 'Store the event. The existing file is JSON lines. A repeated id must replace that line, not append a second copy.',
      constraints: ['Read events.jsonl before choosing a format.', 'Do not rewrite the file as CSV.'],
      writeSet: ['log.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_EVENTS',
      files: {
        'events.jsonl': '{"id":"e1","bay":"north"}\n',
        'log.mjs': `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
export function readEvents(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line))
}
export function writeEvent(file, record) {
  appendFileSync(file, record.bay + '\\n')
}
export function replaceFile(file, text) { writeFileSync(file, text) }
`,
      },
      superficialFiles: {
        'log.mjs': `import { writeFileSync, existsSync, readFileSync } from 'node:fs'
export function readEvents(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line))
}
export function writeEvent(file, record) {
  writeFileSync(file, 'bay\\n' + record.bay + '\\n')
}
`,
      },
      verifySource: `import { readEvents, writeEvent } from './log.mjs'
writeEvent('events.jsonl', { id: 'e1', bay: 'south' })
writeEvent('events.jsonl', { id: 'e2', bay: 'east' })
const rows = readEvents('events.jsonl')
if (rows.length !== 2) throw new Error('jsonl identity')
if (rows.find(row => row.id === 'e1')?.bay !== 'south') throw new Error('jsonl identity')
if (rows.find(row => row.id === 'e2')?.bay !== 'east') throw new Error('jsonl identity')
`,
    },
    {
      caseId: 'REASON-M2-TAG',
      capabilityClass: 'LEGACY_MODIFICATION',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'LEGACY_CONSTRAINT_REASONING',
      symptom: 'formatTag uppercases its input. Callers depend on one argument and mixed-case dock tags.',
      constraints: ['formatTag.length must stay 1.', 'Trim surrounding spaces.'],
      writeSet: ['tag.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_TAG',
      files: {
        'tag.mjs': `export function formatTag(value) {
  return normalize(value)
}
function normalize(value) {
  return String(value).trim().toUpperCase()
}
`,
      },
      superficialFiles: {
        'tag.mjs': `export function formatTag(value, preserveCase = true) {
  const text = String(value).trim()
  return preserveCase ? text : text.toUpperCase()
}
`,
      },
      verifySource: `import { readFileSync } from 'node:fs'
import { formatTag } from './tag.mjs'
const source = readFileSync(new URL('./tag.mjs', import.meta.url), 'utf8')
if (formatTag.length !== 1 || /function formatTag\\([^)]*,/.test(source)) throw new Error('signature')
if (formatTag('  north-dock  ') !== 'north-dock') throw new Error('legacy case')
`,
    },
    {
      caseId: 'REASON-M2-SKU',
      capabilityClass: 'CROSS_STACK_INTEGRATION',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'CROSS_LAYER_REASONING',
      symptom: 'The picker sends sku. The gate reads productCode. contract.txt says field=sku.',
      constraints: ['Keep the picker payload on sku.', 'Read that field in the gate.'],
      writeSet: ['picker.mjs', 'gate.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_SKU',
      files: {
        'contract.txt': 'field=sku\n',
        'picker.mjs': 'export function payload(sku) { return { sku } }\n',
        'gate.mjs': 'export function readSku(body) { return body.productCode ?? "" }\n',
      },
      superficialFiles: {
        'picker.mjs': 'export function payload(sku) { return { productCode: sku } }\n',
      },
      verifySource: `import { readFileSync } from 'node:fs'
import { payload } from './picker.mjs'
import { readSku } from './gate.mjs'
const contract = readFileSync(new URL('./contract.txt', import.meta.url), 'utf8')
if (!contract.includes('field=sku')) throw new Error('contract field')
const body = payload('BX-14')
if (body.sku !== 'BX-14') throw new Error('client contract')
if (readSku(body) !== 'BX-14') throw new Error('server field')
`,
    },
    {
      caseId: 'REASON-M2-CENTS',
      capabilityClass: 'ARCHITECTURE_COMPARISON',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'CROSS_LAYER_REASONING',
      symptom: 'quote.mjs and bill.mjs each floor the cents. Both must round half up through one shared rule.',
      constraints: ['One rounding function.', 'Both consumers must use it.'],
      writeSet: ['quote.mjs', 'bill.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_CENTS',
      files: {
        'quote.mjs': `export function quote(amount) {
  return Math.floor(amount * 100) / 100
}
`,
        'bill.mjs': `export function bill(amount) {
  return Math.floor(amount * 100) / 100
}
`,
      },
      superficialFiles: {
        'quote.mjs': `export function quote(amount) {
  return Math.round(amount * 100) / 100
}
`,
        'bill.mjs': `export function bill(amount) {
  return Math.floor(amount * 100) / 100
}
`,
      },
      verifySource: `import { readFileSync } from 'node:fs'
import { quote } from './quote.mjs'
import { bill } from './bill.mjs'
if (quote(10.005) !== 10.01 || bill(10.005) !== 10.01) throw new Error('half up')
const quoteSource = readFileSync(new URL('./quote.mjs', import.meta.url), 'utf8')
const billSource = readFileSync(new URL('./bill.mjs', import.meta.url), 'utf8')
if (quoteSource.includes('Math.floor') || billSource.includes('Math.floor')) throw new Error('duplicated rule')
const helperNames = [...(quoteSource + '\\n' + billSource).matchAll(/function\\s+([A-Za-z0-9_]+)/g)].map(match => match[1]).filter(name => name !== 'quote' && name !== 'bill')
const imported = [...(quoteSource + '\\n' + billSource).matchAll(/import\\s*\\{([^}]+)\\}\\s*from\\s*['\\\"]\\.\\//g)].flatMap(match => match[1].split(',').map(name => name.trim()))
const shared = [...helperNames, ...imported].find(name => name && quoteSource.includes(name) && billSource.includes(name))
if (!shared) throw new Error('duplicated rule')
`,
    },
    {
      caseId: 'REASON-M2-BIN',
      capabilityClass: 'MULTI_FILE_ARCHITECTURE',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'ROOT_CAUSE_DIAGNOSIS',
      symptom: 'store() throws. The log names decode.mjs. Other callers need decode() to return an object.',
      constraints: ['decode() must keep returning an object.', 'Do not parse that object a second time.'],
      writeSet: ['decode.mjs', 'bin.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_BIN',
      files: {
        'notes.txt': 'Observed throw: SyntaxError at decode.mjs. Confirm which file parses twice before editing.\n',
        'decode.mjs': 'export function decode(raw) { return JSON.parse(raw) }\n',
        'bin.mjs': `import { decode } from './decode.mjs'
export function store(db, raw) {
  const value = decode(raw)
  db.push(JSON.parse(value))
}
export function titles(db) { return db.map(row => row.title) }
`,
      },
      superficialFiles: {
        'decode.mjs': 'export function decode(raw) { return raw }\n',
      },
      verifySource: `import { decode } from './decode.mjs'
import { store, titles } from './bin.mjs'
const parsed = decode('{"title":"Crate"}')
if (typeof parsed === 'string' || parsed.title !== 'Crate') throw new Error('parser contract')
const db = []
store(db, '{"title":"Crate"}')
if (titles(db)[0] !== 'Crate') throw new Error('second parse')
`,
    },
    {
      caseId: 'REASON-M2-SUM',
      capabilityClass: 'AMBIGUOUS_BUG',
      difficulty: 'D1',
      trivial: true,
      atlasFamily: 'ROOT_CAUSE_DIAGNOSIS',
      symptom: 'add() subtracts. It must return the sum of its two arguments.',
      constraints: ['One function.', 'No extra files.'],
      writeSet: ['sum.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M2_SUM',
      files: {
        'sum.mjs': 'export function add(left, right) { return left - right }\n',
      },
      superficialFiles: {
        'sum.mjs': 'export function add() { return 5 }\n',
      },
      verifySource: `import { add } from './sum.mjs'
if (add(2, 3) !== 5 || add(0, 1) !== 1) throw new Error('sum')
`,
    },
  ]
}

export function selectModelReasoningCases(options?: { full?: boolean; ids?: string[] }): FoundryModelReasoningCase[] {
  const all = modelReasoningCases()
  if (options?.ids?.length) return all.filter(item => options.ids!.includes(item.caseId))
  if (options?.full) return all
  return all.filter(item => (FOUNDRY_MODEL_REASONING_FAST_IDS as readonly string[]).includes(item.caseId) || item.trivial)
}
