/**
 * PASS 003 integrated broker proof for the families that do not require a second
 * production package: workspace → fixture → test/lint/typecheck → deploy → browser →
 * computer observation → audit. The exact-install chain is foundryActivationAcceptance.proof.ts.
 */
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { executeEngineerTool } from './engineerTools'
import { evaluateCompletionGate } from './productionCompletionGate'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function readAuditTail(): Promise<{ hash?: string } | null> {
  try {
    const file = path.join(resolveBaseRepoRoot(), '.war-room', 'audit', 'code-operator.jsonl')
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    return JSON.parse(lines.at(-1) ?? '{}') as { hash?: string }
  } catch {
    return null
  }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  const ctx = { repairId: randomUUID() }
  const auditBefore = await readAuditTail()
  const fixtureRel = `tmp/foundry-pass003-fixture-${ctx.repairId.slice(0, 8)}.md`

  const inspect = await executeEngineerTool({ tool: 'workspace.inspect', input: {} }, ctx)
  const search = await executeEngineerTool({ tool: 'workspace.search', input: { query: 'FOUNDRY_TOOL_RUNTIME', pathPrefix: 'lib/native-builder' } }, ctx)
  add([
    check('int_01_workspace_inspect', inspect.ok, JSON.stringify(inspect.error ?? 'ok')),
    check('int_02_workspace_search', search.ok, JSON.stringify(search.error ?? 'ok')),
  ])

  const written = await executeEngineerTool({
    tool: 'file.write',
    input: { path: fixtureRel, content: `foundry-pass003-fixture ${ctx.repairId}\n`, reason: 'PASS 003 integrated fixture' },
  }, ctx)
  add([check('int_03_safe_fixture_write', written.ok, JSON.stringify(written.error ?? 'ok'))])

  const test = await executeEngineerTool({ tool: 'test.run', input: { suite: 'validate:foundry-build-lock' } }, ctx)
  const lint = await executeEngineerTool({ tool: 'lint.run', input: { targets: ['lib/native-builder/foundryPaths.ts'] } }, ctx)
  const typecheck = await executeEngineerTool({ tool: 'typecheck.run', input: { scopeGlob: 'lib/native-builder/foundryPaths.ts' } }, ctx)
  add([
    check('int_04_test_run', test.ok, JSON.stringify(test.error ?? 'ok')),
    check('int_05_lint_run', lint.ok, JSON.stringify(lint.error ?? 'ok')),
    check('int_06_typecheck_scoped', typecheck.ok || ((typecheck.result as { scopedErrorCount?: number })?.scopedErrorCount === 0), JSON.stringify({ ok: typecheck.ok, scoped: (typecheck.result as { scopedErrorCount?: number })?.scopedErrorCount, note: (typecheck.result as { baselineNote?: string })?.baselineNote })),
  ])

  const deploy = await executeEngineerTool({ tool: 'deploy.inspect', input: {} }, ctx)
  const computer = await executeEngineerTool({ tool: 'computer.windows', input: {} }, ctx)
  const browser = await executeEngineerTool({ tool: 'browser.status', input: {} }, ctx)
  add([
    check('int_07_deploy_broker', deploy.ok, JSON.stringify(deploy.error ?? 'ok')),
    check('int_08_computer_broker', computer.ok, JSON.stringify(computer.error ?? 'ok')),
    check('int_09_browser_broker', browser.ok, JSON.stringify(browser.error ?? 'ok')),
  ])

  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, ctx)
  const v = verify.result as { activeInstallId?: string | null; runningInstallId?: string | null; identityMatch?: boolean | null; health?: { running?: boolean }; corePort?: { running?: boolean } }
  const gate = evaluateCompletionGate({
    sourceChanged: true,
    validationOk: test.ok,
    buildOk: true,
    packageOk: true,
    installOk: true,
    activeInstallId: v?.activeInstallId ?? null,
    missionInstallId: v?.runningInstallId ?? v?.activeInstallId ?? null,
    runningInstallId: v?.runningInstallId ?? null,
    uiHealthOk: v?.health?.running === true,
    coreHealthOk: v?.corePort?.running === true,
    identityMatch: v?.identityMatch ?? null,
    browserAcceptanceOk: true,
    consoleAcceptanceOk: true,
    networkAcceptanceOk: true,
    computerUseAcceptance: 'PASS',
    localDeploymentAcceptanceOk: true,
  })
  add([check('int_10_identity_snapshot', verify.ok, JSON.stringify({ active: v?.activeInstallId, running: v?.runningInstallId, match: v?.identityMatch, gate: gate.detail }))])

  const auditAfter = await readAuditTail()
  add([check('int_11_audit_advanced', auditAfter !== null && auditAfter.hash !== auditBefore?.hash, JSON.stringify({ before: auditBefore?.hash, after: auditAfter?.hash }))])

  await rm(path.join(resolveBaseRepoRoot(), fixtureRel), { force: true })
  await executeEngineerTool({ tool: 'browser.stop', input: {} }, ctx)
  const failed = results.filter(r => !r.pass)
  console.log(`foundry PASS 003 integrated broker proof: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryPass003IntegratedProof }
