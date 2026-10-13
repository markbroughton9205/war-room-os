/**
 * Live mission + assignment authority for blueprint execution: SYNCHRONOUS, read-only readers over the existing War Room stores, feeding the
 * isolated ownership bridge (ownership.mjs). Sources: the Foundry mission record file (primary store ONLY - never the repo mirror, which can be stale)
 * and the Agent Ops log via deriveAssignments/deriveAgents (opened read-only). Nothing here can create, change, complete or cancel a mission or assignment.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { AgentOpsLog } from '@/lib/agents/ops/log'
import { deriveAssignments } from '@/lib/agents/ops/engineering/assignments'
import { deriveAgents } from '@/lib/agents/ops/registry'
import { foundryDataHierarchy } from '../foundryPaths'
import { createMissionOwnershipBridge } from './ownership.mjs'

const SAFE_ID = /^[A-Za-z0-9._-]{1,120}$/

/** Strict JSON (no torn-JSON recovery): an unreadable mission record is "unavailable", never "recovered". */
export function readMissionRecordSync(missionId: string): Record<string, unknown> | null {
  if (typeof missionId !== 'string' || !SAFE_ID.test(missionId)) return null
  const file = path.join(foundryDataHierarchy().missions, `${missionId}.json`)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const readOnlyLog = () => new AgentOpsLog(undefined, { readOnly: true })

export function readAssignmentViewSync(assignmentId: string) {
  if (typeof assignmentId !== 'string' || !SAFE_ID.test(assignmentId)) return null
  return deriveAssignments(readOnlyLog()).assignments.get(assignmentId) ?? null
}

export function readAgentStateSync(agentId: string): { state: string } | null {
  if (typeof agentId !== 'string' || !SAFE_ID.test(agentId)) return null
  const a = deriveAgents(readOnlyLog()).agents.get(agentId)
  return a ? { state: String(a.state) } : null
}

/** The bridge the broker consumes (`host.missions`): { resolve, verifyAssignment }. Frozen, read-only. */
export function createLiveOwnershipBridge() {
  return createMissionOwnershipBridge({
    readMission: readMissionRecordSync,
    readAssignment: readAssignmentViewSync,
    readAgent: readAgentStateSync,
  })
}
