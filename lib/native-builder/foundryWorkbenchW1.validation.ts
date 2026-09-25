/**
 * W1 source gates: real desktop ownership, branding, allowlist, Git/terminal, no --no-sandbox policy.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { runFoundryWorkbenchW0Validation } from './foundryWorkbenchW0.validation'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run() {
  await runFoundryWorkbenchW0Validation()
  const root = resolveRepoRoot()
  const main = source('desktop/src/main.cjs')
  const host = source('desktop/workbench-host/index.cjs')
  const prepare = source('desktop/workbench-host/prepare.cjs')
  const policy = source('desktop/workbench-host/policy.cjs')
  const allow = source('desktop/workbench-host/allowlist.cjs')
  const view = source('desktop/src/foundryWorkbench.cjs')
  const pane = source('components/war-room/foundry/FoundryWorkbenchPane.tsx')
  const tools = source('lib/native-builder/engineerTools.ts')
  const results: CaseResult[] = []

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'default off'))
  results.push(check('real_desktop_main', /foundry\.workbench\.ensure/.test(main) && /foundryWorkbenchHost/.test(main) && /startOwned/.test(view) && source('desktop/package.json').includes('"main": "src/main.cjs"'), 'main.cjs owns start (lazy via ensure)'))
  results.push(check('no_sandbox_production_policy', !/appendSwitch\(['"]no-sandbox['"]\)/.test(main) && !/appendSwitch\(['"]disable-setuid-sandbox['"]\)/.test(main), 'NO_SANDBOX_PRODUCTION_POLICY=REFUSED'))
  results.push(check('applicationName_foundry', /applicationName = 'foundry'/.test(prepare) && /urlProtocol = 'foundry'/.test(prepare) && /win32DirName = 'Foundry Workbench'/.test(prepare), 'Foundry product overlay'))
  results.push(check('branding_rewrite', /OpenVSCode Server/.test(view) && /foundryTitle/.test(view) && /Foundry Workbench/.test(pane), 'title rewrite + chrome label'))
  results.push(check('allowlist_home', /HOME_OR_ROOT_REFUSED/.test(allow) && /SYMLINK_ESCAPE/.test(allow) && /UNAUTHORIZED_WORKSPACE/.test(allow), 'allowlist codes'))
  results.push(check('git_gated', /git\.enabled': true/.test(policy) && /showCommitInput': false/.test(policy) && /foundry\.governedCommit/.test(policy) && /command: '-git.commit'/.test(policy) && /disableExtensionArgs/.test(host), 'Git UI on; commit/push Foundry-gated'))
  results.push(check('terminal_gated', /terminal\.integrated\.cwd': '\$\{workspaceFolder\}'/.test(policy) && /hideOnStartup': 'never'/.test(policy), 'W3 Commander terminal; W4 Git UI Foundry-gated'))
  results.push(check('dirty_guard', /refuseIfDirtyCommanderBuffer/.test(tools) && existsSync(path.join(root, 'lib/native-builder/foundryWorkbenchDirtyGuard.ts')), 'Tool Broker dirty hold'))
  results.push(check('crash_recovery', /crashRestarts/.test(host) && /foundry.workbench.recover/.test(main), 'owned restart path'))
  results.push(check('foreign_port_fail_closed', /FOREIGN_PORT_OWNER/.test(host), 'no hijack'))
  results.push(check('focus_return', /foundry.workbench.returnFocus/.test(main) && /foundry-workbench-chrome/.test(pane), 'chrome focus'))
  results.push(check('token_persist', /persist-across-desktop-sessions/.test(host), 'token lifecycle documented'))
  results.push(check('no_cursor', !/cursor-agent|@cursor\/sdk/.test(host) && !/cursor-agent/.test(view), 'cursor absent'))

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W1_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W1_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW1Validation }
