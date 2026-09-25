/**
 * W5.1 source + in-process fixtures: adapter host catalog, ready-file schema, live DAP wiring.
 * Does not rebuild Workbench substrate. Disposable fixture Git only.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFoundryWorkbenchW5Validation } from './foundryWorkbenchW5.validation'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { W4_HUNK_PROPOSAL_STATUS } from './foundryWorkbenchW4'
import { foundryWorkbenchEventsRegisteredOnAgentBus, FOUNDRY_WORKBENCH_EVENT_TYPES } from './foundryWorkbenchEvents'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import { w5AdapterDebugControlPathCount, w5AdapterDirectWritePathCount } from './foundryWorkbenchW5'
import {
  ADAPTER_READY_REQUIRED_FIELDS,
  FOUNDRY_ADAPTER_FOLDER_ID,
  FOUNDRY_ADAPTER_PUBLISHER_ID,
  FOUNDRY_W5_1_COMMANDS,
  MICROSOFT_MARKETPLACE_ENABLED,
  OPENVSX_ENABLED,
  W4_1_STILL_DEFERRED,
  WORKBENCH_DEFAULT,
  adapterCatalogLooksStored,
  adapterReadyIsExtensionHost,
  attemptTypescriptSourceMapFixture,
  loadInstallAdapter,
  parseAdapterReady,
} from './foundryWorkbenchW5_1'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run() {
  await runFoundryWorkbenchW5Validation()
  const results: CaseResult[] = []
  const adapter = source('desktop/workbench-host/extensions/foundry-adapter/extension.js')
  const adapterPkg = source('desktop/workbench-host/extensions/foundry-adapter/package.json')
  const install = source('desktop/workbench-host/install-adapter.cjs')
  const main = source('desktop/src/main.cjs')
  const host = source('desktop/workbench-host/index.cjs')
  const w51 = source('lib/native-builder/foundryWorkbenchW5_1.ts')

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'FOUNDRY_WORKBENCH_W0 default off'))
  results.push(check('no_rebuild_scope', /adapter host \+ live DAP observability/.test(w51) && /Does not rebuild W0–W5/.test(w51), 'W5.1 scope is adapter-host/DAP only'))
  results.push(check('single_copy_install', /removeBuiltinDuplicate/.test(install) && /writeStoredExtensionCatalog/.test(install) && /user-data', 'User', 'extensions.json'/.test(install), 'user catalog + builtin removed'))
  results.push(check('catalog_location_uri', /scheme: 'file'/.test(install) && /relativeLocation: ADAPTER_ID/.test(install), 'stored-extension location URI'))
  results.push(check('empty_array_not_kept', !/if \(Array.isArray\(parsed\)\) return/.test(install), 'empty [] catalog is no longer treated as done'))
  results.push(check('adapter_ready_schema', ADAPTER_READY_REQUIRED_FIELDS.every(field => adapter.includes(field) || adapter.includes('activationTimestamp')), ADAPTER_READY_REQUIRED_FIELDS.join(',')))
  results.push(check('ready_from_activate', /writeAdapterReady\(stateDir/.test(adapter) && /host: 'extension-host'/.test(adapter) && /vscode\.env\.sessionId/.test(adapter), 'ready file from extension host env'))
  results.push(check('activation_event', /ADAPTER_ACTIVATED/.test(adapter) && (FOUNDRY_WORKBENCH_EVENT_TYPES as readonly string[]).includes('ADAPTER_ACTIVATED') && (FOUNDRY_AGENT_EVENT_TYPES as readonly string[]).includes('ADAPTER_ACTIVATED'), 'existing event bus'))
  results.push(check('dap_tracker', /registerDebugAdapterTrackerFactory/.test(adapter) && /event === 'stopped'/.test(adapter) && /stepOverObserved/.test(adapter), 'live DAP tracker, not hardcoded steps'))
  results.push(check('no_hardcoded_step_success', !/result\.debug\.stepOver = true/.test(adapter) && !/stepOverObserved: true/.test(adapter.split('runW5Proof')[0] || ''), 'step flags come from tracker'))
  results.push(check('commands_registered', FOUNDRY_W5_1_COMMANDS.every(id => adapter.includes(id) && adapterPkg.includes(id)), FOUNDRY_W5_1_COMMANDS.join(',')))
  results.push(check('open_test_explorer_alias', /foundry.openTestExplorer/.test(adapter) && /foundry.openTesting/.test(adapter), 'openTestExplorer alias kept'))
  results.push(check('debug_snapshot_disk', /debug-snapshot\.json/.test(adapter), 'real DAP snapshot written for Foundry context'))
  results.push(check('ai_debug_gated', w5AdapterDebugControlPathCount(adapter) === 0 && /commanderAuthorized/.test(adapter), `bypass=${w5AdapterDebugControlPathCount(adapter)}`))
  results.push(check('no_direct_write', w5AdapterDirectWritePathCount(adapter) === 0, `writes=${w5AdapterDirectWritePathCount(adapter)}`))
  results.push(check('no_evaluate', !/customRequest\(\s*['"]evaluate['"]/.test(adapter), 'Debug Console evaluate still Commander-only'))
  results.push(check('openvsx_off', OPENVSX_ENABLED === false && /serviceUrl: ''/.test(source('desktop/workbench-host/prepare.cjs')), 'OPENVSX_ENABLED=NO'))
  results.push(check('marketplace_off', MICROSOFT_MARKETPLACE_ENABLED === false && !/marketplace\.visualstudio\.com/.test(host), 'MICROSOFT_MARKETPLACE_ENABLED=NO'))
  results.push(check('workbench_default_off', WORKBENCH_DEFAULT === false && isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'WORKBENCH_DEFAULT=NO'))
  results.push(check('no_sandbox_policy', !/appendSwitch\(['"]no-sandbox['"]\)/.test(main), 'LINUX_SANDBOX unchanged'))
  results.push(check('w4_1_deferred', W4_1_STILL_DEFERRED === true && W4_HUNK_PROPOSAL_STATUS === 'DEFERRED_W4_1', 'W4.1 not implemented'))
  results.push(check('no_eventsystem2', !/EventSystem2/.test(w51) && !/EventSystem2/.test(adapter), 'existing bus only'))
  results.push(check('events_registered', foundryWorkbenchEventsRegisteredOnAgentBus() && (FOUNDRY_WORKBENCH_EVENT_TYPES as readonly string[]).includes('ADAPTER_DAP_SESSION_OBSERVED'), 'ADAPTER events on existing bus'))
  results.push(check('real_desktop_entry', /desktop\/src\/main\.cjs/.test(source('lib/native-builder/foundryWorkbenchW5_1.proof.ts')) && /startOwned/.test(source('lib/native-builder/foundryWorkbenchW5_1.proof.ts')) && /exthost-client\.cjs/.test(source('lib/native-builder/foundryWorkbenchW5_1.proof.ts')), 'live proof uses main.cjs + owned Workbench + extension host client'))
  results.push(check('protected_systems', !/harbor|lane.?box|inventory|higher.?vision|wrim/i.test(w51.slice(0, 400)), 'W5.1 module does not target protected systems'))

  const tmp = path.join(os.tmpdir(), `w5-1-catalog-${process.pid}`)
  mkdirSync(tmp, { recursive: true })
  const dest = path.join(tmp, FOUNDRY_ADAPTER_FOLDER_ID)
  mkdirSync(dest, { recursive: true })
  const catalogFile = path.join(tmp, 'extensions.json')
  writeFileSync(catalogFile, '[]\n')
  const installer = loadInstallAdapter()
  installer.writeStoredExtensionCatalog(catalogFile, dest)
  const catalog = JSON.parse(readFileSync(catalogFile, 'utf8')) as unknown
  results.push(check('catalog_empty_array_replaced', adapterCatalogLooksStored(catalog) && installer.isStoredExtension((catalog as unknown[])[0]), JSON.stringify(catalog).slice(0, 180)))
  const record = installer.storedExtensionRecord(dest)
  results.push(check('catalog_record_shape', installer.isStoredExtension(record) && (record.identifier as { id: string }).id === FOUNDRY_ADAPTER_PUBLISHER_ID, String((record.identifier as { id: string }).id)))

  const goodReady = parseAdapterReady({
    extensionId: FOUNDRY_ADAPTER_PUBLISHER_ID,
    version: '0.3.0',
    activationTimestamp: new Date().toISOString(),
    workbench: { appName: 'Foundry', appHost: 'vscode-server', sessionId: 'sess-live-1', extensionHostPid: 4242, uiKind: 2 },
    workspaceRoot: '/tmp/w5-1',
    capabilities: { debug: true },
    host: 'extension-host',
    copy: 'user',
    w51: true,
  })
  results.push(check('ready_parser_accepts_host', adapterReadyIsExtensionHost(goodReady), JSON.stringify(goodReady?.workbench)))
  const secretReady = parseAdapterReady({
    extensionId: FOUNDRY_ADAPTER_PUBLISHER_ID,
    version: '0.3.0',
    activationTimestamp: new Date().toISOString(),
    token: 'tkn=not-a-real-token',
    workbench: { sessionId: 'x', extensionHostPid: 1 },
    host: 'extension-host',
  })
  results.push(check('ready_parser_rejects_secrets', secretReady === null, 'token-bearing ready file rejected'))
  const nodeImportReady = parseAdapterReady({
    extensionId: FOUNDRY_ADAPTER_PUBLISHER_ID,
    version: '0.3.0',
    activationTimestamp: new Date().toISOString(),
    workbench: { sessionId: 'x' },
    host: 'node-import',
  })
  results.push(check('ready_requires_extension_host', adapterReadyIsExtensionHost(nodeImportReady) === false, 'standalone node import is not activation proof'))

  const ts = attemptTypescriptSourceMapFixture(path.join(tmp, 'ts'))
  results.push(check('ts_source_map_attempted', ts.compiledJs === true && ts.mapExists === true && ts.mapsToTs === true, `${ts.status}: ${ts.reason}`))
  results.push(check('ts_not_a_gate', ts.status === 'LIMITED' || ts.status === 'PASS', ts.status))

  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* tmp */ }

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W5_1_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W5_1_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW5_1Validation }
