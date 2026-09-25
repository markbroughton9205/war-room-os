/**
 * Convert an approved plan/spec into a dependency graph. Planning Mode binds spec/requirement IDs.
 */
import { randomUUID } from 'node:crypto'
import type { FoundryAgentRole, FoundryCommandCenterGraph, FoundryTaskPriority, FoundryTaskRecord } from './foundryAgentTypes'
import { FOUNDRY_TASK_PRIORITY_RANK } from './foundryAgentTypes'

export type GraphSeedTask = {
  title: string
  role: FoundryAgentRole
  dependsOnTitles?: string[]
  mutating?: boolean
  writeSet?: string[]
  requirementIds?: string[]
  priority?: FoundryTaskPriority
  phase?: FoundryTaskRecord['currentPhase']
}

export function buildTaskGraph(input: {
  missionId: string
  projectId: string
  projectName: string
  projectRoot: string
  goal: string
  planningMode?: boolean
  specId?: string | null
  specVersion?: string | null
  specApproved?: boolean
  priority?: FoundryTaskPriority
  engineeringClass?: import('./foundryContractTypes').FoundryEngineeringClass
  missionContractId?: string | null
  acceptanceContractId?: string | null
  tasks: GraphSeedTask[]
}): FoundryCommandCenterGraph {
  const graphId = randomUUID()
  const now = new Date().toISOString()
  const titleToId = new Map<string, string>()
  const tasks: FoundryTaskRecord[] = input.tasks.map((seed, index) => {
    const taskId = `TASK-${String(index + 1).padStart(3, '0')}`
    titleToId.set(seed.title, taskId)
    const planningHold = Boolean(input.planningMode) && !input.specApproved
    return {
      taskId,
      title: seed.title,
      projectId: input.projectId,
      projectName: input.projectName,
      missionId: input.missionId,
      graphId,
      role: seed.role,
      status: planningHold ? 'PLANNING' : (seed.dependsOnTitles?.length ? 'QUEUED' : 'READY'),
      priority: seed.priority ?? input.priority ?? 'NORMAL',
      workspaceId: null,
      agentId: null,
      dependsOn: [],
      startedAt: null,
      currentPhase: seed.phase ?? 'queued',
      latestAction: planningHold ? 'Waiting for approved spec.' : 'Queued.',
      tests: { ok: null, detail: '' },
      result: '',
      blocker: planningHold ? 'Approved spec required before mutating work.' : null,
      specId: input.specId ?? null,
      specVersion: input.specVersion ?? null,
      requirementIds: seed.requirementIds ?? [],
      filesChanged: [],
      guidance: [],
      repairHistory: [],
      retryCount: 0,
      maxRetries: 2,
      mutating: seed.mutating ?? (seed.role !== 'RESEARCHER' && seed.role !== 'REVIEWER' && seed.role !== 'VERIFIER' && seed.role !== 'TEST' && seed.role !== 'RELEASE'),
      writeSet: seed.writeSet ?? [],
      modelRouting: null,
      missionContractId: input.missionContractId ?? null,
      acceptanceContractId: input.acceptanceContractId ?? null,
    }
  })
  for (let i = 0; i < input.tasks.length; i++) {
    const seed = input.tasks[i]
    tasks[i].dependsOn = (seed.dependsOnTitles ?? []).map(title => titleToId.get(title)).filter((id): id is string => Boolean(id))
    if (tasks[i].status === 'QUEUED' && tasks[i].dependsOn.length === 0 && tasks[i].status !== 'PLANNING') {
      tasks[i].status = 'READY'
    }
  }
  promoteReady(tasks)
  return {
    graphId,
    missionId: input.missionId,
    projectId: input.projectId,
    projectName: input.projectName,
    projectRoot: input.projectRoot,
    goal: input.goal,
    planningMode: Boolean(input.planningMode),
    specId: input.specId ?? null,
    specVersion: input.specVersion ?? null,
    specApproved: Boolean(input.specApproved),
    status: tasks.some(task => task.status === 'PLANNING') ? 'PLANNING' : 'QUEUED',
    paused: false,
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
    tasks,
    agents: [],
    workspaces: [],
    artifacts: [],
    traces: tasks.flatMap(task => task.requirementIds.map(requirementId => ({
      requirementId,
      taskId: task.taskId,
      files: [],
      tests: [],
      status: 'PENDING' as const,
    }))),
    instructionSources: [],
    skillsLoaded: [],
    result: null,
    preview: null,
    recoveryCount: 0,
    lastRecoveryAt: null,
    engineeringClass: input.engineeringClass,
    missionContractId: input.missionContractId ?? null,
    acceptanceContractId: input.acceptanceContractId ?? null,
    missionContractHash: null,
    acceptanceContractHash: null,
    reviewOutcome: null,
    verdictId: null,
  }
}

export function promoteReady(tasks: FoundryTaskRecord[]): void {
  const done = new Set(tasks.filter(task => task.status === 'COMPLETE').map(task => task.taskId))
  for (const task of tasks) {
    if (task.status === 'QUEUED' && task.dependsOn.every(id => done.has(id))) {
      task.status = 'READY'
      task.latestAction = 'Dependencies complete; ready to schedule.'
    }
  }
}

export function ticketManagerGraphSeeds(): GraphSeedTask[] {
  return [
    {
      title: 'Inspect schema and requirements',
      role: 'ARCHITECT',
      mutating: true,
      writeSet: ['.foundry/instructions.md', '.foundry/contracts/api.json', 'README.md', 'package.json'],
      requirementIds: ['REQ-001', 'REQ-002'],
      phase: 'spec',
    },
    {
      title: 'Design migration and API contract',
      role: 'DATABASE',
      dependsOnTitles: ['Inspect schema and requirements'],
      mutating: true,
      writeSet: ['db.mjs', '.foundry/contracts/schema.json'],
      requirementIds: ['REQ-001', 'REQ-003'],
      phase: 'contract',
    },
    {
      title: 'Backend implementation',
      role: 'BACKEND',
      dependsOnTitles: ['Design migration and API contract'],
      mutating: true,
      writeSet: ['server.mjs', 'db.mjs'],
      requirementIds: ['REQ-003', 'REQ-004'],
      phase: 'implement',
    },
    {
      title: 'Frontend implementation',
      role: 'FRONTEND',
      dependsOnTitles: ['Design migration and API contract'],
      mutating: true,
      writeSet: ['public/index.html', 'public/styles.css', 'public/app.js', 'public/logo.svg'],
      requirementIds: ['REQ-004', 'REQ-005'],
      phase: 'implement',
    },
    {
      title: 'Integrate parallel results',
      role: 'RELEASE',
      dependsOnTitles: ['Backend implementation', 'Frontend implementation'],
      mutating: true,
      writeSet: [],
      requirementIds: ['REQ-003', 'REQ-004'],
      phase: 'integrate',
    },
    {
      title: 'Tests',
      role: 'TEST',
      dependsOnTitles: ['Integrate parallel results'],
      mutating: false,
      writeSet: ['test.mjs'],
      requirementIds: ['REQ-006'],
      phase: 'test',
    },
    {
      title: 'Independent review',
      role: 'REVIEWER',
      dependsOnTitles: ['Tests', 'Integrate parallel results'],
      mutating: false,
      requirementIds: ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005', 'REQ-006'],
      phase: 'review',
    },
    {
      title: 'Browser verification',
      role: 'VERIFIER',
      dependsOnTitles: ['Independent review'],
      mutating: false,
      requirementIds: ['REQ-005', 'REQ-006'],
      phase: 'verify',
    },
  ]
}

export function researchGraphSeeds(title: string): GraphSeedTask[] {
  return [{
    title,
    role: 'RESEARCHER',
    mutating: false,
    writeSet: ['foundry-memory.json'],
    requirementIds: ['REQ-RESEARCH'],
    phase: 'research',
    priority: 'LOW',
  }]
}

export function sortQueue(tasks: FoundryTaskRecord[]): FoundryTaskRecord[] {
  return [...tasks].sort((a, b) => FOUNDRY_TASK_PRIORITY_RANK[a.priority] - FOUNDRY_TASK_PRIORITY_RANK[b.priority] || a.taskId.localeCompare(b.taskId))
}
