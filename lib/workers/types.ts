export const WORKER_IDS = [
  'internet_monitor',
  'red_sentinel',
  'repo_health',
  'deployment_status',
  'action_queue',
  'memory_proposals',
] as const

export type WorkerId = (typeof WORKER_IDS)[number]

export function isWorkerId(value: string): value is WorkerId {
  return (WORKER_IDS as readonly string[]).includes(value)
}

export type WorkerRunResult = {
  workerId: WorkerId
  ok: boolean
  startedAt: string
  finishedAt: string
  detail?: Record<string, unknown>
  error?: string
  skippedReason?: string
}
