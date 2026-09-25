/**
 * Large-project ownership checks.
 * Two disposable repositories, restart, rollback, and governance.
 * Does not mutate the War Room source tree.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { issueFromCommanderReport } from './issueIngest'
import { reportIssue } from './runtime'
import { getRepair, saveRepair } from './storage'
import { activityTitle, emptyEngineeringRuntime } from './foundryEngineeringEvents'
import { classifyEngineeringCommand, engineeringRuntimeShouldOwn, rollbackOwnedMission } from './foundryEngineeringRuntime'
import { emptyLargeProjectState, planLargeProjectRepair, selectEngineeringExecutionMode } from './foundryLargeProject'
import { runCodingMission } from './engineerLoop'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

function git(root: string, args: string[]) {
  execFileSync('git', ['-c', 'user.email=foundry@local', '-c', 'user.name=foundry', ...args], { cwd: root, stdio: 'ignore' })
}

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

function noise(root: string) {
  for (let i = 0; i < 90; i += 1) {
    write(root, `archive/n${String(i).padStart(2, '0')}.py`, `"""Unrelated archive note ${i}."""\nVALUE = ${i}\n`)
  }
}

function fixtureCheckout(root: string) {
  write(root, 'pyproject.toml', '[project]\nname = "shop-fixture"\nversion = "0.0.1"\n')
  write(root, 'shop/__init__.py', '')
  write(root, 'shop/items.py', 'class Item:\n    def __init__(self, name, price):\n        self.name = name\n        self.price = price\n')
  write(root, 'shop/checkout.py', 'from shop.items import Item\nfrom shop.pricing import total\n\ndef charge(items, region):\n    return total(items, tax=region)\n')
  write(root, 'shop/pricing/__init__.py', 'from shop.pricing.total import total\n')
  write(root, 'shop/pricing/total.py', 'def total(items, *, tax_rate: float) -> float:\n    return sum(item.price for item in items) * (1 + tax_rate)\n')
  write(root, 'shop/pricing/rates.py', 'RATES = {"eu": 0.2, "us": 0.0}\n\ndef rate_for(region: str) -> float:\n    if region not in RATES:\n        raise KeyError(region)\n    return RATES[region]\n')
  write(root, 'tests/test_checkout.py', 'import unittest\nfrom shop.checkout import charge\nfrom shop.items import Item\n\nclass CheckoutTests(unittest.TestCase):\n    def test_eu_tax(self):\n        self.assertEqual(charge([Item("a", 10)], region="eu"), 12)\n\nif __name__ == "__main__":\n    unittest.main()\n')
  write(root, 'tests/test_checkout_regression.py', 'import unittest\nfrom shop.checkout import charge\nfrom shop.items import Item\n\nclass CheckoutRegression(unittest.TestCase):\n    def test_us_no_tax(self):\n        self.assertEqual(charge([Item("a", 10)], region="us"), 10)\n')
  write(root, 'notes/keep.txt', 'preexisting-dirty\n')
  noise(root)
  git(root, ['init'])
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'fixture'])
  write(root, 'notes/keep.txt', 'preexisting-dirty\nkeep-me\n')
  write(root, 'notes/untracked.txt', 'untracked-note\n')
}

function fixtureOrders(root: string) {
  write(root, 'pyproject.toml', '[project]\nname = "warehouse-fixture"\nversion = "0.0.1"\n')
  write(root, 'warehouse/__init__.py', '')
  write(root, 'warehouse/limits.py', 'from pathlib import Path\n\ndef max_items():\n    text = Path("config/operations.toml").read_text()\n    section = None\n    wanted = "item_cap"\n    for line in text.splitlines():\n        if line.startswith("[") and line.endswith("]"):\n            section = line[1:-1]\n            continue\n        if section == "capacity" and line.startswith(wanted):\n            return int(line.split("=")[1])\n    raise KeyError(wanted)\n')
  write(root, 'warehouse/pipeline.py', 'from warehouse.limits import max_items\n\ndef accept(items):\n    cap = max_items()\n    return len(items) < cap\n')
  write(root, 'config/operations.toml', '[capacity]\nmax_items = 3\nweight_kg = 20\n')
  write(root, 'tests/test_orders.py', 'import unittest\nfrom warehouse.pipeline import accept\n\nclass OrderTests(unittest.TestCase):\n    def test_standard_box(self):\n        self.assertTrue(accept(["a", "b", "c"]))\n')
  write(root, 'tests/test_orders_wide.py', 'import unittest\nfrom warehouse.pipeline import accept\n\nclass OrderWide(unittest.TestCase):\n    def test_under_limit(self):\n        self.assertTrue(accept(["a"]))\n\n    def test_over_limit(self):\n        self.assertFalse(accept(["a", "b", "c", "d"]))\n')
  write(root, 'notes/keep.txt', 'preexisting-dirty\n')
  noise(root)
  git(root, ['init'])
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'fixture'])
  write(root, 'notes/keep.txt', 'preexisting-dirty\nkeep-me\n')
}

async function runMission(workspace: string, request: string, title: string, pauseAfter?: string) {
  return runWithWorkspaceRoot(workspace, async () => {
    const opened = await reportIssue(issueFromCommanderReport({ title, description: request, subsystem: 'project' }))
    if (!opened.repair) throw new Error('repair was not opened')
    const runtime = emptyEngineeringRuntime()
    if (pauseAfter) runtime.largeProject = emptyLargeProjectState(pauseAfter)
    await saveRepair({
      ...opened.repair,
      codingMission: {
        mode: 'bounded_coding',
        commanderRequest: request,
        objective: title,
        acceptanceCriteria: [request],
        plan: [],
        currentStep: 'PLANNING',
        attempt: 0,
        maxAttempts: 4,
        filesRead: [],
        filesChanged: [],
        commandsExecuted: [],
        testsExecuted: [],
        progressEvents: [],
        visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE',
        sessionId: 'large-project-validation',
        engineeringRuntime: runtime,
      },
    })
    return runCodingMission(opened.repair.id)
  })
}

function titles(record: Awaited<ReturnType<typeof runMission>>) {
  return (record.codingMission?.engineeringRuntime?.events ?? []).map(event => activityTitle(event))
}

async function main() {
  check('mode_small', selectEngineeringExecutionMode({ fileCount: 2, request: 'Fix the failing serialization script' }) === 'SMALL', 'small')
  check('mode_large', selectEngineeringExecutionMode({ fileCount: 120, request: 'Fix the failing checkout' }) === 'LARGE_PROJECT', 'large')
  check('mode_unowned', selectEngineeringExecutionMode({ fileCount: 120, request: 'Explain the repository' }) === 'UNOWNED', 'unowned')
  check('small_owner_unchanged', engineeringRuntimeShouldOwn({ fileCount: 2, request: 'Fix the failing serialization script' }) && !engineeringRuntimeShouldOwn({ fileCount: 4000, request: 'Fix the repo' }), 'v1 gate')
  const push = classifyEngineeringCommand('git', ['push', 'origin', 'main'], false)
  check('governance_still_gated', push.allowed === false && push.commandClass === 'GIT_PERSISTENT', push.reason ?? '')

  const keywordPlan = planLargeProjectRepair({
    failureText: 'TypeError: total() got an unexpected keyword argument \'tax\'\nFile "/repo/shop/checkout.py", line 5',
    root: '/repo',
    names: ['shop/checkout.py', 'shop/pricing/__init__.py', 'shop/pricing/total.py', 'shop/pricing/rates.py'],
    configNumbers: [],
    sources: {
      'shop/checkout.py': 'from shop.pricing import total\n\ndef charge(items, region):\n    return total(items, tax=region)\n',
      'shop/pricing/__init__.py': 'from shop.pricing.total import total\n',
      'shop/pricing/total.py': 'def total(items, *, tax_rate: float) -> float:\n    return 0\n',
      'shop/pricing/rates.py': 'def rate_for(region: str) -> float:\n    return 0.2\n',
    },
  })
  check('planner_keyword', keywordPlan.status === 'edits' && keywordPlan.edits.length === 2, keywordPlan.status === 'edits' ? keywordPlan.rootCause : keywordPlan.status === 'blocked' || keywordPlan.status === 'unsupported' ? keywordPlan.reason : keywordPlan.expansion.reason)

  const root1 = path.join(tmpdir(), `foundry-large-shop-${Date.now()}`)
  const root2 = path.join(tmpdir(), `foundry-large-warehouse-${Date.now()}`)
  rmSync(root1, { recursive: true, force: true })
  rmSync(root2, { recursive: true, force: true })
  fixtureCheckout(root1)
  fixtureOrders(root2)

  const request1 = 'Fix the failing checkout tax calculation'
  const mission1 = await runMission(root1, request1, 'Fix checkout')
  const large1 = mission1.codingMission?.engineeringRuntime?.largeProject
  const inspected1 = large1?.filesInspected ?? []
  check('fixture1_mode', large1?.mode === 'LARGE_PROJECT' && (large1.repoFileCount ?? 0) > 80, `files=${large1?.repoFileCount} mode=${large1?.mode}`)
  check('fixture1_bounded', inspected1.length > 0 && inspected1.length < (large1?.repoFileCount ?? 0) && !inspected1.some(file => file.startsWith('archive/')) && (large1?.peakWorkingSet ?? 99) <= 16, `read=${inspected1.length} peak=${large1?.peakWorkingSet} discovered=${large1?.filesDiscovered}`)
  check('fixture1_repair', mission1.state === 'resolved' && readFileSync(path.join(root1, 'shop/checkout.py'), 'utf8').includes('tax_rate=rate_for(region)') && readFileSync(path.join(root1, 'shop/pricing/__init__.py'), 'utf8').includes('rate_for'), mission1.codingMission?.currentAction ?? mission1.state)
  check('fixture1_tests', Boolean(mission1.codingMission?.engineeringRuntime?.completion?.canComplete) && (large1?.checkpoints ?? []).includes('TARGET_TEST_PASS') && (large1?.checkpoints ?? []).includes('REGRESSION_PASS'), (large1?.checkpoints ?? []).join(','))
  check('fixture1_cross_file', (large1?.filesMutated.length ?? 0) >= 2 && (large1?.filesInspected.length ?? 0) >= 3, `mutated=${large1?.filesMutated.join(',')}`)
  check('fixture1_dirty', readFileSync(path.join(root1, 'notes/keep.txt'), 'utf8').includes('keep-me') && readFileSync(path.join(root1, 'notes/untracked.txt'), 'utf8').includes('untracked-note'), 'dirty')
  check('fixture1_dirty_key', (large1?.git.dirty ?? []).includes('notes/keep.txt') && !(large1?.git.dirty ?? []).includes('otes/keep.txt') && (large1?.git.untracked ?? []).includes('notes/untracked.txt'), `dirty=${(large1?.git.dirty ?? []).join(',')} untracked=${(large1?.git.untracked ?? []).join(',')}`)
  const shown1 = titles(mission1)
  check('fixture1_chat', ['ANALYZING PROJECT', 'MAPPING REPOSITORY', 'SEARCHING', 'READING', 'FOUND ISSUE', 'PLANNING REPAIR', 'EDITED', 'TESTING', 'RECHECKING', 'COMPLETE'].every(title => shown1.includes(title)), shown1.join('|'))
  check('fixture1_terminal', mission1.codingMission?.engineeringRuntime?.terminalCollapsed === true, 'collapsed')
  check('fixture1_writes', large1?.modelDirectWrites === 0 && large1?.frkDirectWrites === 0 && large1?.secondMissionTruthCount === 0 && large1?.repeatedFailureWithoutReplan === 0 && large1?.modelCalls === 0, `model=${large1?.modelCalls}`)
  check('fixture1_replan', (mission1.codingMission?.engineeringRuntime?.events ?? []).some(event => event.type === 'STRATEGY_CHANGED'), 'strategy')

  const rolled = await runWithWorkspaceRoot(root1, () => rollbackOwnedMission(mission1.id))
  const checkoutAfter = readFileSync(path.join(root1, 'shop/checkout.py'), 'utf8')
  check('fixture1_rollback', rolled.ok && checkoutAfter.includes('tax=region') && !checkoutAfter.includes('rate_for') && readFileSync(path.join(root1, 'notes/keep.txt'), 'utf8').includes('keep-me'), rolled.restored.join(','))

  const request2 = 'Fix the failing warehouse order limit'
  const mission2 = await runMission(root2, request2, 'Fix orders')
  const large2 = mission2.codingMission?.engineeringRuntime?.largeProject
  check('fixture2_mode', large2?.mode === 'LARGE_PROJECT' && (large2.repoFileCount ?? 0) > 80, `files=${large2?.repoFileCount}`)
  check('fixture2_bounded', (large2?.filesInspected.length ?? 0) < (large2?.repoFileCount ?? 1) && !(large2?.filesInspected ?? []).some(file => file.startsWith('archive/')), `read=${large2?.filesInspected.length} peak=${large2?.peakWorkingSet}`)
  check('fixture2_repair', mission2.state === 'resolved' && readFileSync(path.join(root2, 'warehouse/limits.py'), 'utf8').includes('max_items') && readFileSync(path.join(root2, 'warehouse/pipeline.py'), 'utf8').includes('<='), mission2.codingMission?.currentAction ?? mission2.state)
  check('fixture2_tests', (large2?.checkpoints ?? []).includes('REGRESSION_PASS'), (large2?.checkpoints ?? []).join(','))
  check('fixture2_dirty', readFileSync(path.join(root2, 'notes/keep.txt'), 'utf8').includes('keep-me'), 'dirty')
  check('crosswire', (large1?.filesMutated ?? []).every(file => !(large2?.filesMutated ?? []).includes(file)) && (large1?.filesMutated ?? []).every(file => file.startsWith('shop/')) && (large2?.filesMutated ?? []).every(file => file.startsWith('warehouse/')), `${large1?.filesMutated.join(',')} :: ${large2?.filesMutated.join(',')}`)

  const restartRoot = path.join(tmpdir(), `foundry-large-restart-${Date.now()}`)
  rmSync(restartRoot, { recursive: true, force: true })
  fixtureCheckout(restartRoot)
  const paused = await runMission(restartRoot, request1, 'Fix checkout resume', 'MAP_COMPLETE')
  const pausedLarge = paused.codingMission?.engineeringRuntime?.largeProject
  check('restart_paused', paused.state !== 'resolved' && pausedLarge?.checkpoints.includes('MAP_COMPLETE') && (pausedLarge.filesMutated.length ?? 0) === 0, pausedLarge?.checkpoints.join(',') ?? paused.state)
  const resumed = await runWithWorkspaceRoot(restartRoot, async () => {
    const record = await getRepair(paused.id)
    if (!record?.codingMission?.engineeringRuntime?.largeProject) throw new Error('missing pause')
    record.codingMission.engineeringRuntime.largeProject.pauseAfter = null
    await saveRepair(record)
    return runCodingMission(paused.id)
  })
  const resumedLarge = resumed.codingMission?.engineeringRuntime?.largeProject
  const eventTypes = (resumed.codingMission?.engineeringRuntime?.events ?? []).map(event => event.type)
  check('restart_resume', resumed.state === 'resolved' && eventTypes.filter(type => type === 'MISSION_STARTED').length === 1 && eventTypes.includes('MISSION_RESUMED') && (resumedLarge?.filesDiscovered ?? 0) === (pausedLarge?.filesDiscovered ?? -1) && (resumedLarge?.filesMutated.length ?? 0) >= 2, `state=${resumed.state} discovered=${resumedLarge?.filesDiscovered}`)
  check('restart_no_duplicate_edits', (resumed.codingMission?.engineeringRuntime?.events ?? []).filter(event => event.type === 'FILE_EDITED').length === (resumedLarge?.filesMutated.length ?? -1), `edited=${eventTypes.filter(type => type === 'FILE_EDITED').length}`)

  const govRoot = path.join(tmpdir(), `foundry-large-gov-${Date.now()}`)
  rmSync(govRoot, { recursive: true, force: true })
  fixtureCheckout(govRoot)
  const before = readFileSync(path.join(govRoot, 'shop/checkout.py'), 'utf8')
  const governed = await runMission(govRoot, 'Governance block: do not run git push origin main', 'Governance')
  check('governance_large', governed.state === 'blocked' && readFileSync(path.join(govRoot, 'shop/checkout.py'), 'utf8') === before && !(governed.codingMission?.engineeringRuntime?.events ?? []).some(event => event.type === 'COMMAND_STARTED' && /git push/.test(event.command ?? '')), governed.codingMission?.engineeringRuntime?.blockedDetail?.unblockAction ?? governed.state)

  const failed = results.filter(result => !result.pass)
  console.log(`LARGE_PROJECT_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
