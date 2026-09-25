/**
 * browser.* tool validation: target allowlist (loopback / in-workspace file://) and the honest
 * "not available" fallback when Playwright binaries aren't installed on this machine.
 */
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { assertSafeBrowserTarget, browserClose, browserOpen, inspectLocalPage } from './browserInspector'
import { RepoAccessDeniedError } from './repositoryInspector'
import { browserStopService } from './foundryBrowserService'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function denied(url: string): Promise<boolean> {
  try {
    await assertSafeBrowserTarget(url)
    return false
  } catch (error) {
    return error instanceof RepoAccessDeniedError || /escapes|allowlist|symlink/i.test(error instanceof Error ? error.message : String(error))
  }
}

async function targetTests(): Promise<CaseResult[]> {
  return [
    check('target_01_loopback_ip_allowed', !(await denied('http://127.0.0.1:3848/')), 'loopback should be allowed'),
    check('target_02_localhost_allowed', !(await denied('http://localhost:3000/')), 'localhost should be allowed'),
    check('target_03_allowlisted_public_host_allowed', !(await denied('http://example.com/')), 'example.com is the PASS 003 public-internet allowlist'),
    check('target_03b_non_allowlisted_public_host_denied', await denied('http://not-loopback.example/'), 'non-allowlisted public host must stay denied'),
    check('target_04_public_ip_denied', await denied('http://93.184.216.34/'), 'public IP must be denied'),
    check('target_05_file_outside_repo_denied', await denied('file:///etc/passwd'), 'file:// outside repo must be denied'),
    check('target_06_file_inside_repo_allowed', !(await denied(`file://${process.cwd()}/package.json`)), 'file:// inside repo should be allowed'),
    check('target_07_non_http_scheme_denied', await denied('ftp://127.0.0.1/'), 'non-http(s)/file scheme must be denied'),
    check('target_08_malformed_url_denied', await denied('not a url'), 'malformed URL must be denied'),
  ]
}

async function inspectionTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const result = await inspectLocalPage({ url: 'http://127.0.0.1:1/' }, { repairId })
  // Port 1 is never a real local server in this environment, and Playwright may not have a
  // Chromium binary installed — either way this must be an HONEST not-available result, never a
  // fabricated VERIFIED.
  const honestFailure = result.visualVerification === 'VISUAL_VERIFICATION_NOT_AVAILABLE'
  return [
    check('inspect_01_unreachable_target_is_honest', honestFailure, JSON.stringify(result)),
    check('inspect_02_denied_target_rejected', await denied('http://not-loopback.example/'), 'sanity re-check'),
  ]
}

async function sessionCleanupTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const opened = await browserOpen({ repairId })
  if (!opened.ok) {
    return [check('session_01_open_honest_when_unavailable', /PLAYWRIGHT_NOT_INSTALLED/.test(opened.error), opened.error)]
  }
  const closed = await browserClose({ sessionId: opened.result.sessionId })
  const reclosed = await browserClose({ sessionId: opened.result.sessionId })
  return [
    check('session_01_open_ok', opened.ok, 'browser.open should succeed when Playwright is available'),
    check('session_02_close_ok', closed.ok && closed.result.closed, JSON.stringify(closed)),
    check('session_03_close_idempotent', reclosed.ok && reclosed.result.closed === false, 'closing an already-closed session should not error'),
  ]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await targetTests())
  add(await inspectionTests())
  add(await sessionCleanupTests())
  // The browser is a persistent, long-lived service (PASS 003) — stop it explicitly or this
  // process (and any CI runner waiting on it) never exits.
  await browserStopService()
  const failed = results.filter(r => !r.pass)
  console.log(`browserInspector validation: ${results.length - failed.length}/${results.length} PASS`)
  process.exit(failed.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runBrowserInspectorValidation }
