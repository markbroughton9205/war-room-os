/**
 * Live ENABLED routing proof: one routine Qwen path and one hard Composer path
 * through the unified FRK loop. Fresh disposable tasks. No HOLDS/EVENTS/CENTS.
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { CursorAgentProvider } from './cursorAgentProvider'
import { configuredFoundryModels } from './foundryModelProviders'
import { FoundryModelRouter } from './foundryModelRouter'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'
import { enableCapabilityAwareRouting, getCapabilityAwareRoutingMode, STORED_DEFAULT_POLICY } from './foundryWorkerRouting'
import { liveRouteOptionsFromLoop, startUnifiedStandaloneMission, type UnifiedLoopHost } from './foundryFrkStandaloneUnification'
import { runEnabledRoutingFixtures } from './foundryCapabilityAwareRoutingEnabled.validation'
import type { FoundryModelContext } from './foundryModelTypes'

const local = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => item.historicalReliability === 'RELIABLE')!
const remote = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => !item.local && item.rootCauseStatus === 'SUPPORTED')!

function probeContext(missionId: string, goal: string): FoundryModelContext {
  return {
    missionId,
    missionKind: 'fixture',
    userRequest: goal,
    goal,
    successCriteria: ['Return a structured decision. Do not edit a repository.'],
    constraints: ['Do not commit, push, deploy, or spend.'],
    permissions: {
      filesystem: false,
      terminal: false,
      browser: false,
      computerUse: false,
      tests: false,
      lint: false,
      typecheck: false,
      build: false,
      package: false,
      installProduction: false,
      activateInstall: false,
      installedRuntimeControl: false,
      process: false,
      commit: false,
      push: false,
      liveDeploy: false,
      internetResearch: false,
    },
    phase: 'PLANNING',
    plan: [],
    hypotheses: [],
    changedFiles: [],
    importantFindings: [],
    relevantExcerpts: [],
    visualEvidence: [],
    recentToolResults: [],
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: ['worker interface'], detail: 'enabled routing probe' },
    tools: [],
  }
}

async function main(): Promise<void> {
  const fixtures = await runEnabledRoutingFixtures()
  const workspace = mkdtempSync(path.join(tmpdir(), 'wr-route16-live-'))
  const prevC = process.env.FOUNDRY_CONTRACTS_ROOT
  const prevR = process.env.FRK_REASONING_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = path.join(workspace, 'contracts')
  process.env.FRK_REASONING_ROOT = path.join(workspace, 'frk')
  mkdirSync(process.env.FOUNDRY_CONTRACTS_ROOT, { recursive: true })
  mkdirSync(process.env.FRK_REASONING_ROOT, { recursive: true })
  enableCapabilityAwareRouting({ mission: 'MISSION_16_LIVE' })
  const configured = await configuredFoundryModels()
  const models = configured.some(item => item.provider === remote.provider && item.model === remote.model)
    ? configured
    : [...configured, new CursorAgentProvider(remote.model)]
  const router = new FoundryModelRouter(models)
  try {
    const routineHost: UnifiedLoopHost = {
      missionId: `m16-live-routine-${Date.now()}`,
      goal: 'Rename a disposable local label on an unused glass.',
      userRequest: 'Routine R0 task. State that an unused glass is empty. Return REPLAN.',
      createdAt: new Date().toISOString(),
      observations: [],
    }
    const routine = await startUnifiedStandaloneMission({
      mission: routineHost,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: routineHost.goal || 'routine',
      acceptance: ['local worker selected'],
      routing: { remotePermitted: true, forceDepth: 'R0', forceAmbiguity: 'low', taskFamily: 'FEATURE_EXTENSION' },
    })
    const routineOpts = liveRouteOptionsFromLoop(routine)
    const routineCall = await router.route('reasonMission', {
      kind: 'reasonMission',
      context: probeContext(routine.mission.missionId, 'An unused glass is empty. Return REPLAN.'),
    }, {
      missionId: routineOpts.missionId,
      pinProvider: routineOpts.pinProvider as 'ollama' | 'cursor-agent' | null,
      pinModel: routineOpts.pinModel,
    })

    const hardHost: UnifiedLoopHost = {
      missionId: `m16-live-hard-${Date.now()}`,
      goal: 'A shared cache returns a stale label after a writer updates a different key. Diagnose the root cause.',
      userRequest: 'Hard ambiguity. Do not reuse HOLDS, EVENTS, or CENTS.',
      createdAt: new Date().toISOString(),
      observations: [],
    }
    const hard = await startUnifiedStandaloneMission({
      mission: hardHost,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: hardHost.goal || 'hard',
      acceptance: ['strong worker selected'],
      routing: {
        remotePermitted: true,
        forceDepth: 'R3',
        forceAmbiguity: 'high',
        forceFamilies: ['AMBIGUITY_RESOLUTION', 'ROOT_CAUSE_DIAGNOSIS'],
      },
    })
    const hardOpts = liveRouteOptionsFromLoop(hard)
    const hardCall = await router.route('reasonMission', {
      kind: 'reasonMission',
      context: probeContext(hard.mission.missionId, 'Shared cache stale label after a writer updates a different key. Return REPLAN.'),
    }, {
      missionId: hardOpts.missionId,
      pinProvider: hardOpts.pinProvider as 'ollama' | 'cursor-agent' | null,
      pinModel: hardOpts.pinModel,
    })

    const qwenPass = routine.actualWorker.provider === local.provider && routineCall.response.ok && routineCall.selectedProvider === local.provider
    const composerPass = hard.actualWorker.provider === remote.provider && hardCall.response.ok && hardCall.selectedProvider === remote.provider
    const payload = {
      ok: fixtures.every(item => item.pass) && qwenPass && composerPass && getCapabilityAwareRoutingMode() === 'ENABLED',
      mode: getCapabilityAwareRoutingMode(),
      policy: STORED_DEFAULT_POLICY,
      routine: {
        recommended: `${routine.routingDecision?.selectedProvider}/${routine.routingDecision?.selectedModel}`,
        actual: `${routine.actualWorker.provider}/${routine.actualWorker.model}`,
        applied: routine.routingDecision?.appliedToLiveRoute === true,
        worker: `${routineCall.selectedProvider}/${routineCall.selectedModel}`,
        ok: routineCall.response.ok,
      },
      hard: {
        recommended: `${hard.routingDecision?.selectedProvider}/${hard.routingDecision?.selectedModel}`,
        actual: `${hard.actualWorker.provider}/${hard.actualWorker.model}`,
        applied: hard.routingDecision?.appliedToLiveRoute === true,
        worker: `${hardCall.selectedProvider}/${hardCall.selectedModel}`,
        ok: hardCall.response.ok,
        error: hardCall.response.ok ? null : hardCall.response.error,
      },
      fixtures: fixtures.filter(item => !item.pass),
    }
    const out = path.join(resolveRepoRoot(), 'tmp/foundry-capability-aware-routing-enabled/live.json')
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(payload, null, 2))
    console.log(JSON.stringify(payload, null, 2))
    if (!payload.ok) process.exit(1)
  } finally {
    if (prevC === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = prevC
    if (prevR === undefined) delete process.env.FRK_REASONING_ROOT
    else process.env.FRK_REASONING_ROOT = prevR
    rmSync(workspace, { recursive: true, force: true })
  }
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
