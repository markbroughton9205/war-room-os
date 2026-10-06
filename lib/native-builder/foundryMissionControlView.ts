import { type McInput, type McView, type McTaskState } from './foundryMissionControlTypes';
import { describeTaskState } from './foundryMissionControlStatus';
import { formatDuration, describeJobs } from './foundryMissionControlJobs';
import { describeResources } from './foundryMissionControlResources';
import { describeEvidence } from './foundryMissionControlEvidence';
import { describeAttention } from './foundryMissionControlAttention';
import { describeTimeline } from './foundryMissionControlTimeline';

export function buildMissionControlView(input: McInput): McView {
  const { now, mission, tasks, jobs, leases, evidence, failures, timeline } = input;

  const stateLabel =
    mission.status === 'COMPLETE' ? 'Complete' :
    mission.status === 'BLOCKED' ? 'Needs the Commander' :
    mission.status === 'CANCELLED' ? 'Cancelled' :
    mission.status === 'FAILED' ? 'Failed' :
    mission.status === 'PAUSED' ? 'Paused' :
    mission.status === 'RECOVERING' ? 'Recovering' :
    mission.status === 'WAITING_AUTHORIZATION' ? 'Waiting for authorization' :
    mission.status === 'WAITING_RESOURCE' ? 'Waiting for resource' :
    'In progress';

  const tone =
    mission.status === 'COMPLETE' ? 'ok' :
    mission.status === 'FAILED' ? 'bad' :
    mission.status === 'BLOCKED' ? 'blocked' :
    mission.status === 'CANCELLED' ? 'idle' :
    mission.status === 'PAUSED' ? 'wait' :
    mission.status === 'RECOVERING' ? 'wait' :
    mission.status === 'WAITING_AUTHORIZATION' ? 'wait' :
    mission.status === 'WAITING_RESOURCE' ? 'wait' :
    'ok';

  const endedMs = mission.status === 'COMPLETE' && mission.endedAt ? Date.parse(mission.endedAt) : NaN;
  const elapsed = formatDuration((Number.isFinite(endedMs) ? endedMs : now) - Date.parse(mission.startedAt));

  const phase =
    mission.status === 'COMPLETE' ? 'Done' :
    mission.status === 'FAILED' ? 'Failed' :
    mission.status === 'CANCELLED' ? 'Cancelled' :
    mission.status === 'BLOCKED' ? 'Needs the Commander' :
    mission.status === 'PAUSED' ? 'Paused' :
    mission.status === 'RECOVERING' ? 'Recovering' :
    mission.status === 'WAITING_AUTHORIZATION' ? 'Waiting for authorization' :
    mission.status === 'WAITING_RESOURCE' ? 'Waiting for resource' :
    'Working';

  const lastProgress = 
    mission.lastProgressAt === null ? 'No progress recorded yet' : 
    formatDuration(now - Date.parse(mission.lastProgressAt)) + ' ago';

  const next = 
    tasks.find(task => task.state === 'READY') ? 
      'Start ' + describeTaskState(tasks.find(task => task.state === 'READY')!.state).label : 
    jobs.find(job => job.state === 'RUNNING') ? 
       'Wait for ' + jobs.find(job => job.state === 'RUNNING')!.kind : 'Nothing pending';

  const restarts = mission.restarts > 0 ? 'Survived ' + mission.restarts + ' restart(s)' : 'No restarts';

  const attention = describeAttention(input);

  const taskGroups = Object.values(
    tasks.reduce((acc, task: McInput['tasks'][0]) => {
      const { state } = task;
      if (!acc[state]) {
        acc[state] = { state, items: [] };
      }
      acc[state].items.push(task);
      return acc;
}, {} as Record<string, { state: McTaskState; items: { taskId: string; description: string; state: McTaskState; dependencies: string[]; blockers: { kind: string; detail: string; }[]; attempts: number; }[] }>)
  ).map((group: { state: string; items: McInput['tasks'][0][] }) => ({
    group,
    label: describeTaskState(group.state).label,
    items: group.items.map((task: McInput['tasks'][0]) => ({
      taskId: task.taskId,
      title: task.description.substring(0, 80),
      detail:
        (task.state === 'WAITING' || task.state === 'BLOCKED') ?
          (task.blockers[0]?.detail ?? task.description) :
          task.attempts > 1 ? 'Attempt ' + task.attempts : '',
      tone: describeTaskState(task.state).tone,
    })),
  })).filter(group => group.items.length > 0);

  const jobsDescription = describeJobs(jobs, now);
  const resourcesDescription = describeResources(jobs, leases);
  const evidenceDescription = describeEvidence(evidence);
  const timelineDescription = describeTimeline(timeline, 40);
  const failuresDescription = failures.filter(failure => failure.count >= 2).map(failure => `${failure.key} failed ${failure.count} times`);

  return {
    header: {
      title: mission.title,
      objective: mission.objective,
      stateLabel,
      tone,
      elapsed,
      phase,
      lastProgress,
      next,
      restarts,
    },
    attention,
    taskGroups: taskGroups.map(group => ({ ...group, state: (group.group.state || 'incomplete') as McTaskState })),
    jobs: jobsDescription,
    resources: resourcesDescription,
    evidence: evidenceDescription,
    timeline: timelineDescription,
    failures: failuresDescription,
  };
}
