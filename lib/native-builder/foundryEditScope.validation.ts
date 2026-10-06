/**
 * Scoped edits. Pure scenarios on the real Phase 5 memory-mission fixture (the unrequested money.py edit), the failing-test cases a repair must still be
 * able to fix, and mutation checks on every rule.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as scope from './foundryEditScope'
import { runMutation, type Mutation } from './foundryMutationHarness'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const ROOT = resolveRepoRoot()
const FIXTURE = path.join(ROOT, 'lib/native-builder/__fixtures__/foundry-phase5/e-notes')
const read = (rel: string) => readFileSync(path.join(FIXTURE, rel), 'utf8')
const sources = [
  { file: 'reports/renderer.py', text: read('reports/renderer.py').replace('from jinja2 import Environment, Markup', 'from jinja2 import Environment\nfrom markupsafe import Markup') },
  { file: 'reports/money.py', text: read('reports/money.py') },
  { file: 'tests/test_renderer.py', text: read('tests/test_renderer.py') },
  { file: 'reports/format.py', text: 'def fmt(value):\n    return value\n' },
]
const primaryFiles = ['reports/renderer.py']

// What the reviewer said on the green mission, and what a stack of a failing run looks like.
const SPURIOUS_FINDING = 'STATUS fail: The bold function makes text safe to embed in a page, but the REQUEST is to make bold text safe to embed in the report renderer.'
const NAMED_FINDING = 'STATUS fail: reports/renderer.py does not escape the text.'
const CODE_FINDING = 'STATUS fail: money returns the amount without two decimals.'
const FAILING_RUN_TEST_ONLY = 'FAIL: test_row_shows_the_name_and_the_amount (tests.test_renderer.RendererTests)\nAssertionError: \'3\' != \'3.00\''
const FAILING_RUN_FRAME = 'Traceback (most recent call last):\n  File "/work/reports/money.py", line 2, in money\n    return amount\nNameError: name \'amount_text\' is not defined'
const FAILING_RUN_SYMBOL = 'ImportError: cannot import name \'Markup\' from \'jinja2\''

type Module = typeof scope

function scenarios(module: Module): string[] {
  const failed: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failed.push(name) }
  const edit = (file: string, extra: Partial<Parameters<Module['scopeOfEdit']>[0]> = {}) => module.scopeOfEdit({ file, rework: true, origin: 'REVIEW', finding: SPURIOUS_FINDING, sources, primaryFiles, ...extra })
  // the memory-mission pattern: a review finding on a green mission must not reach a file it does not point at
  expect('a_review_rework_cannot_edit_a_dependency_nothing_points_at', !edit('reports/money.py').allowed)
  expect('a_review_rework_can_edit_the_implementation_of_the_request', edit('reports/renderer.py').allowed && edit('reports/renderer.py').trace === 'PRIMARY_IMPLEMENTATION')
  expect('a_finding_that_names_the_dependency_traces_to_it', edit('reports/money.py', { finding: NAMED_FINDING.replace('reports/renderer.py', 'reports/money.py') }).allowed)
  expect('a_finding_about_code_a_file_defines_traces_to_that_file', edit('reports/money.py', { finding: CODE_FINDING }).allowed && edit('reports/money.py', { finding: CODE_FINDING }).trace === 'UNMET_CRITERION')
  expect('a_finding_naming_a_file_by_path_traces_to_it', edit('reports/format.py', { finding: 'STATUS fail: reports/format.py does not round the value.' }).trace === 'UNMET_CRITERION')
  expect('a_finding_using_a_name_the_file_defines_traces_to_it', edit('reports/format.py', { finding: 'STATUS fail: fmt returns the value without rounding.' }).trace === 'UNMET_CRITERION')
  expect('a_finding_that_names_neither_the_path_nor_a_definition_does_not', !edit('reports/format.py').allowed)
  // failing test / runtime evidence
  expect('a_failing_test_can_repair_the_code_it_goes_through', module.scopeOfEdit({ file: 'reports/money.py', rework: true, origin: 'TEST', finding: FAILING_RUN_TEST_ONLY, sources, primaryFiles }).allowed)
  expect('a_failing_frame_names_the_file', module.scopeOfEdit({ file: 'reports/money.py', rework: true, origin: 'TEST', finding: FAILING_RUN_FRAME, sources, primaryFiles }).trace === 'FAILING_EVIDENCE')
  expect('the_name_the_failure_is_about_traces_to_its_definition', module.scopeOfEdit({ file: 'reports/other.py', rework: true, origin: 'TEST', finding: 'NameError: name \'money\' is not defined', sources: [...sources.slice(0, 1), { file: 'reports/other.py', text: 'def money():\n    return 1\n' }, ...sources.slice(1)], primaryFiles }).allowed)
  expect('a_failing_run_cannot_reach_a_file_it_never_goes_through', !module.scopeOfEdit({ file: 'reports/unrelated.py', rework: true, origin: 'TEST', finding: FAILING_RUN_TEST_ONLY, sources: [...sources, { file: 'reports/unrelated.py', text: 'def other():\n    return 0\n' }], primaryFiles }).allowed)
  expect('the_import_error_names_the_module_a_repair_may_edit', module.scopeOfEdit({ file: 'reports/renderer.py', rework: true, origin: 'TEST', finding: FAILING_RUN_SYMBOL + '\n  File "/work/reports/renderer.py", line 1', sources, primaryFiles }).allowed)
  // not a repair
  expect('the_first_implementation_pass_is_not_governed_by_the_guard', module.scopeOfEdit({ file: 'reports/money.py', rework: false, finding: '', sources, primaryFiles }).trace === 'INITIAL_PASS')
  expect('a_commander_instruction_is_a_trace', module.scopeOfEdit({ file: 'reports/money.py', rework: true, origin: 'COMMANDER', finding: '', sources, primaryFiles }).trace === 'COMMANDER_INSTRUCTION')
  // imports
  expect('imports_are_read_from_python_and_js', module.importedStems('a.py', 'from reports.money import money\nimport os\n').join() === 'money,os' && module.importedStems('a.ts', "import x from './lib/thing'\nconst y = require('./other.js')").join() === 'thing,other')
  expect('the_import_closure_follows_imports_through_files', module.importClosure(['tests/test_renderer.py'], sources).has('reports/money.py'))
  return failed
}

async function main() {
  const failedReal = scenarios(scope)
  const names = ['a_review_rework_cannot_edit_a_dependency_nothing_points_at', 'a_review_rework_can_edit_the_implementation_of_the_request', 'a_finding_that_names_the_dependency_traces_to_it', 'a_finding_about_code_a_file_defines_traces_to_that_file', 'a_finding_naming_a_file_by_path_traces_to_it', 'a_finding_using_a_name_the_file_defines_traces_to_it', 'a_finding_that_names_neither_the_path_nor_a_definition_does_not', 'a_failing_test_can_repair_the_code_it_goes_through', 'a_failing_frame_names_the_file', 'the_name_the_failure_is_about_traces_to_its_definition', 'a_failing_run_cannot_reach_a_file_it_never_goes_through', 'the_import_error_names_the_module_a_repair_may_edit', 'the_first_implementation_pass_is_not_governed_by_the_guard', 'a_commander_instruction_is_a_trace', 'imports_are_read_from_python_and_js', 'the_import_closure_follows_imports_through_files']
  for (const name of names) check(`S_${name}`, !failedReal.includes(name))
  const refused = scope.scopeOfEdit({ file: 'reports/money.py', rework: true, origin: 'REVIEW', finding: SPURIOUS_FINDING, sources, primaryFiles })
  check('S_a_refusal_says_why_and_is_plain_language', !refused.allowed && refused.detail.length > 20 && /nothing that failed/.test(scope.scopeRefusalNote('reports/money.py')) && !/OUT_OF_SCOPE/.test(scope.scopeRefusalNote('x.py')), refused.detail)
  const generic = readFileSync(path.join(ROOT, 'lib/native-builder/foundryEditScope.ts'), 'utf8')
  check('G_no_file_name_is_hard_coded', !/money|renderer|jinja|markup/i.test(generic.replace(/\/\*[\s\S]*?\*\//g, '')), '')
  check('W_a_repair_edit_is_scoped_before_it_is_applied', (() => {
    const runtime = readFileSync(path.join(ROOT, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8')
    const at = runtime.indexOf('scopeOfEdit({')
    const applyAt = runtime.indexOf('const edited = await applyModelEdit(current, call.edit, call.localWorker)')
    return at > 0 && applyAt > at && ['SCOPE_REFUSED', "state.reworkCycles > 0", 'scopeRefusalNote(call.edit.file)', 'primaryFiles: contextOn()'].every(text => runtime.includes(text))
  })(), '')
  check('W_the_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(generic), '')

  const file = path.join(ROOT, 'lib/native-builder/foundryEditScope.ts')
  const mutations: Mutation[] = [
    { name: 'the_first_pass_is_governed', from: "if (!input.rework) return { allowed: true, trace: 'INITIAL_PASS', detail: 'the first implementation pass' }", to: '' },
    { name: 'commander_instructions_are_not_traces', from: "if (input.origin === 'COMMANDER') return", to: "if (false as boolean) return" },
    { name: 'failing_evidence_no_longer_names_files', from: "if (named.includes(file)) return { allowed: true, trace: 'FAILING_EVIDENCE'", to: "if (false as boolean) return { allowed: true, trace: 'FAILING_EVIDENCE'" },
    { name: 'the_failing_symbol_is_not_a_trace', from: "if (failure.symbol && target && definedNames(target.text).has(failure.symbol)) return", to: "if (false as boolean) return" },
    { name: 'the_import_closure_is_not_a_trace', from: "if (importClosure(seeds, sources).has(file)) return", to: "if (false as boolean) return" },
    { name: 'the_closure_reaches_every_file', from: "if (importClosure(seeds, sources).has(file)) return", to: "if (true as boolean) return" },
    { name: 'primary_files_are_not_a_trace', from: "if (input.primaryFiles?.includes(file)) return", to: "if (false as boolean) return" },
    { name: 'every_dependency_is_primary', from: "if (input.primaryFiles?.includes(file)) return", to: "if (true as boolean) return" },
    { name: 'a_finding_naming_a_file_is_not_a_trace', from: "if (named.includes(file)) return { allowed: true, trace: 'UNMET_CRITERION'", to: "if (false as boolean) return { allowed: true, trace: 'UNMET_CRITERION'" },
    { name: 'a_finding_about_defined_code_is_not_a_trace', from: "if (hit) return { allowed: true, trace: 'UNMET_CRITERION'", to: "if (false as boolean) return { allowed: true, trace: 'UNMET_CRITERION'" },
    { name: 'imports_are_not_read', from: "for (const stem of importedStems(current.file, current.text)) {", to: "for (const stem of [] as string[]) {" },
  ]
  for (const mutation of mutations) {
    const outcome = await runMutation<Module>(file, mutation, scenarios)
    check(`M_${mutation.name}_is_caught`, outcome.caught, outcome.failed.slice(0, 2).join(' | '))
  }
  const failed = results.filter(r => !r.pass)
  console.log(`EDIT_SCOPE_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
