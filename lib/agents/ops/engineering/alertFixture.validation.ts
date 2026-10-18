/** Fixture C: the independent verifier must separate untouched baseline, partial and complete implementations. Run: pnpm run validate:agent-eng-fixture-c */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { harness, tmp } from './engtestkit'
import { ALERT_FEATURE, ALERT_REFERENCE, ALERT_VERIFY_SCRIPT, makeAlertApp } from './alertFixture'
import { makeIndependentVerification } from './runtime/verifier'
import { runCommand } from './runtime/commandRunner'
import { buildWorkspaceIndex } from './workspaceIndex'
import { planFromCode } from './codePlanner'
import type { EngineeringTool } from '../types'

const { check, finish } = harness('AGENT_ENG_FIXTURE_C_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'run_workspace_tests']
const app = (mut: (root: string) => void = () => {}) => { const root = makeAlertApp(path.join(tmp(), 'feed')); mut(root); return root }
const score = async (root: string) => {
  const v = makeIndependentVerification('alert center verifier', tmp(), 'verify.mjs', ALERT_VERIFY_SCRIPT, root)
  const r = await v.run()
  const m = (re: RegExp) => Number(re.exec(r.stdout)?.[1])
  return { exit: r.exitCode, pass: m(/# pass (\d+)/), total: m(/# tests (\d+)/), out: r.stdout }
}
const writeRef = (root: string, skip: string[] = [], patch: Record<string, (t: string) => string> = {}) => { for (const [rel, body] of Object.entries(ALERT_REFERENCE)) { if (skip.includes(rel)) continue; mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), patch[rel] ? patch[rel](body) : body) } }

const base = await score(app())
check('C01_untouched_baseline_fails_the_verifier_with_at_most_2_of_12', base.exit !== 0 && base.total === 12 && base.pass <= 2, `${base.pass}/${base.total}`)
const ref = await score(app((r) => writeRef(r)))
check('C02_the_independent_reference_passes_12_of_12', ref.exit === 0 && ref.pass === 12 && ref.total === 12, `${ref.pass}/${ref.total} ${ref.out.slice(-500)}`)
const mem = await score(app((r) => writeRef(r, [], { 'src/alertStore.mjs': () => `let state = { lastId: 0, alerts: [] }\nexport function alertsFile() { return 'memory' }\nexport function readAlerts() { return state }\nexport function writeAlerts(s) { state = s }\n` })))
check('C03_memory_only_storage_is_partial_everything_passes_except_persistence', mem.exit !== 0 && mem.pass === 11 && /not ok 12/.test(mem.out), `${mem.pass}/${mem.total}`)
const noRule = await score(app((r) => writeRef(r, [], { 'src/alertService.mjs': (t) => t.replace("    if (a.archived) throw new AlertError(409, 'archived alerts cannot be changed')\n", '') })))
check('C04_dropping_the_archived_cross_flag_rule_is_caught', noRule.exit !== 0 && /not ok 5/.test(noRule.out), `${noRule.pass}/${noRule.total}`)
const noUi = await score(app((r) => writeRef(r, [], { 'public/index.html': () => '<!doctype html><html><body><ul id="event-list"></ul><script src="/client.js"></script></body></html>' })))
check('C05_a_missing_alert_ui_is_caught', noUi.exit !== 0 && noUi.pass === 11 && /not ok 11/.test(noUi.out), `${noUi.pass}/${noUi.total}`)
const noBulk = await score(app((r) => writeRef(r, [], { 'server.mjs': (t) => t.replace("    if (url.pathname === '/api/alerts/read-all' && req.method === 'POST') return reply(res, 200, readAll())\n", '') })))
check('C06_a_missing_bulk_read_all_endpoint_is_caught_as_a_broken_api', noBulk.exit !== 0 && /not ok 9/.test(noBulk.out), `${noBulk.pass}/${noBulk.total}`)
const badCount = await score(app((r) => writeRef(r, [], { 'src/alertService.mjs': (t) => t.replace("const open = readAlerts().alerts.filter((a) => !a.archived && !a.read)", "const open = readAlerts().alerts.filter((a) => !a.read)") })))
check('C07_an_unread_count_that_includes_archived_alerts_is_caught', badCount.exit !== 0 && /not ok 8/.test(badCount.out), `${badCount.pass}/${badCount.total}`)
const legacy = await score(app((r) => writeRef(r, [], { 'server.mjs': (t) => t.replace("    if (url.pathname === '/api/events' && req.method === 'GET') return reply(res, 200, listEvents())\n", '') })))
check('C08_breaking_the_legacy_endpoint_is_caught', legacy.exit !== 0 && /not ok 10/.test(legacy.out), `${legacy.pass}/${legacy.total}`)
const flags = await score(app((r) => writeRef(r, [], { 'src/alertService.mjs': (t) => t.replace('function change(id, edit) {\n  const state = readAlerts()', 'function change(id, edit) {\n  const state = readAlerts()\n  void 0') })))
check('C09_a_harmless_variation_still_passes_so_the_verifier_is_not_over_fitted_to_the_reference_text', flags.exit === 0, `${flags.pass}/${flags.total}`)
const root = app()
const idx = buildWorkspaceIndex(root)
const plan = planFromCode(idx, { request: ALERT_FEATURE.request, acceptance: ALERT_FEATURE.acceptance, hints: ALERT_FEATURE.hints })
const targets = plan.slices.flatMap((s) => s.files.map((f) => f.path))
check('C10_the_code_planner_finds_the_real_files_to_change_on_the_baseline_without_the_reference', ['server.mjs', 'public/client.js'].every((f) => targets.includes(f)) && targets.some((f) => /^src\//.test(f)), targets.join(','))
check('C11_the_baseline_existing_tests_pass_so_regressions_are_detectable', (await runCommand(root, ['node', '--test', 'test/eventService.test.mjs'], TOOLS)).exitCode === 0)
finish()
