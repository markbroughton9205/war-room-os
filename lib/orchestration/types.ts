export const ORCHESTRATION_TASK_KINDS = ['noop', 'emit', 'run_worker'] as const

export type OrchestrationTaskKind = (typeof ORCHESTRATION_TASK_KINDS)[number]

export type OrchestrationTask = {
  id: string
  kind: OrchestrationTaskKind
  payload: Record<string, unknown>
}

export function isOrchestrationTaskKind(value: string): value is OrchestrationTaskKind {
  return (ORCHESTRATION_TASK_KINDS as readonly string[]).includes(value)
}
