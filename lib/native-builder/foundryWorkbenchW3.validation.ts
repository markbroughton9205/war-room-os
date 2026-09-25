/**
 * W3 source + in-process fixtures: Commander terminal, live diagnostics, no AI free shell.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFoundryWorkbenchW2Validation } from './foundryWorkbenchW2.validation'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { acceptW2Proposal, foundryW2AdapterDirectWritePathCount, rejectW2Proposal, runFoundryW2Command } from './foundryWorkbenchW2'
import {
  adapterInjectionPathCount,
  envelopeForBrokenTs,
  ensureFoundryWorkbenchW3Fixture,
  projectInstructionExcerpt,
  redactTerminalAttach,
} from './foundryWorkbenchW3'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run() {
  await runFoundryWorkbenchW2Validation()
  const results: CaseResult[] = []
  const adapter = source('desktop/workbench-host/extensions/foundry-adapter/extension.js')
  const policy = source('desktop/workbench-host/policy.cjs')
  const shell = source('components/war-room/foundry/FoundryShell.tsx')

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'default off'))
  results.push(check('commander_terminal_enabled', /hideOnStartup': 'never'/.test(policy) && /terminal\.integrated\.cwd': '\$\{workspaceFolder\}'/.test(policy), 'native terminal cwd workspace'))
  results.push(check('git_still_gated', /git\.enabled': true/.test(policy) && /showCommitInput': false/.test(policy) && /command: '-git.push'/.test(policy), 'W4 Git UI on; mutation still Foundry-gated'))
  results.push(check('fallback_terminal_kept', /FoundryTerminal/.test(shell) && /foundry-terminal-fallback/.test(shell), 'shim kept'))
  results.push(check('adapter_no_ai_write', foundryW2AdapterDirectWritePathCount() === 0, 'DIAGNOSTIC_FIX_DIRECT_WRITE_COUNT=0'))
  results.push(check('adapter_ai_sendText_gated', adapterInjectionPathCount(adapter) === 0 && /commanderAuthorized/.test(adapter), 'AI injection 0; Commander proof gated'))
  results.push(check('ts_validate_on', /typescript.validate.enable': true/.test(policy), 'TS language service'))
  results.push(check('openvsx_off', /serviceUrl: ''/.test(source('desktop/workbench-host/prepare.cjs')), 'OpenVSX off'))
  results.push(check('no_sandbox', !/appendSwitch\(['"]no-sandbox['"]\)/.test(source('desktop/src/main.cjs')), 'sandbox policy unchanged'))

  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const previousStateDir = process.env.FOUNDRY_WORKBENCH_STATE_DIR
  process.env.FOUNDRY_WORKBENCH_STATE_DIR = path.join(os.tmpdir(), `w3-state-${process.pid}`)
  mkdirSync(process.env.FOUNDRY_WORKBENCH_STATE_DIR, { recursive: true })
  const fixture = path.join(os.tmpdir(), `w3-fixture-${process.pid}`)
  rmSync(fixture, { recursive: true, force: true })
  mkdirSync(fixture, { recursive: true })
  ensureFoundryWorkbenchW3Fixture(fixture)
  const broken = path.join(fixture, 'broken.ts')
  const before = readFileSync(broken, 'utf8')
  const envelope = envelopeForBrokenTs(fixture)

  results.push(check('fixture_A_terminal_policy', /createTerminal/.test(adapter) && /workspaceFolder/.test(policy), 'native createTerminal + cwd'))

  const inject = await runFoundryW2Command({ kind: 'terminalInject', envelope, instruction: 'rm -rf /' })
  results.push(check('fixture_B_agent_free_shell', inject.ok === false && inject.code === 'AGENT_FREE_SHELL_VIA_WORKBENCH', String(inject.code)))

  const attached = await runFoundryW2Command({
    kind: 'attachTerminal',
    envelope,
    instruction: 'foundry-w3-terminal\nline two',
    providerClass: 'local',
  })
  results.push(check('fixture_C_terminal_context', attached.ok === true && Boolean(attached.chips?.terminal) && attached.readOnly === true, String(attached.chips?.terminal)))

  const secret = await runFoundryW2Command({
    kind: 'attachTerminal',
    envelope,
    instruction: 'token=ghp_FAKESECRETVALUE1234567890abcd',
    providerClass: 'remote',
  })
  const redacted = redactTerminalAttach('token=ghp_FAKESECRETVALUE1234567890abcd', 'remote')
  results.push(check('fixture_D_terminal_secret', redacted.redactionOccurred === true && !String(secret.envelope?.terminalTail || '').includes('ghp_FAKESECRETVALUE1234567890abcd'), `redacted=${redacted.redactionOccurred}`))

  results.push(check('fixture_E_live_diagnostic_shape', envelope.visibleDiagnostics.some(item => item.code === '2322' && /number/.test(item.message)), envelope.visibleDiagnostics[0]?.message || 'none'))

  const explain = await runFoundryW2Command({ kind: 'explainDiagnostic', envelope, providerClass: 'local' })
  results.push(check('fixture_F_explain_diagnostic', explain.ok === true && explain.readOnly === true && readFileSync(broken, 'utf8') === before, String(explain.ok)))
  results.push(check('project_instructions', projectInstructionExcerpt(fixture).includes('typed numeric'), 'existing instruction loader'))

  const fix = await runFoundryW2Command({ kind: 'fix', envelope: envelopeForBrokenTs(fixture), instruction: 'Fix the type error', providerClass: 'local' })
  const applied = fix.proposal ? await acceptW2Proposal(fix.proposal.proposalId) : { ok: false, error: 'no proposal' }
  const after = readFileSync(broken, 'utf8')
  results.push(check('fixture_G_fix_diagnostic', applied.ok === true && after.includes('= 0') && !after.includes('"wrong"'), applied.error || 'applied'))

  writeFileSync(broken, before)
  const staleEnv = envelopeForBrokenTs(fixture)
  const staleProp = await runFoundryW2Command({ kind: 'fix', envelope: staleEnv, instruction: 'Fix the type error', providerClass: 'local' })
  writeFileSync(broken, before.replace('"wrong"', '1'))
  const staleApply = staleProp.proposal ? await acceptW2Proposal(staleProp.proposal.proposalId) : { ok: true }
  results.push(check('fixture_H_stale_diagnostic', staleApply.ok === false && staleApply.code === 'EDIT_PROPOSAL_STALE', String(staleApply.code)))

  results.push(check('language_providers_wired', /executeDefinitionProvider/.test(adapter) && /executeReferenceProvider/.test(adapter) && /executeCompletionItemProvider/.test(adapter) && /prepareRename/.test(adapter), 'native providers'))
  results.push(check('openvsx_no_install', !/open-vsx\.org/.test(adapter) && !/marketplace\.visualstudio\.com/.test(adapter), 'no marketplace install'))

  if (previousStateDir === undefined) delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  else process.env.FOUNDRY_WORKBENCH_STATE_DIR = previousStateDir

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W3_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W3_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW3Validation }
