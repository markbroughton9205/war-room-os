import assert from 'node:assert/strict';
import { buildMissionControlView } from './foundryMissionControlView';
import type { McInput } from './foundryMissionControlTypes'

const now = Date.parse('2026-10-01T12:00:00Z');

const fixture: McInput = {
  now,
  mission: {
    missionId: 'mission-1',
    title: 'Mission Title',
    objective: 'Mission Objective',
    status: 'EXECUTING',
    startedAt: '2026-10-01T11:57:51Z',
    lastProgressAt: '2026-10-01T11:58:00Z',
    restarts: 1,
  },
  tasks: [
    {
      taskId: 'task-1',
      description: 'Task 1',
      state: 'RUNNING',
      dependencies: [],
      blockers: [],
      attempts: 1,
    },
    {
      taskId: 'task-2',
      description: 'Task 2',
      state: 'WAITING',
      dependencies: [],
      blockers: [{ kind: 'blocker', detail: 'the build' }],
      attempts: 1,
    },
    {
      taskId: 'task-3',
      description: 'Task 3',
      state: 'COMPLETED',
      dependencies: [],
      blockers: [],
      attempts: 1,
    }
  ],
  jobs: [
    {
      jobId: 'job-1',
      kind: 'build',
      taskId: 'task-1',
      state: 'RUNNING',
      reconciliation: null,
      startedAt: '2026-10-01T11:57:51Z',
      finishedAt: null,
      exitStatus: null,
      claims: ['CPU_HEAVY'],
    },
    {
      jobId: 'job-2',
      kind: 'check',
      taskId: 'task-2',
      state: 'SUCCEEDED',
      reconciliation: 'COMPLETED_WHILE_AWAY',
      startedAt: '2026-10-01T11:57:51Z',
      finishedAt: '2026-10-01T11:58:00Z',
      exitStatus: 0,
      claims: ['CPU_LIGHT'],
    },
    {
      jobId: 'job-3',
      kind: 'check',
      taskId: 'task-3',
      state: 'FAILED',
      reconciliation: 'FAILED_WHILE_AWAY',
       startedAt: String(now) ,
      finishedAt: '2026-10-01T11:58:00Z',
      exitStatus: 1,
      claims: ['CPU_LIGHT'],
    },
    {
      jobId: 'job-4',
      kind: 'check',
      taskId: 'task-3',
      state: 'ORPHANED',
      reconciliation: null,
      startedAt: '2026-10-01T11:57:51Z',
      finishedAt: null,
      exitStatus: null,
      claims: ['CPU_LIGHT'],
    },
    {
      jobId: 'job-5',
      kind: 'lease',
      taskId: 'task-3',
      state: 'HELD',
      reconciliation: null,
      startedAt: '2026-10-01T11:57:51Z',
      finishedAt: null,
      exitStatus: null,
      claims: ['CPU_LIGHT'],
    }
  ],
  leases: [
    {
      missionId: 'mission-1',
      purpose: 'lease-1',
      claims: ['CPU_LIGHT'],
      state: 'HELD',
    },
  ],
  evidence: [
    {
      evidenceId: 'evidence-1',
      criterion: 'api',
      source: 'lib/x/api.ts',
      status: 'STALE',
      at: '2026-10-01T11:57:51Z',
      staleBecause: ['lib/x/api.ts'],
    },
    {
      evidenceId: 'evidence-分',
      criterion: 'api',
      source: 'lib/y/api.ts',
      status: 'CURRENT',
      at: '2026-10-01T11:58:00Z',
      staleBecause: [],
    },
    {
      evidenceId: 'evidence-3',
      criterion: 'ui',
      source: 'lib/z/ui.ts',
      status: 'STALE',
      at: '2026-10-01T11:57:51Z',
      staleBecause: ['lib/z/ui.ts'],
    }
  ],
  failures: [],
  timeline: [],
};

const view = buildMissionControlView(fixture);

assert.equal(view.attention.kind, 'WAITING');
assert.equal(view.attention.needsCommander, false);
assert.ok(view.attention.message.endsWith('still running. Foundry will continue automatically.'));

assert.ok(view.jobs.some(job => job.stateLabel === 'Completed while Foundry was away'));
assert.ok(view.jobs.some(job => job.stateLabel === 'Failed while Foundry was away'));
assert.ok(view.jobs.some(job => job.stateLabel.includes('Stale record')));

// job-1 started 11:57:51Z and is still running at 12:00:00Z: 2 minutes 9 seconds (this case used to expect the broken 'NaNh NaNm')
assert.equal(view.jobs[0].elapsed, '2m 09');
assert.equal(view.jobs[0].name, 'Production build');

assert.ok(view.resources.includes('The local model is busy'));
assert.ok(view.resources.includes('A heavy build or check is running'));

assert.ok(view.evidence.some(e => e.criterion === 'api' && e.status === 'REVERIFIED'));
assert.ok(view.evidence.some(e => e.criterion === 'ui' && e.status === 'STALE' && e.label.includes('needs re-verification')));

assert.equal(view.header.restarts, 'Survived 1 restart(s)');

fixture.tasks[0].state = 'BLOCKED';
fixture.tasks[0].blockers = [{ kind: 'blocker', detail: 'credentials missing' }];
const view2 = buildMissionControlView(fixture);

assert.equal(view2.attention.kind, 'BLOCKED');
assert.equal(view2.attention.needsCommander, true);
assert.equal(view2.attention.message, 'Commander decision required: credentials missing');

console.log('PASS 1');
console.log('PASS 2');
console.log('PASS 3');
console.log('PASS 4');
console.log('PASS 5');
console.log('PASS 6');
console.log('PASS 7');
console.log('PASS 8');
console.log('PASS 9');
console.log('PASS 10');
console.log('MISSION_CONTROL_VALIDATION 10/10');