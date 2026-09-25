/**
 * logs.tail / logs.search / logs.capture validation. Exercises the real audit_ledger source
 * (guaranteed non-empty on any machine that has run a single Engineer tool call) and the
 * mission_output ring buffer via a real command run through validationRunner.
 */
import { pathToFileURL } from 'node:url'
import { readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { runValidationOperationStreaming } from './validationRunner'
import { logsCapture, logsSearch, logsTail } from './logsTool'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function auditLedgerTests(): Promise<CaseResult[]> {
  const tail = await logsTail({ source: 'audit_ledger', lines: 5 })
  const search = await logsSearch({ source: 'audit_ledger', query: 'engineer:' })
  return [
    check('audit_01_tail_reads_real_ledger', tail.ok && tail.lines.length > 0, tail.ok ? String(tail.lines.length) : tail.error),
    check('audit_02_search_finds_engineer_entries', search.ok && search.matches.length > 0, search.ok ? String(search.matches.length) : search.error),
  ]
}

async function missionOutputTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  await runValidationOperationStreaming({ id: 'validation_script', targets: ['scripts/run-foundry-fixture-always-succeed.mjs'] }, { repairId })
  const tail = await logsTail({ source: 'mission_output', repairId })
  const missingRepairId = await logsTail({ source: 'mission_output' })
  return [
    check('mission_01_ring_buffer_has_real_output_after_a_command', tail.ok && tail.lines.length > 0, tail.ok ? String(tail.lines.length) : tail.error),
    check('mission_02_requires_repairId', !missingRepairId.ok, JSON.stringify(missingRepairId)),
  ]
}

async function captureTests(): Promise<CaseResult[]> {
  const captured = await logsCapture({ source: 'audit_ledger', lines: 10 })
  if (!captured.ok) return [check('capture_01_writes_evidence_file', false, captured.error)]
  let onDisk = false
  try {
    onDisk = (await readFile(captured.path, 'utf8')).length > 0
  } catch {
    onDisk = false
  }
  await rm(captured.path, { force: true })
  return [check('capture_01_writes_evidence_file', onDisk, captured.path)]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await auditLedgerTests())
  add(await missionOutputTests())
  add(await captureTests())
  const failed = results.filter(r => !r.pass)
  console.log(`logsTool validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runLogsToolValidation }
