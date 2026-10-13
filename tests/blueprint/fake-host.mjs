 
// Isolated FAKE host for broker tests: stands in for War Room session auth, mission/assignment ownership, workspace resolution,
// base identity and quality checks. NOT a War Room implementation.
import { createBaseIdentityAdapter, createCheckRegistry } from '../../lib/native-builder/blueprint/adapters.mjs'
import { createMemorySink } from '../../lib/native-builder/blueprint/phase9.mjs'
import fs from 'node:fs'
import path from 'node:path'

export const audit = { id: 'audit', version: '1', role: 'dependency-audit', source: 'audit-impl-v1', run: async () => ({ status: 'PASS', evidence: 'audit ok' }) }
export const behavior = { id: 'behavior', version: '1', role: 'behavior', source: 'behavior-impl-v1', run: async ({ root }) => ({ status: 'PASS', evidence: `a=${fs.readFileSync(path.join(root, 'src/a.mjs'), 'utf8').trim()}` }) }

export function createFakeHost({ now = Date.now, workspaces, checks = [audit, behavior], rev = { 'ws-1': 'rev1' }, policy = {}, sink = true, buildStage } = {}) {
  const tokens = new Map(), assignments = new Set(), state = { rev: { ...rev } }
  return {
    state, tokens, assignments,
    issue(token, fields) { tokens.set(token, { actorId: 'cmd1', role: 'commander', sessionId: `sess-${token}-0001`, authenticatedAt: now(), authenticationSource: 'fake-host', ...fields }) },
    sessions: { resolve: t => (tokens.has(t) ? structuredClone(tokens.get(t)) : null) },
    missions: { verifyAssignment: b => assignments.has(`${b.missionId}|${b.assignmentId}|${b.workspaceId}`) },
    workspaces: { resolve: id => workspaces[id] ?? null },
    baseIdentity: createBaseIdentityAdapter({ get: id => ({ kind: 'commit', value: state.rev[id] }), stableAcrossAdapterWrites: true }),
    checks: createCheckRegistry(checks),
    policy, phase9Sink: sink ? createMemorySink() : null, buildStage,
  }
}
