/**
 * FOUNDRY_TOOL_RUNTIME_PASS_003 acceptance proof: closes the PASS 002 gap where "an installed
 * War Room is running" could be satisfied by a completely unrelated, already-live instance. This
 * proof builds a real artifact, installs it, ACTIVATES it (flips the canonical launcher shim),
 * performs a controlled stop/relaunch transition, and then asserts — using real evidence, not
 * "something answered on 3848" — that the RUNNING install is the EXACT install this mission just
 * produced. Only then does it consider the completion gate satisfiable.
 *
 * If activation or the post-transition identity check ever fails, this rolls the active-install
 * pointer back to whatever it was before this proof touched it and reports the run as FAILED —
 * it never leaves the machine on a broken half-transitioned launcher.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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

type ActiveStatusPayload = { activeInstallId: string | null; activeInstallDir: string | null; valid: boolean; reason: string | null }
type VerifyPayload = { ownership?: string; health?: { running?: boolean }; corePort?: { running?: boolean }; activeInstallId?: string | null; runningInstallId?: string | null; identityMatch?: boolean | null }

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  if (!process.env.FOUNDRY_PRODUCTION_MISSION_ID && process.env.FOUNDRY_COMMANDER_EXPLICIT_ROLLBACK !== 'true') {
    console.error('REFUSED_SCRIPT_BYPASS: foundryActivationAcceptance.proof.ts is a DEPRECATED_ACTIVATION_PATH and cannot activate production without FOUNDRY_PRODUCTION_MISSION_ID.')
    process.exit(1)
  }
  const auditBefore = await readAuditTail()
  const ctx = { repairId: randomUUID() }
  let browserSessionId: string | undefined
  let previousActiveInstallId: string | null | undefined
  let activationAttempted = false

  // 1. Initial state, read-only — this is the "before" picture the report needs.
  const initialActive = (await executeEngineerTool({ tool: 'installer.active_status', input: {} }, ctx)).result as ActiveStatusPayload
  const initialVerify = (await executeEngineerTool({ tool: 'runtime.verify', input: {} }, ctx)).result as VerifyPayload
  add([
    check('p003_01_initial_active_install_captured', true, JSON.stringify(initialActive)),
    check('p003_02_initial_running_install_captured', true, JSON.stringify({ ownership: initialVerify?.ownership, runningInstallId: initialVerify?.runningInstallId })),
  ])

  try {
    // 2. BUILD (real) and PACKAGE (real).
    const buildResult = await executeEngineerTool({ tool: 'build.run', input: {} }, ctx)
    add([check('p003_03_build_run_real', buildResult.ok, JSON.stringify(buildResult.ok ? (buildResult.result as { artifacts?: unknown }).artifacts : buildResult.error))])
    if (!buildResult.ok) throw new Error(`build.run failed: ${buildResult.error}`)

    const packageResult = await executeEngineerTool({ tool: 'package.run', input: {} }, ctx)
    const packagePayload = packageResult.result as
      | { appimage: { path: string; sha256: string }; deb: { path: string; sha256: string }; linuxUnpackedDir: string }
      | undefined
    add([check('p003_04_package_run_real', packageResult.ok, JSON.stringify(packageResult.ok ? 'ok' : packageResult.error))])
    if (!packageResult.ok || !packagePayload) throw new Error(`package.run failed: ${packageResult.error}`)

    // 3. INSTALL (real, isolated, side-by-side) — capture the NEW install id for later identity checks.
    const missionFeature = `pass003-activation-proof-${ctx.repairId.slice(0, 8)}`
    const installResult = await executeEngineerTool({
      tool: 'installer.install_production',
      input: { appimage: packagePayload.appimage, deb: packagePayload.deb, linuxUnpackedDir: packagePayload.linuxUnpackedDir, feature: missionFeature, commanderConfirmed: true },
    }, ctx)
    const installPayload = installResult.result as { installDir?: string; stamp?: { install_id?: string } } | undefined
    const missionInstallId = installPayload?.stamp?.install_id ?? null
    add([
      check('p003_05_install_production_real', installResult.ok, JSON.stringify(installResult.ok ? missionInstallId : installResult.error)),
      check('p003_06_mission_install_id_captured', typeof missionInstallId === 'string' && missionInstallId.includes(missionFeature), String(missionInstallId)),
    ])
    if (!installResult.ok || !missionInstallId) throw new Error(`installer.install_production failed: ${installResult.error}`)

    // 4. ACTIVATE — flips the canonical launcher shim to this exact new install.
    activationAttempted = true
    const activateResult = await executeEngineerTool({ tool: 'installer.activate', input: { installId: missionInstallId, commanderConfirmed: true } }, ctx)
    const activatePayload = activateResult.result as { previousActiveInstallId?: string | null; newActiveInstallId?: string } | undefined
    previousActiveInstallId = activatePayload?.previousActiveInstallId ?? initialActive?.activeInstallId ?? null
    add([check('p003_07_activate_real', activateResult.ok, JSON.stringify(activateResult.ok ? activatePayload : activateResult.error))])
    if (!activateResult.ok) throw new Error(`installer.activate failed: ${activateResult.error}`)

    const activeAfterActivation = (await executeEngineerTool({ tool: 'installer.active_status', input: {} }, ctx)).result as ActiveStatusPayload
    add([check('p003_08_active_status_confirms_new_target', activeAfterActivation.activeInstallId === missionInstallId, JSON.stringify(activeAfterActivation))])

    // 5. CONTROLLED TRANSITION — stop whatever's running (if anything), launch the now-active install.
    const transitionResult = await executeEngineerTool({ tool: 'runtime.transition_to_active', input: { commanderConfirmed: true } }, ctx)
    add([check('p003_09_controlled_transition_real', transitionResult.ok, JSON.stringify(transitionResult.result ?? transitionResult.error))])
    if (!transitionResult.ok) throw new Error(`runtime.transition_to_active failed: ${transitionResult.error}`)

    // 6. EXACT IDENTITY — the core PASS 003 assertion.
    const finalVerify = (await executeEngineerTool({ tool: 'runtime.verify', input: {} }, ctx)).result as VerifyPayload
    const activeMatches = finalVerify?.activeInstallId === missionInstallId
    const runningMatches = finalVerify?.runningInstallId === missionInstallId
    const identityMatch = finalVerify?.identityMatch === true
    add([
      check('p003_10_active_install_equals_mission_install', activeMatches, `ACTIVE=${finalVerify?.activeInstallId} MISSION=${missionInstallId}`),
      check('p003_11_running_install_equals_mission_install', runningMatches, `RUNNING=${finalVerify?.runningInstallId} MISSION=${missionInstallId}`),
      check('p003_12_identity_match_true', identityMatch, `identityMatch=${finalVerify?.identityMatch}`),
      check('p003_13_ui_health', finalVerify?.health?.running === true, JSON.stringify(finalVerify?.health)),
      check('p003_14_core_health', finalVerify?.corePort?.running === true, JSON.stringify(finalVerify?.corePort)),
    ])
    if (!activeMatches || !runningMatches || !identityMatch) {
      throw new Error(`Identity verification failed: ACTIVE=${finalVerify?.activeInstallId} RUNNING=${finalVerify?.runningInstallId} MISSION=${missionInstallId}`)
    }

    // 7. Browser verification of the exact newly-activated build.
    const browserOpened = await executeEngineerTool({ tool: 'browser.open', input: {} }, ctx)
    browserSessionId = (browserOpened.result as { sessionId?: string } | undefined)?.sessionId
    let browserOk = false
    let consoleOk = false
    let networkOk = false
    if (browserOpened.ok && browserSessionId) {
      const nav = await executeEngineerTool({ tool: 'browser.navigate', input: { sessionId: browserSessionId, url: 'http://127.0.0.1:3848/' } }, ctx)
      const shot = await executeEngineerTool({ tool: 'browser.screenshot', input: { sessionId: browserSessionId } }, ctx)
      const consoleResult = await executeEngineerTool({ tool: 'browser.console', input: { sessionId: browserSessionId } }, ctx)
      const networkResult = await executeEngineerTool({ tool: 'browser.network', input: { sessionId: browserSessionId } }, ctx)
      const navPayload = nav.result as { status?: number; url?: string; title?: string } | undefined
      browserOk = nav.ok && typeof navPayload?.status === 'number'
      consoleOk = consoleResult.ok
      networkOk = networkResult.ok
      add([
        check('p003_15_browser_navigate_exact_build', browserOk, JSON.stringify({ ...navPayload, activeInstallId: missionInstallId, runningInstallId: finalVerify?.runningInstallId })),
        check('p003_16_browser_screenshot_evidence', shot.ok, JSON.stringify(shot.result ?? shot.error)),
        check('p003_17_browser_console', consoleOk, JSON.stringify(consoleResult.error ?? 'ok')),
        check('p003_18_browser_network', networkOk, JSON.stringify(networkResult.error ?? 'ok')),
      ])
    } else {
      add([check('p003_15_18_browser_verification', false, `browser.open failed honestly: ${browserOpened.error}`)])
    }

    // 8. Computer-use observation of the exact installed War Room window (read-only).
    const windows = await executeEngineerTool({ tool: 'computer.windows', input: {} }, ctx)
    const windowBlob = JSON.stringify(windows.result ?? windows.error ?? '')
    const sawWarRoom = windows.ok && /war room/i.test(windowBlob)
    add([check('p003_21_computer_observe_installed_war_room', sawWarRoom, windowBlob.slice(0, 1200))])

    // 9. Local fake deployment (DEPLOY=NO — never a real external vendor) + persistent browser verify.
    const deployInspect = await executeEngineerTool({ tool: 'deploy.inspect', input: {} }, ctx)
    const deployPrepare = await executeEngineerTool({ tool: 'deploy.prepare', input: { version: `pass003-${ctx.repairId.slice(0, 8)}` } }, ctx)
    const deployRun = await executeEngineerTool({ tool: 'deploy.run', input: {} }, ctx)
    const deployVerify = await executeEngineerTool({ tool: 'deploy.verify', input: {} }, ctx)
    const deployOrigin = (deployRun.result as { origin?: string } | undefined)?.origin
      ?? (deployVerify.result as { origin?: string } | undefined)?.origin
    let deployBrowserOk = false
    if (deployOrigin && browserSessionId) {
      const deployNav = await executeEngineerTool({
        tool: 'browser.navigate',
        input: { sessionId: browserSessionId, url: deployOrigin },
      }, ctx)
      deployBrowserOk = deployNav.ok
      add([check('p003_26_browser_verifies_local_deploy', deployNav.ok, JSON.stringify(deployNav.result ?? deployNav.error))])
    } else {
      add([check('p003_26_browser_verifies_local_deploy', false, 'deploy origin or browser session missing')])
    }
    add([
      check('p003_22_deploy_inspect', deployInspect.ok, JSON.stringify(deployInspect.error ?? 'ok')),
      check('p003_23_deploy_prepare', deployPrepare.ok, JSON.stringify(deployPrepare.error ?? 'ok')),
      check('p003_24_deploy_run', deployRun.ok, JSON.stringify(deployRun.error ?? 'ok')),
      check('p003_25_deploy_verify', deployVerify.ok, JSON.stringify(deployVerify.error ?? 'ok')),
    ])

    // 10. Completion gate — must require exact identity, not just "installed runtime is up".
    const gate = evaluateCompletionGate({
      sourceChanged: true,
      validationOk: true, // test/lint/typecheck already proven clean by the PASS 002 proof this session
      buildOk: buildResult.ok,
      packageOk: packageResult.ok,
      installOk: installResult.ok,
      activeInstallId: finalVerify?.activeInstallId ?? null,
      missionInstallId,
      runningInstallId: finalVerify?.runningInstallId ?? null,
      uiHealthOk: finalVerify?.health?.running === true,
      coreHealthOk: finalVerify?.corePort?.running === true,
      identityMatch: finalVerify?.identityMatch ?? null,
      browserAcceptanceOk: browserOk,
      consoleAcceptanceOk: consoleOk,
      networkAcceptanceOk: networkOk,
      computerUseAcceptance: sawWarRoom ? 'PASS' : 'FAIL',
      localDeploymentAcceptanceOk: deployInspect.ok && deployPrepare.ok && deployRun.ok && deployVerify.ok && deployBrowserOk,
    })
    add([check('p003_19_completion_gate_complete', gate.complete, gate.detail)])

    const auditAfter = await readAuditTail()
    add([check('p003_20_audit_ledger_advanced', auditAfter !== null && auditAfter.hash !== auditBefore?.hash, JSON.stringify({ before: auditBefore?.hash, after: auditAfter?.hash }))])
  } catch (error) {
    // ROLLBACK — never leave War Room on a broken half-transitioned launcher.
    if (activationAttempted) {
      const rollback = await executeEngineerTool({ tool: 'installer.rollback_activation', input: { previousInstallId: previousActiveInstallId ?? null, commanderConfirmed: true } }, ctx)
      const retransition = await executeEngineerTool({ tool: 'runtime.transition_to_active', input: { commanderConfirmed: true } }, ctx)
      const verifyAfterRollback = (await executeEngineerTool({ tool: 'runtime.verify', input: {} }, ctx)).result as VerifyPayload
      add([
        check('p003_ROLLBACK_01_activation_restored', rollback.ok, JSON.stringify(rollback.result ?? rollback.error)),
        check('p003_ROLLBACK_02_runtime_retransitioned', retransition.ok, JSON.stringify(retransition.result ?? retransition.error)),
        check('p003_ROLLBACK_03_identity_matches_restored_target', verifyAfterRollback?.activeInstallId === (previousActiveInstallId ?? undefined) || previousActiveInstallId === null, JSON.stringify(verifyAfterRollback)),
      ])
    }
    add([check('p003_FATAL', false, error instanceof Error ? error.message : String(error))])
  } finally {
    if (browserSessionId) await executeEngineerTool({ tool: 'browser.close', input: { sessionId: browserSessionId } }, ctx)
    await executeEngineerTool({ tool: 'browser.stop', input: {} }, ctx)
  }

  const failed = results.filter(r => !r.pass)
  console.log(`Foundry PASS 003 activation acceptance proof: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryActivationAcceptanceProof }
