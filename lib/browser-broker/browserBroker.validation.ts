/**
 * Browser Broker Phase 1 — classifier, diagnostics, and client-surface validation.
 * Live Chromium proofs live in browserBroker.live-acceptance.ts.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { classifyBrowserAction } from './actionClassifier'
import { getBrowserBroker } from './broker'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const results: CaseResult[] = []
  const broker = getBrowserBroker()
  const diag = broker.diagnostics()
  results.push(check(
    'health_enum_known',
    ['READY', 'DEGRADED', 'OFFLINE', 'STARTING', 'RECOVERING', 'MISCONFIGURED', 'UNKNOWN'].includes(diag.brokerState),
    diag.brokerState,
  ))
  results.push(check(
    'diagnostics_not_fake_ready',
    diag.brokerState !== 'READY'
      || diag.chromiumState === 'IDLE'
      || Boolean(diag.chromiumPid && diag.chromiumState === 'RUNNING'),
    JSON.stringify({ state: diag.brokerState, pid: diag.chromiumPid, chromium: diag.chromiumState }),
  ))
  const statusClass = classifyBrowserAction({ kind: 'status', owner: 'council' })
  results.push(check(
    'BROWSER-STATUS-1',
    statusClass.verdict === 'ALLOW_RESEARCH' && statusClass.research === true,
    JSON.stringify(statusClass),
  ))
  const idleStatus = broker.statusSnapshot()
  results.push(check(
    'BROWSER-STATUS-2',
    idleStatus.broker_state === 'READY' && idleStatus.chromium_state === 'IDLE' && idleStatus.chromium_pid == null && idleStatus.playwright_available === true,
    JSON.stringify(idleStatus),
  ))
  const statusAction = await broker.executeAction({ kind: 'status', owner: 'broker' })
  results.push(check(
    'status_action_read_only_no_launch',
    statusAction.ok === true && broker.diagnostics().chromiumState === 'IDLE' && !broker.isRunning(),
    JSON.stringify({ ok: statusAction.ok, chromium: broker.diagnostics().chromiumState }),
  ))
  results.push(check(
    'research_navigate_allowed',
    classifyBrowserAction({ kind: 'navigate', owner: 'council', url: 'https://playwright.dev/docs/browser-contexts' }).verdict === 'ALLOW_RESEARCH',
    classifyBrowserAction({ kind: 'navigate', owner: 'council', url: 'https://playwright.dev/docs/browser-contexts' }).reason,
  ))
  results.push(check(
    'search_allowed',
    classifyBrowserAction({ kind: 'search', owner: 'council', query: 'playwright browser contexts' }).verdict === 'ALLOW_RESEARCH',
    'search',
  ))
  const submit = classifyBrowserAction({ kind: 'submit', owner: 'council', selector: 'form.checkout', url: 'https://example.com/checkout' })
  results.push(check(
    'submit_requires_approval',
    submit.verdict === 'ACTION_REQUIRES_APPROVAL',
    JSON.stringify(submit),
  ))
  const pay = classifyBrowserAction({ kind: 'payment', owner: 'council' })
  results.push(check('payment_requires_approval', pay.verdict === 'ACTION_REQUIRES_APPROVAL', pay.reasonCode))
  const purchase = classifyBrowserAction({ kind: 'purchase', owner: 'foundry' })
  results.push(check('purchase_requires_approval', purchase.verdict === 'ACTION_REQUIRES_APPROVAL', purchase.reasonCode))
  const email = classifyBrowserAction({ kind: 'email_send', owner: 'council' })
  results.push(check('email_requires_approval', email.verdict === 'ACTION_REQUIRES_APPROVAL', email.reasonCode))
  const execDl = classifyBrowserAction({ kind: 'execute_download', owner: 'council' })
  results.push(check('execute_download_requires_approval', execDl.verdict === 'ACTION_REQUIRES_APPROVAL', execDl.reasonCode))
  results.push(check(
    'sensitive_subject_not_blocked',
    classifyBrowserAction({ kind: 'navigate', owner: 'council', url: 'https://example.com/malware-analysis' }).verdict === 'ALLOW_RESEARCH',
    'research of sensitive subjects remains allowed',
  ))
  const root = resolveRepoRoot()
  const foundry = await readFile(`${root}/lib/native-builder/foundryBrowserService.ts`, 'utf8')
  const council = await readFile(`${root}/lib/browser-broker/councilClient.ts`, 'utf8')
  const engineer = await readFile(`${root}/lib/native-builder/engineerTools.ts`, 'utf8')
  results.push(check(
    'foundry_uses_shared_broker',
    foundry.includes("from '@/lib/browser-broker'") && foundry.includes('getBrowserBroker'),
    'foundryBrowserService imports shared broker',
  ))
  results.push(check(
    'council_uses_shared_broker',
    council.includes('getBrowserBroker') && council.includes("owner: 'council'"),
    'council client uses shared broker',
  ))
  results.push(check(
    'engineer_keeps_foundry_tool_seam',
    engineer.includes('executeFoundryBrowserTool'),
    'Foundry tool seam unchanged',
  ))
  const playwright = await readFile(`${root}/lib/native-builder/foundryPlaywright.ts`, 'utf8')
  results.push(check(
    'chromium_strips_electron_library_path',
    playwright.includes('chromiumChildEnv') && playwright.includes('LD_LIBRARY_PATH') && playwright.includes('ELECTRON_RUN_AS_NODE'),
    'Chromium child env strips Electron libraries',
  ))
  const policy = await readFile(`${root}/lib/browser-broker/screenshotPolicy.ts`, 'utf8')
  const paths = await readFile(`${root}/lib/browser-broker/paths.ts`, 'utf8')
  const brokerSrc = await readFile(`${root}/lib/browser-broker/broker.ts`, 'utf8')
  results.push(check(
    'screenshot_preflight_policy',
    policy.includes('planScreenshot') && policy.includes('maxDirectPixels') && policy.includes('TILED_CAPTURE') && policy.includes('VIEWPORT_FALLBACK'),
    'oversized document preflight exists',
  ))
  const giant = (await import('./screenshotPolicy')).planScreenshot({
    pageWidth: 1280,
    pageHeight: 80_000,
    viewportWidth: 1280,
    viewportHeight: 720,
    deviceScaleFactor: 2,
    wantFullPage: true,
  })
  results.push(check(
    'pixel_memory_safety_limit',
    giant.strategy !== 'DIRECT_FULL_PAGE' && giant.metrics.estimatedPixels > 8_000_000,
    JSON.stringify({ strategy: giant.strategy, pixels: giant.metrics.estimatedPixels }),
  ))
  results.push(check(
    'SCREENSHOT-4',
    giant.strategy === 'UNSAFE_REJECT' || giant.strategy === 'VIEWPORT_FALLBACK' || giant.strategy === 'BOUNDED_FULL_PAGE' || giant.strategy === 'TILED_CAPTURE',
    JSON.stringify({ strategy: giant.strategy, pixels: giant.metrics.estimatedPixels, reason: giant.reason }),
  ))
  const tiled = (await import('./screenshotPolicy')).planScreenshot({
    pageWidth: 1280,
    pageHeight: 12_500,
    viewportWidth: 1280,
    viewportHeight: 720,
    deviceScaleFactor: 1,
    wantFullPage: true,
  })
  results.push(check(
    'tiled_or_bounded_or_fallback',
    ['BOUNDED_FULL_PAGE', 'TILED_CAPTURE', 'VIEWPORT_FALLBACK', 'UNSAFE_REJECT'].includes(giant.strategy),
    giant.strategy,
  ))
  results.push(check(
    'tiled_capture_medium_oversize',
    tiled.strategy === 'TILED_CAPTURE' || tiled.strategy === 'BOUNDED_FULL_PAGE' || tiled.strategy === 'VIEWPORT_FALLBACK',
    JSON.stringify({ strategy: tiled.strategy, tiles: tiled.tiles.length, pixels: tiled.metrics.estimatedPixels }),
  ))
  results.push(check(
    'playwright_tmp_not_os_tmp',
    paths.includes('withPlaywrightTmpDir') && paths.includes('XDG_RUNTIME_DIR') &&     brokerSrc.includes('withPlaywrightTmpDir'),
    'Playwright tmpdir is short XDG_RUNTIME_DIR, not quota-limited /tmp',
  ))
  const storeSrc = await readFile(`${root}/lib/browser-broker/profileStore.ts`, 'utf8')
  const secretSrc = await readFile(`${root}/lib/browser-broker/secretService.ts`, 'utf8')
  results.push(check(
    'phase2_no_fake_crypto',
    storeSrc.includes('aes-256-gcm') && secretSrc.includes('SECRET_SERVICE') && !storeSrc.includes('aes-256-homemade') && !storeSrc.includes('filesystem-owner-mode'),
    'Phase 2.1 uses Secret Service + AES-256-GCM instead of fake crypto or owner-mode-as-encryption',
  ))
  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  console.log(`browser broker validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runBrowserBrokerValidation }
