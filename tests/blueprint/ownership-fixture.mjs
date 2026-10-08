 
// Hermetic MODEL of live mission + assignment records (shapes copied from foundryMissionTypes.ts / agents/ops/types.ts). Tests mutate it to simulate the real
// mission engine; the broker/bridge only ever READ it. Free-text fields hold SECRET markers to prove they never cross the bridge.
import { createMissionOwnershipBridge } from '../../lib/native-builder/blueprint/ownership.mjs'
export const PATHS = ['src/a.mjs', 'lib/new/c.mjs']
export function createLiveModel(wsRoot, { scope = [...PATHS, 'extra/other.mjs'] } = {}) {
  const m = { reads: 0, missions: new Map(), assignments: new Map(), agents: new Map() }
  m.missions.set('m-1', { missionId: 'm-1', status: 'EXECUTING', kind: 'application', cancelRequested: false, pauseRequested: false, controlRevision: 3, owner: 'SECRET-OWNER', title: 'SECRET-TITLE', userRequest: 'SECRET-REQUEST',
    workspaceBinding: { workspaceId: 'ws-1', workspaceRoot: wsRoot, boundAt: '2026-10-07T00:00:00.000Z', source: 'REQUEST' }, writeSet: { missionId: 'm-1', established: true, paths: scope, entries: [], readScope: [], protectedSubsystems: [] }, updatedAt: '2026-10-07T00:00:00.000Z' })
  m.assignments.set('a-1', { assignment: { id: 'a-1', idempotencyKey: 'k', agentId: 'agent-eng', parentMission: { id: 'm-1', title: 'SECRET-TITLE' }, taskClass: 'feature_implementation', capabilities: [], objective: 'SECRET-OBJECTIVE',
    expectedOutputs: [], completionConditions: [], workspace: { id: 'ws-1', root: wsRoot, kind: 'project' }, tools: ['read_workspace', 'write_workspace'], limits: {}, dependencies: [], createdBy: 'commander:cmd1', createdAt: '2026-10-07T00:00:00.000Z' }, state: 'RUNNING', events: [], cancellation: 'NONE', lastActivityAt: '2026-10-07T00:00:00.000Z' })
  m.agents.set('agent-eng', { state: 'ACTIVE' })
  m.set = (kind, id, patch) => Object.assign(m[kind].get(id), patch)
  m.mission = () => m.missions.get('m-1'); m.asg = () => m.assignments.get('a-1')
  m.bridge = createMissionOwnershipBridge({ readMission: id => { m.reads++; return m.missions.get(id) ?? null }, readAssignment: id => { m.reads++; return m.assignments.get(id) ?? null }, readAgent: id => m.agents.get(id) ?? null })
  m.snapshot = () => JSON.stringify([[...m.missions], [...m.assignments], [...m.agents]])
  return m
}
