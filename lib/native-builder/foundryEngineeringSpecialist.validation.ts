/**
 * Model-backed campaign checks.
 * Unit checks do not call a model. The two fixtures do.
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
import { runCodingMission } from './engineerLoop'
import {
  campaignCompletionAllowed,
  diskMeetsContract,
  implementationNeedsEdit,
  MAX_MODEL_CALLS_PER_CAMPAIGN,
  resolveInterfaceContradiction,
  reviewerFoundGap,
  sourceUsesUnboundName,
  specialistActivity,
} from './foundryEngineeringCampaign'
import {
  classifySpecialistTool,
  editFromProposal,
  allowImplementerCorrection,
  implementerCorrectionPrompt,
  IMPLEMENTER_CORRECTION_LIMIT,
  parseSpecialistPayload,
  specialistRemotePermitted,
} from './foundryEngineeringSpecialist'

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
const OPEN_ONLY = 'from shared.contract import FILTER_FIELD\n\ndef list_projects(projects, status=None):\n    if status == "open":\n        return [item for item in projects if item.get("status") == "open"]\n    return list(projects)\n'

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
    'FILTER_FIELD = "status"\nACCEPTANCE_CLOSED = "status closed returns only closed rows"\nACCEPTANCE_UI = "the UI function forwards status"\n',
    OPEN_ONLY,
    UI,
    'import unittest\nfrom backend.api import list_projects\n\nclass ApiTests(unittest.TestCase):\n    def test_open(self):\n        rows = [{"name": "A", "status": "open"}, {"name": "B", "status": "closed"}]\n        names = [item["name"] for item in list_projects(rows, status="open")]\n        self.assertEqual(names, ["A"])\n',
    'import unittest\nfrom frontend.board import show_board\n\nclass UiTests(unittest.TestCase):\n    def test_open_visible(self):\n        rows = [{"name": "A", "status": "open"}, {"name": "B", "status": "closed"}]\n        self.assertIn("A", show_board(rows, status="open"))\n',
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
      if (runtime.campaign) runtime.campaign.intelligence = 'model'
    }
    await saveRepair({
      ...opened.repair,
      codingMission: {
        mode: 'bounded_coding',
        commanderRequest: request,
        specialistIntelligence: 'model',
        objective: 'Campaign',
        acceptanceCriteria: [request],
        plan: [],
        currentStep: 'PLANNING',
        attempt: 0,
        maxAttempts: 8,
        filesRead: [],
        filesChanged: [],
        commandsExecuted: [],
        testsExecuted: [],
        progressEvents: [],
        visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE',
        sessionId: 'campaign-v4',
        engineeringRuntime: runtime,
      },
    })
    return runCodingMission(opened.repair.id)
  })
}

function campaignOf(repair: Awaited<ReturnType<typeof runMission>>) {
  return repair?.codingMission?.engineeringRuntime?.campaign ?? null
}

async function main() {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const sources = ['foundryEngineeringSpecialist.ts', 'foundryEngineeringCampaign.ts', 'foundryEngineeringRuntime.ts']
    .map(file => readFileSync(path.join(here, file), 'utf8')).join('\n')
  const specialist = readFileSync(path.join(here, 'foundryEngineeringSpecialist.ts'), 'utf8')
  check('provider_branch', !/(?:\bif\b|===|!==|\?|case)[^\n]*(?:qwen|composer)/i.test(sources), 'no provider-named campaign branch (a provider name in operator guidance text is not a branch)')
  check('known_repair', !specialist.includes('status=status') && !specialist.includes('contract.py, api.py'), 'no injected answer')
  check('false_complete', campaignCompletionAllowed({ verification: 'NOT_READY', testsPassed: false, reviewClear: false, unresolvedFailure: true }) === false && campaignCompletionAllowed({ verification: 'PROJECT_READY', testsPassed: true, reviewClear: true, unresolvedFailure: false }) === true && campaignCompletionAllowed({ verification: 'PROJECT_READY', testsPassed: true, reviewClear: false, unresolvedFailure: false }) === false, 'gate')
  check('remote_policy', specialistRemotePermitted('LOCAL', false) === false && specialistRemotePermitted('AUTO', true) === false && specialistRemotePermitted('AUTO', false) === true, 'policy')
  check('policy_block', classifySpecialistTool('git.push') === 'POLICY_BLOCK' && classifySpecialistTool('file.replace_unique') === null, 'tools')
  check('budget', MAX_MODEL_CALLS_PER_CAMPAIGN === 24, String(MAX_MODEL_CALLS_PER_CAMPAIGN))
  check('contradiction', resolveInterfaceContradiction('state', 'status')?.contradiction.includes('state') === true && resolveInterfaceContradiction('status', 'status') === null, 'explicit')
  check('needs_edit', implementationNeedsEdit('BACKEND', OPEN_ONLY, 'FILTER_FIELD = "status"\n', null) === false && implementationNeedsEdit('FRONTEND', UI, '', null) === true, 'scope')
  check('needs_edit_unbound', sourceUsesUnboundName("    return [item for item in ITEMS if normalize_status(item.get('status')) == 1]\n") === true && implementationNeedsEdit('BACKEND', "    return [item for item in ITEMS if normalize_status(item.get('status')) == 1]\n", '', 'normalization is not applied') === true, 'destroyed')
  const brokenParen = 'def list_items(query=None):\n    return [item for item in ITEMS if True\n'
  check('needs_edit_unparseable', implementationNeedsEdit('BACKEND', brokenParen, '', 'missing closing parenthesis in list_items') === true, 'syntax')
  check('review_gap', reviewerFoundGap('STATUS fail closed is unmet') && !reviewerFoundGap('STATUS pass'), 'review')
  check('disk_gate', diskMeetsContract('FILTER_FIELD = "status"\n', 'item.get("status")', 'status=status') && !diskMeetsContract('ACCEPTANCE_CLOSED = "status closed returns only closed rows"\nFILTER_FIELD = "status"\n', OPEN_ONLY, UI), 'disk')
  check('activity', activityTitle({ type: 'TASK_STARTED', phase: 'PLANNING', summary: specialistActivity('ARCHITECT') }) === 'ARCHITECT — analyzing', specialistActivity('VERIFIER'))
  const source = 'def list_projects(projects, status=None):\n    return list(projects)\n'
  const parsed = parseSpecialistPayload({
    raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'filter', tool: { name: 'file.replace_unique', args: { path: 'backend/api.py', matchText: 'return list(projects)', replacementText: 'return [item for item in projects if item.get("status") == status]' } } }),
    summary: 'filter',
    role: 'BACKEND',
    needsEdit: true,
    sources: new Map([['backend/api.py', source]]),
  })
  check('governed_parse', parsed.failureClass === null && parsed.edit?.after.includes('.get("status")') === true, parsed.failureClass ?? 'edit')
  const invalid = parseSpecialistPayload({ raw: '{"decision":"COMPLETE","reasoningSummary":"done"}', summary: 'done', role: 'BACKEND', needsEdit: true, sources: new Map([['backend/api.py', source]]) })
  check('invalid_output', invalid.failureClass === 'INVALID_OUTPUT' && invalid.edit === null, invalid.failureClass ?? 'none')
  const echoed = parseSpecialistPayload({
    raw: '{"decision":"TOOL","reasoningSummary":"bounded edit","tool":{"name":"file.replace_unique","args":{"path":"src/example.ts","anchorId":"<anchorId-from-file.read>","replacementText":"NEW_LABEL","reason":"update label"}}}',
    summary: 'bounded edit',
    role: 'BACKEND',
    needsEdit: true,
    sources: new Map([['backend/api.py', source]]),
  })
  check('example_path_rejected', echoed.failureClass === 'INVALID_OUTPUT' && echoed.edit === null && echoed.result.summary.includes('outside the working set') && echoed.result.evidence[0] === 'bounded edit', echoed.result.summary)
  const missingMatch = parseSpecialistPayload({
    raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'edit', tool: { name: 'file.replace_unique', args: { path: 'backend/api.py', replacementText: 'return []' } } }),
    summary: 'edit',
    role: 'BACKEND',
    needsEdit: true,
    sources: new Map([['backend/api.py', source]]),
  })
  check('missing_match_rejected', missingMatch.failureClass === 'INVALID_OUTPUT' && missingMatch.edit === null && missingMatch.result.summary.includes('matchText'), missingMatch.result.summary)
  const stale = parseSpecialistPayload({
    raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'edit', tool: { name: 'file.replace_unique', args: { path: 'backend/api.py', matchText: 'not in file', replacementText: 'return []' } } }),
    summary: 'edit',
    role: 'BACKEND',
    needsEdit: true,
    sources: new Map([['backend/api.py', source]]),
  })
  check('stale_match_rejected', stale.failureClass === 'INVALID_OUTPUT' && stale.edit === null, stale.result.summary)
  const directWrite = parseSpecialistPayload({
    raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'write', tool: { name: 'file.write', args: { path: 'backend/api.py', content: 'print(1)' } } }),
    summary: 'write',
    role: 'BACKEND',
    needsEdit: true,
    sources: new Map([['backend/api.py', source]]),
  })
  check('direct_write_rejected', directWrite.failureClass === 'INVALID_OUTPUT' && directWrite.edit === null, directWrite.failureClass ?? 'none')
  const corrected = parseSpecialistPayload({
    raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'filter status', tool: { name: 'file.replace_unique', args: { path: 'backend/api.py', matchText: 'return list(projects)', replacementText: 'return [item for item in projects if item.get("status") == status]' } } }),
    summary: 'filter status',
    role: 'BACKEND',
    needsEdit: true,
    sources: new Map([['backend/api.py', source]]),
  })
  check('corrected_output_accepted', corrected.failureClass === null && corrected.edit !== null && echoed.edit === null, corrected.edit?.file ?? 'none')
  const correction = implementerCorrectionPrompt(echoed.result.summary)
  check('one_correction_prompt', correction.startsWith('REJECTED path src/example.ts is outside the working set') && correction.includes('matchText') && IMPLEMENTER_CORRECTION_LIMIT === 1, correction.slice(0, 80))
  check('no_second_correction', allowImplementerCorrection({ needsEdit: true, failureClass: 'INVALID_OUTPUT', correctionsUsed: 0, callsRemaining: 4, calls: 1 }) === true && allowImplementerCorrection({ needsEdit: true, failureClass: 'INVALID_OUTPUT', correctionsUsed: 1, callsRemaining: 4, calls: 2 }) === false, 'limit')
  check('governance_policy_blocks_delete', classifySpecialistTool('file.delete') === 'POLICY_BLOCK' && classifySpecialistTool('file.replace_unique') === null, classifySpecialistTool('file.delete') ?? 'none')
  const outside = editFromProposal({ file: 'backend/api.py', search: 'missing', replace: 'x' }, new Map([['backend/api.py', source]]))
  check('unique_anchor', outside === null, 'refused')
  const unparseable = editFromProposal({
    file: 'backend/api.py',
    search: 'return list(projects)',
    replace: 'return [item for item in projects if True',
  }, new Map([['backend/api.py', source]]))
  check('refuse_unparseable', unparseable === null, 'syntax')
  const fileWrite = parseSpecialistPayload({
    raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'bounded edit', tool: { name: 'file.write', args: { path: 'backend/api.py', content: 'return 1\n' } } }),
    summary: 'bounded edit',
    role: 'BACKEND',
    needsEdit: true,
    sources: new Map([['backend/api.py', source]]),
  })
  check('refuse_file_write', fileWrite.failureClass === 'INVALID_OUTPUT' && fileWrite.edit === null, fileWrite.failureClass ?? 'none')
  if (results.some(item => !item.pass)) {
    console.log(`FAIL ${results.filter(item => item.pass).length}/${results.length}`)
    process.exit(1)
  }

  const root1 = path.join(tmpdir(), `foundry-v4-one-${Date.now()}`)
  const request1 = 'Add project status filtering and expose it through the API and the UI'
  fixtureOne(root1)
  const repair1 = await runMission(root1, request1)
  const campaign1 = campaignOf(repair1)
  const roles1 = new Set((campaign1?.workerReceipts ?? []).map(item => item.role))
  if (campaign1?.verification !== 'PROJECT_READY') {
    console.log('API', readFileSync(path.join(root1, 'backend/api.py'), 'utf8'))
    console.log('UI', readFileSync(path.join(root1, 'frontend/board.py'), 'utf8'))
    console.log('TESTS', campaign1?.knowledge.tests.join(' | '))
    console.log('RECEIPTS', (campaign1?.workerReceipts ?? []).map(item => `${item.role}:${item.summary}`).join(' || '))
  }
  check('fixture1_ready', campaign1?.verification === 'PROJECT_READY' && campaign1.phase === 'COMPLETE', campaign1?.verification ?? `${repair1?.codingMission?.engineeringRuntime?.blockedDetail?.summary ?? 'none'}: ${repair1?.codingMission?.engineeringRuntime?.blockedDetail?.failure ?? ''}`)
  check('fixture1_calls', (campaign1?.modelCalls ?? 0) >= 3 && roles1.has('ARCHITECT') && (roles1.has('BACKEND') || roles1.has('FRONTEND')) && roles1.has('REVIEWER') && roles1.has('VERIFIER'), `${campaign1?.modelCalls ?? 0} ${[...roles1].join(',')}`)
  check('fixture1_edit', readFileSync(path.join(root1, 'backend/api.py'), 'utf8').includes('status') && readFileSync(path.join(root1, 'frontend/board.py'), 'utf8').includes('status=status'), 'disk')
  check('fixture1_truth', campaign1?.modelDirectWrites === 0 && campaign1?.frkDirectWrites === 0 && campaign1?.rawChainOfThoughtStored === 0 && campaign1?.secondMissionTruthCount === 0 && campaign1?.duplicateWorkerCallCount === 0, 'counts')
  check('fixture1_keep', readFileSync(path.join(root1, 'notes/keep.txt'), 'utf8').includes('keep-me'), 'dirty')
  check('fixture1_attribution', (campaign1?.workerReceipts ?? []).every(item => item.provider && item.model && item.routingDecisionId && item.workerCallId), 'receipts')
  rmSync(root1, { recursive: true, force: true })

  const root2 = path.join(tmpdir(), `foundry-v4-two-${Date.now()}`)
  const request2 = 'Update item status filtering and expose it through the API and the UI'
  fixtureTwo(root2)
  const repair2 = await runMission(root2, request2)
  const campaign2 = campaignOf(repair2)
  const review = (campaign2?.workerReceipts ?? []).find(item => item.role === 'REVIEWER')
  const debug = (campaign2?.workerReceipts ?? []).find(item => item.role === 'DEBUGGER')
  if (campaign2?.verification !== 'PROJECT_READY') {
    console.log('API2', readFileSync(path.join(root2, 'backend/api.py'), 'utf8'))
    console.log('UI2', readFileSync(path.join(root2, 'frontend/board.py'), 'utf8'))
    console.log('TESTS2', campaign2?.knowledge.tests.join(' | '))
    console.log('RECEIPTS2', (campaign2?.workerReceipts ?? []).map(item => `${item.role}:${item.resultStatus}:${item.summary}`).join(' || '))
  }
  check('fixture2_review', reviewerFoundGap(review?.summary ?? ''), review?.summary ?? 'none')
  check('fixture2_debug', Boolean(debug?.summary), debug?.summary ?? 'none')
  check('fixture2_rework', (campaign2?.reworkCycles ?? 0) >= 1 && campaign2?.blindRetryCount === 0, String(campaign2?.reworkCycles ?? 0))
  check('fixture2_ready', campaign2?.verification === 'PROJECT_READY' && !/if status == ["']open["']/.test(readFileSync(path.join(root2, 'backend/api.py'), 'utf8')) && /status=status/.test(readFileSync(path.join(root2, 'frontend/board.py'), 'utf8')), campaign2?.verification ?? `${repair2?.codingMission?.engineeringRuntime?.blockedDetail?.summary ?? 'none'}: ${repair2?.codingMission?.engineeringRuntime?.blockedDetail?.failure ?? ''}`)
  check('fixture2_truth', campaign2?.modelDirectWrites === 0 && campaign2?.rawChainOfThoughtStored === 0 && (campaign2?.modelCalls ?? 0) <= MAX_MODEL_CALLS_PER_CAMPAIGN, String(campaign2?.modelCalls ?? 0))
  rmSync(root2, { recursive: true, force: true })

  const root3 = path.join(tmpdir(), `foundry-v4-resume-${Date.now()}`)
  fixtureOne(root3)
  const paused = await runMission(root3, request1, 'AFTER_ARCHITECT')
  const pausedCampaign = campaignOf(paused)
  check('pause_call', (pausedCampaign?.modelCalls ?? 0) >= 1 && pausedCampaign?.checkpoints.includes('SPECIALIST_RESULT') === true && (pausedCampaign?.filesMutated.length ?? 1) === 0, String(pausedCampaign?.modelCalls ?? 0))
  const resumed = await runWithWorkspaceRoot(root3, async () => {
    const current = await getRepair(paused!.id)
    if (!current?.codingMission?.engineeringRuntime?.campaign) throw new Error('missing paused campaign')
    current.codingMission.engineeringRuntime.campaign.pauseAfter = null
    await saveRepair(current)
    return runCodingMission(current.id)
  })
  const resumedCampaign = campaignOf(resumed)
  const architectReceipts = (resumedCampaign?.workerReceipts ?? []).filter(item => item.role === 'ARCHITECT' && !item.failureClass)
  check('resume_once', resumedCampaign?.verification === 'PROJECT_READY' && architectReceipts.length === 1 && resumedCampaign.duplicateWorkerCallCount === 0, `${architectReceipts.length} dup ${resumedCampaign?.duplicateWorkerCallCount ?? -1}`)
  rmSync(root3, { recursive: true, force: true })

  const failed = results.filter(item => !item.pass)
  console.log(`${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
