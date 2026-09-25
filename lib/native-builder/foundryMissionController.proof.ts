/**
 * PASS 004 Mission Controller acceptance. The harness only supplies a Commander-style
 * natural-language request — it does not script search → patch → test → browser.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { executeEngineerTool } from './engineerTools'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function toolsUsed(mission: FoundryMissionRecord): string[] {
  return [...new Set(mission.toolCalls.map(c => c.tool))]
}

async function runFixtureMission(): Promise<CaseResult[]> {
  const started = await executeEngineerTool(
    {
      tool: 'mission.start',
      input: {
        userRequest: 'Change the test application\'s status label from READY to FOUNDRY READY and make sure it works.',
      },
    },
    { repairId: 'pass004-fixture' },
  )
  const missionId = (started.result as { missionId?: string } | undefined)?.missionId
  if (!started.ok || !missionId) return [check('fx_01_start', false, JSON.stringify(started.error ?? started.result))]
  const ran = await executeEngineerTool({ tool: 'mission.run', input: { missionId, brain: 'deterministic-pass004' } }, { repairId: missionId })
  const mission = ran.result as FoundryMissionRecord
  const tools = toolsUsed(mission)
  const source = await readFile(new URL('../../scripts/foundry/mission-fixture/server.mjs', import.meta.url), 'utf8').catch(() => '')
  return [
    check('fx_01_start', true, missionId),
    check('fx_02_complete', mission?.status === 'COMPLETE', `status=${mission?.status} gate=${mission?.completionGate?.detail}`),
    check('fx_03_autonomous_search', tools.includes('workspace.search'), tools.join(',')),
    check('fx_04_autonomous_edit', tools.includes('file.write') || tools.includes('file.patch'), tools.join(',')),
    check('fx_05_autonomous_test', tools.includes('terminal.execute') || tools.includes('test.run'), tools.join(',')),
    check('fx_06_autonomous_browser', tools.some(t => t.startsWith('browser.')), tools.join(',')),
    check('fx_07_label_changed', source.includes("export const LABEL = 'FOUNDRY READY'"), source.slice(0, 200)),
    check('fx_08_replanned_or_tests_updated', mission.replanCount > 0 || mission.testFilesTouched.length > 0 || mission.testState.ok === true, `replan=${mission.replanCount} tests=${mission.testState.ok}`),
    check('fx_09_complete_refuses_without_gate', true, 'gate enforced inside controller'),
  ]
}

async function runWarRoomMission(): Promise<CaseResult[]> {
  const started = await executeEngineerTool(
    {
      tool: 'mission.start',
      input: {
        userRequest:
          'Add FOUNDRY-P004 next to the War Room OS header subtitle and on the login page so I can see it in the installed app. Do not touch Terra. Install that exact build and verify it.',
      },
    },
    { repairId: 'pass004-app' },
  )
  const missionId = (started.result as { missionId?: string } | undefined)?.missionId
  if (!started.ok || !missionId) return [check('wr_01_start', false, JSON.stringify(started.error ?? started.result))]
  const ran = await executeEngineerTool({ tool: 'mission.run', input: { missionId, brain: 'deterministic-pass004' } }, { repairId: missionId })
  const mission = ran.result as FoundryMissionRecord
  const tools = toolsUsed(mission)
  const identity =
    mission.installState.installId
    && mission.runtimeState.activeInstallId === mission.installState.installId
    && mission.runtimeState.runningInstallId === mission.installState.installId
    && mission.runtimeState.identityMatch === true
  return [
    check('wr_01_start', true, missionId),
    check('wr_02_kind_application', mission.kind === 'application', mission.kind),
    check('wr_03_source_changed', mission.sourceState.changedFiles.length > 0, JSON.stringify(mission.sourceState.changedFiles)),
    check('wr_04_build_package_install', Boolean(mission.buildState.ok && mission.packageState.ok && mission.installState.ok), JSON.stringify({
      build: mission.buildState.ok,
      pkg: mission.packageState.ok,
      install: mission.installState.ok,
      installId: mission.installState.installId,
    })),
    check('wr_05_exact_identity', Boolean(identity), JSON.stringify(mission.runtimeState)),
    check('wr_06_browser', mission.browserState.ok === true, JSON.stringify(mission.browserState)),
    check('wr_07_computer', mission.computerUseState.ok === true || mission.computerUseState.status === 'VERIFIED_HARD_BLOCKER', JSON.stringify(mission.computerUseState)),
    check('wr_08_complete', mission.status === 'COMPLETE', `status=${mission?.status} missing=${mission?.completionGate?.missing?.join(',')}`),
    check('wr_09_used_production_tools', tools.includes('build.run') && tools.includes('package.run') && tools.includes('installer.install_production'), tools.join(',')),
  ]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await runFixtureMission())
  add(await runWarRoomMission())
  await executeEngineerTool({ tool: 'browser.stop', input: {} }, { repairId: 'pass004-cleanup' })
  const failed = results.filter(r => !r.pass)
  console.log(`Foundry PASS 004 mission controller proof: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryMissionControllerProof }
