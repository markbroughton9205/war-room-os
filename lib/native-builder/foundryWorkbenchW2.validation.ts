/**
 * W2 source + in-process fixture gates. Workbench stays default off.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFoundryWorkbenchW1Validation } from './foundryWorkbenchW1.validation'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import {
  acceptW2Proposal,
  ensureFoundryWorkbenchW2Fixture,
  envelopeFromDiskFile,
  foundryW2AdapterDirectWritePathCount,
  rejectW2Proposal,
  runFoundryW2Command,
} from './foundryWorkbenchW2'
import { buildFoundryEditorContextEnvelope } from './foundryEditorContext'
import { FOUNDRY_WORKBENCH_EVENT_TYPES, foundryWorkbenchEventsRegisteredOnAgentBus } from './foundryWorkbenchEvents'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run() {
  await runFoundryWorkbenchW1Validation()
  const root = resolveRepoRoot()
  const results: CaseResult[] = []
  const adapter = source('desktop/workbench-host/extensions/foundry-adapter/extension.js')
  const w2 = source('lib/native-builder/foundryWorkbenchW2.ts')
  const api = source('app/api/foundry/workbench/editor/route.ts')
  const host = source('desktop/workbench-host/index.cjs')
  const policy = source('desktop/workbench-host/policy.cjs')
  const pane = source('components/war-room/foundry/FoundryWorkbenchAiPanel.tsx')

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'W2 gated by W0 default off'))
  results.push(check('adapter_no_workspace_fs_write', foundryW2AdapterDirectWritePathCount() === 0 && !/workspace\.fs\.writeFile/.test(adapter), 'ADAPTER_DIRECT_AI_WRITE_PATH=0'))
  results.push(check('adapter_no_provider_keys', !/OPENAI|ANTHROPIC|XAI_API|GEMINI|cursor-agent/.test(adapter), 'no provider keys in adapter'))
  results.push(check('commands_registered', /Foundry: Ask/.test(source('desktop/workbench-host/extensions/foundry-adapter/package.json')) && /foundry.editSelection/.test(adapter), 'Foundry commands'))
  results.push(check('context_menu', /editor\/context/.test(source('desktop/workbench-host/extensions/foundry-adapter/package.json')), 'context menu'))
  results.push(check('tool_broker_only', /acceptFoundryEditProposal/.test(w2) && /executeEngineerTool/.test(source('lib/native-builder/foundryEditProposal.ts')), 'accept → Tool Broker'))
  results.push(check('server_accept_authority', /RENDERER_CONTENT_UNTRUSTED/.test(api), 'renderer replacement untrusted'))
  results.push(check('composer_chips', /foundry-w2-context-chips/.test(pane) && /FoundryWorkbenchAiPanel/.test(source('components/war-room/foundry/FoundryShell.tsx')), 'Composer chips'))
  results.push(check('events_registered', foundryWorkbenchEventsRegisteredOnAgentBus() && FOUNDRY_WORKBENCH_EVENT_TYPES.every(type => (FOUNDRY_AGENT_EVENT_TYPES as readonly string[]).includes(type)), 'event bus names'))
  results.push(check('no_cursor_required', !/cursorAgentProvider|@cursor\/sdk/.test(w2) && !/cursor-agent/.test(adapter), 'W2_CURSOR_REQUIRED=NO'))
  results.push(check('openvsx_still_off', /serviceUrl: ''/.test(source('desktop/workbench-host/prepare.cjs')), 'OpenVSX off'))
  results.push(check('marketplace_still_off', !/marketplace\.visualstudio\.com/.test(host), 'Marketplace off'))
  results.push(check('builtin_ai_disabled', /chat\.enabled': false/.test(policy) && /github\.copilot\.enable/.test(policy), 'Copilot/chat off'))
  results.push(check('git_still_gated', /git\.enabled': true/.test(policy) && /showCommitInput': false/.test(policy) && /command: '-git.commit'/.test(policy) && /foundry\.governedCommit/.test(policy), 'Git UI on; mutation still Foundry-gated'))
  results.push(check('terminal_still_gated', /hideOnStartup': 'never'/.test(policy) && /foundry\.governedCommit/.test(policy), 'W3 Commander terminal; W4 Git mutation still Foundry-gated'))
  results.push(check('adapter_installed_on_start', /installFoundryAdapter/.test(host), 'owned adapter copy'))
  results.push(check('no_sandbox_unchanged', !/appendSwitch\(['"]no-sandbox['"]\)/.test(source('desktop/src/main.cjs')), 'NO_SANDBOX_PRODUCTION_POLICY=REFUSED'))

  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const previousStateDir = process.env.FOUNDRY_WORKBENCH_STATE_DIR
  process.env.FOUNDRY_WORKBENCH_STATE_DIR = path.join(os.tmpdir(), `w2-state-${process.pid}`)
  mkdirSync(process.env.FOUNDRY_WORKBENCH_STATE_DIR, { recursive: true })
  const fixture = path.join(os.tmpdir(), `w2-fixture-${process.pid}`)
  rmSync(fixture, { recursive: true, force: true })
  mkdirSync(fixture, { recursive: true })
  ensureFoundryWorkbenchW2Fixture(fixture)
  const hello = path.join(fixture, 'hello.ts')
  const before = readFileSync(hello, 'utf8')
  const envelope = envelopeFromDiskFile(fixture, 'hello.ts')

  const ask = await runFoundryW2Command({ kind: 'ask', envelope, instruction: 'What does greet do?', providerClass: 'local' })
  results.push(check('fixture_A_ask_read_only', ask.ok === true && ask.readOnly === true && readFileSync(hello, 'utf8') === before, String(ask.ok)))

  const explain = await runFoundryW2Command({ kind: 'explain', envelope, providerClass: 'local' })
  results.push(check('fixture_B_explain', explain.ok === true && explain.readOnly === true && readFileSync(hello, 'utf8') === before, String(explain.ok)))

  const edit = await runFoundryW2Command({ kind: 'edit', envelope, instruction: 'Make this function return a typed result instead of throwing.', providerClass: 'local' })
  const rejected = edit.proposal ? await rejectW2Proposal(edit.proposal.proposalId) : { ok: false }
  results.push(check('fixture_C_reject', Boolean(edit.proposal) && rejected.ok === true && readFileSync(hello, 'utf8') === before, `status=${edit.proposal?.status}`))

  const edit2 = await runFoundryW2Command({ kind: 'edit', envelope: envelopeFromDiskFile(fixture, 'hello.ts'), instruction: 'Make this function return a typed result instead of throwing.', providerClass: 'local' })
  const accepted = edit2.proposal ? await acceptW2Proposal(edit2.proposal.proposalId) : { ok: false, error: 'no proposal' }
  const afterAccept = readFileSync(hello, 'utf8')
  results.push(check('fixture_D_accept', accepted.ok === true && afterAccept.includes('ok: true') && afterAccept.includes('value:'), accepted.error || 'applied'))

  writeFileSync(hello, before)
  const staleEnv = envelopeFromDiskFile(fixture, 'hello.ts')
  const staleProp = await runFoundryW2Command({ kind: 'edit', envelope: staleEnv, instruction: 'typed result', providerClass: 'local' })
  writeFileSync(hello, `${before}\nexport const TOUCHED = true\n`)
  const staleApply = staleProp.proposal ? await acceptW2Proposal(staleProp.proposal.proposalId) : { ok: true, code: 'missing' }
  results.push(check('fixture_E_stale', staleApply.ok === false && staleApply.code === 'EDIT_PROPOSAL_STALE' && readFileSync(hello, 'utf8').includes('TOUCHED') && !readFileSync(hello, 'utf8').includes('ok: true; value'), String(staleApply.code)))

  writeFileSync(hello, before)
  const dirtyEnv = envelopeFromDiskFile(fixture, 'hello.ts')
  const dirtyProp = await runFoundryW2Command({ kind: 'edit', envelope: dirtyEnv, instruction: 'typed result', providerClass: 'local' })
  writeFileSync(path.join(process.env.FOUNDRY_WORKBENCH_STATE_DIR, 'dirty-buffers.json'), JSON.stringify({ paths: [hello] }))
  const dirtyApply = dirtyProp.proposal ? await acceptW2Proposal(dirtyProp.proposal.proposalId) : { ok: true }
  results.push(check('fixture_F_dirty', dirtyApply.ok === false && /DIRTY_COMMANDER_BUFFER/.test(String(dirtyApply.code || dirtyApply.error)) && readFileSync(hello, 'utf8') === before, String(dirtyApply.code)))
  writeFileSync(path.join(process.env.FOUNDRY_WORKBENCH_STATE_DIR, 'dirty-buffers.json'), JSON.stringify({ paths: [] }))

  const tests = await runFoundryW2Command({ kind: 'tests', envelope: envelopeFromDiskFile(fixture, 'hello.ts'), providerClass: 'local' })
  const testApply = tests.proposal ? await acceptW2Proposal(tests.proposal.proposalId) : { ok: false }
  results.push(check('fixture_G_generate_tests', testApply.ok === true && existsSync(path.join(fixture, 'hello.test.ts')), String(testApply.ok)))

  results.push(check('fixture_H_direct_adapter_write', foundryW2AdapterDirectWritePathCount() === 0, String(foundryW2AdapterDirectWritePathCount())))

  const secretEnv = buildFoundryEditorContextEnvelope({
    workspaceRoot: fixture,
    activeFile: '.env',
    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 40, text: readFileSync(path.join(fixture, '.env'), 'utf8') },
    fileContent: readFileSync(path.join(fixture, '.env'), 'utf8'),
    providerClass: 'remote',
  })
  const secret = await runFoundryW2Command({ kind: 'ask', envelope: secretEnv, instruction: 'summarize', providerClass: 'remote' })
  results.push(check('fixture_I_sensitive', secret.ok === false && secret.code === 'SENSITIVE_PATH_BLOCKED' && !String(secret.text || '').includes('placeholder-not-a-live-credential'), String(secret.code)))

  results.push(check('fixture_J_cursor_absent', !/cursorAgentProvider/.test(w2), 'cursor not required'))

  if (previousStateDir === undefined) delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  else process.env.FOUNDRY_WORKBENCH_STATE_DIR = previousStateDir

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W2_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W2_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW2Validation }
