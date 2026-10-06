import type { McInput, McView } from './foundryMissionControlTypes';

export function describeAttention(input: McInput): McView['attention'] {
  // Rule 1: Check for BLOCKED status or tasks with state 'BLOCKED'
  if (input.mission.status === 'BLOCKED' || input.tasks.some(task => task.state === 'BLOCKED')) {
    const blockedTasks = input.tasks.filter(task => task.state === 'BLOCKED');
    let message = '';

    // Find the first non-empty detail from blockers of BLOCKED tasks
    for (const task of blockedTasks) {
      if (task.blockers.length > 0) {
        const firstNonEmptyDetail = task.blockers.find(blocker => blocker.detail.trim() !== '')?.detail;

        if (firstNonEmptyDetail) {
          message = `Commander decision required: ${firstNonEmptyDetail}`;
          break;
        }
      }
    }

    // If no non-empty detail found, use the default message
    if (!message) {
      message = 'Commander decision required: the mission is blocked';
    }

    return {
      kind: 'BLOCKED',
      needsCommander: true,
      message: message
    };
  }

  // Completion cannot hide active work, even when the durable mission status is COMPLETE.
  const activeJobs = input.jobs.some(job => job.state === 'RUNNING' || job.state === 'QUEUED');
  const graphComplete = input.tasks.every(task => task.state === 'COMPLETED' || task.state === 'CANCELLED')
    && input.tasks.some(task => task.state === 'COMPLETED');
  const standaloneComplete = input.mission.verifiedStandaloneCompletion === true && input.tasks.length === 0;
  if (input.mission.status === 'COMPLETE' && !activeJobs && (graphComplete || standaloneComplete)) {
    return {
      kind: 'COMPLETE',
      needsCommander: false,
      message: 'Foundry considers this mission complete'
    };
  }

  // Rule 3: Check for RUNNING, QUEUED jobs or WAITING tasks
  if (input.jobs.some(job => job.state === 'RUNNING' || job.state === 'QUEUED') || 
      input.tasks.some(task => task.state === 'WAITING')) {
    const runningOrQueuedJobs = input.jobs.filter(job => job.state === 'RUNNING' || job.state === 'QUEUED');
    const waitingTasks = input.tasks.filter(task => task.state === 'WAITING');

  const messageParts: string[] = [];

    // Add the kind of each running or queued job
    for (const job of runningOrQueuedJobs) {
      messageParts.push(job.kind);
    }

    // Add 'Background work' once for each WAITING task
    for (let index = 0; index < waitingTasks.length; index++) {
      messageParts.push('Background work');
    }

    const message = messageParts.join(' and ') + ' still running. Foundry will continue automatically.';

    return {
      kind: 'WAITING',
      needsCommander: false,
      message: message
    };
  }

  // Rule 4: Check for RUNNING or READY tasks
  if (input.tasks.some(task => task.state === 'RUNNING' || task.state === 'READY')) {
    return {
      kind: 'RUNNING',
      needsCommander: false,
      message: 'Foundry is working on the next task'
    };
  }

  // Rule 5: Default to IDLE
  return {
    kind: 'IDLE',
    needsCommander: false,
    message: 'Nothing is pending'
  };
}