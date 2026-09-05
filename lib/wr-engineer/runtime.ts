/**
 * WR-Engineer Engineering Runtime.
 *
 * WR-Engineer Agent -> Engineering Runtime -> Model Adapter -> current local/external coding model.
 *
 * This class is the single orchestration point tying together the identity stack, the agent state
 * machine, mission context, the (advisory) read/edit/validation tool surface, and engineering
 * memory. It exposes observable, individually-callable actions — it does not run an autonomous
 * loop, retry policy, or background scheduler. Per the mission brief: "the purpose is a capable
 * engineering agent runtime with observable actions," not uncontrolled autonomous execution. A
 * caller (a human, a script, a future orchestration layer) decides when each method is invoked.
 *
 * Load order (mission brief): IDENTITY -> SOUL -> USER -> current mission -> repository/runtime
 * context -> relevant engineering memory. initialize() enforces exactly that order and keeps every
 * layer individually addressable afterward via getIdentityLayer()/getIdentityStack() — never
 * collapsed into one opaque blob.
 */
import { loadIdentityStack, stackToOrderedText, type IdentityLayerName, type IdentityStack } from './identity/loader'
import { createAgentStateMachine, transitionAgentState, type AgentStateMachine } from './agentState'
import { createMissionContext, markCriterionMet, resolveMission, type CreateMissionInput } from './missionContext'
import * as readSurface from './readSurface'
import * as validation from './validation'
import { proposeEdit, type ProposeEditInput, type WrEngineerEditProposal } from './codeEditProposals'
import { engineeringMemory } from './memory/store'
import type { EngineeringMemoryStore, CreateMemoryRecordInput, EngineeringMemoryRecord, MemoryQuery } from './memory/types'
import type { AgentState, EpistemicStatus, MissionContext, ModelAdapter, ModelAdapterRequest, ModelAdapterResult } from './types'

export class WrEngineerNotInitializedError extends Error {
  constructor() {
    super('WR-Engineer runtime used before initialize() loaded the identity stack.')
    this.name = 'WrEngineerNotInitializedError'
  }
}

export class WrEngineerNoActiveMissionError extends Error {
  constructor() {
    super('No active WR-Engineer mission — call startMission() first.')
    this.name = 'WrEngineerNoActiveMissionError'
  }
}

export class WrEngineerRuntime {
  private identity: IdentityStack | null = null
  private state: AgentStateMachine = createAgentStateMachine('READY')
  private mission: MissionContext | null = null

  constructor(
    private readonly modelAdapter: ModelAdapter,
    private readonly memory: EngineeringMemoryStore = engineeringMemory,
  ) {}

  /** Loads IDENTITY -> SOUL -> USER, in that order, before anything else can run. */
  async initialize(): Promise<void> {
    this.identity = await loadIdentityStack()
  }

  private requireIdentity(): IdentityStack {
    if (!this.identity) throw new WrEngineerNotInitializedError()
    return this.identity
  }

  getIdentityStack(): IdentityStack {
    return this.requireIdentity()
  }

  getIdentityLayer(name: IdentityLayerName): string {
    const stack = this.requireIdentity()
    const layer = stack.layers.find(l => l.name === name)
    if (!layer) throw new Error(`Unknown identity layer: ${name}`)
    return layer.content
  }

  /** Full ordered prompt-assembly text: identity stack, then (if a mission is active) the mission,
   * then repository/runtime context, then relevant engineering memory — mirroring the mission
   * brief's load order exactly. Assembled fresh on each call, never cached, so it always reflects
   * the current mission/repo/memory state. */
  async assembleContext(memoryQuery?: MemoryQuery): Promise<string> {
    const stack = this.requireIdentity()
    const sections = [stackToOrderedText(stack)]

    if (this.mission) {
      sections.push(`<<< MISSION >>>\n${JSON.stringify(this.mission, null, 2)}\n<<< END MISSION >>>`)
    }

    const repoContext = await readSurface.getRepositoryContext()
    sections.push(`<<< REPOSITORY_CONTEXT >>>\n${JSON.stringify(repoContext.status, null, 2)}\n<<< END REPOSITORY_CONTEXT >>>`)

    const memoryRecords = await this.memory.query(memoryQuery)
    sections.push(`<<< ENGINEERING_MEMORY >>>\n${JSON.stringify(memoryRecords, null, 2)}\n<<< END ENGINEERING_MEMORY >>>`)

    return sections.join('\n\n')
  }

  // -- Agent state --------------------------------------------------------

  getState(): AgentState {
    return this.state.current
  }

  getStateHistory() {
    return this.state.history
  }

  private transition(to: AgentState, note?: string): void {
    this.state = transitionAgentState(this.state, to, note)
  }

  // -- Mission --------------------------------------------------------

  startMission(input: CreateMissionInput): MissionContext {
    this.mission = createMissionContext(input)
    this.transition('WORKING', `mission started: ${this.mission.id}`)
    return this.mission
  }

  getMission(): MissionContext | null {
    return this.mission
  }

  private requireMission(): MissionContext {
    if (!this.mission) throw new WrEngineerNoActiveMissionError()
    return this.mission
  }

  markCriterionMet(description: string, evidence: string): MissionContext {
    const mission = markCriterionMet(this.requireMission(), description, evidence)
    this.mission = mission
    return mission
  }

  completeMission(outcome: 'success' | 'partial' | 'failed', summary: string, epistemicStatus: EpistemicStatus): MissionContext {
    const mission = resolveMission(this.requireMission(), outcome, summary, epistemicStatus)
    this.mission = mission
    this.transition(outcome === 'failed' ? 'FAILED' : 'COMPLETE', summary)
    return mission
  }

  // -- Repository inspection / git awareness (delegates to readSurface.ts) --------------------

  readonly inspect = readSurface

  // -- Validation (delegates to validation.ts) --------------------

  readonly validation = validation

  // -- Code-edit proposals (advisory only — see codeEditProposals.ts) --------------------

  proposeEdit(input: ProposeEditInput): WrEngineerEditProposal {
    this.requireMission()
    return proposeEdit(input)
  }

  // -- Engineering memory --------------------------------------------------------

  async recordMemory(input: CreateMemoryRecordInput): Promise<EngineeringMemoryRecord> {
    return this.memory.record(input)
  }

  async queryMemory(query?: MemoryQuery): Promise<EngineeringMemoryRecord[]> {
    return this.memory.query(query)
  }

  // -- Model adapter (the only reasoning entry point — see modelAdapter.ts) --------------------

  async invokeModel(request: ModelAdapterRequest): Promise<ModelAdapterResult> {
    return this.modelAdapter.invoke(request)
  }

  getModelAdapterId(): string {
    return this.modelAdapter.id
  }
}
