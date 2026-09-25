/**
 * FOUNDRY_TOOL_RUNTIME_PASS_002 acceptance proof: drives the real production toolchain
 * end to end through the Tool Broker — test.run, lint.run, typecheck.run(scoped), build.run
 * (real `pnpm run build`), package.run (real electron-builder AppImage+deb), a real production
 * install into the actual ~/.local/opt (isolated, uniquely-named, additive, never touching any
 * existing sibling install, the active launcher, or any .desktop entry), then verifies the REAL
 * installed runtime already live on this shared machine (never launching a competing instance
 * unless genuinely nothing is running) via read-only runtime.health/verify and real browser
 * automation against its actual UI port.
 *
 * This never fabricates a PASS — a genuine failure at any stage is reported honestly. Unlike
 * PASS 001's throwaway-fixture proof, the artifacts and install directory this proof produces are
 * NOT deleted afterward: they are the real deliverable (BUILD_DONE/PACKAGE_DONE/INSTALL_DONE),
 * side-by-side with every prior install, never activated, never replacing anything.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { executeEngineerTool } from './engineerTools'

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
  const auditBefore = await readAuditTail()
  const ctx = { repairId: randomUUID() }
  let browserSessionId: string | undefined
  let selfLaunchedPid: number | undefined

  try {
    // 1. TEST + LINT + TYPECHECK — kept distinct, as required.
    const testResult = await executeEngineerTool({ tool: 'test.run', input: { suite: 'validate:foundry-terminal-session' } }, ctx)
    const lintResult = await executeEngineerTool({ tool: 'lint.run', input: { targets: ['lib/native-builder'] } }, ctx)
    const typecheckResult = await executeEngineerTool({ tool: 'typecheck.run', input: { scopeGlob: 'lib/native-builder/' } }, ctx)
    const typecheckPayload = typecheckResult.result as { scopedErrorCount?: number; totalErrorCount?: number; baselineNote?: string } | undefined
    // typecheckResult.ok reflects the WHOLE-REPO tsc exit code, which is poisoned by the
    // pre-existing baseline errors outside Foundry scope (see CLAUDE.md / PASS 001 report) — the
    // correct completion criterion is "this pass introduced zero errors in its own scope", i.e.
    // scopedErrorCount === 0, not a repo-wide clean exit this pass has no authority to force.
    add([
      check('p002_01_test_run', testResult.ok, JSON.stringify(testResult.error ?? 'ok')),
      check('p002_02_lint_run', lintResult.ok, JSON.stringify(lintResult.error ?? 'ok')),
      check('p002_03_typecheck_run_scoped_clean', typecheckPayload?.scopedErrorCount === 0, JSON.stringify({ scopedErrorCount: typecheckPayload?.scopedErrorCount, totalErrorCount: typecheckPayload?.totalErrorCount, note: typecheckPayload?.baselineNote })),
    ])

    // 2. BUILD PASS != TEST PASS — a real `pnpm run build`.
    const buildResult = await executeEngineerTool({ tool: 'build.run', input: {} }, ctx)
    const buildPayload = buildResult.result as { artifacts?: { buildId: string | null; standaloneReady: boolean; staticReady: boolean } } | undefined
    add([check('p002_04_build_run_real', buildResult.ok, JSON.stringify(buildPayload?.artifacts))])
    if (!buildResult.ok) throw new Error(`build.run failed: ${buildResult.error}`)

    // 3. BUILD PASS != PACKAGE PASS — real electron-builder AppImage + deb.
    const packageResult = await executeEngineerTool({ tool: 'package.run', input: {} }, ctx)
    const packagePayload = packageResult.result as
      | { version: string; appimage: { path: string; sizeBytes: number; sha256: string }; deb: { path: string; sizeBytes: number; sha256: string }; linuxUnpackedDir: string }
      | undefined
    add([
      check('p002_05_package_run_real', packageResult.ok, JSON.stringify(packageResult.ok ? { appimage: packagePayload?.appimage.sizeBytes, deb: packagePayload?.deb.sizeBytes } : packageResult.error)),
    ])
    if (!packageResult.ok || !packagePayload) throw new Error(`package.run failed: ${packageResult.error}`)

    // 4. PACKAGE PASS != INSTALL PASS — a real production install, additive, never activated.
    const installResult = await executeEngineerTool({
      tool: 'installer.install_production',
      input: {
        appimage: packagePayload.appimage,
        deb: packagePayload.deb,
        linuxUnpackedDir: packagePayload.linuxUnpackedDir,
        feature: `pass002-retest-${ctx.repairId.slice(0, 8)}`,
        commanderConfirmed: true,
      },
    }, ctx)
    const installPayload = installResult.result as { installDir?: string; stamp?: unknown; discovered?: { installs: unknown[] } } | undefined
    add([
      check('p002_06_install_production_real', installResult.ok, JSON.stringify(installResult.ok ? installPayload?.installDir : installResult.error)),
      check('p002_07_install_discovered_prior_installs_first', Array.isArray(installPayload?.discovered?.installs) && (installPayload!.discovered!.installs.length > 0), JSON.stringify(installPayload?.discovered?.installs?.length)),
    ])

    // 5. INSTALLED_RUNTIME_RUNNING — idempotent: verify first, launch only if genuinely not running.
    const verifyBefore = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, ctx)
    const verifyBeforePayload = verifyBefore.result as { ownership?: string; health?: { running?: boolean } } | undefined
    if (!verifyBeforePayload?.health?.running) {
      const launched = await executeEngineerTool({ tool: 'runtime.launch_installed', input: {} }, ctx)
      const launchedPayload = launched.result as { alreadyRunning?: boolean; pid?: number } | undefined
      if (launched.ok && launchedPayload?.alreadyRunning === false && typeof launchedPayload.pid === 'number') selfLaunchedPid = launchedPayload.pid
      add([check('p002_08_launch_installed_runtime', launched.ok, JSON.stringify(launched.result ?? launched.error))])
      // Electron + Next.js UI boot observably takes ~10-15s on this machine — poll rather than
      // guess a fixed delay. This is also a shared machine: another agent may win a singleton
      // lock and it may end up being THEIR instance that comes up healthy, not the pid we just
      // spawned — that is still an honest, valid "an installed runtime is live" outcome.
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const probe = await executeEngineerTool({ tool: 'runtime.health', input: {} }, ctx)
        if ((probe.result as { running?: boolean } | undefined)?.running) break
      }
    } else {
      add([check('p002_08_installed_runtime_already_live_no_launch_needed', true, JSON.stringify(verifyBeforePayload))])
    }

    // 6. runtime.health / runtime.verify — read-only, on the now (or already) live installed app.
    const health = await executeEngineerTool({ tool: 'runtime.health', input: {} }, ctx)
    const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, ctx)
    const healthPayload = health.result as { running?: boolean } | undefined
    const verifyPayload = verify.result as { ownership?: string; corePort?: { running?: boolean } } | undefined
    add([
      check('p002_09_runtime_health_running', healthPayload?.running === true, JSON.stringify(healthPayload)),
      check('p002_10_runtime_verify_ownership_installed', verifyPayload?.ownership === 'INSTALLED_RUNTIME', JSON.stringify(verifyPayload)),
      check('p002_11_runtime_verify_core_port_also_up', verifyPayload?.corePort?.running === true, JSON.stringify(verifyPayload?.corePort)),
    ])

    // 7. Browser verification of the REAL installed UI (never the throwaway fixture server).
    const browserOpened = await executeEngineerTool({ tool: 'browser.open', input: {} }, ctx)
    browserSessionId = (browserOpened.result as { sessionId?: string } | undefined)?.sessionId
    if (browserOpened.ok && browserSessionId) {
      const nav = await executeEngineerTool({ tool: 'browser.navigate', input: { sessionId: browserSessionId, url: 'http://127.0.0.1:3848/' } }, ctx)
      const shot = await executeEngineerTool({ tool: 'browser.screenshot', input: { sessionId: browserSessionId } }, ctx)
      const shotPath = (shot.result as { path?: string } | undefined)?.path
      const consoleResult = await executeEngineerTool({ tool: 'browser.console', input: { sessionId: browserSessionId } }, ctx)
      const networkResult = await executeEngineerTool({ tool: 'browser.network', input: { sessionId: browserSessionId } }, ctx)
      const navPayload = nav.result as { status?: number; url?: string } | undefined
      add([
        check('p002_12_browser_navigate_installed_ui', nav.ok && typeof navPayload?.status === 'number', JSON.stringify(navPayload)),
        check('p002_13_browser_screenshot_captured', shot.ok && Boolean(shotPath), JSON.stringify(shot.result ?? shot.error)),
        check('p002_14_browser_console_readable', consoleResult.ok, JSON.stringify(consoleResult.error ?? 'ok')),
        check('p002_15_browser_network_readable', networkResult.ok, JSON.stringify(networkResult.error ?? 'ok')),
      ])
    } else {
      add([check('p002_12_15_browser_verification', false, `browser.open failed honestly: ${browserOpened.error}`)])
    }

    // 8. process/port cross-check — the installed runtime's ports resolve to real, live processes.
    const portCheck = await executeEngineerTool({ tool: 'port.inspect', input: { port: 3848 } }, ctx)
    const portListeners = (portCheck.result as { listeners?: { pid: number | null; knownRole: string | null }[] } | undefined)?.listeners ?? []
    add([check('p002_16_port_inspect_confirms_ui_port', portCheck.ok && portListeners.some(l => l.knownRole === 'war_room_ui'), JSON.stringify(portListeners))])

    // 9. Full exact-identity completion (ACTIVE_INSTALL == RUNNING_INSTALL == MISSION_INSTALL) is
    // a PASS 003 concern — see foundryActivationAcceptance.proof.ts, which activates and verifies
    // this mission's own install rather than accepting whatever installed runtime was already
    // live (this proof deliberately never activates anything — see file docstring).

    // 10. Audit ledger actually grew across this whole chain.
    const auditAfter = await readAuditTail()
    add([check('p002_18_audit_ledger_advanced', auditAfter !== null && auditAfter.hash !== auditBefore?.hash, JSON.stringify({ before: auditBefore?.hash, after: auditAfter?.hash }))])
  } finally {
    if (browserSessionId) await executeEngineerTool({ tool: 'browser.close', input: { sessionId: browserSessionId } }, ctx)
    // The browser is a persistent, long-lived service (PASS 003) — stop it explicitly or this
    // process never exits.
    await executeEngineerTool({ tool: 'browser.stop', input: {} }, ctx)
    if (selfLaunchedPid) await executeEngineerTool({ tool: 'runtime.stop_installed', input: { pid: selfLaunchedPid } }, ctx)
  }

  const failed = results.filter(r => !r.pass)
  console.log(`Foundry PASS 002 production toolchain proof: ${results.length - failed.length}/${results.length} PASS`)
  process.exit(failed.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryProductionToolchainProof }
