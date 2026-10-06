import type { McTone } from './foundryMissionControlTypes';

export function describeTaskState(state: string): { label: string; tone: McTone } {
  switch (state) {
    case 'READY':
      return { label: 'Ready', tone: 'idle' };
    case 'RUNNING':
      return { label: 'Running', tone: 'ok' };
    case 'WAITING':
      return { label: 'Waiting - Foundry will continue automatically', tone: 'wait' };
    case 'BLOCKED':
      return { label: 'Needs the Commander', tone: 'blocked' };
    case 'COMPLETED':
      return { label: 'Completed', tone: 'ok' };
    case 'FAILED':
      return { label: 'Failed', tone: 'bad' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'idle' };
    default:
      return { label: 'Unknown', tone: 'bad' };
  }
}

export function describeJobState(state: string, reconciliation: string | null): { label: string; tone: McTone } {
  switch (state) {
    case 'QUEUED':
      return { label: 'Queued', tone: 'wait' };
    case 'RUNNING':
      return { label: 'Running', tone: 'ok' };
    case 'SUCCEEDED':
      if (reconciliation === 'COMPLETED_WHILE_AWAY') {
        return { label: 'Completed while Foundry was away', tone: 'ok' };
      }
      return { label: 'Completed', tone: 'ok' };
    case 'FAILED':
      if (reconciliation === 'FAILED_WHILE_AWAY') {
        return { label: 'Failed while Foundry was away', tone: 'bad' };
      }
      return { label: 'Failed', tone: 'bad' };
    case 'ORPHANED':
      return { label: 'Stale record - the process is gone and no result was written', tone: 'bad' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'idle' };
    default:
      return { label: 'Unknown', tone: 'bad' };
  }
}