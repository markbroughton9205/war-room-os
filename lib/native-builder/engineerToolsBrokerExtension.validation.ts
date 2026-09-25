/**
 * Broker-level matrix for the Pass 001 tool-runtime extension: valid call, unknown tool, invalid
 * args, permission denied, workspace boundary violation, terminal success/failure, and audit
 * creation — the cross-cutting behaviors every engineerTools.ts case must honor, not just the
 * new tools individually.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { executeEngineerTool, type EngineerToolCall, type EngineerToolName } from './engineerTools'
import { listBoundaryViolations } from './boundaryLog'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function ctx() {
  return { repairId: randomUUID() }
}

async function readAuditTail(): Promise<{ hash?: string; message?: string } | null> {
  try {
    const file = path.join(resolveBaseRepoRoot(), '.war-room', 'audit', 'code-operator.jsonl')
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    return JSON.parse(lines.at(-1) ?? '{}') as { hash?: string; message?: string; previousHash?: string }
  } catch {
    return null
  }
}

async function validCallTests(): Promise<CaseResult[]> {
  const result = await executeEngineerTool({ tool: 'file.read', input: { path: 'package.json' } }, ctx())
  return [check('valid_01_file_read_unaffected', result.ok, JSON.stringify(result.error ?? 'ok'))]
}

async function unknownToolTests(): Promise<CaseResult[]> {
  const call = { tool: 'not.a.real.tool' as EngineerToolName, input: {} } satisfies EngineerToolCall
  const result = await executeEngineerTool(call, ctx())
  return [check('unknown_01_unregistered_tool_rejected', !result.ok && result.error === 'Unknown tool.', JSON.stringify(result))]
}

async function invalidArgsTests(): Promise<CaseResult[]> {
  const result = await executeEngineerTool({ tool: 'terminal.execute', input: {} }, ctx())
  return [check('invalid_01_missing_operation_rejected', !result.ok, JSON.stringify(result))]
}

async function permissionDeniedTests(): Promise<CaseResult[]> {
  const result = await executeEngineerTool({ tool: 'terminal.open_session', input: { cmd: 'bash', args: ['-c', 'echo hi'] } }, ctx())
  return [check('denied_01_shell_interpreter_rejected', !result.ok && /shell/i.test(result.error ?? ''), JSON.stringify(result))]
}

async function boundaryViolationTests(): Promise<CaseResult[]> {
  const before = (await listBoundaryViolations()).length
  const result = await executeEngineerTool({ tool: 'file.read', input: { path: '../../../../../../etc/passwd' } }, ctx())
  const after = (await listBoundaryViolations()).length
  return [
    check('boundary_01_traversal_rejected', !result.ok, JSON.stringify(result)),
    check('boundary_02_violation_recorded', after > before, `before=${before} after=${after}`),
  ]
}

async function terminalSuccessFailureTests(): Promise<CaseResult[]> {
  // node_test at repo root is deliberately NOT used here: this repo carries a leftover
  // desktop/node_modules.windows-bak/ backup tree whose bundled third-party test files fail under
  // node:test — real repo mess, unrelated to the broker. A dedicated fixture keeps this test
  // deterministic and focused on what it actually verifies: terminal.execute surfaces a real exit
  // code either way.
  const success = await executeEngineerTool(
    { tool: 'terminal.execute', input: { operation: { id: 'validation_script', targets: ['scripts/run-foundry-fixture-always-succeed.mjs'] } } },
    ctx(),
  )
  const failure = await executeEngineerTool(
    { tool: 'terminal.execute', input: { operation: { id: 'validation_script', targets: ['scripts/run-foundry-fixture-always-fail.mjs'] } } },
    ctx(),
  )
  const failureResult = failure.result as { exitCode?: number } | undefined
  return [
    check('terminal_01_success_reported_ok', success.ok, JSON.stringify(success.result ?? success.error)),
    check('terminal_02_nonzero_exit_reported_as_failure', failure.ok === false && failureResult?.exitCode === 1, JSON.stringify(failure)),
  ]
}

async function auditCreationTests(): Promise<CaseResult[]> {
  const before = await readAuditTail()
  const opened = await executeEngineerTool({ tool: 'terminal.open_session', input: { cmd: 'node', args: ['-e', 'setInterval(() => {}, 1000)'] } }, ctx())
  const sessionId = (opened.result as { sessionId?: string } | undefined)?.sessionId
  if (sessionId) await executeEngineerTool({ tool: 'terminal.session_kill', input: { sessionId } }, ctx())
  const after = await readAuditTail()
  const advanced = after !== null && after.hash !== before?.hash
  return [check('audit_01_new_tail_entry_after_tool_call', advanced, JSON.stringify({ before: before?.message, after: after?.message }))]
}

/** PASS 002 — workspace search/read hardening: the stale backup trees PASS 001 found (real
 * directories on this machine, not fixtures) must never be reachable through the Tool Broker. */
async function windowsBakDenylistTests(): Promise<CaseResult[]> {
  const nextBak = await executeEngineerTool({ tool: 'file.read', input: { path: '.next.windows-bak/standalone/package.json' } }, ctx())
  const nodeModulesBak = await executeEngineerTool({ tool: 'file.read', input: { path: 'desktop/node_modules.windows-bak/package.json' } }, ctx())
  const distVariant = await executeEngineerTool({ tool: 'file.read', input: { path: 'desktop/dist-11d/anything.txt' } }, ctx())
  const search = await executeEngineerTool({ tool: 'workspace.search', input: { query: 'require', pathPrefix: 'desktop' } }, ctx())
  const searchHits = (search.result as { relPath: string }[] | undefined) ?? []
  return [
    check('denylist_01_next_windows_bak_rejected', !nextBak.ok, JSON.stringify(nextBak)),
    check('denylist_02_node_modules_windows_bak_rejected', !nodeModulesBak.ok, JSON.stringify(nodeModulesBak)),
    check('denylist_03_dist_variant_rejected', !distVariant.ok, JSON.stringify(distVariant)),
    check('denylist_04_search_under_desktop_never_surfaces_bak_or_dist_hits', search.ok && searchHits.every(h => !/\.windows-bak\//.test(h.relPath) && !/\/dist(-.*)?\//.test(h.relPath)), JSON.stringify(searchHits.slice(0, 5))),
  ]
}

/** PASS 002 — dispatch-level wiring for the new tool names, not their deep behavior (that's
 * covered by each tool's own *.validation.ts). Proves engineerTools.ts actually routes to them. */
async function pass002DispatchTests(): Promise<CaseResult[]> {
  const suites = await executeEngineerTool({ tool: 'test.list_suites', input: {} }, ctx())
  const processes = await executeEngineerTool({ tool: 'process.list', input: { limit: 5 } }, ctx())
  const ports = await executeEngineerTool({ tool: 'port.inspect', input: {} }, ctx())
  const badLogSource = await executeEngineerTool({ tool: 'logs.tail', input: { source: 'not-a-real-source' } }, ctx())
  const goodLogSource = await executeEngineerTool({ tool: 'logs.tail', input: { source: 'audit_ledger', lines: 3 } }, ctx())
  const rollbackUnknown = await executeEngineerTool({ tool: 'installer.rollback_target', input: { installId: `no-such-install-${randomUUID()}` } }, ctx())
  const productionMissingArgs = await executeEngineerTool({ tool: 'installer.install_production', input: {} }, ctx())
  return [
    check('pass002_01_test_list_suites_dispatches', suites.ok, JSON.stringify(suites.error ?? 'ok')),
    check('pass002_02_process_list_dispatches', processes.ok, JSON.stringify(processes.error ?? 'ok')),
    check('pass002_03_port_inspect_dispatches', ports.ok, JSON.stringify(ports.error ?? 'ok')),
    check('pass002_04_logs_tail_rejects_unknown_source', !badLogSource.ok, JSON.stringify(badLogSource)),
    check('pass002_05_logs_tail_accepts_known_source', goodLogSource.ok, JSON.stringify(goodLogSource.error ?? 'ok')),
    check('pass002_06_rollback_target_dispatches', !rollbackUnknown.ok, JSON.stringify(rollbackUnknown.error ?? 'unexpectedly ok')),
    check('pass002_07_install_production_requires_artifacts', !productionMissingArgs.ok, JSON.stringify(productionMissingArgs)),
  ]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await validCallTests())
  add(await unknownToolTests())
  add(await invalidArgsTests())
  add(await permissionDeniedTests())
  add(await boundaryViolationTests())
  add(await terminalSuccessFailureTests())
  add(await auditCreationTests())
  add(await windowsBakDenylistTests())
  add(await pass002DispatchTests())
  const failed = results.filter(r => !r.pass)
  console.log(`engineerToolsBrokerExtension validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runEngineerToolsBrokerExtensionValidation }
