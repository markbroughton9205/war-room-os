/**
 * Machine-checkable engineering gates. Missing evidence that a known tool can
 * acquire is a TOOL action, not a REPLAN. No fixture-specific filenames or answers.
 */
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryModelDecision } from './foundryModelTypes'
import { ensureEngineeringState } from './foundryEngineeringDepth'
import type { EngineeringActionIntent } from './foundryEngineeringContract'

export const ENGINEERING_GATE_IDS = [
  'UNDERSTAND_DONE',
  'MAP_DONE',
  'IMPACT_DONE',
  'BASELINE_DONE',
  'PLAN_DONE',
  'SOURCE_DONE',
  'SELF_REVIEW_DONE',
  'TARGETED_TESTS_DONE',
  'REGRESSION_DONE',
  'BUILD_DONE',
  'PACKAGE_DONE',
  'INSTALL_DONE',
  'ACTIVATE_DONE',
  'VERIFY_DONE',
] as const

export type EngineeringGateId = (typeof ENGINEERING_GATE_IDS)[number]

export type NextRequiredActionClass = 'TOOL' | 'FOCUSED_READ' | 'REPLAN' | 'COMPLETE' | 'BLOCKED'

export type ReplanJustification =
  | 'HYPOTHESIS_INVALIDATED'
  | 'OWNER_REJECTED'
  | 'TARGET_REJECTED'
  | 'REPEATED_NO_EVIDENCE'
  | 'PLAN_DEPENDENCY_CHANGED'
  | 'IMPLEMENTATION_DISPROVED'

export type EngineeringGateRow = {
  gate: EngineeringGateId
  status: 'DONE' | 'MISSING'
  whyMissing: string | null
  availableTools: string[]
  recommendedToolClass: string | null
}

export type EngineeringGateTable = {
  currentIntent: EngineeringActionIntent
  rows: EngineeringGateRow[]
  missing: EngineeringGateId[]
  nextRequiredAction: NextRequiredActionClass
  recommendedToolClass: string | null
  availableTools: string[]
  evidenceRequired: string
  stopCondition: string
  compact: string
}

export const GENERIC_TOOL_EXAMPLES = [
  '{"decision":"TOOL","reasoningSummary":"search","tool":{"name":"workspace.search","args":{"query":"ExampleComponent"}}}',
  '{"decision":"TOOL","reasoningSummary":"map owners","tool":{"name":"code.owners","args":{"query":"ExampleComponent"}}}',
  '{"decision":"TOOL","reasoningSummary":"impact","tool":{"name":"code.impact","args":{"query":"ExampleComponent","paths":["src/example.ts"]}}}',
  '{"decision":"TOOL","reasoningSummary":"baseline","tool":{"name":"engineering.baseline","args":{"paths":["src/example.ts"]}}}',
  '{"decision":"TOOL","reasoningSummary":"read region","tool":{"name":"file.read","args":{"path":"src/example.ts","aroundMatch":"export function ExampleComponent"}}}',
  '{"decision":"TOOL","reasoningSummary":"create small file","tool":{"name":"file.write","args":{"path":"src/example.ts","content":"export const FLAG=true\\n","reason":"add flag"}}}',
  '{"decision":"TOOL","reasoningSummary":"bounded edit","tool":{"name":"file.replace_unique","args":{"path":"src/example.ts","anchorId":"<anchorId-from-file.read>","replacementText":"NEW_LABEL","reason":"update label"}}}',
  '{"decision":"TOOL","reasoningSummary":"bounded retry","tool":{"name":"file.replace_unique","args":{"path":"src/example.ts","anchorId":"<anchorId-from-file.read>","replacementText":"NEW_LABEL","reason":"retry with fresh anchor"}}}',
  '{"decision":"TOOL","reasoningSummary":"self review","tool":{"name":"engineering.review","args":{}}}',
  '{"decision":"TOOL","reasoningSummary":"run ranked test","tool":{"name":"terminal.execute","args":{"operation":{"id":"node_test","targets":["sample.test.ts"]}}}}',
].join('\n')

const FIXTURE_LEAK_MARKERS = [
  'greeting.txt',
  'FoundryMissionControllerPanel.tsx',
  'Engineering Review',
  'SYSTEM GO',
  'PASS 008',
  'PASS 009',
  'PASS 010',
]

export function genericExampleForTool(tool: string | null | undefined): string {
  if (!tool) return ''
  const lines = GENERIC_TOOL_EXAMPLES.split('\n')
  const hit = lines.find(line => line.includes(`"name":"${tool}"`) && (tool !== 'file.replace_unique' || line.includes('anchorId')))
    ?? lines.find(line => line.includes(`"name":"${tool}"`))
  return hit ?? ''
}

export function genericToolExamplesLeakFixtureAnswers(source = GENERIC_TOOL_EXAMPLES): string[] {
  return FIXTURE_LEAK_MARKERS.filter(marker => source.includes(marker))
}

function toolSucceeded(mission: FoundryMissionRecord, ...names: string[]): boolean {
  return mission.toolCalls.some(call => call.ok && names.includes(call.tool))
}

function lastFailed(mission: FoundryMissionRecord, name: string) {
  return [...mission.toolCalls].reverse().find(call => call.tool === name && !call.ok)
}

function recentText(mission: FoundryMissionRecord): string {
  const findings = (mission.architectureFindings ?? []).slice(-8).join('\n')
  const observations = mission.observations.slice(-8).map(item => item.text).join('\n')
  const errors = mission.errors.slice(-6).map(item => item.message).join('\n')
  const last = mission.toolCalls.at(-1)
  return `${findings}\n${observations}\n${errors}\n${last?.error ?? ''}\n${last?.excerpt ?? ''}`
}

function readPaths(mission: FoundryMissionRecord): string[] {
  return mission.toolCalls
    .filter(call => call.ok && call.tool === 'file.read')
    .map(call => {
      const excerpt = call.excerpt ?? ''
      return /"relPath":"([^"]+)"/.exec(excerpt)?.[1]
        ?? /^PATH:\n(\S+)/.exec(excerpt)?.[1]
        ?? /^(\S+) sha=/.exec(excerpt)?.[1]
        ?? ''
    })
    .filter(Boolean)
}

function productionPipelineRequired(mission: FoundryMissionRecord): boolean {
  return mission.kind === 'application'
}

function gateIntent(gate: EngineeringGateId | null): EngineeringActionIntent {
  switch (gate) {
    case 'UNDERSTAND_DONE': return 'UNDERSTAND'
    case 'MAP_DONE': return 'MAP'
    case 'IMPACT_DONE': return 'IMPACT'
    case 'BASELINE_DONE': return 'BASELINE'
    case 'PLAN_DONE': return 'PLAN'
    case 'SOURCE_DONE': return 'EDIT'
    case 'SELF_REVIEW_DONE': return 'SELF_REVIEW'
    case 'TARGETED_TESTS_DONE': return 'VALIDATE'
    case 'REGRESSION_DONE': return 'REGRESSION'
    case 'BUILD_DONE': return 'BUILD'
    case 'PACKAGE_DONE': return 'PACKAGE'
    case 'INSTALL_DONE': return 'INSTALL'
    case 'ACTIVATE_DONE': return 'ACTIVATE'
    case 'VERIFY_DONE': return 'VERIFY'
    default: return 'COMPLETE'
  }
}

function toolsForGate(mission: FoundryMissionRecord, gate: EngineeringGateId): { available: string[]; recommended: string; why: string } {
  const searched = toolSucceeded(mission, 'workspace.search', 'workspace.inspect')
  const owners = ensureEngineeringState(mission).ownership?.owners ?? []
  const reads = readPaths(mission)
  const ownerRead = owners.length > 0 && reads.some(path =>
    owners.some(owner => owner === path || owner.endsWith(path.split('/').pop() ?? '') || path.includes(owner) || owner.includes(path)),
  )
  const boundedFail = lastFailed(mission, 'file.replace_unique')?.error ?? ''
  switch (gate) {
    case 'UNDERSTAND_DONE':
      return { available: ['workspace.search'], recommended: 'workspace.search', why: 'no interpretation of the request yet' }
    case 'MAP_DONE':
      return {
        available: searched ? ['code.owners', 'code.refs', 'code.dependents'] : ['workspace.search', 'code.owners', 'code.refs', 'code.dependents'],
        recommended: searched ? 'code.owners' : 'workspace.search',
        why: 'ownership map has not been captured',
      }
    case 'IMPACT_DONE':
      return { available: ['code.impact'], recommended: 'code.impact', why: 'change-impact map has not been captured' }
    case 'BASELINE_DONE':
      return { available: ['engineering.baseline'], recommended: 'engineering.baseline', why: 'pre-edit baseline hashes have not been captured' }
    case 'PLAN_DONE':
      return { available: ['engineering.plan'], recommended: 'engineering.plan', why: 'engineering plan is empty' }
    case 'SOURCE_DONE': {
      const recovery = ensureEngineeringState(mission).editMatchRecovery
      const lintRec = ensureEngineeringState(mission).lintRegionRecovery
      const lintFailed = mission.plan.some(step => step.intent === 'LINT' && step.status === 'failed')
      if (lintFailed) {
        if (lintRec?.nextRequiredAction === 'REPLAN' || (lintRec?.retryUsed && lintRec.focusedReadDone)) {
          return {
            available: [],
            recommended: 'REPLAN',
            why: 'lint region focused read plus one replacement still fail lint. REPLAN with lint evidence.',
          }
        }
        if (lintRec?.focusedReadDone || lintRec?.nextRequiredAction === 'BOUNDED_RETRY') {
          return {
            available: ['file.replace_unique', 'lint.run'],
            recommended: 'file.replace_unique',
            why: 'lint-region WINDOW acquired; CURRENT_STATE=BOUNDED_RETRY. One bounded retry using the returned anchorId. Keep surrounding source/JSX valid. Do not file.read.',
          }
        }
        return {
          available: ['file.read', 'file.replace_unique', 'lint.run'],
          recommended: 'file.read',
          why: 'lint failed after the bounded edit; FOCUSED_READ the failing region and retry one unique replacement',
        }
      }
      if (recovery?.status === 'EDIT_MATCH_RECOVERY') {
        if (recovery.nextRequiredAction === 'FOCUSED_READ') {
          return {
            available: ['file.read', 'file.replace_unique'],
            recommended: 'file.read',
            why: `EDIT_MATCH_RECOVERY ${recovery.code}: FOCUSED_READ around a short already-observed literal. Broker returns EDIT_ANCHOR. Mutation remains available.`,
          }
        }
        if (recovery.nextRequiredAction === 'BOUNDED_RETRY') {
          return {
            available: ['file.replace_unique'],
            recommended: 'file.replace_unique',
            why: recovery.code === 'INVALID_REPLACEMENT'
              ? `EDIT_MATCH_RECOVERY INVALID_REPLACEMENT: CURRENT_STATE=BOUNDED_RETRY. Call file.replace_unique with ANCHOR_ID=${recovery.lastAnchorId ?? 'current'}. Preserve PROTECTED_BINDINGS. Do not file.read.`
              : `EDIT_MATCH_RECOVERY ${recovery.code}: CURRENT_STATE=BOUNDED_RETRY. One bounded retry using the returned anchorId. Do not reconstruct matchText. Do not file.read.`,
          }
        }
        if (recovery.nextRequiredAction === 'BLOCK') {
          return {
            available: [],
            recommended: 'BLOCKED',
            why: `EDIT_MATCH_RECOVERY INVALID_REPLACEMENT: three invalid replacements. BLOCK with exact missing binding evidence. Do not empty-REPLAN.`,
          }
        }
        if (recovery.nextRequiredAction === 'REPLAN') {
          return {
            available: [],
            recommended: 'REPLAN',
            why: `EDIT_MATCH_RECOVERY ${recovery.code}: focused read plus one retry failed. REPLAN with match-failure evidence.`,
          }
        }
      }
      if (/STALE_FILE_HASH|STALE_EDIT_ANCHOR|MATCH_NOT_FOUND|MATCH_NOT_UNIQUE|INVALID_REPLACEMENT/.test(boundedFail)) {
        const code = /STALE_EDIT_ANCHOR/.test(boundedFail)
          ? 'STALE_EDIT_ANCHOR'
          : /STALE_FILE_HASH/.test(boundedFail)
            ? 'STALE_FILE_HASH'
            : /MATCH_NOT_UNIQUE/.test(boundedFail)
              ? 'MATCH_NOT_UNIQUE'
              : /INVALID_REPLACEMENT/.test(boundedFail)
                ? 'INVALID_REPLACEMENT'
                : 'MATCH_NOT_FOUND'
        if (code === 'INVALID_REPLACEMENT') {
          return {
            available: ['file.replace_unique'],
            recommended: 'file.replace_unique',
            why: 'EDIT_MATCH_RECOVERY INVALID_REPLACEMENT: CURRENT_STATE=BOUNDED_RETRY. Keep the same anchorId and correct replacementText. Do not file.read unless STALE_EDIT_ANCHOR.',
          }
        }
        return {
          available: ['file.read', 'file.replace_unique'],
          recommended: 'file.read',
          why: `EDIT_MATCH_RECOVERY ${code}: FOCUSED_READ around a short already-observed literal, then one bounded retry with the returned anchorId.`,
        }
      }
      if (!ownerRead) {
        return {
          available: ['file.read', 'file.replace_unique'],
          recommended: 'file.read',
          why: 'target region has not been read',
        }
      }
      return {
        available: ['file.replace_unique'],
        recommended: 'file.replace_unique',
        why: 'source mutation has not been applied through Tool Broker',
      }
    }
    case 'SELF_REVIEW_DONE':
      if (ensureEngineeringState(mission).selfReview?.status === 'FAIL') {
        return {
          available: ['file.replace_unique', 'engineering.review', 'git.diff'],
          recommended: 'file.replace_unique',
          why: 'self-review failed; apply a tighter unique replacement then review again',
        }
      }
      return { available: ['engineering.review', 'git.diff'], recommended: 'engineering.review', why: 'self-review has not been recorded' }
    case 'TARGETED_TESTS_DONE':
      return { available: ['terminal.execute', 'test.run', 'lint.run'], recommended: 'terminal.execute', why: 'targeted validation has not passed' }
    case 'REGRESSION_DONE':
      return { available: ['lint.run', 'typecheck.run', 'terminal.execute'], recommended: 'lint.run', why: 'bounded regression has not passed' }
    case 'BUILD_DONE':
      return { available: ['build.run'], recommended: 'build.run', why: 'production build has not passed' }
    case 'PACKAGE_DONE':
      return { available: ['package.run'], recommended: 'package.run', why: 'package has not passed' }
    case 'INSTALL_DONE':
      return { available: ['installer.install_production'], recommended: 'installer.install_production', why: 'production install has not passed' }
    case 'ACTIVATE_DONE':
      return { available: ['installer.activate'], recommended: 'installer.activate', why: 'install has not been activated for this mission installId' }
    case 'VERIFY_DONE':
      if (mission.installState.installId && mission.runtimeState.activeInstallId === mission.installState.installId) {
        return { available: ['runtime.transition_to_active', 'runtime.verify'], recommended: 'runtime.transition_to_active', why: 'mission install is active but runtime identity is not verified' }
      }
      return { available: ['runtime.verify'], recommended: 'runtime.verify', why: 'runtime identity has not been verified' }
  }
}

export function buildEngineeringGateTable(mission: FoundryMissionRecord): EngineeringGateTable {
  const engineering = ensureEngineeringState(mission)
  const pipeline = productionPipelineRequired(mission)
  const mapped = Boolean(engineering.ownership?.owners?.length) || toolSucceeded(mission, 'code.owners')
  const impacted = Boolean(engineering.impact?.targetFiles?.length || engineering.impact?.owners?.length) || toolSucceeded(mission, 'code.impact')
  const baselined = Boolean(mission.baseline?.recordedAt) || Boolean(mission.sourceState.baselineFiles.length) || toolSucceeded(mission, 'engineering.baseline')
  const understood = Boolean(mission.interpretation) || mission.toolCalls.length > 0
  const planned = mission.plan.length > 0 || toolSucceeded(mission, 'engineering.plan')
  const sourced = mission.sourceState.changedFiles.length > 0
  const lintFailed = mission.plan.some(step => step.intent === 'LINT' && step.status === 'failed')
  const reviewed = engineering.selfReview?.status === 'PASS'
  const tested = mission.testState.ok === true
  const regression = engineering.regressionOk === true
    || (mission.kind === 'application' && mission.plan.some(step => (step.intent === 'LINT' || step.intent === 'TYPECHECK') && (step.status === 'done' || step.status === 'skipped')))
  const built = mission.buildState.ok === true
  const packed = mission.packageState.ok === true
  const installed = Boolean(mission.installState.installId) && mission.installState.ok === true
  const missionInstall = mission.installState.installId
  const activated = Boolean(missionInstall)
    && mission.runtimeState.activeInstallId === missionInstall
  const verified = mission.runtimeState.identityMatch === true
    && mission.runtimeState.activeInstallId === missionInstall
    && mission.runtimeState.runningInstallId === missionInstall

  const recovering = Boolean(engineering.editMatchRecovery && !sourced)
  const done: Record<EngineeringGateId, boolean> = {
    UNDERSTAND_DONE: understood || sourced || recovering,
    MAP_DONE: mapped || sourced || recovering,
    IMPACT_DONE: impacted || sourced || recovering,
    BASELINE_DONE: baselined || sourced || recovering,
    PLAN_DONE: planned || sourced || recovering,
    SOURCE_DONE: sourced && !lintFailed,
    SELF_REVIEW_DONE: !sourced || reviewed,
    TARGETED_TESTS_DONE: !sourced || tested,
    REGRESSION_DONE: !sourced || regression,
    BUILD_DONE: !pipeline || !sourced || built,
    PACKAGE_DONE: !pipeline || !sourced || packed,
    INSTALL_DONE: !pipeline || !sourced || installed,
    ACTIVATE_DONE: !pipeline || !sourced || activated,
    VERIFY_DONE: !pipeline || !sourced || verified,
  }

  const rows: EngineeringGateRow[] = ENGINEERING_GATE_IDS.map(gate => {
    const status = done[gate] ? 'DONE' : 'MISSING'
    if (status === 'DONE') {
      return { gate, status, whyMissing: null, availableTools: [], recommendedToolClass: null }
    }
    const tools = toolsForGate(mission, gate)
    return {
      gate,
      status,
      whyMissing: tools.why,
      availableTools: tools.available,
      recommendedToolClass: tools.recommended,
    }
  })

  const missing = rows.filter(row => row.status === 'MISSING').map(row => row.gate)
  const first = rows.find(row => row.status === 'MISSING') ?? null
  let nextRequiredAction: NextRequiredActionClass = first ? 'TOOL' : 'COMPLETE'
  let availableTools = first?.availableTools ?? []
  let recommendedToolClass = first?.recommendedToolClass ?? null
  let evidenceRequired = first?.whyMissing ?? 'all engineering gates are satisfied'
  const recovery = engineering.editMatchRecovery
  const lintRec = engineering.lintRegionRecovery
  const lintFailedNow = mission.plan.some(step => step.intent === 'LINT' && step.status === 'failed')
  if (sourced && lintFailedNow) {
    if (lintRec?.nextRequiredAction === 'REPLAN' || (lintRec?.retryUsed && lintRec.focusedReadDone && lintFailedNow)) {
      nextRequiredAction = 'REPLAN'
      availableTools = []
      recommendedToolClass = null
      evidenceRequired = 'lint region focused read plus one replacement still fail lint. REPLAN with lint evidence.'
    } else if (lintRec?.focusedReadDone) {
      nextRequiredAction = 'TOOL'
      availableTools = ['file.replace_unique', 'lint.run']
      recommendedToolClass = 'file.replace_unique'
      evidenceRequired = 'lint-region WINDOW acquired; CURRENT_STATE=BOUNDED_RETRY. One bounded retry using the returned anchorId. Keep surrounding source/JSX valid. Do not file.read.'
    } else {
      nextRequiredAction = 'FOCUSED_READ'
      availableTools = ['file.read', 'file.replace_unique', 'lint.run']
      recommendedToolClass = 'file.read'
      evidenceRequired = 'lint failed after the bounded edit; FOCUSED_READ the failing region and retry one unique replacement'
    }
  }
  if (!sourced && recovery?.status === 'EDIT_MATCH_RECOVERY' && first?.gate === 'SOURCE_DONE') {
    if (recovery.nextRequiredAction === 'FOCUSED_READ') {
      nextRequiredAction = 'FOCUSED_READ'
      availableTools = ['file.read', 'file.replace_unique']
      recommendedToolClass = 'file.read'
      evidenceRequired = `EDIT_MATCH_RECOVERY ${recovery.code}: FOCUSED_READ around a short already-observed literal. Broker returns EDIT_ANCHOR. Mutation remains available.`
    } else if (recovery.nextRequiredAction === 'BOUNDED_RETRY') {
      nextRequiredAction = 'TOOL'
      availableTools = ['file.replace_unique']
      recommendedToolClass = 'file.replace_unique'
      evidenceRequired = recovery.code === 'INVALID_REPLACEMENT'
        ? `EDIT_MATCH_RECOVERY INVALID_REPLACEMENT: CURRENT_STATE=BOUNDED_RETRY. Keep ANCHOR_ID=${recovery.lastAnchorId ?? 'current'}. Preserve PROTECTED_BINDINGS. Do not file.read.`
        : `EDIT_MATCH_RECOVERY ${recovery.code}: CURRENT_STATE=BOUNDED_RETRY. One bounded retry using the returned anchorId. Do not reconstruct matchText. Do not file.read.`
    } else if (recovery.nextRequiredAction === 'BLOCK') {
      nextRequiredAction = 'BLOCKED'
      availableTools = []
      recommendedToolClass = null
      evidenceRequired = 'EDIT_MATCH_RECOVERY INVALID_REPLACEMENT: three invalid replacements. BLOCK. Do not empty-REPLAN.'
    } else if (recovery.nextRequiredAction === 'REPLAN') {
      nextRequiredAction = 'REPLAN'
      availableTools = []
      recommendedToolClass = null
      evidenceRequired = `EDIT_MATCH_RECOVERY ${recovery.code}: focused read plus one retry failed. REPLAN with match-failure evidence.`
    }
  }
  const currentIntent = gateIntent(first?.gate ?? null)
  if (mission.status === 'ACTIVATION_PENDING' || engineering.activationPending) {
    nextRequiredAction = 'TOOL'
    availableTools = ['installer.activate']
    recommendedToolClass = 'installer.activate'
    evidenceRequired = `ACTIVATION_PENDING MISSION_INSTALL_ID=${mission.installState.installId ?? ''} Call installer.activate for this mission install only.`
  }
  const toolStillRequired = nextRequiredAction === 'TOOL' || nextRequiredAction === 'FOCUSED_READ'
  const stopCondition = toolStillRequired
    ? (nextRequiredAction === 'FOCUSED_READ'
      ? 'Call file.read once around a short already-observed literal. Do not REPLAN. Do not dump the file.'
      : 'Acquire missing engineering evidence with a TOOL. Do not REPLAN or BLOCKED because this gate is incomplete.')
    : nextRequiredAction === 'REPLAN'
      ? 'REPLAN with the bounded-edit failure evidence. Do not continue overlapping source reads.'
      : nextRequiredAction === 'BLOCKED'
        ? 'BLOCK with the exact INVALID_REPLACEMENT evidence. Do not empty-REPLAN.'
      : 'All required engineering gates are satisfied. Return COMPLETE.'
  const compact = [
    `CURRENT_INTENT=${currentIntent}`,
    `MISSING_GATES=${missing.join(',') || 'none'}`,
    `AVAILABLE_TOOL_CLASSES=${availableTools.join(',') || 'none'}`,
    `PRIMARY_OWNER=${engineering.ownership?.owners?.[0] ?? 'none'}`,
    `RANKED_TESTS=${(engineering.rankedTests ?? []).slice(0, 3).map(item => item.test).join(',') || 'none'}`,
    `NEXT_REQUIRED_ACTION=${nextRequiredAction}`,
    recommendedToolClass ? `RECOMMENDED_TOOL_CLASS=${recommendedToolClass}` : '',
    `EVIDENCE_REQUIRED=${evidenceRequired}`,
    `STOP_CONDITION=${stopCondition}`,
  ].filter(Boolean).join('\n')

  const table: EngineeringGateTable = {
    currentIntent,
    rows,
    missing,
    nextRequiredAction,
    recommendedToolClass,
    availableTools,
    evidenceRequired,
    stopCondition,
    compact,
  }
  engineering.gateTable = {
    compact,
    nextRequiredAction,
    recommendedToolClass,
    missing,
  }
  return table
}

export function compactGatePrompt(table: EngineeringGateTable): string {
  return table.compact
}

export function classifyReplanJustification(
  mission: FoundryMissionRecord,
  decision?: Pick<FoundryModelDecision, 'reasoningSummary' | 'planChanges'>,
): ReplanJustification | null {
  const text = `${decision?.reasoningSummary ?? ''}\n${recentText(mission)}`
  if (ensureEngineeringState(mission).editMatchRecovery?.nextRequiredAction === 'REPLAN') {
    return 'REPEATED_NO_EVIDENCE'
  }
  if (ensureEngineeringState(mission).lintRegionRecovery?.nextRequiredAction === 'REPLAN') {
    return 'IMPLEMENTATION_DISPROVED'
  }
  if (ensureEngineeringState(mission).identicalActionCount && (ensureEngineeringState(mission).identicalActionCount ?? 0) >= 2) {
    return 'REPEATED_NO_EVIDENCE'
  }
  if (/NOT_OWNER|WRITE TARGET REJECTED|OWNER_EVIDENCE_REQUIRED/.test(text)) return 'OWNER_REJECTED'
  if (/NOT_RUNTIME_REFERENCED|NO_DEPENDENTS|NO_TEST_ASSOCIATION|NO_MISSION_EVIDENCE|CHANGE_BOUNDARY|TERRA_LOCKED/.test(text)) {
    return 'TARGET_REJECTED'
  }
  const hypotheses = decision?.planChanges?.hypotheses ?? mission.hypotheses ?? []
  if (hypotheses.some(item => item.status === 'REJECTED')) return 'HYPOTHESIS_INVALIDATED'
  if (/contradict|invalidated hypothesis|wrong owner|disproved/.test(text) && /FAIL|rejected|NOT_/.test(text)) {
    return 'HYPOTHESIS_INVALIDATED'
  }
  if (decision?.planChanges?.removeStepIds?.length || decision?.planChanges?.reorderStepIds?.length) {
    return 'PLAN_DEPENDENCY_CHANGED'
  }
  if (mission.testState.ok === false || /IMPLEMENTATION_BUG|TEST_EXPECTATION_OUTDATED/.test(text)) {
    return 'IMPLEMENTATION_DISPROVED'
  }
  return null
}

export function evaluateReplanDecision(
  mission: FoundryMissionRecord,
  decision?: Pick<FoundryModelDecision, 'reasoningSummary' | 'planChanges'>,
): {
  allowed: boolean
  code: 'REPLAN_ALLOWED' | 'REPLAN_NOT_JUSTIFIED'
  justification: ReplanJustification | null
  missingGate: EngineeringGateId | null
  recommendedToolClass: string | null
  evidenceRequired: string
  compact: string
} {
  const table = buildEngineeringGateTable(mission)
  const justification = classifyReplanJustification(mission, decision)
  const missingGate = table.missing[0] ?? null
  const toolStillRequired = table.nextRequiredAction === 'TOOL' || table.nextRequiredAction === 'FOCUSED_READ'
  if (toolStillRequired && !justification) {
    const compact = [
      'REPLAN_NOT_JUSTIFIED',
      `MISSING_GATE=${missingGate ?? 'unknown'}`,
      `RECOMMENDED_TOOL_CLASS=${table.recommendedToolClass ?? 'none'}`,
      `EVIDENCE_REQUIRED=${table.evidenceRequired}`,
      'Acquire missing engineering evidence with a TOOL before using REPLAN.',
    ].join('\n')
    return {
      allowed: false,
      code: 'REPLAN_NOT_JUSTIFIED',
      justification: null,
      missingGate,
      recommendedToolClass: table.recommendedToolClass,
      evidenceRequired: table.evidenceRequired,
      compact,
    }
  }
  return {
    allowed: true,
    code: 'REPLAN_ALLOWED',
    justification,
    missingGate,
    recommendedToolClass: table.recommendedToolClass,
    evidenceRequired: table.evidenceRequired,
    compact: `REPLAN_ALLOWED justification=${justification ?? 'none'}`,
  }
}

export function evaluateBlockedDecision(
  mission: FoundryMissionRecord,
  decision?: Pick<FoundryModelDecision, 'reasoningSummary' | 'blocker'>,
): {
  allowed: boolean
  code: 'BLOCKED_ALLOWED' | 'BLOCKED_REFUSED'
  compact: string
  recommendedToolClass: string | null
} {
  const table = buildEngineeringGateTable(mission)
  const recovery = ensureEngineeringState(mission).editMatchRecovery
  if (recovery?.nextRequiredAction === 'BOUNDED_RETRY' && (recovery.invalidReplacementAttempts ?? 0) < 3) {
    return {
      allowed: false,
      code: 'BLOCKED_REFUSED',
      compact: [
        'BLOCKED_REFUSED',
        'CURRENT_STATE=BOUNDED_RETRY',
        `ANCHOR_ID=${recovery.lastAnchorId ?? 'none'}`,
        'A missing gate is remaining work. Return TOOL with file.replace_unique using the same anchorId. Do not BLOCKED.',
      ].join('\n'),
      recommendedToolClass: 'file.replace_unique',
    }
  }
  if (recovery?.nextRequiredAction === 'BLOCK' || (recovery?.invalidReplacementAttempts ?? 0) >= 3) {
    return {
      allowed: true,
      code: 'BLOCKED_ALLOWED',
      compact: 'BLOCKED_ALLOWED INVALID_REPLACEMENT after 3 attempts',
      recommendedToolClass: null,
    }
  }
  const text = `${decision?.reasoningSummary ?? ''} ${decision?.blocker?.blocker ?? ''} ${decision?.blocker?.evidence ?? ''} ${decision?.blocker?.why ?? ''}`
  const resourceOrAuth = /PROVIDER_SLOT|WAITING_RESOURCE|authorization|TERRA_LOCKED|GENERATED_OR_VENDOR|OUTSIDE_WORKSPACE/i.test(text)
  if ((table.nextRequiredAction !== 'TOOL' && table.nextRequiredAction !== 'FOCUSED_READ') || resourceOrAuth) {
    return {
      allowed: true,
      code: 'BLOCKED_ALLOWED',
      compact: 'BLOCKED_ALLOWED',
      recommendedToolClass: table.recommendedToolClass,
    }
  }
  const recommended = table.recommendedToolClass
  const recommendedAttempted = recommended
    ? mission.toolCalls.some(call => call.tool === recommended)
    : false
  const echoesGate = Boolean(table.evidenceRequired && text.includes(table.evidenceRequired))
    || /source mutation has not been applied|missing engineering evidence|MISSING_GATES|EVIDENCE_REQUIRED/i.test(text)
  if (!recommendedAttempted || echoesGate) {
    const compact = [
      'BLOCKED_REFUSED',
      `MISSING_GATE=${table.missing[0] ?? 'unknown'}`,
      `RECOMMENDED_TOOL_CLASS=${recommended ?? 'none'}`,
      `EVIDENCE_REQUIRED=${table.evidenceRequired}`,
      'A missing gate is remaining work. Return TOOL with RECOMMENDED_TOOL_CLASS. Do not BLOCKED.',
    ].join('\n')
    return {
      allowed: false,
      code: 'BLOCKED_REFUSED',
      compact,
      recommendedToolClass: recommended,
    }
  }
  return {
    allowed: true,
    code: 'BLOCKED_ALLOWED',
    compact: 'BLOCKED_ALLOWED',
    recommendedToolClass: recommended,
  }
}
