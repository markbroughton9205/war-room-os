/**
 * Long-horizon campaign checks.
 * Two disposable repositories. Does not mutate the War Room source tree.
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
import { campaignShouldOwn, claimWriteLock, CAMPAIGN_ROLES, interruptRunningTest, readyCampaignTasks, recordTestFinish, recordTestStart, reworkImplementationIds, stalledSameFailure, verificationBarrierSatisfied, type CampaignTestReceipt } from './foundryEngineeringCampaign'
import { runCodingMission } from './engineerLoop'
import { planProblems, planSummary, unjustifiedReopens } from './foundryEngineeringPlan'

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
  for (let i = 0; i < 96; i += 1) write(root, `archive/n${String(i).padStart(2, '0')}.py`, `VALUE = ${i}\n`)
}

function base(root: string, contract: string, backend: string, frontend: string, apiTest: string, uiTest: string) {
  write(root, 'shared/__init__.py', '')
  write(root, 'shared/contract.py', contract)
  write(root, 'backend/__init__.py', '')
  write(root, 'backend/api.py', backend)
  write(root, 'frontend/__init__.py', '')
  write(root, 'frontend/board.py', frontend)
  write(root, 'tests/test_api.py', apiTest)
  write(root, 'tests/test_ui.py', uiTest)
  write(root, 'notes/keep.txt', 'preexisting-dirty\n')
  noise(root)
  git(root, ['init'])
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'fixture'])
  write(root, 'notes/keep.txt', 'preexisting-dirty\nkeep-me\n')
}

const API = 'from shared.contract import FILTER_FIELD\n\ndef list_projects(projects, status=None):\n    return list(projects)\n'
const UI = 'from backend.api import list_projects\n\ndef show_board(projects, status=None):\n    rows = list_projects(projects)\n    return "\\n".join(item["name"] for item in rows)\n'

function fixtureOne(root: string) {
  base(
    root,
    'FILTER_FIELD = "status"\nSTATUSES = ("open", "closed")\n',
    API,
    UI,
    'import unittest\nfrom backend.api import list_projects\n\nclass ApiTests(unittest.TestCase):\n    def test_open(self):\n        rows = [{"name": "A", "status": "open"}, {"name": "B", "status": "closed"}]\n        names = [item["name"] for item in list_projects(rows, status="open")]\n        self.assertEqual(names, ["A"])\n',
    'import unittest\nfrom frontend.board import show_board\n\nclass UiTests(unittest.TestCase):\n    def test_open(self):\n        rows = [{"name": "A", "status": "open"}, {"name": "B", "status": "closed"}]\n        self.assertEqual(show_board(rows, status="open"), "A")\n',
  )
}

function fixtureTwo(root: string) {
  base(
    root,
    'FILTER_FIELD = "status"\n',
    API,
    UI,
    'import unittest\nfrom backend.api import list_projects\n\nclass ApiTests(unittest.TestCase):\n    def test_open(self):\n        rows = [{"name": "A", "state": "open", "status": "closed"}, {"name": "B", "state": "closed", "status": "open"}]\n        names = [item["name"] for item in list_projects(rows, status="open")]\n        self.assertEqual(names, ["B"])\n',
    'import unittest\nfrom frontend.board import show_board\n\nclass UiTests(unittest.TestCase):\n    def test_open(self):\n        rows = [{"name": "A", "state": "open", "status": "closed"}, {"name": "B", "state": "closed", "status": "open"}]\n        self.assertEqual(show_board(rows, status="open"), "B")\n',
  )
}

async function runMission(root: string, request: string, pauseAfter?: string) {
  return runWithWorkspaceRoot(root, async () => {
    const opened = await reportIssue(issueFromCommanderReport({ title: 'Campaign', description: request, subsystem: 'project' }))
    if (!opened.repair) throw new Error('repair was not opened')
    const runtime = emptyEngineeringRuntime()
    if (pauseAfter) {
      const { emptyEngineeringCampaign } = await import('./foundryEngineeringCampaign')
      runtime.campaign = emptyEngineeringCampaign(request, pauseAfter)
    }
    await saveRepair({
      ...opened.repair,
      codingMission: {
        mode: 'bounded_coding',
        commanderRequest: request,
        objective: 'Campaign',
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
        sessionId: 'campaign-validation',
        engineeringRuntime: runtime,
      },
    })
    return runCodingMission(opened.repair.id)
  })
}

async function main() {
  const request1 = 'Add project status filtering and expose it through the API and the UI'
  const request2 = 'Update item status filtering and expose it through the API and the UI'
  check('campaign_gate', campaignShouldOwn(request1) && campaignShouldOwn(request2) && !campaignShouldOwn('Fix the failing serialization script'), 'gate')
  check('v2_gate_unchanged', engineeringRuntimeShouldOwn({ fileCount: 2, request: 'Fix the failing serialization script' }) && !engineeringRuntimeShouldOwn({ fileCount: 4000, request: 'Fix the repo' }), 'v2')
  check('roles', ['ARCHITECT', 'BACKEND', 'FRONTEND', 'DATABASE', 'TEST', 'DEBUGGER', 'REVIEWER', 'VERIFIER'].every(role => (CAMPAIGN_ROLES as readonly string[]).includes(role)), CAMPAIGN_ROLES.join(','))
  const lock = claimWriteLock([{ file: 'backend/api.py', taskId: 'backend' }], 'backend/api.py', 'frontend')
  check('write_lock', lock.ok === false && lock.collision === false, 'serialized')
  check('ready_dependency', readyCampaignTasks([
    { id: 'a', phase: 'ARCHITECT', role: 'ARCHITECT', status: 'COMPLETE', dependsOn: [], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 1, verification: 'PASS' },
    { id: 'b', phase: 'IMPLEMENT', role: 'BACKEND', status: 'PLANNED', dependsOn: ['a'], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 0, verification: 'PENDING' },
    { id: 'c', phase: 'INTEGRATE', role: 'TEST', status: 'PLANNED', dependsOn: ['b'], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 0, verification: 'PENDING' },
  ]).map(task => task.id).join(',') === 'b', 'dag')
  check('rework_debugger_before_retest', readyCampaignTasks([
    { id: 'integrate', phase: 'INTEGRATE', role: 'TEST', status: 'PLANNED', dependsOn: ['backend', 'frontend', 'debug-1'], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 1, verification: 'PENDING' },
    { id: 'backend', phase: 'IMPLEMENT', role: 'BACKEND', status: 'COMPLETE', dependsOn: [], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 1, verification: 'PASS' },
    { id: 'frontend', phase: 'IMPLEMENT', role: 'FRONTEND', status: 'COMPLETE', dependsOn: [], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 1, verification: 'PASS' },
    { id: 'debug-1', phase: 'DEBUG', role: 'DEBUGGER', status: 'READY', dependsOn: [], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 0, verification: 'PENDING' },
  ]).map(task => task.id).join(',') === 'debug-1', 'debugger-first')
  check('rework_target_backend_only', reworkImplementationIds("NameError: name 'normalize_status' is not defined REPAIR_TARGET: backend/api.py").join(',') === 'backend', 'backend')
  check('rework_target_frontend_only', reworkImplementationIds('the UI board.py does not forward status').join(',') === 'frontend', 'frontend')
  check('same_failure_no_second_debugger', stalledSameFailure({ finding: "AssertionError: Lists differ: [] != ['p1']", lastSignature: "AssertionError: Lists differ: [] != ['p1']", appliedEdits: 2, editsAtFailure: 2 }) === true, 'stalled')
  check('new_failure_one_debugger', stalledSameFailure({ finding: "NameError: name 'CANONICAL' is not defined", lastSignature: "NameError: name 'normalize_status' is not defined", appliedEdits: 2, editsAtFailure: 1 }) === false, 'distinct')
  const tasks = [
    { id: 'integrate', role: 'TEST', status: 'COMPLETE' },
    { id: 'review', role: 'REVIEWER', status: 'PLANNED' },
    { id: 'verify', role: 'VERIFIER', status: 'PLANNED' },
  ]
  const pass = (generation: number, result: CampaignTestReceipt['result'], exitCode: number | null): CampaignTestReceipt => ({
    testedMutationGeneration: generation, command: 'python3 -m unittest discover -s tests -q', exitCode, startedAt: 't0', completedAt: result === 'RUNNING' ? null : 't1', result,
  })
  check('failed_test_blocks_review', verificationBarrierSatisfied({ mutationGeneration: 1, testReceipts: [pass(1, 'FAILED', 1)], tasks }) === false, 'fail')
  check('interrupted_test_blocks_review', verificationBarrierSatisfied({ mutationGeneration: 1, testReceipts: [pass(1, 'RUNNING_INTERRUPTED', null)], tasks }) === false, 'interrupted')
  check('absent_test_blocks_review', verificationBarrierSatisfied({ mutationGeneration: 1, testReceipts: [], tasks }) === false, 'absent')
  check('current_pass_permits_review', verificationBarrierSatisfied({ mutationGeneration: 2, testReceipts: [pass(2, 'PASSED', 0)], tasks }) === true, 'current')
  check('old_pass_blocks_review', verificationBarrierSatisfied({ mutationGeneration: 3, testReceipts: [pass(2, 'PASSED', 0)], tasks }) === false, 'stale')
  const running = { mutationGeneration: 1, testReceipts: [pass(1, 'RUNNING', null)] }
  interruptRunningTest(running)
  check('restart_never_converts_running_to_pass', running.testReceipts[0].result === 'RUNNING_INTERRUPTED', running.testReceipts[0].result)
  const recorded = { mutationGeneration: 4, testReceipts: [] as CampaignTestReceipt[] }
  recordTestStart(recorded, 'python3 -m unittest discover -s tests -q', 't0')
  recordTestFinish(recorded, 0, 't1')
  check('pass_binds_generation', recorded.testReceipts[0].testedMutationGeneration === 4 && recorded.testReceipts[0].result === 'PASSED', 'bound')
  check('debugger_blocks_review', verificationBarrierSatisfied({ mutationGeneration: 2, testReceipts: [pass(2, 'PASSED', 0)], tasks: [...tasks, { id: 'debug-1', role: 'DEBUGGER', status: 'READY' }] }) === false, 'debugger')
  check('shared_barrier', verificationBarrierSatisfied({ mutationGeneration: 1, testReceipts: [pass(1, 'PASSED', 0)], tasks }) === verificationBarrierSatisfied({ mutationGeneration: 1, testReceipts: [pass(1, 'PASSED', 0)], tasks }), 'same')
  check('failed_test_selects_debugger_not_retest', readyCampaignTasks([
    { id: 'backend', phase: 'IMPLEMENT', role: 'BACKEND', status: 'PLANNED', dependsOn: ['debug-1'], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: ['backend/api.py'], writes: [], attempt: 1, verification: 'PENDING' },
    { id: 'frontend', phase: 'IMPLEMENT', role: 'FRONTEND', status: 'COMPLETE', dependsOn: [], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 1, verification: 'PASS' },
    { id: 'integrate', phase: 'INTEGRATE', role: 'TEST', status: 'PLANNED', dependsOn: ['backend', 'frontend', 'debug-1'], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: [], writes: [], attempt: 1, verification: 'FAIL' },
    { id: 'debug-1', phase: 'DEBUG', role: 'DEBUGGER', status: 'READY', dependsOn: [], purpose: '', acceptance: '', inputs: [], outputs: [], evidence: [], workingSet: ['backend/api.py'], writes: [], attempt: 0, verification: 'PENDING' },
  ]).map(task => task.id).join(',') === 'debug-1', 'no-retest-before-debug')
  const push = classifyEngineeringCommand('git', ['push', 'origin', 'main'], false)
  check('governance', push.allowed === false, push.reason ?? '')

  const root1 = path.join(tmpdir(), `foundry-campaign-1-${Date.now()}`)
  rmSync(root1, { recursive: true, force: true })
  fixtureOne(root1)
  const mission1 = await runMission(root1, request1)
  const campaign1 = mission1.codingMission?.engineeringRuntime?.campaign
  const roles1 = [...new Set((campaign1?.tasks ?? []).filter(task => task.status === 'COMPLETE').map(task => task.role))]
  check('fixture1_mode', mission1.state === 'resolved' && (campaign1?.repoFileCount ?? 0) > 100, `files=${campaign1?.repoFileCount} state=${mission1.state}`)
  check('fixture1_components', (campaign1?.componentFiles.backend.length ?? 0) > 0 && (campaign1?.componentFiles.frontend.length ?? 0) > 0 && (campaign1?.componentFiles.contract.length ?? 0) > 0 && (campaign1?.componentFiles.tests.length ?? 0) > 0, 'components')
  check('fixture1_roles', roles1.includes('ARCHITECT') && roles1.includes('BACKEND') && roles1.includes('FRONTEND') && roles1.includes('REVIEWER') && roles1.includes('VERIFIER'), roles1.join(','))
  check('fixture1_dag', (campaign1?.tasks.find(task => task.id === 'integrate')?.dependsOn ?? []).includes('backend') && (campaign1?.tasks.find(task => task.id === 'integrate')?.dependsOn ?? []).includes('frontend'), 'depends')
  check('fixture1_edits', readFileSync(path.join(root1, 'backend/api.py'), 'utf8').includes('.get("status")') && readFileSync(path.join(root1, 'frontend/board.py'), 'utf8').includes('status=status'), 'wired')
  check('fixture1_verify', campaign1?.verification === 'PROJECT_READY' && campaign1.phase === 'COMPLETE', campaign1?.verification ?? '')
  check('fixture1_truth', campaign1?.secondMissionTruthCount === 0 && campaign1?.modelDirectWrites === 0 && campaign1?.frkDirectWrites === 0 && campaign1?.rawChainOfThoughtStored === 0 && campaign1?.collisionCount === 0, 'counts')
  check('fixture1_dirty', readFileSync(path.join(root1, 'notes/keep.txt'), 'utf8').includes('keep-me') && !(campaign1?.filesMutated ?? []).includes('notes/keep.txt'), 'dirty')
  check('fixture1_terminal', mission1.codingMission?.engineeringRuntime?.terminalCollapsed === true, 'collapsed')
  const titles1 = (mission1.codingMission?.engineeringRuntime?.events ?? []).map(event => activityTitle(event))
  check('fixture1_chat', ['CAMPAIGN', 'ARCHITECTING', 'PLAN READY', 'INTEGRATING', 'REVIEWING', 'VERIFYING', 'COMPLETE'].every(title => titles1.includes(title)), titles1.join('|'))
  check('fixture1_progress', titles1.some(title => /\d+ \/ \d+ phases complete/.test(title)) || (mission1.codingMission?.engineeringRuntime?.events ?? []).some(event => /\d+ \/ \d+ phases complete/.test(event.detail ?? '') || /\d+ \/ \d+ phases complete/.test(event.summary)), 'progress')

  const rolled = await runWithWorkspaceRoot(root1, () => rollbackOwnedMission(mission1.id))
  const apiAfter = readFileSync(path.join(root1, 'backend/api.py'), 'utf8')
  check('fixture1_rollback', rolled.ok && apiAfter.includes('return list(projects)') && !apiAfter.includes('.get("status")') && readFileSync(path.join(root1, 'notes/keep.txt'), 'utf8').includes('keep-me'), rolled.restored.join(','))

  const root2 = path.join(tmpdir(), `foundry-campaign-2-${Date.now()}`)
  rmSync(root2, { recursive: true, force: true })
  fixtureTwo(root2)
  const mission2 = await runMission(root2, request2)
  const campaign2 = mission2.codingMission?.engineeringRuntime?.campaign
  check('fixture2_rework', mission2.state === 'resolved' && (campaign2?.reworkCycles ?? 0) >= 1 && campaign2?.strategy === 'CONTRACT_FIELD' && campaign2.blindRetryCount === 0, `cycles=${campaign2?.reworkCycles} strategy=${campaign2?.strategy}`)
  check('fixture2_diagnosis', (campaign2?.failureAttribution ?? '').includes('implementation'), campaign2?.failureAttribution ?? '')
  check('fixture2_repair', readFileSync(path.join(root2, 'backend/api.py'), 'utf8').includes('.get("status")') && !readFileSync(path.join(root2, 'backend/api.py'), 'utf8').includes('.get("state")'), 'key')
  check('fixture2_verify', campaign2?.verification === 'PROJECT_READY' && (campaign2.reviewFindings.length ?? 1) === 0, campaign2?.verification ?? '')
  check('fixture2_events', (mission2.codingMission?.engineeringRuntime?.events ?? []).some(event => event.type === 'REWORKING') && (mission2.codingMission?.engineeringRuntime?.events ?? []).some(event => event.type === 'VERIFICATION_STARTED'), 'events')
  const edited2 = (mission2.codingMission?.engineeringRuntime?.events ?? []).filter(event => event.type === 'FILE_EDITED')
  const duplicateKeys = campaign2?.appliedEditKeys.filter((key, index, all) => all.indexOf(key) !== index).length ?? 1
  check('fixture2_duplicate_keys', duplicateKeys === 0 && edited2.length === (campaign2?.filesMutated.length ?? -1) + (campaign2?.reworkCycles ?? 0), `edited=${edited2.length} keys=${campaign2?.appliedEditKeys.join(',')}`)

  // ---- Phase 2: the plan is built from project truth, revised by evidence, kept across reload, and never repeats finished work.
  const plan1 = campaign1?.plan
  check('plan_built_for_a_clean_mission', Boolean(plan1) && plan1!.revision === 1 && plan1!.tasks.length >= 6 && plan1!.tasks.every(task => task.status === 'DONE' || task.status === 'SKIPPED') && planProblems(plan1!).length === 0, `rev=${plan1?.revision} tasks=${plan1?.tasks.map(t => t.status).join(',')}`)
  check('plan_tasks_have_acceptance_working_set_reason_and_dependencies', Boolean(plan1) && plan1!.tasks.every(task => task.acceptance.length > 0 && task.workingSetWhy.length > 0) && plan1!.tasks.some(task => task.id === 'backend' && task.workingSet.includes('backend/api.py')) && plan1!.tasks.some(task => task.id === 'frontend' && task.workingSet.includes('frontend/board.py')), plan1?.tasks.map(t => `${t.id}:${t.workingSet.join('+')}`).join(' ') ?? '')
  check('plan_goal_and_acceptance_come_from_the_request', Boolean(plan1) && plan1!.goal.length > 0 && plan1!.acceptance.length > 0, plan1?.goal ?? '')
  const plan2 = campaign2?.plan
  const revisionEvents2 = (mission2.codingMission?.engineeringRuntime?.events ?? []).filter(event => event.type === 'PLAN_REVISED')
  check('plan_is_revised_when_the_failure_evidence_arrives', Boolean(plan2) && plan2!.revision >= 2 && plan2!.revisions.length >= 2 && plan2!.revisions.some(rev => rev.trigger === 'TEST_FAILURE'), `rev=${plan2?.revision} triggers=${plan2?.revisions.map(r => r.trigger).join(',')}`)
  check('plan_revision_is_announced_as_a_runtime_event', revisionEvents2.length >= 1 && revisionEvents2.every(event => { try { const p = JSON.parse(event.detail ?? '{}') as { revision?: number }; return typeof p.revision === 'number' } catch { return false } }), `events=${revisionEvents2.length}`)
  const rev2 = plan2?.revisions.find(rev => rev.trigger === 'TEST_FAILURE')
  check('plan_keeps_completed_work_and_states_it_was_not_repeated', Boolean(rev2) && ['discover', 'architect', 'contract'].every(id => rev2!.changes.some(change => change.op === 'KEEP' && change.taskId === id)) && !rev2!.changes.some(change => change.op === 'REOPEN' && ['discover', 'architect', 'contract'].includes(change.taskId)), rev2?.changes.map(c => `${c.op}:${c.taskId}`).join(' ') ?? '')
  check('plan_reopens_only_the_implicated_work_with_a_reason', Boolean(rev2) && rev2!.changes.some(change => change.op === 'REOPEN' && change.taskId === 'backend' && change.why.length > 0) && unjustifiedReopens(plan2!).length === 0, rev2?.changes.map(c => `${c.op}:${c.taskId}`).join(' ') ?? '')
  check('plan_adds_a_debug_step_linked_to_the_failure', Boolean(plan2) && plan2!.tasks.some(task => task.id.startsWith('debug-') && task.dependsOn.length === 0) && Boolean(rev2?.evidence.length), plan2?.tasks.map(t => t.id).join(',') ?? '')
  check('plan_finished_work_is_not_executed_twice', (() => { const started = (mission2.codingMission?.engineeringRuntime?.events ?? []).filter(event => event.type === 'TASK_STARTED').map(event => (event.summary ?? '').toLowerCase()); const done = started.filter(text => text.startsWith('architect')); const backendRuns = started.filter(text => text.startsWith('backend')).length; return done.length === new Set(done).size && done.length === 3 && backendRuns === 2 })(), (mission2.codingMission?.engineeringRuntime?.events ?? []).filter(event => event.type === 'TASK_STARTED').map(event => event.summary).join(' | '))
  check('plan_is_structurally_sound_and_bounded', Boolean(plan2) && planProblems(plan2!).length === 0 && plan2!.tasks.length <= 32 && plan2!.revisions.length <= 12, planProblems(plan2!).join(';') || 'ok')
  const reloaded2 = await runWithWorkspaceRoot(root2, () => getRepair(mission2.id))
  check('plan_survives_a_restart_byte_for_byte', JSON.stringify(reloaded2?.codingMission?.engineeringRuntime?.campaign?.plan) === JSON.stringify(plan2), `revisions=${reloaded2?.codingMission?.engineeringRuntime?.campaign?.plan?.revisions.length}`)
  const human = planSummary(plan2)
  const RAW_TERMS = /\b(debug-\d|TASK_|PLAN_|BLOCKED_|FAILURE_CHANGED|TEST_FAILURE|CONTRADICTION|REOPENED|fingerprint|mutationGeneration)\b/
  check('plan_summary_is_plain_language_with_no_ids_or_enums', Boolean(human) && [human!.headline, human!.lastRevision ?? '', ...human!.steps].every(text => !RAW_TERMS.test(text)) && human!.steps.every(step => !step.startsWith('Find the cause of the failing test')), `${human?.headline} | ${human?.lastRevision}`)

  const restartRoot = path.join(tmpdir(), `foundry-campaign-restart-${Date.now()}`)
  rmSync(restartRoot, { recursive: true, force: true })
  fixtureOne(restartRoot)
  const paused = await runMission(restartRoot, request1, 'PLAN_READY')
  const pausedCampaign = paused.codingMission?.engineeringRuntime?.campaign
  check('restart_paused', paused.state !== 'resolved' && (pausedCampaign?.checkpoints ?? []).includes('PLAN_READY') && (pausedCampaign?.filesMutated.length ?? 1) === 0, pausedCampaign?.checkpoints.join(',') ?? paused.state)
  const resumed = await runWithWorkspaceRoot(restartRoot, async () => {
    const record = await getRepair(paused.id)
    if (!record?.codingMission?.engineeringRuntime?.campaign) throw new Error('missing pause')
    record.codingMission.engineeringRuntime.campaign.pauseAfter = null
    await saveRepair(record)
    return runCodingMission(paused.id)
  })
  const resumedCampaign = resumed.codingMission?.engineeringRuntime?.campaign
  const started = (resumed.codingMission?.engineeringRuntime?.events ?? []).filter(event => event.type === 'CAMPAIGN_STARTED').length
  const resumedEvents = (resumed.codingMission?.engineeringRuntime?.events ?? []).filter(event => event.type === 'MISSION_RESUMED').length
  check('restart_resume', resumed.state === 'resolved' && resumedCampaign?.repoFileCount === pausedCampaign?.repoFileCount && started === 1 && resumedEvents === 1, `state=${resumed.state} started=${started} resumed=${resumedEvents}`)
  check('restart_no_duplicate', (resumedCampaign?.appliedEditKeys.length ?? 0) === new Set(resumedCampaign?.appliedEditKeys ?? []).size, (resumedCampaign?.appliedEditKeys ?? []).join(','))

  const failed = results.filter(result => !result.pass)
  console.log(`CAMPAIGN_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : 'campaign validation failed')
  process.exit(1)
})
