import type { McInput } from './foundryMissionControlTypes';

export function describeClaim(claim: string): string {
  switch (claim) {
    case 'GPU':
      return 'the GPU';
    case 'CPU_HEAVY':
      return 'heavy CPU work';
    case 'MEMORY_HEAVY':
      return 'a lot of memory';
    case 'BROWSER_SESSION':
      return 'a browser session';
    case 'RUNTIME_CONTROL':
      return 'runtime control';
    case 'SUBSYSTEM_WRITE:build-output':
      return 'the build output';
    case 'PORT:N':
      return 'port N';
    case 'MODEL:ollama/X':
      return 'the local model X';
    case 'PROJECT_WRITE:PATH':
      return 'writing FILE';
    default:
      return claim;
  }
}

export function describeResources(jobs: McInput['jobs'], leases: McInput['leases']): string[] {
  const resourceLines = [];

  // Check for 'The local model is busy'
  if (leases.some(lease => lease.state === 'HELD')) {
    resourceLines.push('The local model is busy');
  }

  // Check for 'A heavy build or check is running'
  if (jobs.some(job => job.state === 'RUNNING' && job.claims.includes('CPU_HEAVY'))) {
    resourceLines.push('A heavy build or check is running');
  }

  // Check for 'A project writer is active'
  if (jobs.some(job => job.state === 'RUNNING' && job.claims.some(claim => claim.startsWith('PROJECT_WRITE:')))) {
    resourceLines.push('A project writer is active');
  }

  // Check for 'A browser session is claimed'
  if (
    jobs.some(job => job.state === 'RUNNING' && job.claims.includes('BROWSER_SESSION')) ||
    leases.some(lease => lease.state === 'HELD' && lease.claims.includes('BROWSER_SESSION'))
  ) {
    resourceLines.push('A browser session is claimed');
  }

  // Check for 'N heavy job(s) queued'
  const queuedJobs = jobs.filter(job => job.state === 'QUEUED');
  if (queuedJobs.length > 0) {
    resourceLines.push(`${queuedJobs.length} heavy job(s) queued`);
  }

  // If none of the above conditions are met, add 'No scarce resources are claimed'
  if (resourceLines.length === 0) {
    resourceLines.push('No scarce resources are claimed');
  }

  return resourceLines;
}