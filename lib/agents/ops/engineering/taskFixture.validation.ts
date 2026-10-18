/** Fixture B: the independent verifier must separate untouched baseline, partial and complete implementations. Run: pnpm run validate:agent-eng-fixture-b */
import { cpSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { harness, tmp } from './engtestkit'
import { TASK_FEATURE, TASK_REFERENCE, TASK_VERIFY_SCRIPT, makeTaskApp } from './taskFixture'
import { makeIndependentVerification } from './runtime/verifier'
import { runCommand } from './runtime/commandRunner'
import { buildWorkspaceIndex } from './workspaceIndex'
import { planFromCode } from './codePlanner'
import type { EngineeringTool } from '../types'

const { check, finish } = harness('AGENT_ENG_FIXTURE_B_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'run_workspace_tests']
const app = (mut: (root: string) => void = () => {}) => { const root = makeTaskApp(path.join(tmp(), 'todo')); mut(root); return root }
const score = async (root: string) => {
  const v = makeIndependentVerification('task board verifier', tmp(), 'verify.mjs', TASK_VERIFY_SCRIPT, root)
  const r = await v.run()
  const m = (re: RegExp) => Number(re.exec(r.stdout)?.[1])
  return { exit: r.exitCode, pass: m(/# pass (\d+)/), total: m(/# tests (\d+)/), out: r.stdout }
}
const writeRef = (root: string, skip: string[] = [], patch: Record<string, (t: string) => string> = {}) => { for (const [rel, body] of Object.entries(TASK_REFERENCE)) { if (skip.includes(rel)) continue; mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), patch[rel] ? patch[rel](body) : body) } }

const base = await score(app())
check('T01_untouched_baseline_fails_the_verifier_with_at_most_2_of_12', base.exit !== 0 && base.total === 12 && base.pass <= 2, `${base.pass}/${base.total}`)
const ref = await score(app((r) => writeRef(r)))
check('T02_the_independent_reference_passes_12_of_12', ref.exit === 0 && ref.pass === 12 && ref.total === 12, `${ref.pass}/${ref.total} ${ref.out.slice(-400)}`)
const mem = await score(app((r) => writeRef(r, [], { 'src/taskStore.mjs': () => `let board = { lastId: 0, tasks: [] }\nexport function tasksFile() { return 'memory' }\nexport function readBoard() { return board }\nexport function writeBoard(b) { board = b }\n` })))
check('T03_a_memory_only_implementation_is_partial_it_passes_the_api_checks_but_fails_persistence', mem.exit !== 0 && mem.pass === 11 && /not ok 12/.test(mem.out), `${mem.pass}/${mem.total}`)
const noRules = await score(app((r) => writeRef(r, [], { 'src/taskService.mjs': (t) => t.replace("if (!MOVES[task.status].includes(status)) throw new TaskError(409, 'cannot move ' + task.status + ' to ' + status)\n", '') })))
check('T04_dropping_the_transition_rules_is_caught', noRules.exit !== 0 && noRules.pass < 12 && /not ok 4/.test(noRules.out), `${noRules.pass}/${noRules.total}`)
const noUi = await score(app((r) => writeRef(r, [], { 'public/index.html': () => '<!doctype html><html><body><ul id="todo-list"></ul><script src="/client.js"></script></body></html>' })))
check('T05_a_missing_board_ui_is_caught', noUi.exit !== 0 && noUi.pass === 11 && /not ok 11/.test(noUi.out), `${noUi.pass}/${noUi.total}`)
const reuse = await score(app((r) => writeRef(r, [], { 'src/taskStore.mjs': (t) => t.replace('lastId: Number(parsed.lastId) || 0', 'lastId: Math.max(0, ...(Array.isArray(parsed.tasks) ? parsed.tasks.map((x) => x.id) : [0]))') })))
check('T06_the_id_sequence_check_is_real_but_max_id_recovery_is_an_acceptable_design', reuse.exit === 0, `${reuse.pass}/${reuse.total}`)
const broken = await score(app((r) => writeRef(r, [], { 'server.mjs': (t) => t.replace("if (url.pathname === '/api/todos' && req.method === 'GET') return reply(res, 200, listTodos())", '') })))
check('T07_breaking_the_legacy_endpoint_is_caught', broken.exit !== 0 && /not ok 10/.test(broken.out), `${broken.pass}/${broken.total}`)
const root = app()
const idx = buildWorkspaceIndex(root)
const plan = planFromCode(idx, { request: TASK_FEATURE.request, acceptance: TASK_FEATURE.acceptance, hints: TASK_FEATURE.hints })
const targets = plan.slices.flatMap((s) => s.files.map((f) => f.path))
check('T08_the_code_planner_finds_the_real_files_to_change_on_the_baseline_without_the_reference', ['server.mjs', 'public/client.js'].every((f) => targets.includes(f)) && targets.some((f) => /^src\//.test(f)), targets.join(','))
check('T09_the_baseline_existing_tests_pass_so_regressions_are_detectable', (await runCommand(root, ['node', '--test', 'test/todoService.test.mjs'], TOOLS)).exitCode === 0)
void cpSync; void readFileSync
finish()
