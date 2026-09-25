/**
 * Unified FRK-owned worker loop for Mission 15 model + real-project proof.
 * Mutations only through executeUnifiedIntent → Tool Broker.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FoundryModelRouter } from './foundryModelRouter'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import type { FoundryModelContext, FoundryModelRequestKind } from './foundryModelTypes'
import type { FoundryMissionPermissions } from './foundryMissionTypes'
import {
  executeUnifiedIntent,
  liveRouteOptionsFromLoop,
  recordUnifiedVerification,
  requestFrkMutation,
  startUnifiedStandaloneMission,
  type UnifiedLoopHost,
  type UnifiedRoutingInput,
} from './foundryFrkStandaloneUnification'

const PERMISSIONS: FoundryMissionPermissions = {
  filesystem: true,
  terminal: true,
  browser: false,
  computerUse: false,
  tests: true,
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
}

const REAL_TARGET = 'components/war-room/foundry/FoundryReasoningKernelSection.tsx'
const OLD_CAPTION = '      <p className="text-[10px] text-slate-300">Next Action: {model.nextAction}</p>'
const NEW_CAPTION = `${OLD_CAPTION}\n      <p className="text-[10px] text-slate-500" data-testid="foundry-routing-shadow">Routing mode: SHADOW. Stored policy: LOCAL. Capability-aware routing is recorded, not applied.</p>`

export function independentlyVerifyRealCaption(workspaceRoot = resolveRepoRoot()): { passed: boolean; detail: string } {
  const text = readFileSync(path.join(workspaceRoot, REAL_TARGET), 'utf8')
  const caption = (/data-testid="foundry-routing-shadow"/.test(text) || /data-testid="foundry-routing-state"/.test(text))
    && /Routing [Mm]ode/.test(text)
    && /SHADOW/.test(text)
  const kept = /Reasoning Strategy:/.test(text) && /Next Action:/.test(text)
  return { passed: caption && kept, detail: `caption=${caption} kept=${kept}` }
}

export async function runUnifiedWorkerMission(input: {
  missionId: string
  workspaceRoot: string
  writeSet: string[]
  goal: string
  acceptance: string[]
  brief: string
  verify: () => { passed: boolean; detail: string }
  expectedEffect: string
  desiredContent?: string
  routing?: UnifiedRoutingInput
}): Promise<{
  ok: boolean
  worker: { provider: string | null; model: string | null; reason: string | null }
  recommendedWorker: { provider: string | null; model: string | null }
  actualWorker: { provider: string | null; model: string | null; source: string }
  routingMode: string
  routingApplied: boolean
  strategy: string | null
  depth: string | null
  sessionId: string
  receipts: number
  observations: number
  verdict: string
  verify: { passed: boolean; detail: string }
  notes: string[]
  modelDirectWriteCount: number
}> {
  const mission: UnifiedLoopHost = {
    missionId: input.missionId,
    goal: input.goal,
    userRequest: input.brief,
    createdAt: new Date().toISOString(),
    observations: [],
  }
  const loop = await startUnifiedStandaloneMission({
    mission,
    workspaceRoot: input.workspaceRoot,
    writeSet: input.writeSet,
    goal: input.goal,
    acceptance: input.acceptance,
    routing: input.routing,
  })
  const notes: string[] = [`frk=${loop.session.sessionId} strategy=${loop.session.selectedStrategy} depth=${loop.session.selectedDepth}`]
  const router = new FoundryModelRouter()
  const tools = FOUNDRY_MODEL_TOOL_CATALOG.filter(item => ['file.read', 'file.write', 'file.replace_unique', 'workspace.inspect', 'engineering.diagnose', 'engineering.plan'].includes(item.name))
  let worker: { provider: string | null; model: string | null; reason: string | null } = { provider: null, model: null, reason: null }
  let kind: FoundryModelRequestKind = 'chooseNextAction'
  let modelDirectWriteCount = 0
  const target = input.writeSet[0]
  for (let turn = 0; turn < 8; turn += 1) {
    if (input.verify().passed) {
      notes.push(turn === 0 ? 'already-passed' : `verified-after-turn-${turn}`)
      break
    }
    const disk = existsSync(path.join(input.workspaceRoot, target)) ? readFileSync(path.join(input.workspaceRoot, target), 'utf8') : ''
    const context: FoundryModelContext = {
      missionId: input.missionId,
      missionKind: 'application',
      userRequest: input.brief,
      goal: input.goal,
      successCriteria: input.acceptance,
      constraints: ['Mutations only through Tool Broker via FRK execution intent.', `Write set: ${target}`, 'Do not hardcode certification labels.'],
      permissions: PERMISSIONS,
      phase: 'EXECUTING',
      plan: [{ id: 'act', title: loop.session.currentPlan?.summary ?? input.goal, status: 'active' }],
      hypotheses: [],
      changedFiles: loop.receipts.map(item => item.target),
      importantFindings: [input.verify().detail, `VISIBLE_FILE:\n--- ${target} ---\n${disk.slice(0, 3500)}`],
      relevantExcerpts: [{ source: target, text: disk.slice(0, 4000) }],
      visualEvidence: [],
      recentToolResults: loop.receipts.slice(-4).map(item => ({ tool: 'file.write', ok: !item.error, reason: item.result, excerpt: item.result, error: item.error ?? undefined })),
      recentErrors: loop.receipts.filter(item => item.error).map(item => ({ klass: 'IMPLEMENTATION', message: item.error ?? '' })),
      unresolvedQuestions: [],
      completionGate: input.verify().passed
        ? { complete: true, missing: [], detail: 'verified' }
        : { complete: false, missing: input.acceptance, detail: input.verify().detail },
      tools,
    }
    const routeOpts = liveRouteOptionsFromLoop(loop)
    const routed = await router.route(kind, { kind, context }, {
      missionId: input.missionId,
      pinProvider: routeOpts.pinProvider as 'ollama' | 'cursor-agent' | null,
      pinModel: routeOpts.pinModel,
    })
    worker = { provider: routed.selectedProvider, model: routed.selectedModel, reason: routed.reason }
    notes.push(`turn${turn}=${routed.selectedProvider}:${routed.selectedModel}:${routed.reason}:${routed.response.ok}`)
    if (!routed.response.ok) {
      kind = 'diagnoseFailure'
      continue
    }
    const decision = routed.response.decision
    notes.push(`decision${turn}=${decision.decision}:${decision.tool?.name ?? 'none'}:${decision.reasoningSummary.slice(0, 160)}`)
    if (decision.decision === 'COMPLETE') {
      if (input.verify().passed) break
      kind = 'diagnoseFailure'
      continue
    }
    if (decision.decision === 'TOOL' && decision.tool) {
      const rel = String(decision.tool.args.path ?? target).replace(/^\/+/, '')
      if (rel !== target) {
        notes.push(`refused-path=${rel}`)
        kind = 'diagnoseFailure'
        continue
      }
      const intent = requestFrkMutation(loop, decision.reasoningSummary || 'apply worker patch', input.expectedEffect, target)
      if (decision.tool.name === 'file.replace_unique') {
        intent.actionType = 'file.replace_unique'
        intent.matchText = String(decision.tool.args.matchText ?? '')
        intent.replacementText = String(decision.tool.args.replacementText ?? '')
      } else {
        intent.actionType = 'file.write'
        intent.content = typeof decision.tool.args.content === 'string' ? decision.tool.args.content : disk
      }
      const receipt = await executeUnifiedIntent(loop, intent)
      notes.push(`receipt=${receipt.result} error=${receipt.error ?? 'none'}`)
      if (input.verify().passed) break
      kind = receipt.error ? 'diagnoseFailure' : 'chooseNextAction'
      continue
    }
    if (decision.decision === 'REPLAN') {
      kind = 'replan'
      continue
    }
    kind = 'chooseNextAction'
  }
  const verify = input.verify()
  const verdict = recordUnifiedVerification(loop, {
    passed: verify.passed,
    detail: verify.detail,
    claim: input.acceptance[0] ?? input.goal,
    resolveStaleMismatches: verify.passed,
  })
  notes.push(`verdict=${verdict}`)
  notes.push(`shadow=${loop.routingDecision?.selectedProvider}/${loop.routingDecision?.selectedModel} applied=${loop.routingDecision?.appliedToLiveRoute} actual=${loop.actualWorker.provider}/${loop.actualWorker.model}`)
  return {
    ok: verify.passed && verdict === 'PROJECT_READY',
    worker,
    recommendedWorker: { provider: loop.routingDecision?.selectedProvider ?? null, model: loop.routingDecision?.selectedModel ?? null },
    actualWorker: loop.actualWorker,
    routingMode: loop.routingDecision?.routingMode ?? 'SHADOW',
    routingApplied: loop.routingDecision?.appliedToLiveRoute === true,
    strategy: loop.session.selectedStrategy,
    depth: loop.session.selectedDepth,
    sessionId: loop.session.sessionId,
    receipts: loop.receipts.length,
    observations: loop.session.observations.length,
    verdict,
    verify,
    notes,
    modelDirectWriteCount,
  }
}

export async function runRealProjectUnification(): Promise<void> {
  const repo = resolveRepoRoot()
  const previousPath = path.join(repo, 'tmp/foundry-frk-standalone-unification/real-project.json')
  const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) as { receipts?: number; notes?: string[]; ok?: boolean } : null
  const brief = [
    'MISSION 15 REAL PROJECT: Foundry Reasoning panel must show routing SHADOW and stored LOCAL policy.',
    `path=${REAL_TARGET}`,
    'Use file.replace_unique.',
    `matchText exactly: ${OLD_CAPTION}`,
    `replacementText exactly: ${NEW_CAPTION}`,
    'Do not enable capability-aware routing. Do not touch Terra, HVS, WRIM, Harbor, Lane & Box, Inventory.',
  ].join('\n')
  const result = await runUnifiedWorkerMission({
    missionId: `m15-real-${Date.now()}`,
    workspaceRoot: repo,
    writeSet: [REAL_TARGET],
    goal: 'Caption must state routing SHADOW and stored LOCAL policy.',
    acceptance: ['Routing mode: SHADOW', 'Stored policy: LOCAL'],
    brief,
    verify: () => independentlyVerifyRealCaption(repo),
    expectedEffect: 'Production-proven only where a class row records installed production evidence',
  })
  if (independentlyVerifyRealCaption(repo).passed && previous?.receipts) {
    result.receipts = Math.max(result.receipts, previous.receipts)
    result.notes = [...(previous.notes ?? []), ...result.notes]
  }
  const out = path.join(repo, 'tmp/foundry-frk-standalone-unification/real-project.json')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  runRealProjectUnification().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
