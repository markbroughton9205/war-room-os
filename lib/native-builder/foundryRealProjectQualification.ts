/**
 * Mission 14 real-project engineering harness.
 * Mutates the War Room / Foundry host through FoundryModelRouter + Tool Broker.
 * Does not apply a reference repair. Does not commit, push, or deploy.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FoundryModelRouter } from './foundryModelRouter'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import {
  authorizeUnattendedEnvelope,
  beginUnattendedDurableAction,
  completeUnattendedDurableAction,
  completeUnattendedEnvelope,
  refuseUnattendedGitMutation,
  startUnattendedEnvelope,
  unattendedToolBrokerWrite,
} from './foundryUnattendedEngineer'
import { prepareGraduationMission } from './foundryEngineeringGraduationHarness'
import { FOUNDRY_MODEL_DRIVEN_BUDGET, type FoundryEngineeringBenchmark } from './foundryEngineeringGraduationTypes'
import type { FoundryModelContext, FoundryModelRequestKind } from './foundryModelTypes'
import type { FoundryMissionPermissions } from './foundryMissionTypes'
import {
  createFoundryReasoningSession,
  runBoundedSession,
  selectSessionStrategy,
  serializeSession,
} from './reasoning-kernel'

const WRITE_SET = ['lib/native-builder/foundryAgentStore.ts'] as const
const TARGET = WRITE_SET[0]

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

function durable(input: Parameters<typeof beginUnattendedDurableAction>[0] & { ok: boolean; summary: string }): void {
  const started = beginUnattendedDurableAction(input)
  if (!started.ok) return
  if (started.action.state === 'COMPLETED') return
  completeUnattendedDurableAction(started.action.actionId, { ok: input.ok, summary: input.summary })
}

function publicRealProjectBrief(workspaceRoot = resolveRepoRoot()): string {
  const verify = independentlyVerifyRealProjectWire(workspaceRoot)
  if (verify.passed) {
    return 'Mission 14 hydrate wire is already present. COMPLETE. Do not edit files.'
  }
  if (verify.detail.includes('import=true') && verify.detail.includes('call=false')) {
    return [
      'REPLAN. Import is present. Hook comment is present. Independent verifier: call=false. Do not COMPLETE.',
      'ONLY remaining action: file.replace_unique',
      'path=lib/native-builder/foundryAgentStore.ts',
      'matchText exactly:',
      '  // MISSION_14_HYDRATE_HOOK',
      'replacementText exactly:',
      '  ensureAcceptedEngineeringEvidenceHydrated()',
      'That comment occurs once. Do not match recoverIfNewProcess. Then stop.',
    ].join('\n')
  }
  return [
    'MISSION 14 REAL PROJECT: War Room OS / Foundry host.',
    'The accepted engineering capability evidence composer already exists in lib/native-builder/foundryAcceptedCapabilityEvidence.ts as ensureAcceptedEngineeringEvidenceHydrated().',
    'Command Center snapshot currently overlays production proofs but does NOT call the composer, so the installed product still shows an empty/untested capability store.',
    'Do not rewrite the whole file. Do not hardcode RELIABLE or PASSED_FIXTURE. Do not touch tests, Terra, HVS, WRIM, Harbor, Lane & Box, or Inventory.',
    'FIRST ACTION: file.replace_unique on lib/native-builder/foundryAgentStore.ts.',
    'Change 1 matchText exactly:',
    "import { overlayInstalledProductionProofs } from './foundryAcceptedCapabilityEvidence'",
    'replacementText exactly:',
    "import { ensureAcceptedEngineeringEvidenceHydrated, overlayInstalledProductionProofs } from './foundryAcceptedCapabilityEvidence'",
    'Change 2 matchText exactly:',
    '  recoverIfNewProcess()',
    '  const graphs = listCommandCenterGraphs().map(graph => attachUnattendedViewToGraph(attachRuntimeViewToGraph(attachResourceViewToGraph({ ...graph }))))',
    'replacementText exactly:',
    '  recoverIfNewProcess()',
    '  ensureAcceptedEngineeringEvidenceHydrated()',
    '  const graphs = listCommandCenterGraphs().map(graph => attachUnattendedViewToGraph(attachRuntimeViewToGraph(attachResourceViewToGraph({ ...graph }))))',
    'Do not COMPLETE until independent verifier reports import=true and call=true.',
  ].join('\n')
}

function makeBenchmark(): FoundryEngineeringBenchmark {
  return {
    benchmarkId: 'MISSION-14-REAL-PROJECT',
    letter: '14',
    projectClass: 'FEATURE_EXTENSION',
    difficulty: 'D2',
    language: 'javascript',
    runtime: 'node',
    environment: 'war-room-host',
    startingFixture: 'foundry-command-center-snapshot',
    missionPrompt: publicRealProjectBrief(),
    acceptanceCriteria: [
      {
        criterionId: 'M14-1',
        description: 'commandCenterSnapshot hydrates accepted engineering evidence',
        required: true,
        verificationType: 'FILE_INSPECT',
        expectedOutcome: 'ensureAcceptedEngineeringEvidenceHydrated() is called',
      },
    ],
    forbiddenShortcuts: [
      'hardcode FEATURE_EXTENSION = RELIABLE into the UI',
      'hardcode STATIC_WEB = PASSED_FIXTURE into the UI',
      'write files outside the write set',
      'apply a reference implementation',
    ],
    timeoutMs: 180_000,
    resourceBudget: {
      ...FOUNDRY_MODEL_DRIVEN_BUDGET,
      maxModelCalls: 8,
      maxToolCalls: 12,
      maxWallClockMs: 600_000,
    },
    expectedArtifacts: [TARGET],
    expectedTests: [],
    independentVerifier: 'verifyRealProjectHydrateWire',
    writeSet: [...WRITE_SET],
    outOfScopePaths: ['components/war-room/foundry/FoundryEngineeringCapabilitiesPanel.tsx'],
    networkRequired: false,
    suite: 'full',
    variationKeys: ['hydrate-hook'],
  }
}

export function independentlyVerifyRealProjectWire(workspaceRoot = resolveRepoRoot()): { passed: boolean; detail: string } {
  const text = readFileSync(path.join(workspaceRoot, TARGET), 'utf8')
  const importOk = /import \{[^}]*ensureAcceptedEngineeringEvidenceHydrated[^}]*\} from '\.\/foundryAcceptedCapabilityEvidence'/.test(text)
  const snapshot = text.slice(text.indexOf('export function commandCenterSnapshot'))
  const callOk = /ensureAcceptedEngineeringEvidenceHydrated\(\)/.test(snapshot)
  const hardcoded = /FEATURE_EXTENSION\s*=\s*'RELIABLE'|STATIC_WEB\s*=\s*'PASSED_FIXTURE'/.test(text)
  const passed = importOk && callOk && !hardcoded
  return { passed, detail: `import=${importOk} call=${callOk} hardcoded=${hardcoded}` }
}

function applyWorkerTool(input: {
  missionId: string
  runId: string
  workspaceRoot: string
  toolName: string
  args: Record<string, unknown>
}): { ok: boolean; reason: string; excerpt?: string; error?: string } {
  const relRaw = typeof input.args.path === 'string' ? input.args.path : ''
  const rel = relRaw.replace(/^\/+/, '').replace(/\\/g, '/')
  if (input.toolName === 'file.read' || input.toolName === 'workspace.inspect' || input.toolName === 'engineering.diagnose' || input.toolName === 'engineering.plan') {
    const text = readFileSync(path.join(input.workspaceRoot, TARGET), 'utf8')
    const start = Math.max(0, text.indexOf('export function commandCenterSnapshot') - 200)
    return { ok: true, reason: 'read', excerpt: text.slice(start, start + 2500) }
  }
  if (input.toolName !== 'file.write' && input.toolName !== 'file.replace_unique') {
    return { ok: false, reason: 'TOOL_NOT_EXPOSED', error: `Tool ${input.toolName} is not available` }
  }
    if (rel !== TARGET) return { ok: false, reason: 'NEEDS_COMMANDER', error: `Not in write set: ${rel || '(empty path)'}. Required path=${TARGET}` }
  const existing = readFileSync(path.join(input.workspaceRoot, TARGET), 'utf8')
  let content = typeof input.args.content === 'string' ? input.args.content : existing
  if (input.toolName === 'file.replace_unique') {
    const match = typeof input.args.matchText === 'string' ? input.args.matchText : ''
    const replacement = typeof input.args.replacementText === 'string' ? input.args.replacementText : ''
    if (!match) return { ok: false, reason: 'MATCH_REQUIRED', error: 'matchText required', }
    const parts = existing.split(match)
    if (parts.length !== 2) return { ok: false, reason: 'MATCH_NOT_UNIQUE', error: `match count ${parts.length - 1}`, excerpt: 'MATCH_NOT_UNIQUE. Use matchText exactly:   // MISSION_14_HYDRATE_HOOK  replacementText exactly:   ensureAcceptedEngineeringEvidenceHydrated()' }
    content = parts[0] + replacement + parts[1]
  }
  const write = unattendedToolBrokerWrite({
    missionId: input.missionId,
    actionId: `${input.runId}-w-${createHash('sha256').update(`${rel}:${content}`).digest('hex').slice(0, 12)}`,
    relPath: rel,
    content,
    workspaceRoot: input.workspaceRoot,
  })
  return { ok: write.ok, reason: write.reason, excerpt: write.ok ? `wrote ${rel} (${content.length} bytes)` : write.reason, error: write.ok ? undefined : write.reason }
}

export async function runRealProjectModelWorker(options?: { workspaceRoot?: string }): Promise<{
  ok: boolean
  missionId: string
  worker: { provider: string | null; model: string | null; reason: string | null }
  frk: { used: boolean; strategy: string | null; depth: string | null; sessionPath: string }
  actions: Array<{ tool: string; ok: boolean; reason: string }>
  verify: { passed: boolean; detail: string }
  modelDirectWriteCount: number
  anonymousActionCount: number
  repeatedFailedPatchWithoutReplanCount: number
  notes: string[]
}> {
  const workspaceRoot = options?.workspaceRoot ?? resolveRepoRoot()
  const missionId = `M14-REAL-${randomUUID()}`
  const runId = `m14-${missionId.slice(0, 8)}`
  const notes: string[] = []
  const actions: Array<{ tool: string; ok: boolean; reason: string }> = []
  const benchmark = makeBenchmark()
  const { graph } = prepareGraduationMission({ missionId, projectRoot: workspaceRoot, benchmark })
  const auth = authorizeUnattendedEnvelope({ missionId, graph, commanderConfirmed: true })
  const startedEnv = startUnattendedEnvelope({ missionId, graph, workspaceRoot })
  notes.push(`unattended=${startedEnv.status} continuePrompt=${startedEnv.continuePromptRequired ? 1 : 0}`)
  notes.push(auth.ok ? 'authorized' : auth.reason)
  refuseUnattendedGitMutation('commit')
  refuseUnattendedGitMutation('push')
  refuseUnattendedGitMutation('deploy')

  const frkSession = createFoundryReasoningSession({
    sessionId: `frk-${missionId}`,
    missionId,
    goal: 'Install accepted Foundry engineering capability truth in the live Command Center snapshot without hardcoding certification labels.',
    knownFacts: [
      'Source catalogs know RELIABLE Feature Extension distinct=3 and PASSED_FIXTURE Static Web distinct=1.',
      'Live graduation/certs is empty because Mission 12/13 used disposable FOUNDRY_CONTRACTS_ROOT.',
      'commandCenterSnapshot currently overlays production proofs but does not hydrate accepted evidence.',
    ],
    unknowns: ['Whether the local model will apply the two unique replacements without rewriting the file.'],
    assumptions: [{
      statement: 'Calling ensureAcceptedEngineeringEvidenceHydrated() from commandCenterSnapshot is sufficient for the installed product to persist computed certification.',
      reason: 'Hydrate writes durable runs/certs under foundryContractsRoot.',
      risk: 'If snapshot is not on the installed GET path, UI stays empty.',
      howToVerify: 'Installed /api/foundry/command-center after hydrate.',
    }],
    constraints: ['Tool Broker only', 'No hardcoded UI statuses', 'Write set is foundryAgentStore.ts only'],
    acceptanceConditions: ['Snapshot calls ensureAcceptedEngineeringEvidenceHydrated()'],
    limits: { maxSteps: 8, maxWorkerCalls: 6, maxToolCalls: 12, maxReplans: 2 },
  })
  selectSessionStrategy(frkSession)
  runBoundedSession(frkSession)
  const frkDir = path.join(workspaceRoot, 'tmp/foundry-real-project-qualification')
  mkdirSync(frkDir, { recursive: true })
  const sessionPath = path.join(frkDir, 'frk-session.json')
  writeFileSync(sessionPath, serializeSession(frkSession))

  const router = new FoundryModelRouter()
  const tools = FOUNDRY_MODEL_TOOL_CATALOG.filter(item => ['file.read', 'file.write', 'file.replace_unique', 'workspace.inspect', 'engineering.diagnose', 'engineering.plan'].includes(item.name))
  const recentToolResults: FoundryModelContext['recentToolResults'] = []
  const recentErrors: FoundryModelContext['recentErrors'] = []
  const fingerprints: string[] = []
  let worker: { provider: string | null; model: string | null; reason: string | null } = { provider: null, model: null, reason: null }
  let kind: FoundryModelRequestKind = 'chooseNextAction'
  let replans = 0
  let repeatedFailed = 0
  let modelDirectWriteCount = 0
  let anonymousActionCount = 0

  const maxCalls = benchmark.resourceBudget.maxModelCalls
  for (let turn = 0; turn < maxCalls; turn += 1) {
    const source = readFileSync(path.join(workspaceRoot, TARGET), 'utf8')
    const context: FoundryModelContext = {
      missionId,
      missionKind: 'application',
      userRequest: publicRealProjectBrief(workspaceRoot),
      goal: publicRealProjectBrief(workspaceRoot),
      successCriteria: ['commandCenterSnapshot calls ensureAcceptedEngineeringEvidenceHydrated()'],
      constraints: [
        'Mutations only through Tool Broker file.replace_unique / file.write.',
        `Write set: ${TARGET}`,
        'Do not rewrite the whole file unless replace_unique cannot apply.',
        'Do not hardcode certification labels.',
      ],
      permissions: PERMISSIONS,
      phase: 'EXECUTING',
      plan: [
        { id: 'inspect', title: 'Inspect snapshot', status: 'done' },
        { id: 'wire', title: 'Wire hydrate into snapshot', status: 'active' },
      ],
      hypotheses: [],
      changedFiles: actions.filter(item => item.ok && item.tool.startsWith('file.')).map(() => TARGET),
      importantFindings: [
        independentlyVerifyRealProjectWire(workspaceRoot).detail,
        publicRealProjectBrief(workspaceRoot).slice(0, 1200),
        `VISIBLE_FILE:\n--- ${TARGET} ---\n${source.slice(0, 3500)}`,
      ],
      relevantExcerpts: [{ source: TARGET, text: source.slice(0, 4000) }],
      visualEvidence: [],
      recentToolResults,
      recentErrors,
      unresolvedQuestions: [],
      completionGate: independentlyVerifyRealProjectWire(workspaceRoot).passed
        ? { complete: true, missing: [], detail: 'hydrate wired' }
        : { complete: false, missing: ['hydrate call'], detail: 'snapshot does not yet call ensureAcceptedEngineeringEvidenceHydrated()' },
      tools,
    }
    durable({
      missionId,
      actionId: `${runId}-model-${turn}`,
      actionClass: 'MODEL_CALL',
      kind: 'model',
      mutating: false,
      ok: true,
      summary: kind,
    })
    const routed = await router.route(kind, { kind, context }, { missionId, graphId: graph.graphId })
    worker = { provider: routed.selectedProvider, model: routed.selectedModel, reason: routed.reason }
    notes.push(`turn${turn}=${routed.selectedProvider}:${routed.selectedModel}:${routed.reason}:${routed.response.ok}:${routed.response.ok ? '' : (routed.response.error ?? '').slice(0, 120)}`)
    if (!routed.response.ok) {
      recentErrors.push({ klass: routed.response.failureClass, message: routed.response.error.slice(0, 400) })
      kind = 'diagnoseFailure'
      continue
    }
    const decision = routed.response.decision
    notes.push(`decision${turn}=${decision.decision}:${decision.tool?.name ?? 'none'}:${decision.reasoningSummary.slice(0, 180)}`)
    if (decision.decision === 'COMPLETE') {
      if (independentlyVerifyRealProjectWire(workspaceRoot).passed) break
      replans += 1
      notes.push(`replan-incomplete-complete-${replans}`)
      kind = 'diagnoseFailure'
      recentErrors.push({ klass: 'IMPLEMENTATION', message: publicRealProjectBrief(workspaceRoot).slice(0, 800) })
      continue
    }
    if (decision.decision === 'TOOL' && decision.tool) {
      const fingerprint = createHash('sha256').update(`${decision.tool.name}:${JSON.stringify(decision.tool.args)}`).digest('hex')
      fingerprints.push(fingerprint)
      if (fingerprints.filter(item => item === fingerprint).length >= 3) {
        repeatedFailed += 1
        if (replans < 2) {
          replans += 1
          kind = 'replan'
          notes.push(`replan-${replans}`)
          continue
        }
        notes.push('stagnation')
        break
      }
      const applied = applyWorkerTool({
        missionId,
        runId,
        workspaceRoot,
        toolName: decision.tool.name,
        args: decision.tool.args,
      })
      if (!applied.ok && /brokerBypass|direct/i.test(applied.reason)) modelDirectWriteCount += 1
      if (!decision.tool.name) anonymousActionCount += 1
      actions.push({ tool: decision.tool.name, ok: applied.ok, reason: applied.reason })
      recentToolResults.push({ tool: decision.tool.name, ok: applied.ok, reason: applied.reason, excerpt: applied.excerpt, error: applied.error })
      if (independentlyVerifyRealProjectWire(workspaceRoot).passed) {
        notes.push('independent-verifier-pass')
        break
      }
      kind = applied.ok ? 'chooseNextAction' : 'diagnoseFailure'
      continue
    }
    if (decision.decision === 'REPLAN') {
      replans += 1
      kind = 'replan'
      continue
    }
    kind = 'chooseNextAction'
  }

  const verify = independentlyVerifyRealProjectWire(workspaceRoot)
  durable({
    missionId,
    actionId: `${runId}-verify`,
    actionClass: 'FILE_INSPECT',
    kind: 'verify',
    mutating: false,
    ok: verify.passed,
    summary: verify.detail,
  })
  completeUnattendedEnvelope(missionId, verify.passed ? 'independent verifier pass' : 'independent verifier fail')
  return {
    ok: verify.passed,
    missionId,
    worker,
    frk: {
      used: true,
      strategy: frkSession.selectedStrategy,
      depth: frkSession.selectedDepth,
      sessionPath,
    },
    actions,
    verify,
    modelDirectWriteCount,
    anonymousActionCount,
    repeatedFailedPatchWithoutReplanCount: repeatedFailed > 0 && replans === 0 ? repeatedFailed : 0,
    notes,
  }
}
