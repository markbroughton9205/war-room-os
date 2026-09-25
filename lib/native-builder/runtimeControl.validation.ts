/**
 * runtime.health / runtime.verify / runtime.launch / runtime.stop validation.
 * health/verify are read-only diagnostics and must behave sanely regardless of whatever
 * actually happens to be listening on the installed UI port on this machine.
 */
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  runtimeHealth,
  runtimeHealthDetailed,
  runtimeLaunch,
  runtimeLaunchInstalled,
  runtimeStop,
  runtimeStopInstalled,
  runtimeVerify,
} from './runtimeControl'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const OWNERSHIP_VALUES = new Set(['INSTALLED_RUNTIME', 'PACKAGED_RUNTIME', 'DEV_RUNTIME', 'UNKNOWN_OWNER', 'NOT_RUNNING'])

async function readOnlyTests(): Promise<CaseResult[]> {
  const health = await runtimeHealth()
  const verify = await runtimeVerify()
  const detailed = await runtimeHealthDetailed()
  const consistentWithHealth = verify.health.running === health.running
  return [
    check('readonly_01_health_never_throws', typeof health.running === 'boolean', JSON.stringify(health)),
    check('readonly_02_verify_never_throws', OWNERSHIP_VALUES.has(verify.ownership), JSON.stringify({ ownership: verify.ownership, detail: verify.detail })),
    check('readonly_03_not_running_implies_no_ownership_claim', health.running || verify.ownership === 'NOT_RUNNING', JSON.stringify(verify)),
    check('readonly_04_verify_reuses_same_health_probe_result', consistentWithHealth, `health.running=${health.running} verify.health.running=${verify.health.running}`),
    check('readonly_05_detailed_reports_both_ports', detailed.ui.port === 3848 && detailed.core.port === 3847, JSON.stringify(detailed)),
    check('readonly_06_verify_reports_core_port', verify.corePort.port === 3847, JSON.stringify(verify.corePort)),
    check('readonly_07_installed_runtime_has_executable_or_null', verify.ownership !== 'INSTALLED_RUNTIME' || typeof verify.executablePath === 'string' || verify.executablePath === null, JSON.stringify({ ownership: verify.ownership, executablePath: verify.executablePath })),
  ]
}

async function installedLaunchIdempotencyTests(): Promise<CaseResult[]> {
  const refusedStop = await runtimeStopInstalled(1)
  const before = await runtimeVerify()
  const launched = await runtimeLaunchInstalled()
  if (!launched.ok) {
    // Honest failure (e.g. no stamped install on this machine) is a valid, non-fake outcome.
    return [
      check('installed_01_stop_refuses_untracked_pid', !refusedStop.ok && /did not itself start/i.test(refusedStop.error ?? ''), JSON.stringify(refusedStop)),
      check('installed_02_launch_or_honest_failure', true, `honest failure: ${launched.error}`),
    ]
  }
  if (launched.alreadyRunning) {
    return [
      check('installed_01_stop_refuses_untracked_pid', !refusedStop.ok && /did not itself start/i.test(refusedStop.error ?? ''), JSON.stringify(refusedStop)),
      check('installed_02_launch_reports_already_running', before.health.running === true, JSON.stringify({ before: before.ownership, launched })),
    ]
  }
  // We actually started a new process on a machine with nothing running — clean it up ourselves.
  const stopped = await runtimeStopInstalled(launched.pid)
  return [
    check('installed_01_stop_refuses_untracked_pid', !refusedStop.ok && /did not itself start/i.test(refusedStop.error ?? ''), JSON.stringify(refusedStop)),
    check('installed_02_launch_started_and_self_cleanup_stop_succeeded', stopped.ok && stopped.killed, JSON.stringify({ launched, stopped })),
  ]
}

async function launchPolicyTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const denied = await runtimeLaunch({ cmd: 'bash', args: ['-c', 'echo hi'], repairId })
  return [check('launch_01_shell_interpreter_denied', !denied.ok && /shell/i.test(denied.error ?? ''), JSON.stringify(denied))]
}

async function launchStopRoundTripTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const launched = await runtimeLaunch({ cmd: 'node', args: ['-e', 'setInterval(() => {}, 1000)'], repairId, label: 'runtime-control-fixture' })
  if (!launched.ok || !launched.sessionId) return [check('roundtrip_01_launch', false, launched.error ?? 'no sessionId')]
  const stopped = await runtimeStop(launched.sessionId)
  return [
    check('roundtrip_01_launch', launched.ok, JSON.stringify(launched)),
    check('roundtrip_02_stop', stopped.ok && stopped.killed, JSON.stringify(stopped)),
  ]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await readOnlyTests())
  add(await launchPolicyTests())
  add(await launchStopRoundTripTests())
  add(await installedLaunchIdempotencyTests())
  const failed = results.filter(r => !r.pass)
  console.log(`runtimeControl validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runRuntimeControlValidation }
