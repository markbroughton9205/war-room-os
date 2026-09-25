/**
 * terminal.open_session / session_send / session_read / session_kill validation.
 * Honest scope reminder: this is a kept-open-stdin pipe session, not a PTY (see terminalSession.ts).
 */
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  closeTerminalSession,
  openTerminalSession,
  readTerminalSession,
  sendTerminalSessionInput,
} from './terminalSession'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function policyTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const denied = await openTerminalSession({ repairId, cmd: 'bash', args: ['-c', 'echo hi'] })
  return [check('policy_01_shell_interpreter_denied', !denied.ok && /shell/i.test(denied.error ?? ''), JSON.stringify(denied))]
}

async function echoRoundTripTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const opened = await openTerminalSession({
    repairId,
    cmd: 'node',
    args: ['-e', "process.stdin.setEncoding('utf8'); process.stdin.on('data', d => process.stdout.write('echo:' + d))"],
    label: 'echo-fixture',
  })
  if (!opened.ok || !opened.sessionId) {
    return [check('echo_01_open', false, opened.error ?? 'no sessionId')]
  }
  const sessionId = opened.sessionId
  const immediateRead = readTerminalSession(sessionId, 0)
  const sent = sendTerminalSessionInput(sessionId, 'hello-foundry')
  await sleep(400)
  const afterSend = readTerminalSession(sessionId, 0)
  const echoed = afterSend.entries.some(e => e.stream === 'stdout' && e.text.includes('echo:hello-foundry'))
  const closed = await closeTerminalSession(sessionId)
  await sleep(100)
  const afterClose = readTerminalSession(sessionId, 0)
  return [
    check('echo_01_open', opened.ok, JSON.stringify(opened)),
    check('echo_02_immediate_read_nonblocking', immediateRead.ok, 'read before any output must return immediately, not hang'),
    check('echo_03_send_ok', sent.ok, JSON.stringify(sent)),
    check('echo_04_output_captured', echoed, JSON.stringify(afterSend.entries.map(e => e.text))),
    check('echo_05_close_ok', closed.ok && closed.killed, JSON.stringify(closed)),
    check('echo_06_read_after_close_reports_closed', afterClose.ok && afterClose.closed, JSON.stringify(afterClose)),
  ]
}

async function nonZeroExitTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const opened = await openTerminalSession({ repairId, cmd: 'node', args: ['-e', 'process.exit(1)'], label: 'exit-1-fixture' })
  if (!opened.ok || !opened.sessionId) return [check('exit_01_open', false, opened.error ?? 'no sessionId')]
  await sleep(300)
  const read = readTerminalSession(opened.sessionId, 0)
  return [check('exit_01_nonzero_surfaced', read.closed && read.exitCode === 1, JSON.stringify(read))]
}

async function unknownSessionTests(): Promise<CaseResult[]> {
  const bogus = randomUUID()
  const sendResult = sendTerminalSessionInput(bogus, 'x')
  const readResult = readTerminalSession(bogus, 0)
  return [
    check('unknown_01_send_rejected', !sendResult.ok, JSON.stringify(sendResult)),
    check('unknown_02_read_rejected', !readResult.ok, JSON.stringify(readResult)),
  ]
}

async function sessionCapTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const opened: string[] = []
  let capHit = false
  for (let i = 0; i < 5; i += 1) {
    const result = await openTerminalSession({ repairId, cmd: 'node', args: ['-e', 'setInterval(() => {}, 1000)'], label: `cap-fixture-${i}` })
    if (result.ok && result.sessionId) opened.push(result.sessionId)
    else capHit = true
  }
  for (const sessionId of opened) await closeTerminalSession(sessionId)
  return [check('cap_01_per_mission_session_cap_enforced', capHit, `opened ${opened.length} of 5 attempts before the cap kicked in`)]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await policyTests())
  add(await echoRoundTripTests())
  add(await nonZeroExitTests())
  add(await unknownSessionTests())
  add(await sessionCapTests())
  const failed = results.filter(r => !r.pass)
  console.log(`terminalSession validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runTerminalSessionValidation }
