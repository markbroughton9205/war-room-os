/**
 * W0 source gates for Hybrid B Code-OSS REH-web. Gallery remains off. No Microsoft Marketplace.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_WORKBENCH_HOST, FOUNDRY_WORKBENCH_PORT, FOUNDRY_WORKBENCH_PARTITION, isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run() {
  const root = resolveRepoRoot()
  const host = source('desktop/workbench-host/index.cjs')
  const view = source('desktop/src/foundryWorkbench.cjs')
  const main = source('desktop/src/main.cjs')
  const preload = source('desktop/src/preload.cjs')
  const trust = source('desktop/src/desktopTrust.cjs')
  const pane = source('components/war-room/foundry/FoundryWorkbenchPane.tsx')
  const api = source('app/api/foundry/workbench/route.ts')
  const provenance = JSON.parse(source('desktop/workbench-host/provenance.json')) as Record<string, unknown>
  const results: CaseResult[] = []

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false && isFoundryWorkbenchW0Enabled({ FOUNDRY_WORKBENCH_W0: '0' } as NodeJS.ProcessEnv) === false, 'default off'))
  const constants = source('desktop/workbench-host/constants.cjs')
  results.push(check('loopback_port', FOUNDRY_WORKBENCH_HOST === '127.0.0.1' && FOUNDRY_WORKBENCH_PORT === 3849 && constants.includes("'127.0.0.1'") && constants.includes('3849'), `${FOUNDRY_WORKBENCH_HOST}:${FOUNDRY_WORKBENCH_PORT}`))
  results.push(check('no_lan_bind', !/0\.0\.0\.0/.test(host) && !/0\.0\.0\.0/.test(view), 'no 0.0.0.0'))
  results.push(check('auth_required', /connection-token-file/.test(host) && !/--without-connection-token/.test(host), 'token file'))
  results.push(check('token_not_public', !/NEXT_PUBLIC/.test(api) && /stripSecrets/.test(api) && /Token never enters this renderer/.test(pane), 'no token in renderer'))
  results.push(check('partition', view.includes(FOUNDRY_WORKBENCH_PARTITION) && /nodeIntegration: false/.test(view) && /sandbox: true/.test(view), FOUNDRY_WORKBENCH_PARTITION))
  results.push(check('ipc_allowlist', preload.includes('foundry.workbench.ensure') && /shell\.exec/.test(main) && /DENIED/.test(main), 'allowlist + denied privileged ipc'))
  results.push(check('no_marketplace', !/marketplace\.visualstudio\.com/.test(host) && !/marketplace\.visualstudio\.com/.test(view) && provenance.microsoftMarketplace === false, 'marketplace off'))
  results.push(check('openvsx_disabled_w0', /serviceUrl: ''/.test(source('desktop/workbench-host/prepare.cjs')), 'gallery overlay empty'))
  results.push(check('no_cursor_in_host', !/cursor-agent|@cursor\/sdk|cursorElectron/.test(host) && !/cursor-agent/.test(view), 'cursor absent'))
  results.push(check('no_nested_electron', /nestedElectron: false/.test(view) && !/VSCodium|code\.exe/.test(host), 'node server'))
  results.push(check('trust_secret_not_on_3849', /LOOPBACK_PORTS = new Set\(\['3848', '3847', '3000', '3001'\]\)/.test(trust), '3849 not a desktop-trust origin'))
  results.push(check('main_allows_3849', /ALLOWED_PORTS = new Set\(\[3847, 3848, 3849, 3000, 3001\]\)/.test(main), '3849 destination allowed'))
  results.push(check('upstream_mit', provenance.upstreamLicense === 'MIT' && /gitpod-io\/openvscode-server/.test(String(provenance.upstreamOfficialRepo)), String(provenance.tag)))
  results.push(check('runtime_not_vendored_source', existsSync(path.join(root, 'desktop/workbench-host/prepare.cjs')) && !existsSync(path.join(root, 'vendor/code-oss')), 'no vendor/code-oss'))
  results.push(check('shell_gated', /workbenchW0 \? <FoundryWorkbenchPane/.test(source('components/war-room/foundry/FoundryShell.tsx')), 'pane gated'))
  results.push(check('no_second_tool_broker', !/file\.write|workspace\.fs/.test(host), 'host has no fs mutation tools'))

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W0_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W0_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW0Validation }
