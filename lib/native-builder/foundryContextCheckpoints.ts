import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryContextCheckpoint } from './foundryOperationsTypes'
import { foundryDataHierarchy } from './foundryPaths'
import { buildFoundryModelContext } from './foundryModelContext'
import { buildLocalFoundryModelContext } from './foundryLocalModelRuntime'
import type { FoundryModelContext } from './foundryModelTypes'

const ARCHIVE_AFTER = 24

export function buildMissionCheckpoint(mission: FoundryMissionRecord, nextIntendedAction = ''): FoundryContextCheckpoint {
  return {
    checkpointId: randomUUID(),
    missionId: mission.missionId,
    at: new Date().toISOString(),
    goal: mission.goal,
    currentPlan: mission.plan.map(step => `${step.status}:${step.intent}:${step.title}`),
    confirmedFindings: [
      ...(mission.architectureFindings ?? []),
      ...(mission.codeDecisions ?? []),
      ...(mission.testFindings ?? []),
      ...(mission.runtimeFindings ?? []),
    ].slice(-24),
    rejectedHypotheses: (mission.hypotheses ?? [])
      .filter(item => item.status === 'REJECTED')
      .map(item => item.statement)
      .slice(-12),
    architectureDiscoveries: (mission.architectureFindings ?? []).slice(-12),
    changedFiles: mission.sourceState.changedFiles.slice(-40),
    currentErrors: mission.errors.slice(-8).map(error => `${error.klass}: ${error.message}`),
    runtimeState: `active=${mission.runtimeState.activeInstallId} running=${mission.runtimeState.runningInstallId} match=${mission.runtimeState.identityMatch}`,
    latestVisualState: mission.artifacts.at(-1) ?? mission.browserState.detail ?? 'none',
    unresolvedQuestions: [
      ...(mission.context.unresolvedQuestions ?? []),
      ...(mission.blocker ? [mission.blocker.blocker] : []),
    ].slice(-10),
    nextIntendedAction: nextIntendedAction || mission.currentAction || mission.modelState?.lastExpectedObservation || '',
  }
}

export async function persistCheckpoint(mission: FoundryMissionRecord, checkpoint: FoundryContextCheckpoint): Promise<void> {
  const root = path.join(foundryDataHierarchy().checkpoints, mission.missionId)
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, `${checkpoint.checkpointId}.json`), JSON.stringify(checkpoint, null, 2), 'utf8')
  await appendFile(path.join(root, 'index.jsonl'), `${JSON.stringify({ id: checkpoint.checkpointId, at: checkpoint.at })}\n`, 'utf8')
  mission.latestCheckpointId = checkpoint.checkpointId
}

export async function archiveOldObservations(mission: FoundryMissionRecord): Promise<number> {
  if (mission.observations.length <= ARCHIVE_AFTER) return 0
  const archived = mission.observations.slice(0, mission.observations.length - ARCHIVE_AFTER)
  const keep = mission.observations.slice(-ARCHIVE_AFTER)
  const file = path.join(foundryDataHierarchy().observationArchives, `${mission.missionId}.observations.jsonl`)
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, archived.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf8')
  mission.observations = keep
  return archived.length
}

export function compactModelContext(mission: FoundryMissionRecord, loopWarning?: string, options?: { local?: boolean }): FoundryModelContext {
  if (options?.local) return buildLocalFoundryModelContext(mission, loopWarning)
  const context = buildFoundryModelContext(mission, loopWarning)
  context.recentToolResults = context.recentToolResults.slice(-6)
  context.relevantExcerpts = context.relevantExcerpts.slice(-6)
  context.importantFindings = context.importantFindings.slice(-16)
  return context
}

export function shouldCheckpoint(mission: FoundryMissionRecord, tool?: string): boolean {
  if (tool && /build\.run|package\.run|installer\.|runtime\.transition/.test(tool)) return true
  return mission.loopCount > 0 && mission.loopCount % 6 === 0
}
