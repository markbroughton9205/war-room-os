/**
 * Provider-neutral specialist calls for one engineering campaign.
 * Roles stay responsibilities. Worker selection stays on recommendFoundryWorker.
 * The model never writes disk. This module does not apply patches.
 */
import { probeOllama } from './ollamaClient'
import { applyFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { configuredFoundryModels } from './foundryModelProviders'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'
import {
  recommendFoundryWorker,
  reconsiderFoundryRouting,
  routingCandidatesFromEvidence,
  type FoundryRoutingCandidate,
  type FoundryWorkerRoutingNeed,
} from './foundryWorkerRouting'
import { buildWorkerRequest, dispatchReasoningWorker } from './reasoning-kernel/worker'
import { extractJsonObject } from './localCoder'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import type { FoundryModelContext, FoundryMissionModel } from './foundryModelTypes'
import type { PlannedEdit } from './foundryLargeProject'
import {
  MAX_MODEL_CALLS_PER_CAMPAIGN,
  pythonLooksUnparseable,
  specialistActivity,
  type CampaignRole,
  type CampaignWorkerReceipt,
  type EngineeringCampaign,
} from './foundryEngineeringCampaign'

export const SPECIALIST_FAILURE_CLASSES = [
  'PROVIDER_UNAVAILABLE',
  'RESOURCE_BLOCK',
  'INVALID_OUTPUT',
  'CAPABILITY_FAILURE',
  'TIMEOUT',
  'POLICY_BLOCK',
] as const
export type SpecialistFailureClass = (typeof SPECIALIST_FAILURE_CLASSES)[number]

export function classifyUnselectedLocalWorker(input: {
  outcome: string
  localOnly: boolean
  providerReachable: boolean
  modelInstalled: boolean
}): SpecialistFailureClass {
  if (input.outcome === 'BLOCKED_RESOURCE') return 'RESOURCE_BLOCK'
  if (input.outcome === 'BLOCKED_COMMANDER') return 'POLICY_BLOCK'
  if (input.localOnly && !input.providerReachable) return 'PROVIDER_UNAVAILABLE'
  if (input.localOnly && input.providerReachable && !input.modelInstalled) return 'PROVIDER_UNAVAILABLE'
  if (input.outcome === 'BLOCKED_PROVIDER') return 'PROVIDER_UNAVAILABLE'
  return 'CAPABILITY_FAILURE'
}

export type FoundrySpecialistRequest = {
  campaignId: string
  taskId: string
  role: CampaignRole
  missionContract: string
  taskPurpose: string
  acceptanceCriteria: string[]
  workingSet: string[]
  projectFacts: string[]
  knownInterfaces: string[]
  failureEvidence: string[]
  /** Edits earlier repair attempts already made without fixing the failure. The next attempt should try something else. */
  alreadyTried?: string[]
  resourceBudget: { callsRemaining: number; ceiling: number }
  localOnly: boolean
  reasoningDepth: 'R0' | 'R1' | 'R2' | 'R3' | 'R4'
  excerpts: { file: string; text: string }[]
  needsEdit: boolean
  pin: { provider: string; model: string } | null
  attempt: number
}

export type FoundrySpecialistResult = {
  status: 'propose' | 'pass' | 'fail' | 'blocked'
  summary: string
  findings: string[]
  hypotheses: string[]
  evidence: string[]
  recommendedActions: string[]
  proposedEdits: { file: string; search: string; replace: string }[]
  testPlan: string[]
  risks: string[]
  uncertainty: string
  verdict: '' | 'PROJECT_READY' | 'NOT_READY'
}

export type SpecialistCall = {
  receipt: CampaignWorkerReceipt
  result: FoundrySpecialistResult | null
  failureClass: SpecialistFailureClass | null
  activity: string
  workerLabel: string
  edit: PlannedEdit | null
  switchedWorker: boolean
  localWorker: boolean
  calls: number
}

const BLOCKED_TOOL = /^(git\.|deploy|installer\.|process\.|build\.|package\.)/

export function specialistRemotePermitted(policy: string, localOnly: boolean): boolean {
  if (localOnly) return false
  return policy !== 'LOCAL'
}

export function classifySpecialistTool(toolName: string | null): SpecialistFailureClass | null {
  if (!toolName) return null
  if (BLOCKED_TOOL.test(toolName) || toolName === 'file.delete') return 'POLICY_BLOCK'
  return null
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) : clean
}

function failureFromError(error: string): SpecialistFailureClass {
  if (/timeout|aborted|timed out/i.test(error)) return 'TIMEOUT'
  if (/budget exceeded|resource budget|call budget/i.test(error)) return 'RESOURCE_BLOCK'
  if (/unavailable|not configured|no foundry reasoning model|fetch failed|ECONNREFUSED|socket hang up/i.test(error)) return 'PROVIDER_UNAVAILABLE'
  if (/BLOCKED_CAPABILITY/.test(error)) return 'CAPABILITY_FAILURE'
  if (/requires permission (commit|push|liveDeploy|installProduction)|POLICY_BLOCK/.test(error)) return 'POLICY_BLOCK'
  return 'INVALID_OUTPUT'
}

export function parseSpecialistPayload(input: {
  raw: string
  summary: string
  role: CampaignRole
  needsEdit: boolean
  sources: ReadonlyMap<string, string>
  requiredPaths?: string[]
}): { result: FoundrySpecialistResult; failureClass: SpecialistFailureClass | null; edit: PlannedEdit | null } {
  const parsed = input.raw ? extractJsonObject(input.raw) : null
  const summary = clip(input.summary || (typeof parsed?.reasoningSummary === 'string' ? parsed.reasoningSummary : ''), 500)
  const tool = parsed?.tool && typeof parsed.tool === 'object' && !Array.isArray(parsed.tool)
    ? parsed.tool as Record<string, unknown>
    : null
  const toolName = typeof tool?.name === 'string' ? tool.name : null
  const policy = classifySpecialistTool(toolName)
  const args = tool?.args && typeof tool.args === 'object' && !Array.isArray(tool.args)
    ? tool.args as Record<string, unknown>
    : {}
  const edits: FoundrySpecialistResult['proposedEdits'] = []
  if (!policy && toolName === 'file.replace_unique') {
    const file = typeof args.path === 'string' ? args.path : ''
    const search = typeof args.matchText === 'string' ? args.matchText : ''
    const replace = typeof args.replacementText === 'string'
      ? args.replacementText
      : typeof args.content === 'string' ? args.content : ''
    if (file && replace) edits.push({ file, search, replace })
  }
  const verdict = /\bNOT_READY\b/.test(summary) ? 'NOT_READY' as const
    : /\bPROJECT_READY\b/.test(summary) ? 'PROJECT_READY' as const
      : ''
  const findings = /STATUS fail|unmet|does not|doesn't|missing/i.test(summary) ? [summary] : []
  const hypotheses = /HYPOTHESIS:|root cause|because|only handles|special-case/i.test(summary) ? [summary] : []
  const evidenceLine = summary.match(/EVIDENCE:\s*([^]*?)(?=REPAIR_TARGET:|$)/i)?.[1]?.trim() ?? ''
  const repairTarget = summary.match(/REPAIR_TARGET:\s*(\S+)/i)?.[1]?.trim() ?? ''
  const result: FoundrySpecialistResult = {
    status: policy ? 'blocked' : edits.length ? 'propose' : findings.length || verdict === 'NOT_READY' ? 'fail' : 'pass',
    summary,
    findings,
    hypotheses,
    evidence: evidenceLine ? [evidenceLine] : [],
    recommendedActions: repairTarget ? [repairTarget] : [],
    proposedEdits: edits,
    testPlan: /unittest|test_/.test(summary) ? [summary] : [],
    risks: [],
    uncertainty: '',
    verdict,
  }
  if (policy) return { result, failureClass: policy, edit: null }
  if (toolName === 'file.write') return { result, failureClass: 'INVALID_OUTPUT', edit: null }
  if (input.role === 'ARCHITECT') {
    const needed = (input.requiredPaths ?? []).filter(file => /(^|\/)(shared|contract|backend|frontend)\//.test(file)).slice(0, 3)
    const named = (file: string) => summary.includes(file) || summary.includes(file.split('/').pop() ?? file)
    if (needed.length < 3 || needed.some(file => !named(file))) return { result, failureClass: 'INVALID_OUTPUT', edit: null }
  }
  if (input.role === 'VERIFIER' && !verdict) return { result, failureClass: 'INVALID_OUTPUT', edit: null }
  if ((input.role === 'TEST') && result.testPlan.length === 0) return { result, failureClass: 'INVALID_OUTPUT', edit: null }
  if (input.role === 'DEBUGGER' && hypotheses.length === 0 && !edits.length) return { result, failureClass: 'INVALID_OUTPUT', edit: null }
  const proposal = edits[0]
  const edit = proposal && (!input.needsEdit || proposal.search) ? editFromProposal(proposal, input.sources) : null
  if (input.needsEdit && !edit) {
    const path = typeof args.path === 'string' ? args.path : ''
    const search = typeof args.matchText === 'string' ? args.matchText : ''
    const known = path ? input.sources.get(path) : undefined
    const reason = !path
      ? 'path and matchText are required'
      : known === undefined
        ? `path ${path} is outside the working set`
        : !search
          ? 'matchText is required and must occur once in the working-set file'
          : 'matchText is missing or not unique in the working-set file'
    result.evidence = [summary]
    result.summary = reason
    return { result, failureClass: 'INVALID_OUTPUT', edit: null }
  }
  if (edits.length && !edit) return { result, failureClass: 'INVALID_OUTPUT', edit: null }
  return { result, failureClass: null, edit }
}

export function editFromProposal(
  proposal: { file: string; search: string; replace: string },
  sources: ReadonlyMap<string, string>,
): PlannedEdit | null {
  const source = sources.get(proposal.file)
  if (source === undefined || !proposal.replace || proposal.replace === proposal.search) return null
  if (!proposal.search) {
    if (proposal.replace === source) return null
    const lostDefs = /\bdef\s+\w+/.test(source) && !/\bdef\s+\w+/.test(proposal.replace)
    const collapsed = proposal.replace.length < Math.floor(source.length * 0.5)
    if (lostDefs || collapsed) return null
    if (pythonLooksUnparseable(proposal.replace) && !pythonLooksUnparseable(source)) return null
    return {
      file: proposal.file,
      before: source,
      after: proposal.replace,
      start: 0,
      end: source.length,
      reason: 'Specialist proposed a governed file replacement.',
    }
  }
  const start = source.indexOf(proposal.search)
  if (start < 0 || source.indexOf(proposal.search, start + proposal.search.length) >= 0) return null
  const after = source.slice(0, start) + proposal.replace + source.slice(start + proposal.search.length)
  if (pythonLooksUnparseable(after) && !pythonLooksUnparseable(source)) return null
  return {
    file: proposal.file,
    before: source,
    after,
    start,
    end: start + proposal.search.length,
    reason: 'Specialist proposed a governed unique replacement.',
  }
}

function candidatesFromEvidence(models: FoundryMissionModel[]): FoundryRoutingCandidate[] {
  return routingCandidatesFromEvidence({
    evidence: ACCEPTED_WORKER_CAPABILITY_EVIDENCE,
    liveIdentities: models
      .filter((model): model is FoundryMissionModel & { model: string } => Boolean(model.provider && model.model))
      .map(model => ({ provider: model.provider, model: model.model })),
  })
}

export function capabilityFamiliesForSpecialistRole(role: CampaignRole): FoundryWorkerRoutingNeed['capabilityFamilies'] {
  if (role === 'DEBUGGER') return ['ROOT_CAUSE_DIAGNOSIS']
  if (role === 'REVIEWER') return ['AMBIGUITY_RESOLUTION']
  if (role === 'ARCHITECT') return ['CROSS_LAYER_REASONING']
  if (role === 'VERIFIER' || role === 'TEST') return ['TEST_TRUTH_DISCRIMINATION']
  return ['PLAN_TO_CODE_FIDELITY']
}

function needFor(input: FoundrySpecialistRequest, candidates: FoundryRoutingCandidate[], remotePermitted: boolean, callsRemaining: number): FoundryWorkerRoutingNeed {
  const hard = input.role === 'ARCHITECT' || input.role === 'DEBUGGER' || input.role === 'REVIEWER'
  const families = capabilityFamiliesForSpecialistRole(input.role)
  return {
    missionId: input.campaignId,
    taskFamily: input.role === 'FRONTEND' ? 'FRONTEND_APP' : input.role === 'BACKEND' ? 'BACKEND_API' : 'FEATURE_EXTENSION',
    capabilityFamilies: families,
    difficultyClass: hard ? 'ambiguous' : 'localized',
    reasoningDepth: hard ? 'R3' : 'R1',
    ambiguity: hard ? 'high' : 'low',
    risk: 'low',
    privacyRequirement: input.localOnly ? 'local' : 'any',
    localOnlyRequirement: input.localOnly,
    remotePermitted,
    commanderPolicy: remotePermitted ? 'AUTO' : 'LOCAL',
    pin: input.pin,
    candidates,
    callBudgetRemaining: callsRemaining,
    callBudgetCeiling: input.resourceBudget.ceiling,
    wallTimeBudgetMs: 180000,
    missionContractHash: input.campaignId,
    acceptanceContractHash: input.taskId,
    toolAuthority: 'existing-patch-path',
    deployAuthority: false,
    now: new Date().toISOString(),
  }
}

function permissions(): FoundryModelContext['permissions'] {
  return {
    filesystem: true,
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
  }
}

function promptFor(input: FoundrySpecialistRequest): string {
  const source = input.role === 'ARCHITECT'
    ? input.excerpts.map(item => item.file).join('\n')
    : input.excerpts.map(item => `SOURCE ${item.file}\n${item.text.slice(0, 4000)}`).join('\n')
  const lead = input.role === 'ARCHITECT'
    ? 'Return REPLAN. From the file names, name the shared contract, the backend, and the frontend, the interface they share, the dependency order, and one risk. Do not call a tool.'
    : ''
  const shared = [
    lead,
    `ROLE ${input.role}. You are not the campaign owner.`,
    `PURPOSE ${input.taskPurpose}`,
    input.missionContract ? `CONTRACT ${input.missionContract.slice(0, 400)}` : '',
    input.failureEvidence.length ? `FAILURE ${input.failureEvidence.join(' | ').slice(0, 400)}` : '',
    input.alreadyTried?.length && (input.role === 'DEBUGGER' || input.role === 'BACKEND' || input.role === 'FRONTEND')
      ? `ALREADY TRIED, DO NOT REPEAT ${input.alreadyTried.join(' | ').slice(0, 320)}`
      : '',
    input.projectFacts.length ? `FACTS ${input.projectFacts.join(' | ').slice(0, 300)}` : '',
    'Do not commit, push, deploy, spend, or write files yourself.',
    source,
  ].filter(Boolean)
  if (input.role === 'ARCHITECT') return shared.join('\n')
  if (input.role === 'REVIEWER') {
    return ['Compare every acceptance sentence in CONTRACT with SOURCE. A STATUSES list is not a defect. Return REPLAN. reasoningSummary must be STATUS fail and name each unmet acceptance, or STATUS pass when every acceptance sentence is implemented. Do not call a tool.', ...shared].join('\n')
  }
  if (input.role === 'VERIFIER') {
    const passed = input.projectFacts.some(item => /verify pass/.test(item))
    const line = passed
      ? 'The tests passed. reasoningSummary must be the single word PROJECT_READY. Return REPLAN. Do not call a tool.'
      : 'The tests failed. reasoningSummary must be the single word NOT_READY. Return REPLAN. Do not call a tool.'
    return [line, ...shared].join('\n')
  }
  if (input.role === 'TEST') {
    return [...shared, 'Name an independent verification command. Return REPLAN. reasoningSummary must include unittest and the test file name. Do not copy an implementer sentence. Do not return TOOL.'].join('\n')
  }
  if (input.role === 'DEBUGGER') {
    return [...shared, 'Return REPLAN. reasoningSummary must contain these lines and no tool call: HYPOTHESIS: <root cause from the test output and source> EVIDENCE: <the failing line or missing name> REPAIR_TARGET: <one project file path>. The implementer applies the repair.'].join('\n')
  }
  if (!input.needsEdit) {
    return [...shared, 'The narrow test already passes. Return REPLAN. reasoningSummary must be STATUS pass. Do not return TOOL.'].join('\n')
  }
  const file = input.workingSet[0] ?? input.excerpts[0]?.file ?? ''
  const missingName = /NameError|not defined|not imported|ImportError/i.test(input.failureEvidence.join(' '))
  return [
    ...shared,
    `Return TOOL file.replace_unique for ${file}.`,
    'path must be that working-set file. matchText must be copied exactly from SOURCE and occur once. replacementText is the replacement. Do not use anchorId. Do not use src/example.ts.',
    'Do not replace the whole file. Keep every existing function, assignment, and import that SOURCE already has.',
    input.role === 'FRONTEND'
      ? 'The UI must pass the caller filter argument into the existing API function. Do not filter the rows again after that call.'
      : 'The backend must keep rows whose contract field equals the supplied filter argument. When no filter is supplied, return every row. Do not hardcode one status literal.',
    missingName
      ? 'FAILURE names a missing name. Add the missing import from CONTRACT with one unique replacement. Do not define a local copy. Do not delete existing functions or data.'
      : 'A name used in the file must be imported or defined in SOURCE. If CONTRACT defines a helper, import it before calling it.',
    'Do not return COMPLETE.',
  ].join('\n')
}

function contextFor(input: FoundrySpecialistRequest, goal: string): FoundryModelContext {
  const editTool = FOUNDRY_MODEL_TOOL_CATALOG.filter(tool => tool.name === 'file.replace_unique').map(tool => ({
    ...tool,
    purpose: 'Replace one unique matchText copied from SOURCE. path must be the working-set file. Do not use anchorId. Do not use src/example.ts.',
    args: {
      path: 'working-set file',
      matchText: 'unique text copied once from SOURCE',
      replacementText: 'replacement text',
      reason: 'string',
    },
    required: ['path', 'matchText', 'replacementText', 'reason'],
  }))
  return {
    missionId: input.campaignId,
    missionKind: 'fixture',
    userRequest: goal,
    goal,
    successCriteria: input.acceptanceCriteria.slice(0, 4),
    constraints: ['Do not commit, push, deploy, or spend.', 'Do not write files. Foundry applies governed edits.'],
    permissions: permissions(),
    phase: 'EXECUTING',
    plan: [{ id: input.taskId, title: input.taskPurpose.slice(0, 80), status: 'active' }],
    hypotheses: [],
    changedFiles: [],
    importantFindings: input.projectFacts.slice(0, 4),
    relevantExcerpts: input.excerpts.slice(0, 4).map(item => ({ source: item.file, text: item.text.slice(0, 700) })),
    visualEvidence: [],
    recentToolResults: input.excerpts.slice(0, 3).map(item => ({
      tool: 'file.read',
      ok: true,
      reason: item.file,
      excerpt: `${item.file}\n${item.text.slice(0, 700)}`,
    })),
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: {
      complete: false,
      missing: [input.role !== 'VERIFIER'
        ? 'specialist-result'
        : input.projectFacts.some(item => /verify pass/.test(item)) ? 'PROJECT_READY' : 'NOT_READY'],
      detail: input.role,
    },
    loopWarning: input.needsEdit ? undefined : 'Return REPLAN only. Do not call a tool.',
    tools: input.needsEdit ? editTool : [],
  }
}

function receiptFor(input: FoundrySpecialistRequest, provider: string, model: string, routingDecisionId: string, status: string, summary: string, failureClass: SpecialistFailureClass | null): CampaignWorkerReceipt {
  return {
    role: input.role,
    provider,
    model,
    routingDecisionId,
    workerCallId: `specialist-${input.taskId}-${input.attempt}-${provider}`,
    taskId: input.taskId,
    campaignId: input.campaignId,
    attempt: input.attempt,
    evidenceInputs: input.excerpts.map(item => item.file).slice(0, 8),
    resultStatus: status,
    summary: clip(summary, 180),
    failureClass,
  }
}

async function dispatchPinned(input: FoundrySpecialistRequest, provider: string, model: string, models: FoundryMissionModel[]) {
  const goal = promptFor(input)
  return dispatchReasoningWorker({
    request: buildWorkerRequest({
      requestId: `specialist-${input.campaignId}-${input.taskId}-${input.attempt}`,
      missionId: input.campaignId,
      task: input.role === 'DEBUGGER' ? 'diagnosis' : input.role === 'REVIEWER' ? 'critique' : input.needsEdit ? 'repair' : 'understand',
      problem: input.taskPurpose,
      constraints: ['No direct file writes.', 'No commit, push, or deploy.'],
      evidenceSummaries: input.projectFacts.slice(0, 4),
    }),
    context: contextFor(input, goal),
    pin: { provider, model },
    models,
    signal: AbortSignal.timeout(180_000),
  })
}

export const IMPLEMENTER_CORRECTION_LIMIT = 1

export function implementerCorrectionPrompt(reason: string): string {
  return `REJECTED ${reason}. Return one TOOL file.replace_unique. path must be a working-set file. matchText must be copied once from SOURCE. Include replacementText. Do not use anchorId or src/example.ts.`
}

export function allowImplementerCorrection(input: {
  needsEdit: boolean
  failureClass: string | null
  correctionsUsed: number
  callsRemaining: number
  calls: number
}): boolean {
  return input.failureClass === 'INVALID_OUTPUT'
    && input.needsEdit
    && input.correctionsUsed < IMPLEMENTER_CORRECTION_LIMIT
    && input.callsRemaining > input.calls
}

export async function callCampaignSpecialist(input: FoundrySpecialistRequest, sources: ReadonlyMap<string, string>): Promise<SpecialistCall> {
  const activity = specialistActivity(input.role)
  const policy = applyFoundryRuntimeConfig().providerPolicy
  const remotePermitted = specialistRemotePermitted(policy, input.localOnly)
  const models = await configuredFoundryModels({ routingRetry: true })
  const candidates = candidatesFromEvidence(models)
  const callsRemaining = input.resourceBudget.callsRemaining
  if (callsRemaining < 1) {
    return {
      receipt: receiptFor(input, '', '', 'budget', 'blocked', 'Model-call budget is exhausted.', 'RESOURCE_BLOCK'),
      result: null,
      failureClass: 'RESOURCE_BLOCK',
      activity,
      workerLabel: 'none',
      edit: null,
      switchedWorker: false,
      localWorker: false,
      calls: 0,
    }
  }
  let decision = recommendFoundryWorker(needFor(input, candidates, remotePermitted, callsRemaining))
  let switchedWorker = false
  if (decision.outcome !== 'SELECTED' && !input.pin) {
    const routine = recommendFoundryWorker({
      ...needFor(input, candidates, remotePermitted, callsRemaining),
      reasoningDepth: 'R1',
      ambiguity: 'low',
      capabilityFamilies: ['PLAN_TO_CODE_FIDELITY'],
    })
    if (routine.outcome === 'SELECTED') decision = routine
  }
  if (!decision.selectedProvider || !decision.selectedModel) {
    const probe = input.localOnly ? await probeOllama(process.env, { timeoutMs: 1500 }) : null
    const failure = classifyUnselectedLocalWorker({
      outcome: decision.outcome,
      localOnly: input.localOnly,
      providerReachable: probe?.available === true,
      modelInstalled: (probe?.models.length ?? 0) > 0,
    })
    const reason = failure !== 'PROVIDER_UNAVAILABLE' || !input.localOnly
      ? decision.reason
      : probe?.available
        ? 'Local Ollama is reachable, but the required model is not installed. No worker call was made.'
        : 'Local Ollama provider is unreachable at 127.0.0.1:11434. No worker call was made.'
    return {
      receipt: receiptFor(input, '', '', decision.routingDecisionId, 'blocked', reason, failure),
      result: null,
      failureClass: failure,
      activity,
      workerLabel: 'none',
      edit: null,
      switchedWorker: false,
      localWorker: false,
      calls: 0,
    }
  }
  let provider = decision.selectedProvider
  let model = decision.selectedModel
  let routed = await dispatchPinned(input, provider, model, models)
  if (!routed.ok && !input.pin) {
    const again = reconsiderFoundryRouting({
      need: { ...needFor(input, candidates, remotePermitted, callsRemaining - 1), previousProvider: provider, previousModel: model, switchCount: 0 },
      previousProvider: provider,
      previousModel: model,
      failureType: failureFromError(routed.error),
      succeeded: false,
      switchCount: 0,
    })
    if (again.decision.selectedProvider && again.decision.selectedModel && (again.decision.selectedProvider !== provider || again.decision.selectedModel !== model)) {
      provider = again.decision.selectedProvider
      model = again.decision.selectedModel
      decision = again.decision
      switchedWorker = true
      routed = await dispatchPinned(input, provider, model, models)
    }
  }
  if (!routed.ok && /fetch failed|ECONNREFUSED|socket hang up|aborted|timed out|timeout/i.test(routed.error) && callsRemaining > (switchedWorker ? 2 : 1)) {
    const retry = await dispatchPinned(input, provider, model, models)
    routed = retry.ok ? retry : routed
  }
  if (!routed.ok) {
    const failure = failureFromError(routed.error)
    return {
      receipt: receiptFor(input, provider, model, decision.routingDecisionId, 'blocked', routed.error, failure),
      result: null,
      failureClass: failure,
      activity,
      workerLabel: `${provider}/${model}`,
      edit: null,
      switchedWorker,
      localWorker: candidates.find(item => item.provider === provider && item.model === model)?.local ?? false,
      calls: switchedWorker ? 2 : 1,
    }
  }
  let calls = switchedWorker ? 2 : 1
  let correctionsUsed = 0
  let rejectedEvidence = ''
  let parsed = parseSpecialistPayload({
    raw: routed.rawText,
    summary: routed.summary,
    role: input.role,
    needsEdit: input.needsEdit,
    sources,
    requiredPaths: input.workingSet,
  })
  if (allowImplementerCorrection({ needsEdit: input.needsEdit, failureClass: parsed.failureClass, correctionsUsed, callsRemaining, calls })) {
    correctionsUsed += 1
    rejectedEvidence = parsed.result?.summary ?? 'invalid output'
    const correction = implementerCorrectionPrompt(rejectedEvidence)
    const retry = await dispatchPinned({ ...input, failureEvidence: [...input.failureEvidence, correction] }, provider, model, models)
    calls += 1
    if (retry.ok) {
      const accepted = parseSpecialistPayload({
        raw: retry.rawText,
        summary: retry.summary,
        role: input.role,
        needsEdit: input.needsEdit,
        sources,
        requiredPaths: input.workingSet,
      })
      accepted.result.evidence = [`REJECTED ${rejectedEvidence}`, ...accepted.result.evidence]
      parsed = accepted
      routed = retry
    }
  }
  const receipt = receiptFor(input, routed.ok ? routed.provider : provider, routed.ok ? routed.model : model, decision.routingDecisionId, parsed.failureClass ?? parsed.result.status, parsed.result.summary, parsed.failureClass)
  if (rejectedEvidence) receipt.evidenceInputs = [`REJECTED ${rejectedEvidence}`, ...receipt.evidenceInputs]
  return {
    receipt,
    result: parsed.result,
    failureClass: parsed.failureClass,
    activity,
    workerLabel: `${routed.ok ? routed.provider : provider}/${routed.ok ? routed.model : model}`,
    edit: parsed.edit,
    switchedWorker,
    localWorker: candidates.find(item => item.provider === (routed.ok ? routed.provider : provider) && item.model === (routed.ok ? routed.model : model))?.local ?? false,
    calls,
  }
}

export function specialistRequestFromCampaign(input: {
  campaign: EngineeringCampaign
  taskId: string
  role: CampaignRole
  purpose: string
  acceptance: string
  workingSet: string[]
  excerpts: { file: string; text: string }[]
  needsEdit: boolean
  attempt: number
  contractText?: string
}): FoundrySpecialistRequest {
  const campaign = input.campaign
  return {
    campaignId: campaign.missionId,
    taskId: input.taskId,
    role: input.role,
    missionContract: input.contractText || [campaign.request, ...campaign.acceptance].join('\n'),
    taskPurpose: input.purpose,
    acceptanceCriteria: [input.acceptance],
    workingSet: input.workingSet,
    projectFacts: [...campaign.knowledge.architecture, ...campaign.knowledge.tests].slice(0, 6),
    knownInterfaces: campaign.knowledge.interfaces.slice(0, 4),
    failureEvidence: campaign.repairFinding ? [campaign.repairFinding] : campaign.knowledge.failures.slice(-2),
    alreadyTried: campaign.progress?.triedSummaries?.slice(-4) ?? [],
    resourceBudget: { callsRemaining: campaign.modelCallBudget - campaign.modelCalls, ceiling: campaign.modelCallBudget },
    localOnly: campaign.localOnly,
    reasoningDepth: 'R1',
    excerpts: input.excerpts,
    needsEdit: input.needsEdit,
    pin: campaign.pin,
    attempt: input.attempt,
  }
}

export function campaignCallsRemaining(campaign: EngineeringCampaign): number {
  return Math.max(0, (campaign.modelCallBudget || MAX_MODEL_CALLS_PER_CAMPAIGN) - campaign.modelCalls)
}
