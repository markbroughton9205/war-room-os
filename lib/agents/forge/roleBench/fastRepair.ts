import { changedRatio, extractCode, runModule } from './exec'
import type { Fixture } from './types'

/** FAST_REPAIR_WORKER: one targeted defect in a small file; the answer must pass behavioural assertions AND stay a bounded edit (<= 50% of lines changed). */
type Case = { id: string; symptom: string; buggy: string; fixed: string; test: string }
const HEAD = "import assert from 'node:assert/strict'\n"
const CASES: Case[] = [
  { id: 'missing_import', symptom: 'ReferenceError: join is not defined', buggy: "export function configPath(dir, name) {\n  return join(dir, name + '.json')\n}\n", fixed: "import { join } from 'node:path'\nexport function configPath(dir, name) {\n  return join(dir, name + '.json')\n}\n", test: "assert.equal(configPath('a', 'b'), 'a/b.json')" },
  { id: 'unclosed_brace', symptom: 'SyntaxError: Unexpected end of input', buggy: 'export function average(xs) {\n  if (xs.length === 0) return 0\n  let sum = 0\n  for (const x of xs) {\n    sum += x\n\n  return sum / xs.length\n}\n', fixed: 'export function average(xs) {\n  if (xs.length === 0) return 0\n  let sum = 0\n  for (const x of xs) {\n    sum += x\n  }\n  return sum / xs.length\n}\n', test: 'assert.equal(average([2, 4, 6]), 4); assert.equal(average([]), 0)' },
  { id: 'off_by_one', symptom: 'sumTo(3) returns 3, expected 6', buggy: 'export function sumTo(n) {\n  let total = 0\n  for (let i = 1; i < n; i++) total += i\n  return total\n}\n', fixed: 'export function sumTo(n) {\n  let total = 0\n  for (let i = 1; i <= n; i++) total += i\n  return total\n}\n', test: 'assert.equal(sumTo(3), 6); assert.equal(sumTo(1), 1); assert.equal(sumTo(0), 0)' },
  { id: 'wrong_branch_value', symptom: 'clamp(15, 0, 10) returns 0, expected 10', buggy: 'export function clamp(v, min, max) {\n  if (v < min) return min\n  if (v > max) return min\n  return v\n}\n', fixed: 'export function clamp(v, min, max) {\n  if (v < min) return min\n  if (v > max) return max\n  return v\n}\n', test: 'assert.equal(clamp(15, 0, 10), 10); assert.equal(clamp(-1, 0, 10), 0); assert.equal(clamp(5, 0, 10), 5)' },
  { id: 'typo_property', symptom: 'lastItem([1,2,3]) returns undefined', buggy: 'export function lastItem(xs) {\n  return xs[xs.lenght - 1]\n}\n', fixed: 'export function lastItem(xs) {\n  return xs[xs.length - 1]\n}\n', test: 'assert.equal(lastItem([1, 2, 3]), 3)' },
  { id: 'missing_await', symptom: 'loadAll returns an array of Promises instead of values', buggy: 'export async function loadAll(fetchOne, ids) {\n  const out = []\n  for (const id of ids) out.push(fetchOne(id))\n  return out\n}\n', fixed: 'export async function loadAll(fetchOne, ids) {\n  const out = []\n  for (const id of ids) out.push(await fetchOne(id))\n  return out\n}\n', test: 'assert.deepEqual(await loadAll(async (id) => id * 2, [1, 2, 3]), [2, 4, 6])' },
  { id: 'missing_return', symptom: 'titleCase("hello world") returns undefined', buggy: "export function titleCase(s) {\n  const r = s.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')\n}\n", fixed: "export function titleCase(s) {\n  const r = s.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')\n  return r\n}\n", test: "assert.equal(titleCase('hello world'), 'Hello World')" },
  { id: 'lexicographic_sort', symptom: 'sortedNumbers([10, 9, 1]) returns [1, 10, 9], expected [1, 9, 10]', buggy: 'export function sortedNumbers(xs) {\n  return [...xs].sort()\n}\n', fixed: 'export function sortedNumbers(xs) {\n  return [...xs].sort((a, b) => a - b)\n}\n', test: 'assert.deepEqual(sortedNumbers([10, 9, 1]), [1, 9, 10])' },
  { id: 'mutates_input', symptom: 'withoutFirst changes the array passed in; callers must keep their original', buggy: 'export function withoutFirst(xs) {\n  xs.shift()\n  return xs\n}\n', fixed: 'export function withoutFirst(xs) {\n  return xs.slice(1)\n}\n', test: 'const a = [1, 2, 3]; assert.deepEqual(withoutFirst(a), [2, 3]); assert.deepEqual(a, [1, 2, 3])' },
  { id: 'wrong_delimiter', symptom: 'parseKv("a=1;b=2") returns {"a":"1;b","=2":...}; pairs are separated by semicolons', buggy: "export function parseKv(s) {\n  const out = {}\n  for (const pair of s.split(',')) {\n    const [k, v] = pair.split('=')\n    out[k] = v\n  }\n  return out\n}\n", fixed: "export function parseKv(s) {\n  const out = {}\n  for (const pair of s.split(';')) {\n    const [k, v] = pair.split('=')\n    out[k] = v\n  }\n  return out\n}\n", test: "assert.deepEqual(parseKv('a=1;b=2'), { a: '1', b: '2' })" },
]

const SYSTEM = 'You repair small JavaScript files. Fix ONLY the reported defect and change as little as possible. Reply with the complete corrected file in exactly one ```js code block and nothing else.'

export function fastRepairFixtures(): Fixture[] {
  return CASES.map((c): Fixture => ({
    id: `fast_repair/${c.id}`, role: 'FAST_REPAIR_WORKER', system: SYSTEM, maxTokens: 700,
    prompt: `File (ES module):\n\`\`\`js\n${c.buggy}\`\`\`\n\nReported problem: ${c.symptom}\n\nReturn the corrected file.`,
    reference: '```js\n' + c.fixed + '```', broken: '```js\n' + c.buggy + '```',
    async check(reply) {
      const code = extractCode(reply)
      if (!code) return { pass: false, detail: 'no code in reply' }
      const r = await runModule(`${code}\n${HEAD}${c.test}\n`)
      if (!r.ok) return { pass: false, detail: (r.timedOut ? 'timed out' : r.stderr.split('\n').find((l) => /Error/.test(l)) ?? `exit ${r.exitCode}`).slice(0, 140) }
      const ratio = changedRatio(c.buggy, code)
      return ratio > 0.5 ? { pass: false, detail: `passes but rewrote ${Math.round(ratio * 100)}% of the file (bounded edit required)` } : { pass: true, detail: `passes; ${Math.round(ratio * 100)}% of lines changed` }
    },
  }))
}
