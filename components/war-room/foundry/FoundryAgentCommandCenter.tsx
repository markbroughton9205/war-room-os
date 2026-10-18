'use client'

import type { FoundryCommandCenterGraph, FoundryCommandCenterSnapshot, FoundryTaskRecord } from '@/lib/native-builder/foundryAgentTypes'
import { FoundryContractVerdictPanel } from './FoundryContractVerdictPanel'
import { FoundryResourceGovernorPanel } from './FoundryResourceGovernorPanel'
import { FoundryMissionRuntimePanel } from './FoundryMissionRuntimePanel'
import { FoundryUnattendedEngineerPanel } from './FoundryUnattendedEngineerPanel'
import { FoundryEngineeringCapabilitiesPanel } from './FoundryEngineeringCapabilitiesPanel'

type Props = {
  snapshot: FoundryCommandCenterSnapshot | null
  advanced?: boolean
  onOpenPreview?: (url: string) => void
  onRefresh?: () => void
}

async function post(action: string, extra: Record<string, unknown> = {}) {
  await fetch('/api/foundry/command-center', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  })
}

export function FoundryAgentCommandCenter({ snapshot, advanced, onOpenPreview, onRefresh }: Props) {
  const graphs = snapshot?.graphs ?? []
  const live = graphs.filter(graph => !['COMPLETE', 'CANCELLED', 'FAILED'].includes(graph.status) || graph.tasks.some(task => task.status === 'RUNNING'))
  const previewable = graphs.filter(graph => Boolean(graph.preview?.localPreview))
  const seen = new Set<string>()
  const cards = [...live, ...previewable, ...graphs.filter(graph => graph.tasks.some(task => task.startedAt))]
    .filter(graph => {
      if (seen.has(graph.graphId)) return false
      seen.add(graph.graphId)
      return true
    })
  return (
    <section className="space-y-3" data-testid="foundry-agent-command-center">
      <FoundryEngineeringCapabilitiesPanel view={snapshot?.engineeringCapabilities} />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-400">Agents / Tasks</p>
        {snapshot?.runningTaskCount ? (
          <p className="text-[10px] uppercase tracking-widest text-cyan-300" data-testid="foundry-background-status">
            {snapshot.backgroundLabel}
          </p>
        ) : (
          <p className="text-[10px] uppercase tracking-widest text-slate-600">No running tasks</p>
        )}
      </div>
      {cards.length === 0 ? (
        <p className="text-[11px] text-slate-500" data-testid="foundry-command-center-empty">No live agent work. Decorative cards are not shown.</p>
      ) : cards.map(graph => (
        <article key={graph.graphId} className="rounded border border-emerald-400/20 bg-black/30 p-2" data-testid="foundry-active-work" data-graph-id={graph.graphId}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-100">{graph.projectName}</p>
              <p className="text-[10px] text-slate-400">{graph.goal}</p>
            </div>
          <p className={`text-[10px] uppercase tracking-widest ${graph.contractVerdict?.projectReadyAdmissible && graph.contractVerdict.verdict === 'PASS' ? 'text-emerald-400' : 'text-slate-400'}`}>{graph.contractVerdict?.truthfulHeadline ?? graph.status}</p>
          </div>
          {graph.stagnationDetected ? (
            <p className="mt-1 text-[10px] uppercase tracking-widest text-amber-300" data-testid="foundry-stagnation-detected">STAGNATION DETECTED{graph.stagnationReason ? ` — ${graph.stagnationReason}` : ''}</p>
          ) : null}
          {graph.lastReplan ? (
            <div className="mt-1 text-[10px] text-cyan-200" data-testid="foundry-replan">
              <p className="uppercase tracking-widest">REPLAN {graph.lastReplan.level} · {graph.lastReplan.status}</p>
              <p>{graph.lastReplan.reason}</p>
              <p className="text-slate-500">attempts {graph.lastReplan.attemptCount}</p>
            </div>
          ) : null}
          <FoundryMissionRuntimePanel view={graph.runtimeView} advanced={advanced} />
          <FoundryUnattendedEngineerPanel
            view={graph.unattendedView}
            graphId={graph.graphId}
            goal={graph.goal}
            contractGeneration={graph.missionContractHash}
            budgetState={graph.resourceView?.status ?? null}
            onRefresh={onRefresh}
          />
          <FoundryResourceGovernorPanel
            view={graph.resourceView}
            advanced={advanced}
            onExtend={() => {
              const nextCalls = (graph.resourceView?.modelCallsLimit ?? 40) + 20
              const nextTokens = (graph.resourceView?.tokensLimit ?? 150000) + 50000
              const confirmed = window.confirm(
                `Extend Budget\nCurrent model calls: ${graph.resourceView?.modelCallsUsed ?? 0} / ${graph.resourceView?.modelCallsLimit ?? 'n/a'}\nRequested model calls: ${nextCalls} (delta +20)\nCurrent tokens: ${graph.resourceView?.tokensUsed ?? 0} / ${graph.resourceView?.tokensLimit ?? 'n/a'}\nRequested tokens: ${nextTokens} (delta +50000)\nConfirm Commander resource authorization?`,
              )
              if (!confirmed) return
              void post('extend-budget', {
                graphId: graph.graphId,
                commanderConfirmed: true,
                maxModelCalls: nextCalls,
                maxTotalTokens: nextTokens,
              }).then(() => onRefresh?.())
            }}
          />
          <div className="mt-2 space-y-1" data-testid="foundry-task-cards">
            {graph.tasks.filter(task => task.status !== 'QUEUED' || Boolean(task.startedAt)).map(task => (
              <TaskCard key={task.taskId} task={task} />
            ))}
          </div>
          <FoundryContractVerdictPanel
            view={graph.contractVerdict}
            advanced={advanced}
            showApprovalCopy={Boolean(graph.planningMode && graph.contractVerdict && !graph.contractVerdict.legacy && (!graph.specApproved || graph.contractVerdict.reapprovalRequired))}
            onApproveExecution={() => void post('approve-execution', {
              graphId: graph.graphId,
              expectedSpecVersion: graph.contractVerdict?.specVersion ?? graph.specVersion,
              expectedMissionContractHash: graph.contractVerdict?.missionContract.hash ?? graph.missionContractHash,
              expectedAcceptanceContractHash: graph.contractVerdict?.acceptanceContract.hash ?? graph.acceptanceContractHash,
            }).then(() => onRefresh?.())}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase text-slate-300" onClick={() => onRefresh?.()}>Open plan</button>
            <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase text-slate-300" onClick={() => graph.preview?.localPreview && onOpenPreview?.(graph.preview.localPreview)}>View work</button>
            {graph.preview?.localPreview ? (
              <>
                <button type="button" data-testid="foundry-open-app" aria-label="Open app" className="rounded border border-emerald-400/40 px-2 py-0.5 text-[9px] uppercase text-emerald-200" onClick={() => onOpenPreview?.(graph.preview!.localPreview!)}>Open app</button>
                <button type="button" data-testid="foundry-open-website" className="rounded border border-emerald-400/40 px-2 py-0.5 text-[9px] uppercase text-emerald-200" onClick={() => onOpenPreview?.(graph.preview!.localPreview!)}>Open website</button>
              </>
            ) : null}
            <button type="button" className="rounded border border-amber-400/30 px-2 py-0.5 text-[9px] uppercase text-amber-200" onClick={() => void post('pause', { graphId: graph.graphId }).then(() => onRefresh?.())}>Pause</button>
            <button type="button" className="rounded border border-red-400/30 px-2 py-0.5 text-[9px] uppercase text-red-200" onClick={() => void post('cancel', { graphId: graph.graphId }).then(() => onRefresh?.())}>Cancel</button>
          </div>
          {advanced ? <AdvancedTrace graph={graph} /> : null}
        </article>
      ))}
    </section>
  )
}

function TaskCard({ task }: { task: FoundryTaskRecord }) {
  return (
    <div className="rounded border border-white/10 px-2 py-1" data-testid="foundry-task-card" data-task-id={task.taskId} data-mock="0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-emerald-100">{task.title}</p>
        <p className="text-[9px] uppercase tracking-widest text-cyan-300">{task.role}</p>
      </div>
      <p className="text-[9px] uppercase tracking-widest text-slate-500">
        {task.status} · {task.currentPhase} · {task.projectName}
        {task.workspaceId ? ` · ${task.workspaceId.slice(0, 8)}` : ''}
      </p>
      {task.startedAt ? <p className="text-[9px] text-slate-600">Started {task.startedAt}</p> : null}
      <p className="text-[10px] text-slate-400">{task.latestAction}</p>
      {task.tests.detail ? <p className="text-[10px] text-slate-500">Tests: {task.tests.ok ? 'PASS' : 'FAIL'}</p> : null}
      {task.result ? <p className="text-[10px] text-slate-400">{task.result}</p> : null}
      {task.blocker ? <p className="text-[10px] text-red-300">Blocker: {task.blocker}</p> : null}
    </div>
  )
}

function AdvancedTrace({ graph }: { graph: FoundryCommandCenterGraph }) {
  return (
    <div className="mt-2 rounded border border-white/10 p-2" data-testid="foundry-command-center-advanced">
      <p className="text-[9px] uppercase tracking-widest text-slate-500">Instruction sources</p>
      {graph.instructionSources.filter(source => source.loaded).map(source => (
        <p key={`${source.layer}-${source.origin}`} className="text-[10px] text-slate-400">{source.layer} · {source.origin}</p>
      ))}
      <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">Traceability</p>
      {graph.traces.map(trace => (
        <p key={`${trace.requirementId}-${trace.taskId}`} className="text-[10px] text-slate-400">
          {trace.requirementId} → {trace.taskId} → {trace.agentId || 'unassigned'} → {trace.status}
        </p>
      ))}
      <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">Agents</p>
      {graph.agents.map(agent => (
        <p key={agent.agentId} className="text-[10px] text-slate-400">
          {agent.agentId} {agent.role} {agent.modelRouting.provider}/{agent.modelRouting.model} ws={agent.workspaceId?.slice(0, 8)}
        </p>
      ))}
      {graph.lastReplanId ? (
        <p className="mt-1 text-[9px] text-slate-600" data-testid="foundry-replan-advanced">
          replan {graph.lastReplanId} plan {graph.planHash ?? '—'}
        </p>
      ) : null}
    </div>
  )
}
