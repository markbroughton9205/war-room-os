/**
 * One disposable two-worker interface proof.
 * Does not rerun the reasoning suite and does not change stored policy.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { CursorAgentProvider } from './cursorAgentProvider'
import { configuredFoundryModels } from './foundryModelProviders'
import { applyFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { runCapabilityRoutingFixtures } from './foundryCapabilityAwareRouting.validation'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'
import { getCapabilityAwareRoutingMode, STORED_DEFAULT_POLICY } from './foundryWorkerRouting'
import { buildWorkerRequest, dispatchReasoningWorker } from './reasoning-kernel/worker'
import type { FoundryModelContext } from './foundryModelTypes'

function context(): FoundryModelContext {
  const goal = 'Disposable routing probe. State that an unused glass is empty. Return REPLAN and do not request a tool.'
  return {
    missionId: 'capability-routing-live-probe',
    missionKind: 'fixture',
    userRequest: goal,
    goal,
    successCriteria: ['The worker returns a structured decision through the shared interface.'],
    constraints: ['Do not commit, push, deploy, spend, or edit a repository.'],
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
    completionGate: { complete: false, missing: ['worker interface'], detail: 'disposable worker swap' },
    tools: [],
  }
}

function redact(error: string): string {
  return error.replace(/\$\d[\d,]*/g, '$[redacted]').replace(/usage limit[^.]* /gi, 'usage limit ').slice(0, 400)
}

async function callWorker(provider: string, model: string, models: Awaited<ReturnType<typeof configuredFoundryModels>>) {
  const request = buildWorkerRequest({
    requestId: `swap-${provider}`,
    missionId: 'capability-routing-live-probe',
    task: 'understand',
    problem: 'An unused glass is empty.',
    constraints: ['Do not edit files.'],
    evidenceSummaries: [],
  })
  const started = Date.now()
  const routed = await dispatchReasoningWorker({
    request,
    context: context(),
    pin: { provider, model },
    models,
    signal: AbortSignal.timeout(200_000),
  })
  return { routed, elapsedMs: Date.now() - started }
}

function git(command: string): string {
  return execSync(command, { cwd: resolveRepoRoot(), encoding: 'utf8' }).trim()
}

async function main(): Promise<void> {
  const fixtures = runCapabilityRoutingFixtures()
  const local = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => item.historicalReliability === 'RELIABLE')!
  const remote = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => !item.local && item.rootCauseStatus === 'SUPPORTED')!
  const configured = await configuredFoundryModels()
  const models = configured.some(item => item.provider === remote.provider && item.model === remote.model)
    ? configured
    : [...configured, new CursorAgentProvider(remote.model)]
  const qwen = await callWorker(local.provider, local.model, models)
  const composer = qwen.routed.ok ? await callWorker(remote.provider, remote.model, models) : null
  const policy = applyFoundryRuntimeConfig().providerPolicy
  const qwenPass = qwen.routed.ok && qwen.routed.provider === local.provider && qwen.routed.model === local.model && qwen.routed.shadowApplied === false
  const composerPass = Boolean(composer?.routed.ok && composer.routed.provider === remote.provider && composer.routed.model === remote.model && composer.routed.shadowApplied === false)
  const swap = qwenPass && composerPass && policy === 'LOCAL'
  const root = path.join(resolveRepoRoot(), 'tmp/foundry-worker-routing')
  mkdirSync(root, { recursive: true })
  const head = git('git rev-parse HEAD')
  const branch = git('git branch --show-current')
  const dirty = git('git status --porcelain').split('\n').filter(Boolean).length
  const launcher = git("sed -n '6p' $HOME/.local/bin/war-room-os-user")
  const lines = [
    '# FOUNDRY_CAPABILITY_AWARE_WORKER_ROUTING_01_REPORT',
    '',
    `Repo: ${resolveRepoRoot()} branch ${branch} HEAD ${head}`,
    `Live install: ${launcher}`,
    `Dirty paths: ${dirty}`,
    `Routing mode: ${getCapabilityAwareRoutingMode()}`,
    `Stored policy: ${policy}`,
    `Stored default constant: ${STORED_DEFAULT_POLICY}`,
    `Fixtures: ${fixtures.filter(item => item.pass).length}/${fixtures.length}`,
    `QWEN_WORKER_INTERFACE=${qwenPass ? 'PASS' : 'FAIL'} ${qwen.routed.ok ? qwen.routed.provider + '/' + qwen.routed.model : redact(qwen.routed.error)}`,
    `COMPOSER_WORKER_INTERFACE=${composerPass ? 'PASS' : 'FAIL'} ${composer ? (composer.routed.ok ? composer.routed.provider + '/' + composer.routed.model : redact(composer.routed.error)) : 'not called'}`,
    `WORKER_SWAP_LIVE_PROOF=${swap ? 'PASS' : 'FAIL'}`,
    `SHADOW_APPLIED=${qwen.routed.shadowApplied}`,
    '',
    ...fixtures.map(item => `${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`),
  ]
  writeFileSync(path.join(root, 'FOUNDRY_CAPABILITY_AWARE_WORKER_ROUTING_01_REPORT.md'), lines.join('\n'))
  console.log(lines.join('\n'))
  if (!swap || fixtures.some(item => !item.pass)) process.exit(1)
}

main().catch(error => {
  console.error(redact(error instanceof Error ? error.message : String(error)))
  process.exit(1)
})
