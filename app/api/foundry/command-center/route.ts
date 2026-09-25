import { NextResponse } from 'next/server'
import {
  cancelCommandCenter,
  enqueueCommandCenterWork,
  executeCommandCenterGraph,
  getCommandCenterSnapshot,
  guideCommandCenter,
  pauseCommandCenter,
  resumeCommandCenter,
  approveCommandCenterExecution,
  revokeCommandCenterExecution,
  startCommandCenterAutoEngineer,
  stopCommandCenterAutoEngineer,
} from '@/lib/native-builder/foundryAgentCommandCenter'
import { loadCommandCenterGraph } from '@/lib/native-builder/foundryAgentStore'
import { buildContractVerdictViewFromGraph, commandCenterSnapshotWithContractViews } from '@/lib/native-builder/foundryContractVerdictView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(commandCenterSnapshotWithContractViews(getCommandCenterSnapshot()))
}

export async function POST(req: Request) {
  let body: {
    action?: string
    goal?: string
    graphId?: string
    taskId?: string
    agentId?: string
    instruction?: string
    planningMode?: boolean
    specApproved?: boolean
    specId?: string
    specVersion?: string
    expectedSpecVersion?: string
    expectedMissionContractHash?: string
    expectedAcceptanceContractHash?: string
    expectedMissionContractId?: string
    expectedAcceptanceContractId?: string
    priority?: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW'
    kind?: 'ticket-manager' | 'research' | 'custom'
    projectId?: string
    projectName?: string
    projectRoot?: string
    missionId?: string
    commanderConfirmed?: boolean
    maxModelCalls?: number
    maxTotalTokens?: number
    maxEstimatedRemoteCostUsd?: number
    maxTestRuns?: number
    maxDagReplans?: number
  } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const action = body.action || 'enqueue'
  try {
    if (action === 'enqueue') {
      if (!body.goal?.trim()) return NextResponse.json({ error: 'goal is required.' }, { status: 400 })
      const graph = await enqueueCommandCenterWork({
        goal: body.goal.trim(),
        planningMode: body.planningMode,
        specApproved: body.specApproved,
        specId: body.specId,
        specVersion: body.specVersion,
        priority: body.priority,
        kind: body.kind,
        projectId: body.projectId,
        projectName: body.projectName,
        projectRoot: body.projectRoot,
        missionId: body.missionId,
        commanderInstruction: body.goal.trim(),
      })
      void executeCommandCenterGraph(graph.graphId)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) }, snapshot: commandCenterSnapshotWithContractViews(getCommandCenterSnapshot()) }, { status: 201 })
    }
    if (!body.graphId) return NextResponse.json({ error: 'graphId is required.' }, { status: 400 })
    if (action === 'pause') {
      const graph = await pauseCommandCenter({ graphId: body.graphId, taskId: body.taskId, agentId: body.agentId })
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } })
    }
    if (action === 'resume') {
      const graph = await resumeCommandCenter({ graphId: body.graphId, taskId: body.taskId })
      void executeCommandCenterGraph(graph.graphId)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } })
    }
    if (action === 'cancel') {
      const graph = await cancelCommandCenter(body.graphId, body.taskId)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } })
    }
    if (action === 'guide') {
      if (!body.instruction?.trim()) return NextResponse.json({ error: 'instruction is required.' }, { status: 400 })
      const graph = guideCommandCenter(body.graphId, body.taskId, body.instruction.trim())
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } })
    }
    if (action === 'open') {
      const graph = loadCommandCenterGraph(body.graphId)
      if (!graph) return NextResponse.json({ error: 'Unknown graph.' }, { status: 404 })
      const { attachResourceViewToGraph } = await import('@/lib/native-builder/foundryResourceGovernor')
      attachResourceViewToGraph(graph)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph), resourceView: graph.resourceView }, preview: graph.preview })
    }
    if (action === 'contract') {
      const graph = loadCommandCenterGraph(body.graphId)
      if (!graph) return NextResponse.json({ error: 'Unknown graph.' }, { status: 404 })
      return NextResponse.json({ contractVerdict: buildContractVerdictViewFromGraph(graph), graphId: graph.graphId, missionId: graph.missionId })
    }
    if (action === 'approve-execution') {
      const graph = approveCommandCenterExecution(body.graphId, {
        specVersion: body.expectedSpecVersion,
        missionContractHash: body.expectedMissionContractHash,
        acceptanceContractHash: body.expectedAcceptanceContractHash,
        missionContractId: body.expectedMissionContractId,
        acceptanceContractId: body.expectedAcceptanceContractId,
      })
      void executeCommandCenterGraph(graph.graphId)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } })
    }
    if (action === 'revoke-execution') {
      const graph = revokeCommandCenterExecution(body.graphId)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } })
    }
    if (action === 'start-auto-engineer') {
      const graph = startCommandCenterAutoEngineer(body.graphId, body.commanderConfirmed === true)
      if (graph.unattendedView?.status === 'NONE' || !graph.unattendedView) {
        return NextResponse.json({ error: 'UNATTENDED_WITHOUT_COMMANDER_AUTH', graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } }, { status: 400 })
      }
      void executeCommandCenterGraph(graph.graphId)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } })
    }
    if (action === 'stop-auto-engineer') {
      const graph = stopCommandCenterAutoEngineer(body.graphId)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph) } })
    }
    if (action === 'extend-budget') {
      const graph = loadCommandCenterGraph(body.graphId)
      if (!graph) return NextResponse.json({ error: 'Unknown graph.' }, { status: 404 })
      const { extendResourceBudget, attachResourceViewToGraph } = await import('@/lib/native-builder/foundryResourceGovernor')
      const decision = extendResourceBudget({
        missionId: graph.missionId,
        commanderConfirmed: body.commanderConfirmed === true,
        nextLimits: {
          maxModelCalls: body.maxModelCalls,
          maxTotalTokens: body.maxTotalTokens,
          maxEstimatedRemoteCostUsd: body.maxEstimatedRemoteCostUsd,
          maxTestRuns: body.maxTestRuns,
          maxDagReplans: body.maxDagReplans,
        },
        reason: 'Commander extended resource budget from Command Center.',
      })
      if (!decision.ok) return NextResponse.json({ error: decision.reason, decision }, { status: 400 })
      graph.resourceBudgetId = decision.budget?.budgetId ?? graph.resourceBudgetId
      attachResourceViewToGraph(graph)
      return NextResponse.json({ graph: { ...graph, contractVerdict: buildContractVerdictViewFromGraph(graph), resourceView: graph.resourceView }, decision })
    }
    return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
