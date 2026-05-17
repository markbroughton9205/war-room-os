import type { AgentQueueItem, DurableWorker, FoundryAgent } from './agentBlueprints'

export function buildDurableWorkers(agents: FoundryAgent[], persistence: DurableWorker['persistence']): DurableWorker[] {
  return agents.map((agent, index) => ({
    id: `worker-${agent.blueprintId}`,
    name: `${agent.name} Worker`,
    kind: agent.operationalRole === 'retrieval'
      ? 'retrieval'
      : agent.operationalRole === 'forecasting'
        ? 'forecasting'
        : agent.operationalRole === 'repair_analysis'
          ? 'repair_monitoring'
          : agent.operationalRole === 'provider_health'
            ? 'provider_health'
            : agent.operationalRole === 'workflow_coordination'
              ? 'workflow_coordination'
              : agent.operationalRole === 'monitoring'
                ? 'monitoring'
                : 'analytics',
    assignedAgentBlueprintId: agent.blueprintId,
    state: agent.state === 'active' ? 'ready' : agent.state === 'degraded' ? 'degraded' : agent.state === 'paused' ? 'paused' : 'idle',
    queueDepth: agent.state === 'active' ? index % 3 : 0,
    memoryScope: agent.memoryScope,
    operationalHistory: agent.activityHistory.slice(-5),
    externalExecutionAllowed: false,
    persistence,
  }))
}

export function routeScopedAgentTask(input: {
  sourceAgentId: string
  targetAgentId: string
  kind: AgentQueueItem['kind']
  payload: Record<string, unknown>
}): AgentQueueItem {
  return {
    id: `agent-queue-${input.sourceAgentId}-${input.targetAgentId}-${Date.now()}`,
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    kind: input.kind,
    status: 'queued',
    payload: {
      ...input.payload,
      externalExecutionAllowed: false,
      auditRequired: true,
    },
    createdAt: new Date().toISOString(),
  }
}

export function buildCoordinationSummary(workers: DurableWorker[], queueRows: number | null) {
  const queueDepth = workers.reduce((sum, worker) => sum + worker.queueDepth, 0) + (queueRows ?? 0)
  return {
    queueDepth,
    readyWorkers: workers.filter(worker => worker.state === 'ready').length,
    degradedWorkers: workers.filter(worker => worker.state === 'degraded').length,
    persistentQueueRows: queueRows,
    coordinationRule: 'Agents coordinate through auditable queues and scoped messages; no worker executes external effects.',
  }
}
