/**
 * Fresh practice variants for the seven Mission 02 qualifying failures.
 * Domains, identifiers, and layouts differ from the original fixtures.
 */
import type { FoundryModelReasoningCase } from './foundryModelReasoningCases'
import { modelReasoningCases } from './foundryModelReasoningCases'

function practice(partial: FoundryModelReasoningCase): FoundryModelReasoningCase {
  return partial
}

export function reasoningPracticeCases(): FoundryModelReasoningCase[] {
  const variantsA: FoundryModelReasoningCase[] = [
    practice({
      caseId: 'PRACTICE-M3-STOCK',
      capabilityClass: 'PERFORMANCE_BOTTLENECK',
      difficulty: 'D2',
      trivial: false,
      atlasFamily: 'PERFORMANCE_DIAGNOSIS',
      symptom: 'indexStock parses the aisle json again on every bin. Parse once per call and keep parses near one.',
      constraints: ['Do not raise a LIMIT constant.', 'Duplicate aisle ids are not the defect.'],
      writeSet: ['aisle.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M3_STOCK',
      files: {
        'aisle.mjs': `export function indexStock(bins, aisleId) {
  const blob = JSON.stringify(bins)
  let parses = 0
  let found = null
  for (const bin of bins) {
    parses += 1
    const again = JSON.parse(blob)
    if (bin.aisleId === aisleId) found = again.find(item => item.aisleId === aisleId)
  }
  return { bin: found, parses }
}
`,
      },
      superficialFiles: {
        'aisle.mjs': `const LIMIT = 1000000
export function indexStock(bins, aisleId) {
  const blob = JSON.stringify(bins)
  let parses = 0
  let found = null
  for (const bin of bins) {
    parses += 1
    if (parses > LIMIT) break
    const again = JSON.parse(blob)
    if (bin.aisleId === aisleId) found = again.find(item => item.aisleId === aisleId)
  }
  return { bin: found, parses }
}
`,
      },
      verifySource: `import { indexStock } from './aisle.mjs'
const bins = []
for (let i = 0; i < 24; i += 1) bins.push({ aisleId: 'a' + i, shelf: i })
const result = indexStock(bins, 'a4')
if (!result.bin || result.bin.aisleId !== 'a4') throw new Error('missing bin')
if (result.parses >= 24) throw new Error('repeated parse')
`,
    }),
    practice({
      caseId: 'PRACTICE-M3-RECEIPT',
      capabilityClass: 'MISLEADING_REGRESSION',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'TEST_TRUTH_DISCRIMINATION',
      symptom: 'receipt.test.mjs fails. schema.json seals the payload field as unit. The test currently asserts true.',
      constraints: ['Do not rename the sealed schema field.', 'The test must read receipt.unit.'],
      writeSet: ['receipt.mjs', 'receipt.test.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M3_RECEIPT',
      files: {
        'schema.json': '{"field":"unit"}\n',
        'receipt.mjs': 'export function loadReceipt() { return { unit: "crate" } }\n',
        'receipt.test.mjs': `import assert from 'node:assert/strict'
assert.ok(true)
// previous assertion read receipt.unitCode
`,
      },
      superficialFiles: {
        'receipt.mjs': 'export function loadReceipt() { return { unitCode: "crate" } }\n',
        'receipt.test.mjs': `import { loadReceipt } from './receipt.mjs'
const receipt = loadReceipt()
if (receipt.unitCode !== 'crate') throw new Error('unit missing')
`,
      },
      verifySource: `import { readFileSync } from 'node:fs'
import { loadReceipt } from './receipt.mjs'
const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'))
if (schema.field !== 'unit') throw new Error('contract field must stay unit')
const receipt = loadReceipt()
if (!Object.prototype.hasOwnProperty.call(receipt, 'unit') || Object.prototype.hasOwnProperty.call(receipt, 'unitCode')) {
  throw new Error('contract field must stay unit')
}
const test = readFileSync(new URL('./receipt.test.mjs', import.meta.url), 'utf8')
if (test.includes('assert.ok(true)')) throw new Error('public test still asserts true')
if (test.includes('unitCode')) throw new Error('test still reads the stale field')
if (!test.includes('unit')) throw new Error('test does not read the sealed unit field')
await import('./receipt.test.mjs')
`,
    }),
    practice({
      caseId: 'PRACTICE-M3-CRIB',
      capabilityClass: 'AMBIGUOUS_BUG',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'AMBIGUITY_RESOLUTION',
      symptom: 'loanCount stays 0 after lend(). A returned tool must not increase loanCount.',
      constraints: ['Two plausible ledgers exist: rack and returns.', 'Do not make loanCount equal the returns list.'],
      writeSet: ['crib.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M3_CRIB',
      files: {
        'crib.mjs': `export function createCrib() {
  const rack = []
  const returns = []
  return {
    lend(toolId, options) { returns.push(toolId) },
    loanCount() { return rack.length },
  }
}
`,
      },
      superficialFiles: {
        'crib.mjs': `export function createCrib() {
  const returns = []
  return {
    lend(toolId) { returns.push(toolId) },
    loanCount() { return returns.length },
  }
}
`,
      },
      verifySource: `import { createCrib } from './crib.mjs'
const open = createCrib()
open.lend('t1')
open.lend('t2')
if (open.loanCount() !== 2) throw new Error('accepted tools must be on loan')
const mixed = createCrib()
mixed.lend('t3')
mixed.lend('t4', { returned: true })
if (mixed.loanCount() !== 1) throw new Error('returned tool counted')
`,
    }),
    practice({
      caseId: 'PRACTICE-M3-DESK',
      capabilityClass: 'CONCURRENCY_STATE',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'ROOT_CAUSE_DIAGNOSIS',
      symptom: 'claim() stores the clerk in one module variable, so the first desk handle sees the second clerk.',
      constraints: ['Each claim() result must keep its own name.', 'Do not ignore the second claim().'],
      writeSet: ['desk.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M3_DESK',
      files: {
        'desk.mjs': `let clerk = null
export function claim(name) {
  clerk = name
  return { who: () => clerk }
}
`,
      },
      superficialFiles: {
        'desk.mjs': `let clerk = null
export function claim(name) {
  if (!clerk) clerk = name
  return { who: () => clerk }
}
`,
      },
      verifySource: `import { claim } from './desk.mjs'
const first = claim('nora')
const second = claim('pius')
if (first.who() !== 'nora' || second.who() !== 'pius') throw new Error('shared clerk')
`,
    }),
    practice({
      caseId: 'PRACTICE-M3-SHIP',
      capabilityClass: 'INCOMPLETE_SPEC',
      difficulty: 'D2',
      trivial: false,
      atlasFamily: 'ROOT_CAUSE_DIAGNOSIS',
      symptom: 'Store the shipment. The existing file is JSON lines. A repeated id must replace that line, not append a second copy.',
      constraints: ['Read shipments.jsonl before choosing a format.', 'Do not rewrite the file as CSV.'],
      writeSet: ['ship.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M3_SHIP',
      files: {
        'shipments.jsonl': '{"id":"s1","dock":"west"}\n',
        'ship.mjs': `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
export function readShipments(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line))
}
export function writeShipment(file, record) {
  appendFileSync(file, record.dock + '\\n')
}
export function replaceFile(file, text) { writeFileSync(file, text) }
`,
      },
      superficialFiles: {
        'ship.mjs': `import { writeFileSync, existsSync, readFileSync } from 'node:fs'
export function readShipments(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line))
}
export function writeShipment(file, record) {
  writeFileSync(file, 'dock\\n' + record.dock + '\\n')
}
`,
      },
      verifySource: `import { readShipments, writeShipment } from './ship.mjs'
writeShipment('shipments.jsonl', { id: 's1', dock: 'east' })
writeShipment('shipments.jsonl', { id: 's2', dock: 'north' })
const rows = readShipments('shipments.jsonl')
if (rows.length !== 2) throw new Error('jsonl identity')
if (rows.find(row => row.id === 's1')?.dock !== 'east') throw new Error('jsonl identity')
if (rows.find(row => row.id === 's2')?.dock !== 'north') throw new Error('jsonl identity')
`,
    }),
    practice({
      caseId: 'PRACTICE-M3-FEE',
      capabilityClass: 'ARCHITECTURE_COMPARISON',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'CROSS_LAYER_REASONING',
      symptom: 'fee.mjs and levy.mjs each floor the cents. Both must round half up through one shared rule.',
      constraints: ['One rounding function.', 'Both consumers must use it.'],
      writeSet: ['fee.mjs', 'levy.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M3_FEE',
      files: {
        'fee.mjs': 'export function fee(amount) { return Math.floor(amount * 100) / 100 }\n',
        'levy.mjs': 'export function levy(amount) { return Math.floor(amount * 100) / 100 }\n',
      },
      superficialFiles: {
        'fee.mjs': 'export function fee(amount) { return Math.round(amount * 100) / 100 }\n',
        'levy.mjs': 'export function levy(amount) { return Math.floor(amount * 100) / 100 }\n',
      },
      verifySource: `import { readFileSync } from 'node:fs'
import { fee } from './fee.mjs'
import { levy } from './levy.mjs'
if (fee(10.005) !== 10.01 || levy(10.005) !== 10.01) throw new Error('half up')
const feeSource = readFileSync(new URL('./fee.mjs', import.meta.url), 'utf8')
const levySource = readFileSync(new URL('./levy.mjs', import.meta.url), 'utf8')
if (feeSource.includes('Math.floor') || levySource.includes('Math.floor')) throw new Error('duplicated rule')
const names = [...(feeSource + levySource).matchAll(/function\\s+([A-Za-z0-9_]+)/g)].map(match => match[1]).filter(name => name !== 'fee' && name !== 'levy')
const imported = [...(feeSource + levySource).matchAll(/import\\s*\\{([^}]+)\\}/g)].flatMap(match => match[1].split(',').map(name => name.trim()))
if (![...names, ...imported].some(name => name && feeSource.includes(name) && levySource.includes(name))) throw new Error('duplicated rule')
`,
    }),
    practice({
      caseId: 'PRACTICE-M3-CRATE',
      capabilityClass: 'MULTI_FILE_ARCHITECTURE',
      difficulty: 'D3',
      trivial: false,
      atlasFamily: 'ROOT_CAUSE_DIAGNOSIS',
      symptom: 'keep() throws. The log names unpack.mjs. Other callers need unpack() to return an object.',
      constraints: ['unpack() must keep returning an object.', 'Do not parse that object a second time.'],
      writeSet: ['unpack.mjs', 'keep.mjs'],
      hiddenAnswer: 'GRAD_HIDDEN_M3_CRATE',
      files: {
        'notes.txt': 'Observed throw: SyntaxError at unpack.mjs. Confirm which file parses twice before editing.\n',
        'unpack.mjs': 'export function unpack(raw) { return JSON.parse(raw) }\n',
        'keep.mjs': `import { unpack } from './unpack.mjs'
export function keep(db, raw) {
  const value = unpack(raw)
  db.push(JSON.parse(value))
}
export function labels(db) { return db.map(row => row.label) }
`,
      },
      superficialFiles: {
        'unpack.mjs': 'export function unpack(raw) { return raw }\n',
      },
      verifySource: `import { unpack } from './unpack.mjs'
import { keep, labels } from './keep.mjs'
const parsed = unpack('{"label":"Spool"}')
if (typeof parsed === 'string' || parsed.label !== 'Spool') throw new Error('parser contract')
const db = []
keep(db, '{"label":"Spool"}')
if (labels(db)[0] !== 'Spool') throw new Error('second parse')
`,
    }),
  ]
  return variantsA
}

export const FIDELITY_FAST_IDS = ['PRACTICE-M3-STOCK', 'PRACTICE-M3-RECEIPT', 'REASON-M2-SKU'] as const

export const ORIGINAL_REEVALUATION_IDS = [
  'REASON-M2-HOLDS',
  'REASON-M2-INVOICE',
  'REASON-M2-PARTS',
  'REASON-M2-ACTOR',
  'REASON-M2-EVENTS',
  'REASON-M2-CENTS',
  'REASON-M2-BIN',
] as const

export function selectFidelityCases(options?: { full?: boolean; ids?: string[] }): FoundryModelReasoningCase[] {
  const practice = reasoningPracticeCases()
  const originals = modelReasoningCases()
  const all = [...practice, ...originals]
  if (options?.ids?.length) return all.filter(item => options.ids!.includes(item.caseId))
  if (options?.full) {
    const reeval = originals.filter(item => (ORIGINAL_REEVALUATION_IDS as readonly string[]).includes(item.caseId) || item.caseId === 'REASON-M2-TAG' || item.caseId === 'REASON-M2-SKU' || item.trivial)
    return [...practice, ...reeval]
  }
  return all.filter(item => (FIDELITY_FAST_IDS as readonly string[]).includes(item.caseId))
}
