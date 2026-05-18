import 'server-only'

let lastOrchestrationStepResult: Record<string, unknown> | null = null

export function setLastOrchestrationStepResult(result: Record<string, unknown>) {
  lastOrchestrationStepResult = result
}

export function getLastOrchestrationStepResult() {
  return lastOrchestrationStepResult
}
