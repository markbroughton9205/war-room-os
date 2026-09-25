/**
 * PASS 005 live proof. This harness provides only natural-language missions and assertions.
 * It does not select tools, encode a tool sequence, or substitute a deterministic test brain.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { startMission, runModelMission } from './foundryMissionController'
import { configuredFoundryModels } from './foundryModelProviders'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function naturalMission(request: string): Promise<FoundryMissionRecord> {
  const created = await startMission(request)
  return runModelMission(created.missionId)
}

async function run() {
  const configured = await configuredFoundryModels()
  if (!configured.length) {
    console.error('BLOCKED p005_live_model No configured real Foundry model. Configure Ollama, a Council provider, or FOUNDRY_OPENAI_COMPATIBLE_* and rerun.')
    process.exit(2)
  }
  console.log(`MODEL ${configured[0].provider}/${configured[0].model ?? 'auto'}`)
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const result of batch) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }

  const toolChoice = await naturalMission('The controlled model-tool-choice fixture page is showing ALPHA. Change it to OMEGA, run its real test, launch it, and visually verify OMEGA.')
  const toolSource = await readFile('scripts/foundry/model-tool-choice/app.mjs', 'utf8')
  const toolNames = toolChoice.toolCalls.map(call => call.tool)
  add([
    check('p005_model_01_complete', toolChoice.status === 'COMPLETE', toolChoice.status),
    check(
      'p005_model_02_tool_choice',
      ['workspace.search', 'file.read', 'process.start', 'browser.screenshot'].every(name => toolNames.includes(name))
        && toolNames.some(name => name === 'file.write' || name === 'file.patch')
        && toolNames.some(name => name === 'terminal.execute' || name === 'test.run'),
      [...new Set(toolNames)].join(','),
    ),
    check('p005_model_03_omega', toolSource.includes("'OMEGA'") && toolChoice.browserState.ok === true, toolChoice.browserState.detail ?? ''),
  ])

  const replan = await naturalMission('Fix the model-replan fixture so its visible status says FIXED. A clue claims theme-clue.mjs controls it, but verify that hypothesis from actual imports and runtime evidence. Record rejection if false, then test and visually verify the fix.')
  const rejected = (replan.hypotheses ?? []).some(hypothesis => hypothesis.status === 'REJECTED' && hypothesis.evidenceAgainst.length > 0)
  const replacement = (replan.hypotheses ?? []).some(hypothesis => hypothesis.status === 'SUPPORTED' || hypothesis.status === 'CONFIRMED')
  add([
    check('p005_replan_01_complete', replan.status === 'COMPLETE', replan.status),
    check('p005_replan_02_rejected', rejected, JSON.stringify(replan.hypotheses)),
    check('p005_replan_03_new_hypothesis', replacement && replan.replanCount > 0, `replans=${replan.replanCount}`),
  ])

  const visual = await naturalMission('The safe War Room visual acceptance fixture contains SYSTEM NOMINAL but it is invisible. Inspect the actual browser state and screenshot, find the source, make the label visibly readable, run its test, relaunch it, and visually verify the corrected result.')
  const visualTools = visual.toolCalls.map(call => call.tool)
  add([
    check('p005_visual_01_complete', visual.status === 'COMPLETE', visual.status),
    check('p005_visual_02_before_after', visualTools.filter(name => name === 'browser.screenshot').length >= 2, visualTools.join(',')),
    check('p005_visual_03_acceptance', visual.browserState.ok === true, visual.browserState.detail ?? ''),
  ])

  const production = await naturalMission('Change the harmless login and War Room header acceptance marker from FOUNDRY-P004 to FOUNDRY-P005. Do not touch Terra. Validate it, build it, package it, install and activate the exact build, transition the installed runtime, then verify it in the browser and through Computer Use.')
  const identity = production.installState.installId
    && production.installState.installId === production.runtimeState.activeInstallId
    && production.installState.installId === production.runtimeState.runningInstallId
    && production.runtimeState.identityMatch === true
  add([
    check('p005_prod_01_complete', production.status === 'COMPLETE', production.status),
    check('p005_prod_02_chain', Boolean(production.buildState.ok && production.packageState.ok && production.installState.ok), production.completionGate.detail),
    check('p005_prod_03_identity', Boolean(identity), JSON.stringify(production.runtimeState)),
    check('p005_prod_04_visual', production.browserState.ok === true && production.computerUseState.status === 'PASS', JSON.stringify({ browser: production.browserState, computer: production.computerUseState })),
    check('p005_prod_05_model_owned', Boolean(production.modelState?.activeProvider && production.modelState.calls > 1), JSON.stringify(production.modelState)),
  ])

  const failed = results.filter(result => !result.pass)
  console.log(`Foundry PASS 005 live model proof: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
