/**
 * FOUNDRY_TOOL_RUNTIME_PASS_001 acceptance proof: exercises the extended tool broker end to end
 * through a harmless workflow — inspect the repo, search it, mutate + check a fixture, spin up a
 * throwaway local HTTP server, drive it with real browser automation, capture evidence, verify
 * (read-only) the real installed runtime without touching it, exercise installer.install against
 * an isolated tmp/ override only, and confirm the audit ledger grew. Every fixture created here is
 * removed at the end, success or failure. This never fabricates a PASS — a genuine failure (e.g.
 * Playwright unavailable) is reported as FAIL with the real reason.
 */
import { pathToFileURL } from 'node:url'
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot, resolveBaseRepoRoot } from '@/lib/repo/paths'
import { executeEngineerTool } from './engineerTools'
import { probeHttpPort } from './runtimeControl'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const PROOF_PORT = 19321
const FIXTURE_DIR = 'tmp/foundry-tool-runtime-proof'
const FIXTURE_DATA_REL = `${FIXTURE_DIR}/greeting.md`
const FIXTURE_CHECK_SCRIPT_REL = 'scripts/run-foundry-tool-runtime-proof-fixture-check.mjs'
const FIXTURE_GREETING = 'hello-foundry-tool-runtime'

async function readAuditTail(): Promise<{ hash?: string } | null> {
  try {
    const file = path.join(resolveBaseRepoRoot(), '.war-room', 'audit', 'code-operator.jsonl')
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    return JSON.parse(lines.at(-1) ?? '{}') as { hash?: string }
  } catch {
    return null
  }
}

async function removeFixtures(): Promise<void> {
  await rm(path.join(resolveRepoRoot(), FIXTURE_DIR), { recursive: true, force: true })
  await rm(path.join(resolveRepoRoot(), FIXTURE_CHECK_SCRIPT_REL), { force: true })
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  const auditBefore = await readAuditTail()
  const repairId = randomUUID()
  const ctx = { repairId }
  let httpSessionId: string | undefined
  let browserSessionId: string | undefined

  try {
    // 1. Inspect a real repo file.
    const inspected = await executeEngineerTool({ tool: 'workspace.inspect', input: {} }, ctx)
    const read = await executeEngineerTool({ tool: 'file.read', input: { path: 'package.json' } }, ctx)
    add([
      check('e2e_01_workspace_inspect', inspected.ok, JSON.stringify(inspected.error ?? 'ok')),
      check('e2e_02_file_read', read.ok, JSON.stringify(read.error ?? 'ok')),
    ])

    // 2. Search the workspace. Scoped to lib/native-builder: the repo also carries stale
    // .next.windows-bak/ and node_modules.windows-bak/ backup trees that repositoryInspector's
    // denylist does not (yet) cover, which can surface bundled build output ahead of real source
    // in an unscoped search — a real gap, reported in the pass deliverable, not papered over here.
    const searched = await executeEngineerTool({ tool: 'workspace.search', input: { query: 'ENGINEER_TOOL_NAMES', pathPrefix: 'lib/native-builder' } }, ctx)
    const hits = (searched.result as { relPath: string }[] | undefined) ?? []
    add([check('e2e_03_workspace_search', searched.ok && hits.some(h => h.relPath.includes('engineerTools.ts')), JSON.stringify(hits.slice(0, 3)))])

    // 3. A harmless mutation + a real test/check against it (never touches production source).
    await mkdir(path.join(resolveRepoRoot(), FIXTURE_DIR), { recursive: true })
    const written = await executeEngineerTool({ tool: 'file.write', input: { path: FIXTURE_DATA_REL, content: FIXTURE_GREETING, reason: 'Foundry tool-runtime acceptance proof fixture.' } }, ctx)
    const checkScript = `
import { readFileSync } from 'node:fs'
const content = readFileSync(${JSON.stringify(FIXTURE_DATA_REL)}, 'utf8')
if (content !== ${JSON.stringify(FIXTURE_GREETING)}) {
  console.error('fixture content mismatch:', content)
  process.exit(1)
}
console.log('fixture content verified')
`
    await executeEngineerTool({ tool: 'file.write', input: { path: FIXTURE_CHECK_SCRIPT_REL, content: checkScript, reason: 'Foundry tool-runtime acceptance proof check script.' } }, ctx)
    const validated = await executeEngineerTool({ tool: 'validation.run', input: { operation: { id: 'validation_script', targets: [FIXTURE_CHECK_SCRIPT_REL] } } }, ctx)
    add([
      check('e2e_04_fixture_mutation_written', written.ok, JSON.stringify(written.error ?? 'ok')),
      check('e2e_05_fixture_validation_passed', validated.ok, JSON.stringify(validated.result ?? validated.error)),
    ])

    // 4. Start a throwaway local HTTP server (never the real installed War Room app).
    const opened = await executeEngineerTool({
      tool: 'terminal.open_session',
      input: {
        cmd: 'node',
        args: ['-e', `require('http').createServer((_,res)=>{res.setHeader('content-type','text/html');res.end('<html><body><h1 id="marker">foundry-proof-ok</h1></body></html>')}).listen(${PROOF_PORT},'127.0.0.1',()=>console.log('LISTENING'))`],
        label: 'foundry-tool-runtime-proof-fixture-server',
      },
    }, ctx)
    httpSessionId = (opened.result as { sessionId?: string } | undefined)?.sessionId
    let serverUp = false
    for (let attempt = 0; attempt < 20 && !serverUp; attempt += 1) {
      await sleep(150)
      serverUp = (await probeHttpPort(`http://127.0.0.1:${PROOF_PORT}/`, 500)).ok
    }
    add([check('e2e_06_fixture_server_up', opened.ok && serverUp, JSON.stringify({ opened: opened.ok, serverUp }))])

    // 5. Real browser automation against the throwaway server — honest fail if unavailable.
    const browserOpened = await executeEngineerTool({ tool: 'browser.open', input: {} }, ctx)
    browserSessionId = (browserOpened.result as { sessionId?: string } | undefined)?.sessionId
    if (browserOpened.ok && browserSessionId) {
      const nav = await executeEngineerTool({ tool: 'browser.navigate', input: { sessionId: browserSessionId, url: `http://127.0.0.1:${PROOF_PORT}/` } }, ctx)
      const found = await executeEngineerTool({ tool: 'browser.find', input: { sessionId: browserSessionId, selector: '#marker' } }, ctx)
      const foundMatches = (found.result as { matches: { text: string }[] } | undefined)?.matches ?? []
      const shot = await executeEngineerTool({ tool: 'browser.screenshot', input: { sessionId: browserSessionId } }, ctx)
      const shotPath = (shot.result as { path?: string } | undefined)?.path
      const consoleResult = await executeEngineerTool({ tool: 'browser.console', input: { sessionId: browserSessionId } }, ctx)
      add([
        check('e2e_07_browser_navigate', nav.ok, JSON.stringify(nav.error ?? nav.result)),
        check('e2e_08_browser_finds_marker', found.ok && foundMatches.some(m => m.text.includes('foundry-proof-ok')), JSON.stringify(foundMatches)),
        check('e2e_09_browser_screenshot_captured', shot.ok && Boolean(shotPath) && existsSync(shotPath ?? ''), JSON.stringify(shot.result ?? shot.error)),
        check('e2e_10_browser_console_readable', consoleResult.ok, JSON.stringify(consoleResult.error ?? 'ok')),
      ])
    } else {
      add([check('e2e_07_10_browser_automation', false, `browser.open failed honestly: ${browserOpened.error}`)])
    }

    // 6. runtime.health / runtime.verify — read-only, must never start a competing instance.
    const health = await executeEngineerTool({ tool: 'runtime.health', input: {} }, ctx)
    const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, ctx)
    add([
      check('e2e_11_runtime_health_readonly', health.ok, JSON.stringify(health.result)),
      check('e2e_12_runtime_verify_readonly', verify.ok, JSON.stringify(verify.result)),
    ])

    // 7. installer.install — only ever against an isolated tmp/ override, never the real install root.
    const installRoot = path.join(resolveRepoRoot(), FIXTURE_DIR, 'install-root')
    const artifactPath = path.join(resolveRepoRoot(), FIXTURE_DIR, 'fixture.AppImage')
    await writeFile(artifactPath, 'not-a-real-binary')
    const installed = await executeEngineerTool({
      tool: 'installer.install',
      input: { sourceArtifactPath: artifactPath, installRootOverride: installRoot, feature: 'tool-runtime-proof', commanderConfirmed: true },
    }, ctx)
    const installDir = (installed.result as { installDir?: string } | undefined)?.installDir
    const stampExists = Boolean(installDir) && existsSync(path.join(installDir ?? '', 'INSTALL_STAMP.json'))
    const realOptUntouched = !installDir || !installDir.startsWith(path.join(process.env.HOME ?? '', '.local', 'opt'))
    add([check('e2e_13_installer_install_isolated_to_tmp', installed.ok && stampExists && realOptUntouched, JSON.stringify({ installDir, stampExists, realOptUntouched }))])

    // 8. Audit ledger actually grew.
    const auditAfter = await readAuditTail()
    add([check('e2e_14_audit_ledger_advanced', auditAfter !== null && auditAfter.hash !== auditBefore?.hash, JSON.stringify({ before: auditBefore?.hash, after: auditAfter?.hash }))])
  } finally {
    // 9. Always clean up — success or failure.
    if (browserSessionId) await executeEngineerTool({ tool: 'browser.close', input: { sessionId: browserSessionId } }, ctx)
    // The browser is a persistent, long-lived service (PASS 003) — stop it explicitly or this
    // process never exits.
    await executeEngineerTool({ tool: 'browser.stop', input: {} }, ctx)
    if (httpSessionId) await executeEngineerTool({ tool: 'terminal.session_kill', input: { sessionId: httpSessionId } }, ctx)
    await removeFixtures()
  }

  const failed = results.filter(r => !r.pass)
  console.log(`Foundry tool-runtime acceptance proof: ${results.length - failed.length}/${results.length} PASS`)
  process.exit(failed.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryBrokerExtensionProof }
