export type McTaskState = 'READY' | 'RUNNING' | 'WAITING' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type McTone = 'ok' | 'wait' | 'blocked' | 'bad' | 'idle';

export type McInput = {
  now: number;
  mission: {
    missionId: string;
    title: string;
    objective: string;
    status: string;
    startedAt: string;
    /** When a COMPLETE mission completed (persisted); elapsed freezes here. Null/absent while the mission is not complete. */
    endedAt?: string | null;
    /** Positive durable gate/transition evidence from the source reader, excluding executive graph work. */
    verifiedStandaloneCompletion?: boolean;
    lastProgressAt: string | null;
    restarts: number;
  };
  tasks: Array<{
    taskId: string;
    description: string;
    state: McTaskState;
    dependencies: string[];
    blockers: Array<{ kind: string; detail: string }>;
    attempts: number;
  }>;
  jobs: Array<{
    jobId: string;
    kind: string;
    taskId: string;
    state: string;
    reconciliation: string | null;
    startedAt: string;
    finishedAt: string | null;
    exitStatus: number | null;
    claims: string[];
  }>;
  leases: Array<{
    missionId: string;
    purpose: string;
    claims: string[];
    state: string;
  }>;
  evidence: Array<{
    evidenceId: string;
    criterion: string;
    source: string;
    status: 'CURRENT' | 'STALE';
    at: string;
    staleBecause: string[];
  }>;
  failures: Array<{
    key: string;
    signature: string;
    count: number;
  }>;
  timeline: Array<{
    at: string;
    kind: string;
    text: string;
  }>;
};

export type McView = {
  header: {
    title: string;
    objective: string;
    stateLabel: string;
    tone: McTone;
    elapsed: string;
    phase: string;
    lastProgress: string;
    next: string;
    restarts: string;
  };
  attention: {
    kind: 'WAITING' | 'BLOCKED' | 'RUNNING' | 'COMPLETE' | 'IDLE';
    message: string;
    needsCommander: boolean;
  };
  taskGroups: Array<{
    state: McTaskState;
    label: string;
    items: Array<{
      taskId: string;
      title: string;
      detail: string;
      tone: McTone;
    }>;
  }>;
  jobs: Array<{
    jobId: string;
    name: string;
    taskId: string;
    stateLabel: string;
    tone: McTone;
    elapsed: string;
    result: string;
    claims: string;
  }>;
  resources: string[];
  evidence: Array<{
    criterion: string;
    proof: string;
    status: 'CURRENT' | 'STALE' | 'REVERIFIED';
    label: string;
    tone: McTone;
  }>;
  timeline: Array<{
    at: string;
    text: string;
  }>;
  failures: string[];
};