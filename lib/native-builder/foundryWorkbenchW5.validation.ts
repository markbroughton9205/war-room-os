/**
 * W5 source + in-process fixtures: Commander debugger + Test Explorer.
 * Disposable fixture Git only. Never commit/push the canonical War Room repo.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFoundryWorkbenchW4Validation } from './foundryWorkbenchW4.validation'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { acceptW2Proposal } from './foundryWorkbenchW2'
import { FOUNDRY_WORKBENCH_EVENT_TYPES, foundryWorkbenchEventsRegisteredOnAgentBus, appendFoundryWorkbenchEvent } from './foundryWorkbenchEvents'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import { FOUNDRY_EDITOR_CONTEXT_BOUNDS } from './foundryEditorContext'
import {
  AUTO_COMMIT_AFTER_DEBUG_FIX,
  AUTO_PUSH_AFTER_DEBUG_FIX,
  AUTO_STAGE_AFTER_DEBUG_FIX,
  FOUNDRY_W5_COMMANDS,
  W4_1_STILL_DEFERRED,
  W5_BROWSER_DEBUG,
  W5_COMMANDER_DEBUG_CHARGES_MISSION_BUDGET,
  W5_COMMANDER_TEST_CHARGES_MISSION_BUDGET,
  W5_DEBUG_LANGUAGE,
  W5_MULTI_PROCESS_DEBUG,
  W5_SOURCE_MAP_STATUS,
  W5_TEST_FRAMEWORK,
  W5_TEST_HISTORY,
  W5_WATCH_MODE_DEFAULT,
  boundDebugSnapshot,
  boundTestSnapshot,
  ensureFoundryWorkbenchW5Fixture,
  envelopeWithDebug,
  envelopeWithTest,
  fixtureDebugSnapshot,
  fixtureFailingTest,
  remoteDebugSecretLeakCount,
  remoteTestSecretLeakCount,
  runFoundryW5Command,
  runNodeTests,
  scmAfterFix,
  w5AdapterDebugControlPathCount,
  w5AdapterDirectWritePathCount,
  w5AuthorityStillZero,
} from './foundryWorkbenchW5'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function git(args: string[], cwd: string) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true })
}

async function run() {
  await runFoundryWorkbenchW4Validation()
  const results: CaseResult[] = []
  const adapter = source('desktop/workbench-host/extensions/foundry-adapter/extension.js')
  const adapterPkg = source('desktop/workbench-host/extensions/foundry-adapter/package.json')
  const policy = source('desktop/workbench-host/policy.cjs')
  const pane = source('components/war-room/foundry/FoundryWorkbenchAiPanel.tsx')
  const main = source('desktop/src/main.cjs')
  const w5 = source('lib/native-builder/foundryWorkbenchW5.ts')

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'default off'))
  results.push(check('debug_ui_policy', /debug\.openDebug': 'openOnDebugBreak'/.test(policy) && /debug\.javascript\.autoAttachFilter': 'disabled'/.test(policy), 'native Debug UI; auto-attach off'))
  results.push(check('test_explorer_policy', /testing\.openTesting': 'neverOpen'/.test(policy) && /testing\.followRunningTest': false/.test(policy) && /saveBeforeTestRun': 'never'/.test(policy), 'Test Explorer does not auto-watch'))
  results.push(check('adapter_w5_commands', FOUNDRY_W5_COMMANDS.every(id => adapterPkg.includes(id) && adapter.includes(id)), FOUNDRY_W5_COMMANDS.join(',')))
  results.push(check('adapter_test_controller', /createTestController/.test(adapter) && /foundry\.nodeTest/.test(adapter) && !/--watch/.test(adapter), 'node:test TestController, no watch'))
  results.push(check('adapter_dap_gated', /runW5Proof/.test(adapter) && /commanderAuthorized/.test(adapter) && w5AdapterDebugControlPathCount(adapter) === 0, `bypass=${w5AdapterDebugControlPathCount(adapter)}`))
  results.push(check('adapter_no_evaluate', !/customRequest\(\s*['"]evaluate['"]/.test(adapter), 'AI has no Debug Console evaluate'))
  results.push(check('adapter_no_direct_write', w5AdapterDirectWritePathCount(adapter) === 0 && !/workspace\.fs\.writeFile/.test(adapter), `writes=${w5AdapterDirectWritePathCount(adapter)}`))
  results.push(check('openvsx_off', /serviceUrl: ''/.test(source('desktop/workbench-host/prepare.cjs')), 'OpenVSX off'))
  results.push(check('marketplace_off', !/marketplace\.visualstudio\.com/.test(source('desktop/workbench-host/index.cjs')), 'Marketplace off'))
  results.push(check('no_sandbox', !/appendSwitch\(['"]no-sandbox['"]\)/.test(main), 'sandbox policy unchanged'))
  results.push(check('events_registered', foundryWorkbenchEventsRegisteredOnAgentBus() && ['DEBUG_CONTEXT_ATTACHED', 'TEST_FAILURE_ATTACHED', 'TEST_FIX_VERIFIED'].every(type => (FOUNDRY_AGENT_EVENT_TYPES as readonly string[]).includes(type) && (FOUNDRY_WORKBENCH_EVENT_TYPES as readonly string[]).includes(type)), 'W5 events on existing bus'))
  results.push(check('chips', /chips\?\.debug/.test(pane) && /chips\?\.test/.test(pane), 'Composer debug/test chips'))
  results.push(check('watch_default', W5_WATCH_MODE_DEFAULT === 'disabled', W5_WATCH_MODE_DEFAULT))
  results.push(check('framework', W5_TEST_FRAMEWORK === 'node:test' && W5_DEBUG_LANGUAGE === 'javascript', `${W5_TEST_FRAMEWORK}/${W5_DEBUG_LANGUAGE}`))
  results.push(check('source_map_status', W5_SOURCE_MAP_STATUS === 'JS_FIXTURE_PROVEN_TS_MAP_LIMITED', W5_SOURCE_MAP_STATUS))
  results.push(check('w4_1_deferred', W4_1_STILL_DEFERRED === true && /DEFERRED_W4_1/.test(source('lib/native-builder/foundryWorkbenchW4.ts')), 'W4.1 not implemented'))
  results.push(check('auto_scm_off', AUTO_STAGE_AFTER_DEBUG_FIX === false && AUTO_COMMIT_AFTER_DEBUG_FIX === false && AUTO_PUSH_AFTER_DEBUG_FIX === false && w5AuthorityStillZero(), 'no auto stage/commit/push'))
  results.push(check('resource_accounting', W5_COMMANDER_DEBUG_CHARGES_MISSION_BUDGET === false && W5_COMMANDER_TEST_CHARGES_MISSION_BUDGET === false, 'Commander debug/test not mission-budgeted'))
  results.push(check('scope_limits', W5_MULTI_PROCESS_DEBUG === 'NOT_REQUIRED' && W5_BROWSER_DEBUG === 'NOT_REQUIRED' && W5_TEST_HISTORY === 'BOUNDED_CURRENT_RUN', 'single Node process; bounded history'))
  results.push(check('variable_bounds', FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DEBUG_FRAMES === 8 && FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DEBUG_VARS === 12 && FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DEBUG_VAR_CHARS === 200, 'bounded debug serialization'))
  results.push(check('no_eventsystem2', !/EventSystem2/.test(w5) && !/EventSystem2/.test(adapter), 'existing bus only'))

  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const previousProjects = process.env.FOUNDRY_PROJECTS_ROOT
  const previousStateDir = process.env.FOUNDRY_WORKBENCH_STATE_DIR
  process.env.FOUNDRY_PROJECTS_ROOT = path.join(os.tmpdir(), `w5-projects-${process.pid}`)
  process.env.FOUNDRY_WORKBENCH_STATE_DIR = path.join(os.tmpdir(), `w5-state-${process.pid}`)
  mkdirSync(process.env.FOUNDRY_PROJECTS_ROOT, { recursive: true })
  mkdirSync(process.env.FOUNDRY_WORKBENCH_STATE_DIR, { recursive: true })

  const fixture = ensureFoundryWorkbenchW5Fixture(path.join(process.env.FOUNDRY_PROJECTS_ROOT, 'w5-debug-test-fixture'))
  const debugFixDir = ensureFoundryWorkbenchW5Fixture(path.join(process.env.FOUNDRY_PROJECTS_ROOT, 'w5-debug-fix'))
  const testFixDir = ensureFoundryWorkbenchW5Fixture(path.join(process.env.FOUNDRY_PROJECTS_ROOT, 'w5-test-fix'))
  const staleDir = ensureFoundryWorkbenchW5Fixture(path.join(process.env.FOUNDRY_PROJECTS_ROOT, 'w5-stale'))

  const launch = readFileSync(path.join(fixture, '.vscode', 'launch.json'), 'utf8')
  const provenance = path.join(fixture, '.vscode', 'FOUNDRY_LAUNCH_PROVENANCE.json')
  results.push(check('fixture_A_debug_start', /pwa-node/.test(launch) && /debug-entry\.js/.test(launch) && existsSync(path.join(fixture, 'debug-entry.js')), 'launch pwa-node present'))
  results.push(check('launch_provenance', existsSync(provenance) && /foundry-workbench-w5/.test(readFileSync(provenance, 'utf8')), 'generated launch provenance recorded'))

  const existingLaunch = path.join(process.env.FOUNDRY_PROJECTS_ROOT, 'w5-existing-launch')
  mkdirSync(path.join(existingLaunch, '.vscode'), { recursive: true })
  writeFileSync(path.join(existingLaunch, '.vscode', 'launch.json'), '{"version":"0.2.0","configurations":[]}\n')
  ensureFoundryWorkbenchW5Fixture(existingLaunch)
  results.push(check('launch_not_overwritten', readFileSync(path.join(existingLaunch, '.vscode', 'launch.json'), 'utf8').includes('"configurations":[]'), 'existing launch.json preserved'))

  const ranBefore = runNodeTests(fixture)
  const debugRan = spawnSync(process.execPath, ['debug-entry.js'], { cwd: fixture, encoding: 'utf8', timeout: 10_000 })
  results.push(check('fixture_bug_executes', debugRan.status === 0 && /"total":20/.test(debugRan.stdout), debugRan.stdout.slice(0, 120)))
  results.push(check('fixture_B_breakpoint', /addBreakpoints/.test(adapter) && /SourceBreakpoint/.test(adapter) && /breakpointLine/.test(adapter), 'adapter sets line breakpoints'))
  const snap = fixtureDebugSnapshot(fixture)
  results.push(check('fixture_C_variables', snap.boundedVariables.some(item => item.name === 'total') && snap.boundedVariables.some(item => item.name === 'items'), snap.boundedVariables.map(item => item.name).join(',')))
  results.push(check('fixture_D_call_stack', snap.boundedCallStack.length >= 2 && snap.boundedCallStack[0]?.functionName === 'calculateTotal', String(snap.boundedCallStack.length)))
  results.push(check('fixture_E_stepping', /dap\(session, 'next'/.test(adapter) && /stepIn/.test(adapter) && /stepOut/.test(adapter), 'step over/into/out wired'))

  const attach = await runFoundryW5Command({ kind: 'attachDebug', workspaceRoot: fixture, providerClass: 'local' })
  const beforeExplain = readFileSync(path.join(fixture, 'calculate-total.js'), 'utf8')
  const explain = await runFoundryW5Command({ kind: 'explainDebug', workspaceRoot: fixture, providerClass: 'local' })
  results.push(check('fixture_F_debug_explain', explain.ok === true && explain.readOnly === true && Boolean(explain.chips?.debug) && readFileSync(path.join(fixture, 'calculate-total.js'), 'utf8') === beforeExplain, String(explain.chips?.debug)))
  results.push(check('debug_context_attach', attach.ok === true && Boolean(attach.envelope?.debug?.attached) && /Debug ·/.test(String(attach.chips?.debug)), String(attach.chips?.debug)))

  const debugFix = await runFoundryW5Command({ kind: 'fixFromDebug', workspaceRoot: debugFixDir })
  results.push(check('debug_fix_proposal', Boolean(debugFix.proposal) && /implementation is wrong/i.test(String(debugFix.proposal?.reason)) && !/rewrite the test/i.test(String(debugFix.proposal?.replacementText)), debugFix.proposal?.reason || ''))
  const debugAccepted = debugFix.proposal ? await acceptW2Proposal(debugFix.proposal.proposalId) : { ok: false, error: 'no proposal' }
  const afterDebug = runNodeTests(debugFixDir)
  results.push(check('fixture_G_debug_fix', debugAccepted.ok === true && afterDebug.tests.every(item => item.status === 'pass') && /items\.length/.test(readFileSync(path.join(debugFixDir, 'calculate-total.js'), 'utf8')) && !/length - 1/.test(readFileSync(path.join(debugFixDir, 'calculate-total.js'), 'utf8')), debugAccepted.error || afterDebug.tests.map(item => item.status).join(',')))
  const debugScm = scmAfterFix(debugFixDir)
  const debugStaged = git(['diff', '--cached', '--name-only'], debugFixDir).stdout.trim()
  results.push(check('scm_after_debug_fix', Boolean((debugScm.changedFiles || []).some(item => item.includes('calculate-total.js'))) && !debugStaged, `changed=${(debugScm.changedFiles || []).join(',')} staged=${debugStaged}`))

  const discovered = await runFoundryW5Command({ kind: 'discoverTests', workspaceRoot: fixture })
  results.push(check('fixture_H_test_discovery', Boolean(discovered.tests?.length) && discovered.tests!.some(item => /sums all line items/.test(item.name)), `n=${discovered.tests?.length}`))
  const suite = await runFoundryW5Command({ kind: 'runTests', workspaceRoot: fixture })
  const single = await runFoundryW5Command({ kind: 'runTests', workspaceRoot: fixture, instruction: 'single' })
  results.push(check('fixture_I_test_run', Boolean(suite.tests?.length) && Boolean(single.tests?.length), `suite=${suite.tests?.length} single=${single.tests?.length}`))
  const failing = fixtureFailingTest(fixture)
  results.push(check('fixture_J_test_failure', failing.status === 'fail' && /25/.test(String(failing.expected)) && Boolean(failing.message || failing.outputTail), `${failing.testName} ${failing.message}`))
  results.push(check('test_failure_surface', ranBefore.tests.some(item => item.status === 'fail') && /not ok|AssertionError|fail/i.test(`${ranBefore.stdout}\n${ranBefore.stderr}`), ranBefore.tests.map(item => `${item.name}:${item.status}`).join(',')))

  const beforeTestExplain = readFileSync(path.join(fixture, 'calculate-total.js'), 'utf8')
  const explainTest = await runFoundryW5Command({ kind: 'explainTest', workspaceRoot: fixture })
  results.push(check('fixture_K_explain_test', explainTest.ok === true && explainTest.readOnly === true && /not stale/i.test(String(explainTest.text)) && readFileSync(path.join(fixture, 'calculate-total.js'), 'utf8') === beforeTestExplain, String(explainTest.text).slice(0, 160)))
  results.push(check('test_context_attach', Boolean(explainTest.chips?.test) && /Test ·/.test(String(explainTest.chips?.test)) && /FAIL/.test(String(explainTest.chips?.test)), String(explainTest.chips?.test)))

  const testFix = await runFoundryW5Command({ kind: 'fixFailedTest', workspaceRoot: testFixDir })
  results.push(check('test_repair_safety', /implementation is wrong/i.test(String(testFix.proposal?.reason)) && !/calculate-total\.test\.js/.test(String(testFix.proposal?.filePath)), testFix.proposal?.reason || ''))
  const testAccepted = testFix.proposal ? await acceptW2Proposal(testFix.proposal.proposalId) : { ok: false, error: 'no proposal' }
  const afterTest = runNodeTests(testFixDir)
  appendFoundryWorkbenchEvent('TEST_FIX_VERIFIED', 'sums all line items')
  results.push(check('fixture_L_test_fix', testAccepted.ok === true && afterTest.tests.every(item => item.status === 'pass') && afterTest.status === 0, testAccepted.error || afterTest.tests.map(item => item.status).join(',')))

  const staleProp = await runFoundryW5Command({ kind: 'fixFailedTest', workspaceRoot: staleDir })
  writeFileSync(path.join(staleDir, 'calculate-total.js'), `${readFileSync(path.join(staleDir, 'calculate-total.js'), 'utf8')}\nexport const TOUCHED = true\n`)
  const staleApply = staleProp.proposal ? await acceptW2Proposal(staleProp.proposal.proposalId) : { ok: true, code: 'missing' }
  results.push(check('fixture_M_stale', staleApply.ok === false && staleApply.code === 'EDIT_PROPOSAL_STALE' && readFileSync(path.join(staleDir, 'calculate-total.js'), 'utf8').includes('TOUCHED'), String(staleApply.code)))

  const secretDebug = boundDebugSnapshot({
    ...fixtureDebugSnapshot(fixture),
    boundedVariables: [{ name: 'token', value: 'ghp_FAKESECRETVALUE1234567890abcd', truncated: false, redacted: false }],
  }, 'remote')
  const secretAttach = await runFoundryW5Command({
    kind: 'attachDebug',
    workspaceRoot: fixture,
    providerClass: 'remote',
    envelope: envelopeWithDebug(fixture, secretDebug, { sensitive: { blocked: false, redacted: true, reason: null, providerClass: 'remote' } }),
  })
  const leakDebug = remoteDebugSecretLeakCount(secretDebug, 'remote')
  results.push(check('fixture_N_secret_debug', leakDebug === 0 && !JSON.stringify(secretAttach.snapshot || secretDebug).includes('ghp_FAKESECRETVALUE1234567890abcd') && (secretAttach.privacy?.remoteSecretLeakCount ?? leakDebug) === 0, `leak=${leakDebug}`))

  const secretTest = boundTestSnapshot({
    ...fixtureFailingTest(fixture),
    outputTail: 'token=ghp_FAKESECRETVALUE1234567890abcd\nnot ok 1 - does not leak',
    message: 'token=ghp_FAKESECRETVALUE1234567890abcd',
  }, 'remote')
  const secretTestAttach = await runFoundryW5Command({
    kind: 'attachTest',
    workspaceRoot: fixture,
    providerClass: 'remote',
    envelope: envelopeWithTest(fixture, secretTest, { sensitive: { blocked: false, redacted: true, reason: null, providerClass: 'remote' } }),
  })
  const leakTest = remoteTestSecretLeakCount(secretTest, 'remote')
  results.push(check('fixture_O_secret_test', leakTest === 0 && !JSON.stringify(secretTestAttach.snapshot || secretTest).includes('ghp_FAKESECRETVALUE1234567890abcd'), `leak=${leakTest}`))

  const agentDebug = await runFoundryW5Command({ kind: 'agentDebugControl', workspaceRoot: fixture })
  const agentStart = await runFoundryW5Command({ kind: 'agentDebugStart', workspaceRoot: fixture })
  const agentStep = await runFoundryW5Command({ kind: 'agentDebugStep', workspaceRoot: fixture })
  const agentEval = await runFoundryW5Command({ kind: 'agentDebugEval', workspaceRoot: fixture })
  results.push(check('fixture_P_agent_debug', [agentDebug, agentStart, agentStep, agentEval].every(item => item.ok === false && item.code === 'AI_DEBUG_CONTROL'), agentDebug.code || ''))

  const boom = spawnSync(process.execPath, ['boom.js'], { cwd: fixture, encoding: 'utf8', timeout: 10_000 })
  const exceptionExplain = await runFoundryW5Command({
    kind: 'explainDebug',
    workspaceRoot: fixture,
    envelope: envelopeWithDebug(fixture, fixtureDebugSnapshot(fixture, { stoppedReason: 'exception', exception: 'Error: intentional fixture exception' })),
  })
  results.push(check('exception_flow', boom.status !== 0 && /intentional fixture exception/.test(`${boom.stderr}\n${boom.stdout}`) && exceptionExplain.readOnly === true, `status=${boom.status}`))

  const huge = boundDebugSnapshot({
    boundedVariables: [{ name: 'blob', value: 'x'.repeat(5000), truncated: false, redacted: false }],
    boundedCallStack: Array.from({ length: 40 }, (_, index) => ({ functionName: `fn${index}`, file: 'f.js', line: index })),
  })
  results.push(check('large_variable_bound', huge.boundedVariables[0]!.value.length <= 201 && huge.boundedCallStack.length <= 8, `chars=${huge.boundedVariables[0]?.value.length} frames=${huge.boundedCallStack.length}`))

  const counts = {
    AI_DEBUG_CONTROL_BYPASS_COUNT: w5AdapterDebugControlPathCount(adapter) + (agentDebug.ok ? 1 : 0),
    DEBUG_FIX_DIRECT_WRITE_COUNT: w5AdapterDirectWritePathCount(adapter),
    TEST_FIX_DIRECT_WRITE_COUNT: w5AdapterDirectWritePathCount(adapter),
    STALE_TEST_FIX_APPLY_COUNT: staleApply.ok ? 1 : 0,
    REMOTE_DEBUG_SECRET_LEAK_COUNT: leakDebug,
    REMOTE_TEST_SECRET_LEAK_COUNT: leakTest,
    AUTO_STAGE_AFTER_DEBUG_FIX_COUNT: debugStaged ? 1 : 0,
    AUTO_COMMIT_AFTER_DEBUG_FIX_COUNT: AUTO_COMMIT_AFTER_DEBUG_FIX ? 1 : 0,
    AUTO_PUSH_AFTER_DEBUG_FIX_COUNT: AUTO_PUSH_AFTER_DEBUG_FIX ? 1 : 0,
  }
  results.push(check('required_counts_zero', Object.values(counts).every(value => value === 0), JSON.stringify(counts)))
  results.push(check('git_still_gated', /git\.enabled': true/.test(policy) && /showCommitInput': false/.test(policy) && /command: '-git.commit'/.test(policy), 'W4 SCM unchanged'))

  if (previousProjects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
  else process.env.FOUNDRY_PROJECTS_ROOT = previousProjects
  if (previousStateDir === undefined) delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  else process.env.FOUNDRY_WORKBENCH_STATE_DIR = previousStateDir
  try { rmSync(path.dirname(fixture), { recursive: true, force: true }) } catch { /* tmp */ }

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W5_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W5_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW5Validation }
