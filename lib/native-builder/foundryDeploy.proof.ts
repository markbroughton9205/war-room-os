/**
 * PASS 003 local fake deployment proof. No real external vendor. Exercises the state machine
 * and verifies the live local HTTP endpoint with the persistent Foundry browser.
 */
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { executeEngineerTool } from './engineerTools'
import { selectDeployBackend } from './foundryDeploy'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  const ctx = { repairId: randomUUID() }
  const routing = selectDeployBackend({ id: 'foundry-local-fake', kind: 'local_fake', apiEndpoint: 'in-process' })
  add([check('dp_01_backend_selects_api', routing.backend === 'api', JSON.stringify(routing))])

  const inspect = await executeEngineerTool({ tool: 'deploy.inspect', input: {} }, ctx)
  add([check('dp_02_inspect', inspect.ok, JSON.stringify(inspect.result ?? inspect.error))])

  const v1 = `v1-${ctx.repairId.slice(0, 6)}`
  const prepared = await executeEngineerTool({ tool: 'deploy.prepare', input: { version: v1, marker: `MARKER-${v1}` } }, ctx)
  add([check('dp_03_prepare', prepared.ok && (prepared.result as { phase?: string })?.phase === 'PREPARED', JSON.stringify(prepared.result ?? prepared.error))])

  const ran = await executeEngineerTool({ tool: 'deploy.run', input: {} }, ctx)
  add([check('dp_04_run_success', ran.ok && (ran.result as { phase?: string })?.phase === 'SUCCESS', JSON.stringify(ran.result ?? ran.error))])

  const status = await executeEngineerTool({ tool: 'deploy.status', input: {} }, ctx)
  const logs = await executeEngineerTool({ tool: 'deploy.logs', input: {} }, ctx)
  const verified = await executeEngineerTool({ tool: 'deploy.verify', input: {} }, ctx)
  add([
    check('dp_05_status', status.ok && (status.result as { phase?: string })?.phase === 'SUCCESS', JSON.stringify(status.result ?? status.error)),
    check('dp_06_logs', logs.ok && Array.isArray((logs.result as { lines?: unknown[] })?.lines), JSON.stringify(logs.error ?? 'ok')),
    check('dp_07_verify', verified.ok, JSON.stringify(verified.result ?? verified.error)),
  ])

  const origin = (ran.result as { origin?: string } | undefined)?.origin
  const browser = await executeEngineerTool({ tool: 'browser.start', input: {} }, ctx)
  let browserNavOk = false
  if (browser.ok && origin) {
    const pageId = (browser.result as { pageId?: string } | undefined)?.pageId
    const nav = await executeEngineerTool({ tool: 'browser.navigate', input: { pageId, url: origin } }, ctx)
    const text = await executeEngineerTool({ tool: 'browser.get_text', input: { pageId } }, ctx)
    const consoleResult = await executeEngineerTool({ tool: 'browser.console', input: { pageId } }, ctx)
    const network = await executeEngineerTool({ tool: 'browser.network', input: { pageId } }, ctx)
    const shot = await executeEngineerTool({ tool: 'browser.screenshot', input: { pageId } }, ctx)
    const body = String((text.result as { text?: string } | undefined)?.text ?? '')
    browserNavOk = nav.ok && body.includes(`FOUNDRY_DEPLOY_VERSION=${v1}`)
    add([
      check('dp_08_browser_sees_version', browserNavOk, JSON.stringify({ nav: nav.result ?? nav.error, snippet: body.slice(0, 200) })),
      check('dp_09_browser_console_network_screenshot', consoleResult.ok && network.ok && shot.ok, JSON.stringify({ console: consoleResult.error ?? 'ok', network: network.error ?? 'ok', shot: shot.error ?? 'ok' })),
    ])
  } else {
    add([check('dp_08_browser_sees_version', false, `browser.start failed: ${browser.error}`)])
  }

  const v2 = `v2-${ctx.repairId.slice(0, 6)}`
  await executeEngineerTool({ tool: 'deploy.prepare', input: { version: v2 } }, ctx)
  await executeEngineerTool({ tool: 'deploy.run', input: {} }, ctx)
  const failedRun = await executeEngineerTool({ tool: 'deploy.run', input: { fail: true } }, ctx)
  add([check('dp_10_induced_failure', !failedRun.ok && String(failedRun.error ?? '').includes('Induced'), JSON.stringify(failedRun.error ?? failedRun.result))])

  const rolled = await executeEngineerTool({ tool: 'deploy.rollback', input: {} }, ctx)
  const after = await executeEngineerTool({ tool: 'deploy.verify', input: {} }, ctx)
  const afterVersion = (after.result as { version?: string } | undefined)?.version
  add([
    check('dp_11_rollback', rolled.ok && (rolled.result as { phase?: string })?.phase === 'ROLLED_BACK', JSON.stringify(rolled.result ?? rolled.error)),
    check('dp_12_rollback_restored_prior', after.ok && afterVersion === v1, JSON.stringify(after.result ?? after.error)),
  ])

  await executeEngineerTool({ tool: 'browser.stop', input: {} }, ctx)
  const failed = results.filter(r => !r.pass)
  console.log(`foundry deploy proof: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryDeployProof }
