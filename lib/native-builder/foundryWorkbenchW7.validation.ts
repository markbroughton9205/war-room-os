/**
 * W7 source gates: Linux sandbox, default-ready vs enabled, no production activation.
 * Chains W6 (which chains W5.1→W0). Does not package/install/activate.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFoundryWorkbenchW6Validation } from './foundryWorkbenchW6.validation'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { W4_HUNK_PROPOSAL_STATUS } from './foundryWorkbenchW4'
import {
  MICROSOFT_MARKETPLACE_ENABLED,
  OPENVSX_DEFAULT_ON,
  W4_1_STILL_DEFERRED,
  W7_CARRY_TYPESCRIPT_SOURCE_MAP,
  W7_MODE_SEPARATION,
  W7_PRODUCTIONIZATION_EXECUTED,
  W7_SOURCE_SCOPE,
  WORKBENCH_DEFAULT_ENABLED,
  futureProductionizationPlan,
  inspectLinuxChromeSandbox,
  marketplaceStillOff,
  openVsxStillDefaultOff,
  productionDisableSandboxEnvCount,
  productionNoSandboxFlagCount,
  sourceScopeExists,
  workbenchDefaultEnabled,
  workbenchDefaultStillDisabled,
} from './foundryWorkbenchW7'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run() {
  await runFoundryWorkbenchW6Validation()
  const results: CaseResult[] = []
  const main = source('desktop/src/main.cjs')
  const installer = source('lib/native-builder/installerTool.ts')
  const runtime = source('lib/native-builder/runtimeControl.ts')
  const w7 = source('lib/native-builder/foundryWorkbenchW7.ts')
  const prepare = source('desktop/workbench-host/prepare-linux-chrome-sandbox.cjs')
  const afterPack = source('desktop/scripts/after-pack-linux-sandbox.cjs')
  const desktopPkg = source('desktop/package.json')
  const client = source('desktop/workbench-host/exthost-client.cjs')
  const shell = source('components/war-room/foundry/FoundryShell.tsx')
  const pane = source('components/war-room/foundry/FoundryWorkbenchPane.tsx')

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'FOUNDRY_WORKBENCH_W0 default off'))
  results.push(check('WORKBENCH_DEFAULT_ENABLED', WORKBENCH_DEFAULT_ENABLED === false && workbenchDefaultEnabled() === false && workbenchDefaultStillDisabled(), 'NO'))
  results.push(check('MICROSOFT_MARKETPLACE_ENABLED', MICROSOFT_MARKETPLACE_ENABLED === false && marketplaceStillOff(), 'NO'))
  results.push(check('OPENVSX_DEFAULT_ON', OPENVSX_DEFAULT_ON === false && openVsxStillDefaultOff(), 'NO'))
  results.push(check('w4_1_deferred', W4_1_STILL_DEFERRED === true && W4_HUNK_PROPOSAL_STATUS === 'DEFERRED_W4_1', 'W4.1 deferred'))
  results.push(check('lazy_start', /workbench owned child deferred until foundry.workbench.ensure/.test(main) && !/await foundryWorkbenchHost.startOwned\(\)/.test(main), 'desktop does not eager-start Workbench'))
  results.push(check('ensure_starts_owned', /host.startOwned/.test(source('desktop/src/foundryWorkbench.cjs')), 'ensure() starts owned child'))
  results.push(check('prepare_script', /chmod 4755/.test(prepare) && /chown root:root/.test(prepare) && /SANDBOX_NATIVE_PASS/.test(prepare), 'chrome-sandbox prepare'))
  results.push(check('after_pack', /after-pack-linux-sandbox/.test(desktopPkg) && /applyHelper/.test(afterPack), 'packaging sandbox step'))
  results.push(check('install_prepare', /LINUX_CHROME_SANDBOX\.json/.test(installer) && /applyHelper/.test(installer), 'install sandbox step'))
  results.push(check('PRODUCTION_NO_SANDBOX_FLAG_COUNT', productionNoSandboxFlagCount() === 0, String(productionNoSandboxFlagCount())))
  results.push(check('PRODUCTION_DISABLE_SANDBOX_ENV_COUNT', productionDisableSandboxEnvCount() === 0, String(productionDisableSandboxEnvCount())))
  results.push(check('shim_no_bypass', !/exec "\$\{executablePath\}".*no-sandbox/.test(installer), 'activate shim has no sandbox bypass'))
  results.push(check('runtime_no_bypass', !/\['--no-sandbox'/.test(runtime), 'runtime.launch_installed has no sandbox bypass'))
  results.push(check('exthost_gated', /FOUNDRY_WORKBENCH_ALLOW_SANDBOX_BYPASS/.test(client), 'exthost-client bypass is explicit harness-only'))
  results.push(check('mode_separation', W7_MODE_SEPARATION.WORKBENCH.includes('manual') && W7_MODE_SEPARATION.AGENT.includes('available'), 'WORKBENCH/AGENT/STANDALONE ENGINEER'))
  results.push(check('default_experience', /primary manual engineering surface/.test(pane) && /Agent and Standalone Engineer remain available/.test(shell), 'Foundry → project → Workbench'))
  results.push(check('source_scope', sourceScopeExists().every(item => item.exists) && W7_SOURCE_SCOPE.length >= 20, sourceScopeExists().filter(item => !item.exists).map(item => item.rel).join(',') || 'all present'))
  results.push(check('productionization_not_executed', W7_PRODUCTIONIZATION_EXECUTED === false && futureProductionizationPlan().executed === false, 'plan only'))
  results.push(check('typescript_source_map', W7_CARRY_TYPESCRIPT_SOURCE_MAP === 'LIMITED', W7_CARRY_TYPESCRIPT_SOURCE_MAP))
  results.push(check('single_instance', /requestSingleInstanceLock/.test(main), 'second-instance lock'))
  results.push(check('ready_vs_enabled', /WORKBENCH_DEFAULT_READY/.test(w7) && /WORKBENCH_DEFAULT_ENABLED/.test(w7) && WORKBENCH_DEFAULT_ENABLED === false, 'DEFAULT-READY != PRODUCTION-ACTIVATED'))

  const sandbox = inspectLinuxChromeSandbox()
  results.push(check('sandbox_inspect', Boolean(sandbox.helper) && Boolean(sandbox.rootCause), sandbox.rootCause))
  results.push(check('W0_REGRESSION', true, 'chained via W6'))
  results.push(check('W1_REGRESSION', true, 'chained via W6'))
  results.push(check('W2_REGRESSION', true, 'chained via W6'))
  results.push(check('W3_REGRESSION', true, 'chained via W6'))
  results.push(check('W4_REGRESSION', true, 'chained via W6'))
  results.push(check('W5_REGRESSION', true, 'chained via W6'))
  results.push(check('W5_1_REGRESSION', true, 'chained via W6'))
  results.push(check('W6_REGRESSION', true, 'runFoundryWorkbenchW6Validation'))

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W7_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W7_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW7Validation }
