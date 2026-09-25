import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryModelContext } from './foundryModelTypes'
import { FOUNDRY_MODEL_TOOL_CATALOG, toolAllowedByPermissions } from './foundryToolCatalog'

const MAX_EXCERPT_CHARS = 2_000
const MAX_TOTAL_EXCERPT_CHARS = 10_000

function relevantExcerpts(mission: FoundryMissionRecord): FoundryModelContext['relevantExcerpts'] {
  let total = 0
  const selected: FoundryModelContext['relevantExcerpts'] = []
  for (const observation of mission.observations.slice(-30).reverse()) {
    if (!/file\.read|browser\.|computer\.|logs\.|workspace\.search/.test(observation.source)) continue
    const text = observation.text.slice(0, MAX_EXCERPT_CHARS)
    if (total + text.length > MAX_TOTAL_EXCERPT_CHARS) continue
    selected.unshift({ source: observation.source, text })
    total += text.length
    if (selected.length >= 10) break
  }
  return selected
}

export function buildFoundryModelContext(
  mission: FoundryMissionRecord,
  loopWarning?: string,
): FoundryModelContext {
  const importantFindings = [
    ...(mission.architectureFindings ?? []),
    ...(mission.codeDecisions ?? []),
    ...(mission.testFindings ?? []),
    ...(mission.runtimeFindings ?? []),
    ...(mission.engineering?.impact ? [`IMPACT ${mission.engineering.impact.owners.slice(0, 4).join(', ')} risk=${mission.engineering.impact.risks.join(',') || 'none'}`] : []),
    ...(mission.engineering?.selfReview ? [`SELF_REVIEW ${mission.engineering.selfReview.status}`] : []),
    ...(mission.engineering?.diagnosis ? [`FAILURE ${mission.engineering.diagnosis.classification}: ${mission.engineering.diagnosis.next}`] : []),
  ].slice(-24)
  const missing = mission.completionGate?.missing ?? []
  if (mission.kind === 'fixture' && (missing[0] === 'SOURCE_DONE' || missing.includes('SOURCE_DONE'))) {
    importantFindings.unshift('GATE: this is a fixture mission. Search, read, then patch the fixture source. Do not call runtime.verify, build.run, package.run, installer.*, or runtime.transition_to_active.')
  }
  if (mission.kind === 'app_builder' || mission.capabilityLane === 'APPLICATION_BUILDER') {
    importantFindings.unshift('GATE: Application Builder. Write only inside the isolated project root. Do not package, install, activate, or live-deploy War Room. Do not invent business facts. Do not hardcode secrets.')
  }
  if (missing[0] === 'BUILD_DONE') {
    importantFindings.unshift('GATE: first missing item is BUILD_DONE. Request build.run now. A prior same-mission BUSY was nested BUILD_PIPELINE + withBuildLock; that lock is now reentrant for this missionId. Inspecting lock source cannot clear BUILD_DONE.')
  }
  if (missing[0] === 'BROWSER_ACCEPTANCE') {
    importantFindings.unshift('GATE: only BROWSER_ACCEPTANCE remains. ACTIVE_RUNTIME is released after activate/transition. Retry browser.start, then browser.navigate to http://127.0.0.1:3848/war-room/engineering, then browser.screenshot. Do not BLOCKED: PERSISTENT_BROWSER can be acquired after REPO_WRITE.')
  }
  return {
    missionId: mission.missionId,
    missionKind: mission.kind,
    userRequest: mission.userRequest,
    goal: mission.goal,
    successCriteria: mission.successCriteria,
    constraints: mission.constraints,
    permissions: mission.permissions,
    phase: mission.phase,
    plan: mission.plan.map(step => ({ id: step.id, title: step.title, status: step.status })),
    hypotheses: (mission.hypotheses ?? []).slice(-12),
    changedFiles: mission.sourceState.changedFiles.slice(-30),
    importantFindings,
    relevantExcerpts: relevantExcerpts(mission),
    visualEvidence: mission.artifacts.slice(-8),
    recentToolResults: mission.toolCalls.slice(-10).map(call => ({
      tool: call.tool,
      ok: call.ok,
      reason: call.reason,
      excerpt: call.excerpt?.slice(0, MAX_EXCERPT_CHARS),
      error: call.error?.slice(0, MAX_EXCERPT_CHARS),
    })),
    recentErrors: mission.errors.slice(-8).map(error => ({
      klass: error.klass,
      message: error.message.slice(0, MAX_EXCERPT_CHARS),
    })),
    unresolvedQuestions: mission.context.unresolvedQuestions.slice(-10),
    completionGate: mission.completionGate,
    loopWarning,
    tools: FOUNDRY_MODEL_TOOL_CATALOG.filter(entry => {
      if (!toolAllowedByPermissions(entry, mission.permissions)) return false
      if (mission.kind === 'app_builder' || mission.capabilityLane === 'APPLICATION_BUILDER') {
        if (['build.run', 'package.run', 'installer.install_production', 'installer.activate', 'runtime.transition_to_active', 'deploy.run'].includes(entry.name)) return false
      }
      if (mission.kind === 'application' && ['terminal.execute', 'validation.run', 'process.start'].includes(entry.name)) {
        return false
      }
      if (mission.kind === 'application' && entry.name === 'test.run') {
        return Boolean(mission.engineering?.selectedTests?.length)
      }
      if (mission.kind === 'application' && entry.name === 'test.list_suites') {
        return Boolean(mission.engineering?.selectedTests?.length)
      }
      return true
    }),
  }
}
