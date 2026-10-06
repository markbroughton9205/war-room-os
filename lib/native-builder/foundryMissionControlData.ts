import type { McInput, McView, McTaskState } from './foundryMissionControlTypes';
import { buildMissionControlView } from './foundryMissionControlView';
import { readMissionControlSource, listExecutiveMissionIds } from './foundryMissionExecutiveRuntime';

export function buildMissionControlInput(source: NonNullable<ReturnType<typeof readMissionControlSource>>): McInput {
  const mission = source.mission;
  const state = source.state;
  
  const startedAt = mission.createdAt;
   const lastProgressAt = Math.max(
     Date.parse(mission.updatedAt),
     ...source.jobs.map(job => Date.parse(job.finishedAt || '0'))
   );
  const lastProgressAtIso = Number.isFinite(lastProgressAt) ? new Date(lastProgressAt).toISOString() : null;
  
  const restarts = Math.max(0, (source.state?.generations?.length || 0) - 1);

  const tasks = (state?.graph?.tasks ?? []).map(task => ({
    taskId: task.taskId,
    description: task.description,
    state: task.state as McTaskState,
    dependencies: task.dependencies,
    blockers: task.blockers.map(blocker => ({ kind: blocker.kind, detail: blocker.detail })),
    attempts: task.retryState?.attempts || 0
  }));

  const jobs = source.jobs.map(job => ({
    jobId: job.jobId,
    kind: job.kind,
    taskId: job.taskId,
    state: job.state,
    reconciliation: job.reconciliation || null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    exitStatus: job.exitStatus || null,
    claims: job.claims
  })) || [];

  const leases = source.leases.map(lease => ({
    missionId: lease.missionId,
    purpose: lease.purpose,
    claims: lease.claims,
    state: lease.state
  })) || [];

  const evidence = (state?.evidence ?? []).map(evidenceItem => ({
    evidenceId: evidenceItem.evidenceId,
    criterion: evidenceItem.criterion,
    source: evidenceItem.source,
    status: evidenceItem.status,
    at: evidenceItem.at,
    staleBecause: evidenceItem.staleBecause || []
  })) || [];

  const failures = Object.entries(state?.failures || {}).map(([key, failure]) => ({
    key,
    signature: failure.signature,
    count: Number(failure.count) || 0
  }));

  const timeline = source.agentEvents.filter(event => event.type === 'MISSION_EXECUTIVE').map(event => ({
    at: event.at,
    kind: 'event',
    text: event.text
  })) || [];

  return {
    now: Date.now(),
    mission: {
      missionId: mission.missionId,
      title: mission.title,
      objective: mission.objective,
      status: mission.status,
      verifiedStandaloneCompletion: mission.verifiedStandaloneCompletion === true,
      startedAt: startedAt,
      endedAt: mission.status === 'COMPLETE' ? (source.mission.completedAt || mission.updatedAt) : null,
      lastProgressAt: lastProgressAtIso,
      restarts: restarts
    },
    tasks: tasks,
    jobs: jobs,
    leases: leases,
    evidence: evidence,
    failures: failures,
    timeline: timeline
  };
}

export function loadMissionControlInput(missionId: string): McInput | null {
  const source = readMissionControlSource(missionId);
  return source ? buildMissionControlInput(source) : null;
}

export function loadMissionControlView(missionId: string): McView | null {
  const input = loadMissionControlInput(missionId);
  return input ? buildMissionControlView(input) : null;
}

/** listExecutiveMissionIds yields { missionId, mtimeMs } entries (a bare id is accepted too); String() of the entry itself gave "[object Object]". */
export function missionIdOf(entry: { missionId: string } | string): string {
  return typeof entry === 'string' ? entry : String(entry.missionId);
}

export function listMissionControlMissions(): { missionId: string; title: string; status: string }[] {
  const missions = listExecutiveMissionIds();
  return missions.map(entry => {
    const missionId = missionIdOf(entry);
    const source = readMissionControlSource(missionId);
    return { missionId, title: source?.mission.title || '', status: source?.mission.status || 'unknown' };
  });
}