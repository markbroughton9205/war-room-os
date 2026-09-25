/**
 * W6 source + in-process fixtures: governed extension lifecycle.
 * Does not rebuild Workbench substrate. Disposable fixture VSIX only.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFoundryWorkbenchW5_1Validation } from './foundryWorkbenchW5_1.validation'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { W4_HUNK_PROPOSAL_STATUS } from './foundryWorkbenchW4'
import { foundryWorkbenchEventsRegisteredOnAgentBus, FOUNDRY_WORKBENCH_EVENT_TYPES } from './foundryWorkbenchEvents'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import {
  INITIAL_ALLOWLIST,
  MICROSOFT_MARKETPLACE_ENABLED,
  OPENVSX_DEFAULT_ON,
  W4_1_STILL_DEFERRED,
  W6_SCOPE,
  WORKBENCH_DEFAULT,
  adapterStillSingle,
  inspectExtensionPackage,
  marketplaceEndpointsPresent,
  mutateExtension,
  recommendExtension,
  recordFromInspect,
  unpackVsix,
} from './foundryWorkbenchW6'
import { packLanguageVsix, packLintVsix, packLintVsixV2, writeUnsafeFixture } from './foundryWorkbenchW6.fixtures'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run() {
  await runFoundryWorkbenchW5_1Validation()
  const results: CaseResult[] = []
  const w6 = source('lib/native-builder/foundryWorkbenchW6.ts')
  const host = source('desktop/workbench-host/governed-extensions.cjs')
  const adapter = source('desktop/workbench-host/extensions/foundry-adapter/extension.js')
  const adapterPkg = source('desktop/workbench-host/extensions/foundry-adapter/package.json')
  const policy = source('desktop/workbench-host/policy.cjs')
  const index = source('desktop/workbench-host/index.cjs')
  const ui = source('components/war-room/foundry/FoundryWorkbenchExtensionsPanel.tsx')
  const api = source('app/api/foundry/workbench/extensions/route.ts')

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'FOUNDRY_WORKBENCH_W0 default off'))
  results.push(check('no_rebuild_scope', /governed extension lifecycle only/.test(W6_SCOPE) && /Does not rebuild editor/.test(w6), 'W6 scope'))
  results.push(check('linux_first', /linuxFirst/.test(w6) && !/win32MutexName/.test(w6), 'LINUX_FIRST'))
  results.push(check('source_types', ['BUILTIN', 'LOCAL_VSIX', 'OPENVSX', 'OFFICIAL_RELEASE', 'MANUAL_PATH'].every(item => w6.includes(item)), 'source types'))
  results.push(check('states', ['DISCOVERED', 'REVIEW_PENDING', 'APPROVED', 'INSTALLED', 'ACTIVE', 'DISABLED', 'QUARANTINED', 'REMOVED', 'BLOCKED'].every(item => w6.includes(item)), 'states'))
  results.push(check('trust_not_from_install', /trusted: false/.test(w6), 'install is not trust'))
  results.push(check('commander_gate', /COMMANDER_APPROVAL_REQUIRED/.test(w6) && /AGENT_EXTENSION_INSTALL/.test(w6), 'Commander authority'))
  results.push(check('marketplace_off', MICROSOFT_MARKETPLACE_ENABLED === false && !marketplaceEndpointsPresent(index) && !marketplaceEndpointsPresent(host), 'MICROSOFT_MARKETPLACE_ENABLED=NO'))
  results.push(check('openvsx_optional', OPENVSX_DEFAULT_ON === false && /Extension Source: OpenVSX/.test(w6) && /Extension Source: OpenVSX/.test(ui), 'OpenVSX optional labeled'))
  results.push(check('auto_update_off', /extensions.autoUpdate': false/.test(policy) && /AUTO_UPDATE_REFUSED/.test(w6), 'no auto-update'))
  results.push(check('adapter_protected', /ADAPTER_PROTECTED/.test(w6) && /ADAPTER_PROTECTED/.test(host) && /foundry.openExtensions/.test(adapter) && /installExtensions: false/.test(adapter), 'adapter not an installer'))
  results.push(check('open_extensions_command', adapterPkg.includes('foundry.openExtensions') && adapter.includes('foundry.openExtensions'), 'foundry.openExtensions'))
  results.push(check('host_snapshot', /extensions-host-snapshot\.json/.test(adapter), 'activation snapshot from extension host'))
  results.push(check('disable_args', /governedDisableArgs/.test(index) && /disabled-extensions\.json/.test(host) && /setUserExtensionCatalogEnabled/.test(host) && /setUserExtensionCatalogEnabled/.test(w6), 'catalog disable persistence'))
  results.push(check('events_registered', foundryWorkbenchEventsRegisteredOnAgentBus() && (FOUNDRY_WORKBENCH_EVENT_TYPES as readonly string[]).includes('EXTENSION_INSTALLED') && (FOUNDRY_AGENT_EVENT_TYPES as readonly string[]).includes('EXTENSION_INSTALLED'), 'existing bus'))
  results.push(check('no_eventsystem2', !/EventSystem2/.test(w6), 'no EventSystem2'))
  results.push(check('ui_tabs', /Installed/.test(ui) && /Available/.test(ui) && /Updates/.test(ui) && /Quarantined/.test(ui), 'Commander EXTENSIONS UI'))
  results.push(check('ui_actions', ['REVIEW', 'INSTALL', 'ENABLE', 'DISABLE', 'UPDATE', 'REMOVE'].every(item => ui.includes(item)), 'Commander actions'))
  results.push(check('recommend_separate', /foundry-w6-recommendation/.test(ui) && /approved: false/.test(w6), 'AI recommend != approve'))
  results.push(check('api_gated', /commanderApproved/.test(api) && /isFoundryWorkbenchW0Enabled/.test(api), 'API Commander gated'))
  results.push(check('workbench_default_off', WORKBENCH_DEFAULT === false, 'WORKBENCH_DEFAULT=NO'))
  results.push(check('w4_1_deferred', W4_1_STILL_DEFERRED === true && W4_HUNK_PROPOSAL_STATUS === 'DEFERRED_W4_1', 'W4.1 deferred'))
  results.push(check('no_sandbox_policy', !/appendSwitch\(['"]no-sandbox['"]\)/.test(source('desktop/src/main.cjs')), 'LINUX_SANDBOX unchanged'))
  results.push(check('allowlist_small', INITIAL_ALLOWLIST.length === 2, INITIAL_ALLOWLIST.join(',')))
  results.push(check('no_language_claim', !/Python engineering certified/.test(w6), 'install != language graduation'))

  const tmp = path.join(os.tmpdir(), `w6-source-${process.pid}`)
  mkdirSync(tmp, { recursive: true })
  const lint = packLintVsix(tmp)
  const lang = packLanguageVsix(tmp)
  const lintV2 = packLintVsixV2(tmp)
  const unpacked = unpackVsix(tmp, lint.file)
  const rec = recordFromInspect(unpacked, 'LOCAL_VSIX', lint.file)
  results.push(check('fixture_A_catalog', rec.extensionId === 'foundry.w6-lint-fixture' && rec.license === 'MIT' && rec.linuxCompat === 'LINUX_COMPATIBLE' && rec.capabilities.includes('LINTER'), `${rec.extensionId} ${rec.license} ${rec.capabilities.join(',')}`))
  const langRec = recordFromInspect(unpackVsix(tmp, lang.file), 'LOCAL_VSIX')
  results.push(check('fixture_B_class', langRec.extensionId === 'foundry.w6-language-fixture' && langRec.license === 'Apache-2.0' && langRec.capabilities.includes('LOW_RISK_LANGUAGE_DATA'), langRec.capabilities.join(',')))

  const agent = mutateExtension(tmp, { action: 'install', actor: 'agent', vsixPath: lint.file, commanderApproved: false })
  results.push(check('fixture_J_no_agent', agent.ok === false && agent.code === 'AGENT_EXTENSION_INSTALL', String(agent.code)))

  const silent = mutateExtension(tmp, { action: 'download', actor: 'commander', commanderApproved: false, vsixPath: lint.file })
  results.push(check('silent_download_refused', silent.ok === false && silent.code === 'SILENT_DOWNLOAD_REFUSED', String(silent.code)))

  const autoUp = mutateExtension(tmp, { action: 'update', actor: 'commander', commanderApproved: false, vsixPath: lint.file, nextVsixPath: lintV2.file })
  results.push(check('auto_update_refused', autoUp.ok === false && autoUp.code === 'AUTO_UPDATE_REFUSED', String(autoUp.code)))

  const unsafeDir = writeUnsafeFixture(path.join(tmp, 'unsafe'))
  const unsafeInspect = inspectExtensionPackage(unsafeDir)
  const unsafe = mutateExtension(tmp, { action: 'install', actor: 'commander', commanderApproved: true, packageDir: unsafeDir })
  results.push(check('fixture_I_unsafe', unsafe.ok === false && unsafe.code === 'UNSAFE_AUTO_INSTALL_REFUSED' && unsafeInspect.concerns.length > 0, `${unsafe.code} ${unsafeInspect.concerns.join(',')}`))

  const review = mutateExtension(tmp, { action: 'review', actor: 'commander', commanderApproved: true, vsixPath: lint.file, sourceType: 'LOCAL_VSIX' })
  results.push(check('fixture_A_review', review.ok === true && review.record?.status === 'DISCOVERED', String(review.record?.status)))
  const approve = mutateExtension(tmp, { action: 'approve', actor: 'commander', commanderApproved: true, extensionId: 'foundry.w6-lint-fixture' })
  results.push(check('fixture_B_approval', approve.ok === true && approve.record?.approvedBy === 'commander', String(approve.record?.status)))
  const installed = mutateExtension(tmp, { action: 'install', actor: 'commander', commanderApproved: true, vsixPath: lint.file, sourceType: 'LOCAL_VSIX' })
  results.push(check('local_vsix_install', installed.ok === true && installed.record?.status === 'INSTALLED' && Boolean(installed.record?.sha256) && existsSync(String(installed.record?.installedPath)), `sha=${installed.record?.sha256?.slice(0, 12)}`))
  const disabled = mutateExtension(tmp, { action: 'disable', actor: 'commander', commanderApproved: true, extensionId: 'foundry.w6-lint-fixture' })
  results.push(check('disable_state', disabled.ok === true && disabled.record?.status === 'DISABLED' && disabled.record?.enabled === false, String(disabled.record?.status)))
  const enabled = mutateExtension(tmp, { action: 'enable', actor: 'commander', commanderApproved: true, extensionId: 'foundry.w6-lint-fixture' })
  results.push(check('enable_state', enabled.ok === true && enabled.record?.enabled === true, String(enabled.record?.status)))
  const updated = mutateExtension(tmp, { action: 'update', actor: 'commander', commanderApproved: true, extensionId: 'foundry.w6-lint-fixture', nextVsixPath: lintV2.file, sourceType: 'LOCAL_VSIX' })
  results.push(check('commander_update', updated.ok === true && updated.record?.version === '1.1.0' && existsSync(path.join(tmp, 'extensions-provenance.jsonl')), String(updated.record?.version)))
  const langInstall = mutateExtension(tmp, { action: 'install', actor: 'commander', commanderApproved: true, vsixPath: lang.file, sourceType: 'LOCAL_VSIX' })
  results.push(check('second_class_install', langInstall.ok === true && langInstall.record?.extensionId === 'foundry.w6-language-fixture', String(langInstall.record?.status)))
  results.push(check('adapter_single', adapterStillSingle(tmp) === true, 'FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT'))
  const recText = recommendExtension(tmp, 'foundry.w6-lint-fixture', 'Install lint fixture for JavaScript diagnostics')
  results.push(check('recommend_not_install', recText.approved === false, recText.text.slice(0, 80)))
  results.push(check('no_free_shell', !/term\.sendText/.test(host) && /AGENT_FREE_SHELL_VIA_EXTENSION_COUNT/.test(w6), 'no free-shell via extension host'))

  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* tmp */ }

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W6_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W6_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW6Validation }
