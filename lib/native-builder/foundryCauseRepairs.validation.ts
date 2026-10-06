/**
 * Cause first. Behaviour is checked on the REAL Proof A fixture (a data file that starts with a byte-order mark) with real Python runs:
 * the minimal repair at the cause passes, the workaround that spells the mark out passes too, and only the first is what Foundry lets through.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as causes from './foundryCauseRepairs'
import { guardPlannedEdit } from './foundryEditGuard'
import { editFromProposal } from './foundryEngineeringSpecialist'
import { plainOutputEnv } from './foundryEngineeringRuntime'
import { runMutation, type Mutation } from './foundryMutationHarness'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const ROOT = resolveRepoRoot()
const FIXTURE = path.join(ROOT, 'lib/native-builder/__fixtures__/foundry-phase5/a-prices')
const LOADER = 'prices/loader.py'
const loader = readFileSync(path.join(FIXTURE, LOADER), 'utf8')
const env = { ...plainOutputEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }

// What the runtime trace really printed for the failing test (recorded run).
const TRACE = "It failed with KeyError: 'product' at prices/loader.py:load_prices:12; values in scope there: path='prices/../data/prices.csv', prices={}, handle=<_io.TextIOWrapper>, row={'\\ufeffproduct': 'apple', 'price': '1.50'}"

const MINIMAL = { search: 'with open(path, newline="") as handle:', replace: 'with open(path, newline="", encoding="utf-8-sig") as handle:' }
const WORKAROUND = { search: 'prices[row["product"]] = float(row["price"])', replace: 'prices[row["\\ufeffproduct"]] = float(row["price"])' }

function withCopy<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cause-first-'))
  try {
    cpSync(FIXTURE, dir, { recursive: true })
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const unittest = (dir: string) => { const run = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests'], { cwd: dir, encoding: 'utf8', env }); return { code: run.status ?? 1, out: `${run.stdout}${run.stderr}` } }

type Module = typeof causes

function scenarios(module: Module): string[] {
  const failed: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failed.push(name) }
  const found = module.causesIn(TRACE)
  expect('the_trace_shows_the_byte_order_mark', found.length === 1 && found[0].id === 'BYTE_ORDER_MARK' && /utf-8-sig/.test(found[0].hint))
  expect('a_trace_without_the_mark_shows_no_cause', module.causesIn("It failed with KeyError: 'total' at cart.py:12; row={'total': '1'}").length === 0)
  expect('spelling_the_mark_out_is_a_workaround', module.workaroundFor(found, { before: 'prices[row["product"]]', after: 'prices[row["\\ufeffproduct"]]' })?.cause === 'BYTE_ORDER_MARK')
  expect('stripping_the_mark_by_hand_is_a_workaround', module.workaroundFor(found, { before: 'name = row["product"]', after: 'name = key.lstrip("\\ufeff")' }) !== null)
  expect('the_byte_form_is_a_workaround_too', module.workaroundFor(found, { before: 'x', after: "open(p, 'rb').read().lstrip(b'\\xef\\xbb\\xbf')" }) !== null)
  expect('the_repair_at_the_read_is_not_a_workaround', module.workaroundFor(found, { before: 'open(path, newline="")', after: 'open(path, newline="", encoding="utf-8-sig")' }) === null)
  expect('a_comment_that_mentions_the_mark_is_not_code', module.workaroundFor(found, { before: 'x = 1', after: '# the file has a \\ufeff mark\nx = 1' }) === null)
  expect('a_workaround_already_there_is_not_new', module.workaroundFor(found, { before: 'row["\\ufeffproduct"]', after: 'row["\\ufeffproduct"] + 0' }) === null)
  expect('without_the_evidence_nothing_is_refused', module.workaroundFor([], { before: 'a', after: 'row["\\ufeffproduct"]' }) === null)
  return failed
}

async function main() {
  const failedReal = scenarios(causes)
  const names = ['the_trace_shows_the_byte_order_mark', 'a_trace_without_the_mark_shows_no_cause', 'spelling_the_mark_out_is_a_workaround', 'stripping_the_mark_by_hand_is_a_workaround', 'the_byte_form_is_a_workaround_too', 'the_repair_at_the_read_is_not_a_workaround', 'a_comment_that_mentions_the_mark_is_not_code', 'a_workaround_already_there_is_not_new', 'without_the_evidence_nothing_is_refused']
  for (const name of names) check(`S_${name}`, !failedReal.includes(name))

  // ---- real Proof A: both edits make the tests pass; Foundry lets only the repair at the cause through
  const failing = withCopy(unittest)
  check('A_the_fixture_fails_for_the_reason_the_trace_shows', failing.code !== 0 && /KeyError: 'product'/.test(failing.out), failing.out.trim().split('\n').slice(-1)[0])
  const minimal = editFromProposal({ file: LOADER, ...MINIMAL }, new Map([[LOADER, loader]]))
  const work = editFromProposal({ file: LOADER, ...WORKAROUND }, new Map([[LOADER, loader]]))
  check('A_both_edits_build', Boolean(minimal) && Boolean(work), '')
  const minimalGuard = minimal ? guardPlannedEdit({ file: LOADER, source: loader, edit: minimal, causeEvidence: TRACE }) : null
  const workGuard = work ? guardPlannedEdit({ file: LOADER, source: loader, edit: work, causeEvidence: TRACE }) : null
  check('A_the_repair_at_the_cause_is_let_through', minimalGuard !== null && !minimalGuard.refused, '')
  check('A_the_workaround_is_refused_with_the_cause_named', workGuard?.refused?.cause === 'BYTE_ORDER_MARK', workGuard?.refused?.because ?? '')
  check('A_without_the_evidence_the_same_edit_is_not_refused', work ? !guardPlannedEdit({ file: LOADER, source: loader, edit: work })?.refused : false, '')
  const minimalRun = minimalGuard ? withCopy(dir => { writeFileSync(path.join(dir, LOADER), minimalGuard.after); return unittest(dir) }) : { code: 1, out: '' }
  check('A_the_minimal_repair_really_passes_the_fixture_tests', minimalRun.code === 0, minimalRun.out.trim().split('\n').slice(-1)[0])
  check('A_the_minimal_repair_is_one_argument_and_nothing_else', minimalGuard?.after === loader.replace(MINIMAL.search, MINIMAL.replace) && !/restkey|restval|ufeff/i.test(minimalGuard.after), '')
  const workRun = workGuard ? withCopy(dir => { writeFileSync(path.join(dir, LOADER), work!.after); return unittest(dir) }) : { code: 1, out: '' }
  check('A_the_workaround_would_also_have_passed_which_is_why_the_tests_alone_cannot_choose', workRun.code === 0, workRun.out.trim().split('\n').slice(-1)[0])

  // ---- wiring
  const runtime = readFileSync(path.join(ROOT, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8')
  check('W_the_trace_note_names_the_repair_at_the_cause', runtime.includes('causesIn(lines.join(') && runtime.includes('Cause shown by the trace:'), '')
  check('W_an_edit_is_checked_against_the_cause_before_it_is_written', runtime.includes('causeEvidence:') && runtime.includes("if (guarded?.refused)") && runtime.includes("return 'refused' as const") && runtime.includes("if (edited === 'refused')"), '')
  check('W_a_refused_edit_is_explained_plainly_and_asked_again', runtime.includes('causeRefusalNote(guarded.refused)') && runtime.includes('refuseEdit(current, call.edit.file'), '')
  const module = readFileSync(path.join(ROOT, 'lib/native-builder/foundryCauseRepairs.ts'), 'utf8')
  check('W_the_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(module), '')
  check('W_the_note_is_plain_language', !/BYTE_ORDER_MARK|U\+FEFF/.test(causes.causeRefusalNote({ cause: 'BYTE_ORDER_MARK', because: 'x' })), '')

  const file = path.join(ROOT, 'lib/native-builder/foundryCauseRepairs.ts')
  const mutations: Mutation[] = [
    { name: 'the_trace_no_longer_shows_the_mark', from: "if (BOM_TEXT.test(evidence)) causes.push", to: "if (false as boolean) causes.push" },
    { name: 'the_workaround_is_no_longer_seen', from: "BOM_IN_CODE.test(codeOnly(region.after)) && !BOM_IN_CODE.test(codeOnly(region.before))", to: "false" },
    { name: 'a_comment_counts_as_code', from: "return text.split('\\n').filter(line => !/^\\s*(?:#|\\/\\/)/.test(line)).join('\\n')", to: 'return text' },
    { name: 'an_old_workaround_counts_as_new', from: " && !BOM_IN_CODE.test(codeOnly(region.before))", to: '' },
    { name: 'the_byte_form_is_not_recognised', from: "|\\\\x[eE][fF]\\\\x[bB][bB]\\\\x[bB][fF]/\n\nexport type Workaround", to: "/\n\nexport type Workaround" },
  ]
  for (const mutation of mutations) {
    const outcome = await runMutation<Module>(file, mutation, scenarios)
    check(`M_${mutation.name}_is_caught`, outcome.caught, outcome.failed.slice(0, 2).join(' | '))
  }
  const failed = results.filter(r => !r.pass)
  console.log(`CAUSE_REPAIRS_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
