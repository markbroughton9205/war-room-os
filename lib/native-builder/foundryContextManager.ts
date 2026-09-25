/**
 * FoundryContextManager — layered mission context, token accounting, and compaction.
 * Layered context, retain-last compaction, orphan-tool filtering, and fallback summary
 * adapted from kkkhs/ClawdCode ContextManager / CompactionService
 * (MIT, commit 217a01369f9cb7d1ccc89c1fd9f50d6db2965b81, Copyright (c) 2026).
 * See docs/third-party/clawdcode.md.
 *
 * Never stuffs whole repositories into context. Foundry mission identity remains canonical.
 */
import { estimateTokens } from './foundryLocalModelRuntime'
import { compactModelContext } from './foundryContextCheckpoints'
import { loadSkillsForRole } from './foundryAgentSkills'
import { redactSecretLikeText } from './foundrySensitivePathGuard'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryModelContext } from './foundryModelTypes'

export const FOUNDRY_CONTEXT_DEFAULTS = {
  maxTokens: 24_000,
  compactionThreshold: 18_000,
  retainRecentObservations: 24,
  retainToolResults: 8,
  retainExcerpts: 8,
  maxExcerptChars: 1_200,
  maxPackChars: 8_000,
} as const

export type FoundryContextLayer = {
  task: string
  projectFacts: string[]
  approvedSpec: string[]
  recentObservations: string[]
  toolResults: string[]
  engineeringMemory: string[]
  atlasPacks: string[]
  conversationSummary: string
}

export type FoundryContextPack = {
  missionId: string
  estimatedTokens: number
  compacted: boolean
  layers: FoundryContextLayer
}

const SECRET_SOURCE = /\.env|credential|secret|id_rsa|\.pem/i

function compactText(value: string, max = FOUNDRY_CONTEXT_DEFAULTS.maxExcerptChars): string {
  const redacted = redactSecretLikeText(value)
  return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted
}

function conversationSummary(mission: FoundryMissionRecord): string {
  const user = compactText(mission.userRequest, 400)
  const goal = compactText(mission.goal, 240)
  const findings = [
    ...(mission.architectureFindings ?? []),
    ...(mission.codeDecisions ?? []),
    ...(mission.testFindings ?? []),
  ].slice(-6).map(item => compactText(item, 180))
  const pending = mission.plan.filter(step => step.status === 'pending' || step.status === 'active').map(step => step.title).slice(0, 8)
  return [
    `Primary request: ${user}`,
    `Goal: ${goal}`,
    findings.length ? `Key findings: ${findings.join(' | ')}` : 'Key findings: none yet',
    pending.length ? `Pending: ${pending.join('; ')}` : 'Pending: none',
    mission.blocker ? `Blocker: ${compactText(mission.blocker.blocker, 200)}` : 'Blocker: none',
  ].join('\n')
}

export function shouldCompactFoundryContext(estimatedTokens: number, threshold = FOUNDRY_CONTEXT_DEFAULTS.compactionThreshold): boolean {
  return estimatedTokens > threshold
}

export function buildFoundryContextPack(
  mission: FoundryMissionRecord,
  loopWarning?: string,
  options?: { local?: boolean },
): { pack: FoundryContextPack; modelContext: FoundryModelContext } {
  const modelContext = compactModelContext(mission, loopWarning, options)
  const atlas = loadSkillsForRole({
    role: 'ARCHITECT',
    missionText: mission.userRequest,
    workspaceContext: mission.workspace ?? mission.goal,
  })
  const recentObservations = mission.observations
    .slice(-FOUNDRY_CONTEXT_DEFAULTS.retainRecentObservations)
    .filter(item => !SECRET_SOURCE.test(item.source) && !SECRET_SOURCE.test(item.text))
    .map(item => compactText(`${item.source}: ${item.text}`))
  const toolResults = modelContext.recentToolResults
    .slice(-FOUNDRY_CONTEXT_DEFAULTS.retainToolResults)
    .map(item => compactText(`${item.tool} ${item.ok ? 'ok' : 'FAIL'}: ${item.excerpt ?? item.error ?? item.reason}`))
  const layers: FoundryContextLayer = {
    task: compactText(mission.goal, 500),
    projectFacts: [
      mission.workspace ? `workspace=${mission.workspace}` : 'workspace=bound-mission',
      `kind=${mission.kind}`,
      `status=${mission.status}`,
      `changed=${mission.sourceState.changedFiles.slice(-8).join(',') || 'none'}`,
    ],
    approvedSpec: (mission.successCriteria ?? []).slice(0, 8).map(item => compactText(String(item), 240)),
    recentObservations,
    toolResults,
    engineeringMemory: [
      mission.engineering?.compactLine ? `${mission.engineering.compactLine.headline}: ${mission.engineering.compactLine.detail}` : '',
      ...(mission.engineering?.allowedChangeSet ?? []).slice(0, 6),
    ].filter(Boolean).map(item => compactText(String(item), 240)),
    atlasPacks: atlas.skills.slice(0, 3).map(skill => compactText(`${skill.skillId}: ${skill.purpose}. ${skill.procedure}`, 400)),
    conversationSummary: conversationSummary(mission),
  }
  const packed = [
    layers.task,
    layers.conversationSummary,
    ...layers.projectFacts,
    ...layers.approvedSpec,
    ...layers.recentObservations,
    ...layers.toolResults,
    ...layers.atlasPacks,
  ].join('\n')
  const estimatedTokens = estimateTokens(packed)
  const compacted = shouldCompactFoundryContext(estimatedTokens)
  if (compacted) {
    modelContext.recentToolResults = modelContext.recentToolResults.slice(-6)
    modelContext.relevantExcerpts = modelContext.relevantExcerpts.slice(-6)
    modelContext.importantFindings = [
      `[Context compacted] ${layers.conversationSummary}`,
      ...modelContext.importantFindings.slice(-12),
    ]
  }
  mission.contextPack = {
    missionId: mission.missionId,
    estimatedTokens,
    compacted,
    layers,
  }
  return { pack: mission.contextPack, modelContext }
}

export function foundryContextForModel(
  mission: FoundryMissionRecord,
  loopWarning?: string,
  options?: { local?: boolean },
): FoundryModelContext {
  return buildFoundryContextPack(mission, loopWarning, options).modelContext
}

export function filterOrphanToolObservations(observations: Array<{ source: string; text: string }>): Array<{ source: string; text: string }> {
  return observations.filter(item => item.text.trim().length > 0 && !/^tool (FAIL|ok):?\s*$/i.test(item.text))
}
