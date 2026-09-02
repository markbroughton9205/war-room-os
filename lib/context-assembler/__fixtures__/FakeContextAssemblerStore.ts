import type {
  ContextAssemblerStore,
  MemoryRecordRow,
  MessageRow,
  NewContextSnapshotRow,
  OpenLoopRow,
  PromptArtifactRow,
  ProjectRow,
  SessionSummaryRow,
  ContextSnapshotRow,
  WorldKnowledgeRow,
} from '../types'

/** In-memory ContextAssemblerStore double for validation scripts — mirrors the fake-store
 * pattern used by lib/council/memory-write-gate/FakeMemoryStore.ts. No network/Supabase calls. */
export class FakeContextAssemblerStore implements ContextAssemblerStore {
  conversations = new Map<string, { id: string; active_project_id: string | null }>()
  projects = new Map<string, ProjectRow>()
  openLoopsByProject = new Map<string, OpenLoopRow[]>()
  summariesByConversation = new Map<string, SessionSummaryRow>()
  memoryRecordsByScope = new Map<string, MemoryRecordRow[]>()
  artifactsByConversation = new Map<string, PromptArtifactRow[]>()
  messagesByConversation = new Map<string, MessageRow[]>()
  worldKnowledgeByScope = new Map<string, WorldKnowledgeRow[]>()
  insertedSnapshots: ContextSnapshotRow[] = []
  private nextSnapshotId = 1

  setWorldKnowledge(projectId: string | null, rows: WorldKnowledgeRow[]) {
    this.worldKnowledgeByScope.set(projectId ?? 'global', rows)
  }

  private memoryKey(scope: string, projectId: string | null) {
    return `${scope}::${projectId ?? 'null'}`
  }

  setMemoryRecords(scope: string, projectId: string | null, rows: MemoryRecordRow[]) {
    this.memoryRecordsByScope.set(this.memoryKey(scope, projectId), rows)
  }

  async getConversation(conversationId: string) {
    return this.conversations.get(conversationId) ?? null
  }

  async getProject(projectId: string) {
    return this.projects.get(projectId) ?? null
  }

  async getOpenLoops(projectId: string) {
    return this.openLoopsByProject.get(projectId) ?? []
  }

  async getLatestSessionSummary(conversationId: string) {
    return this.summariesByConversation.get(conversationId) ?? null
  }

  async getActiveMemoryRecords(scope: string, projectId: string | null) {
    return this.memoryRecordsByScope.get(this.memoryKey(scope, projectId)) ?? []
  }

  async getRecentPromptArtifacts(conversationId: string, limit: number) {
    return (this.artifactsByConversation.get(conversationId) ?? []).slice(0, limit)
  }

  async getRecentMessages(conversationId: string, limit: number) {
    return (this.messagesByConversation.get(conversationId) ?? []).slice(-limit)
  }

  async getActiveWorldKnowledge(projectId: string | null, limit: number) {
    return (this.worldKnowledgeByScope.get(projectId ?? 'global') ?? []).slice(0, limit)
  }

  async insertContextSnapshot(row: NewContextSnapshotRow): Promise<ContextSnapshotRow> {
    const snapshot: ContextSnapshotRow = {
      ...row,
      id: `fake-snapshot-${this.nextSnapshotId++}`,
      assembled_at: new Date().toISOString(),
    }
    this.insertedSnapshots.push(snapshot)
    return snapshot
  }
}
