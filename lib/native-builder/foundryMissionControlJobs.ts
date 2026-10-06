import type { McInput, McView } from './foundryMissionControlTypes';
import { describeJobState } from './foundryMissionControlStatus';
import { describeClaim } from './foundryMissionControlResources';

/** Job times arrive as ISO strings (epoch-millisecond strings are accepted too). */
const toMs = (value: string): number => (/^\d+$/.test(value) ? Number(value) : Date.parse(value));

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return 'unknown';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  } else if (totalSeconds < 3600) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}`;
  } else {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
}

export function describeJobs(jobs: McInput['jobs'], now: number): McView['jobs'] {
  return jobs.map((job) => ({
    jobId: job.jobId,
    taskId: job.taskId,
    name:
      job.kind === 'task'
        ? 'Authoring ' + job.taskId
        : job.kind === 'build'
        ? 'Production build'
        : job.kind === 'typecheck'
        ? 'Whole-project typecheck'
        : job.kind === 'test'
        ? 'Test suite'
        : job.kind === 'lint'
        ? 'Lint'
        : job.kind,
    stateLabel: describeJobState(job.state, job.reconciliation).label,
    tone: describeJobState(job.state, job.reconciliation).tone,
    elapsed: formatDuration(
      (job.finishedAt ? toMs(job.finishedAt) : now) - toMs(job.startedAt)
    ),
    result:
      job.state === 'SUCCEEDED'
        ? 'Passed'
        : job.state === 'FAILED'
        ? `Failed (exit ${job.exitStatus})`
        : job.state === 'RUNNING'
        ? 'In progress'
        : job.state === 'QUEUED'
        ? 'Waiting for resources'
        : job.state === 'ORPHANED'
        ? 'Result unknown'
        : job.state === 'CANCELLED'
        ? 'Cancelled'
        : job.state,
    claims: job.claims.map(describeClaim).join(', '),
  }));
}