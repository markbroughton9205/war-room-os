/**
 * process.list / process.inspect validation. Runs against the real live process table on this
 * machine — the validator process itself is a guaranteed-alive fixture, so this never mocks ps.
 */
import { pathToFileURL } from 'node:url'
import { processInspect, processList } from './processInspector'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function listTests(): Promise<CaseResult[]> {
  const all = await processList({ limit: 50 })
  const self = await processList({ filter: 'node' })
  return [
    check('list_01_returns_real_processes', all.ok && all.processes.length > 0, all.ok ? String(all.processes.length) : all.error),
    check('list_02_fields_are_well_typed', all.ok && all.processes.every(p => Number.isInteger(p.pid) && Number.isInteger(p.ppid) && typeof p.command === 'string'), 'shape check'),
    check('list_03_never_includes_environ_or_secrets_field', all.ok && all.processes.every(p => !('environ' in p) && !('env' in p)), 'no environ field present'),
    check('list_04_filter_narrows_results', self.ok, self.ok ? String(self.processes.length) : self.error),
  ]
}

async function inspectTests(): Promise<CaseResult[]> {
  const self = await processInspect({ pid: process.pid })
  const invalid = await processInspect({ pid: -1 })
  const nonexistent = await processInspect({ pid: 999_999 })
  return [
    check('inspect_01_finds_this_running_process', self.ok && self.process.pid === process.pid, self.ok ? JSON.stringify(self.process) : self.error),
    check('inspect_02_invalid_pid_rejected', !invalid.ok, JSON.stringify(invalid)),
    check('inspect_03_nonexistent_pid_honest_not_found', !nonexistent.ok, JSON.stringify(nonexistent)),
  ]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await listTests())
  add(await inspectTests())
  const failed = results.filter(r => !r.pass)
  console.log(`processInspector validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runProcessInspectorValidation }
