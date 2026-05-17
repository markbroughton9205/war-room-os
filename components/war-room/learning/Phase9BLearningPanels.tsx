import type { ReactNode } from 'react'
import { getAgentEvolutionProposals, getAgentEvolutionSummary } from '@/lib/learning/agentEvolutionEngine'
import { detectLearningAnomalies } from '@/lib/learning/anomalyDetection'
import { getBackgroundWorkerPlans, getBackgroundWorkerSummary } from '@/lib/learning/backgroundWorkerCoordinator'
import { getDoctrineEntries, getDoctrineSummary } from '@/lib/learning/doctrineEngine'
import { getEscalationPlans, getEscalationSummary } from '@/lib/learning/escalationPlanner'
import { getForecastSummary, compareForecastScenarios } from '@/lib/learning/forecastingEngine'
import { getNarrativeGraph } from '@/lib/learning/narrativeGraph'
import { getOperationalLearningMetrics } from '@/lib/learning/operationalMetrics'
import { getOutcomeLedgerSnapshot } from '@/lib/learning/outcomeLedger'
import { getProviderScorecards } from '@/lib/learning/providerPerformanceTracker'
import { getResourceAwarenessSnapshot } from '@/lib/learning/resourceAwareness'
import { compareSimulationToForecast, getSimulationScenarios } from '@/lib/learning/simulationPlanner'
import { detectStrategicPatterns } from '@/lib/learning/strategicPatternDetector'
import { getWorkflowOutcomes } from '@/lib/learning/workflowOutcomeTracker'

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

function Panel({
  title,
  accent,
  children,
}: {
  title: string
  accent: string
  children: ReactNode
}) {
  return (
    <section className="rounded p-3 text-xs" style={{ border: `1px solid ${accent}55`, background: 'rgba(0,0,0,0.28)' }}>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{title}</h3>
      {children}
    </section>
  )
}

export function Phase9BLearningPanels() {
  const outcomeLedger = getOutcomeLedgerSnapshot()
  const providerScorecards = getProviderScorecards()
  const doctrine = getDoctrineEntries()
  const doctrineSummary = getDoctrineSummary()
  const graph = getNarrativeGraph()
  const forecasts = compareForecastScenarios()
  const forecastSummary = getForecastSummary()
  const simulations = getSimulationScenarios().map(compareSimulationToForecast)
  const workers = getBackgroundWorkerPlans()
  const workerSummary = getBackgroundWorkerSummary()
  const resources = getResourceAwarenessSnapshot()
  const agentProposals = getAgentEvolutionProposals()
  const agentSummary = getAgentEvolutionSummary()
  const escalations = getEscalationPlans()
  const escalationSummary = getEscalationSummary()
  const anomalies = detectLearningAnomalies()
  const metrics = getOperationalLearningMetrics()
  const patterns = detectStrategicPatterns()
  const workflows = getWorkflowOutcomes()

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-white/10 pt-10">
      <header className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#d4af37]">Phase 9B</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Outcome Ledger + Recursive Operational Learning
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          War Room can remember, evaluate, classify, forecast, and propose improvements. External execution remains approval-bound.
        </p>
      </header>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded border border-emerald-500/30 bg-black/30 p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Strategic index</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-300">{pct(metrics.strategicPerformanceIndex)}</div>
        </div>
        <div className="rounded border border-sky-500/30 bg-black/30 p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Outcome accuracy</div>
          <div className="mt-1 text-2xl font-semibold text-sky-300">{pct(metrics.outcomeAccuracy)}</div>
        </div>
        <div className="rounded border border-amber-500/30 bg-black/30 p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Provider score</div>
          <div className="mt-1 text-2xl font-semibold text-amber-300">{pct(metrics.providerAverageScore)}</div>
        </div>
        <div className="rounded border border-fuchsia-500/30 bg-black/30 p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Approval gates</div>
          <div className="mt-1 text-2xl font-semibold text-fuchsia-300">{metrics.approvalGateIntegrity}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Outcome Ledger" accent="#D4AF37">
          <p className="mb-2 text-[10px] text-slate-400">{outcomeLedger.guardrail}</p>
          <div className="mb-2 text-[10px] text-slate-500">
            {outcomeLedger.summary.totalEntries} entries · {outcomeLedger.summary.unresolvedRiskCount} unresolved risks · {outcomeLedger.summary.contradictionMisses} contradiction misses
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {outcomeLedger.entries.map(entry => (
              <li key={entry.id} className="rounded border border-white/10 p-2 text-slate-300">
                <div className="font-semibold text-white">{entry.title}</div>
                <div className="mt-1 text-[10px] text-slate-500">{entry.kind} · {entry.project} · {entry.status} · success {pct(entry.successScore)}</div>
                <div className="mt-1 text-[10px] text-slate-400">{entry.executionOutcome}</div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Provider Scorecards" accent="#60A5FA">
          <div className="max-h-72 overflow-auto">
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="pb-1 text-left">Provider</th>
                  <th className="pb-1 text-left">Overall</th>
                  <th className="pb-1 text-left">Accuracy</th>
                  <th className="pb-1 text-left">Hallucination</th>
                  <th className="pb-1 text-left">Watch</th>
                </tr>
              </thead>
              <tbody>
                {providerScorecards.map(card => (
                  <tr key={card.provider} className="border-t border-white/5 text-slate-300">
                    <td className="py-1 pr-2 font-semibold text-sky-200">{card.provider}</td>
                    <td className="py-1 pr-2">{pct(card.overallScore)}</td>
                    <td className="py-1 pr-2">{pct(card.accuracy)}</td>
                    <td className="py-1 pr-2">{pct(card.hallucinationRate)}</td>
                    <td className="py-1">{card.watchItems[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Doctrine Engine" accent="#34D399">
          <div className="mb-2 text-[10px] text-slate-500">
            {doctrineSummary.promoted} promoted · avg confidence {pct(doctrineSummary.averageConfidence)}
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {doctrine.map(entry => (
              <li key={entry.id} className="rounded border border-white/10 p-2 text-slate-300">
                <div className="font-semibold text-emerald-200">{entry.principle}</div>
                <div className="mt-1 text-[10px] text-slate-500">
                  recurrence {entry.recurrenceFrequency} · confidence {pct(entry.confidence)} · {entry.status}
                </div>
                {entry.contradictions.length ? <div className="mt-1 text-[10px] text-amber-200">{entry.contradictions[0]}</div> : null}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Narrative + Event Graph" accent="#F472B6">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded border border-white/10 p-2 text-slate-300">{graph.nodes.length} nodes</div>
            <div className="rounded border border-white/10 p-2 text-slate-300">{graph.edges.length} edges</div>
            <div className="rounded border border-white/10 p-2 text-slate-300">{graph.clusters.length} clusters</div>
          </div>
          <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
            {graph.clusters.map(cluster => (
              <li key={cluster.id} className="rounded border border-white/10 p-2 text-slate-300">
                <div className="font-semibold text-fuchsia-200">{cluster.title}</div>
                <div className="mt-1 text-[10px] text-slate-500">
                  overlap {pct(cluster.sourceOverlap)} · sync {pct(cluster.narrativeSynchronization)} · contradiction {pct(cluster.contradictionPressure)}
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Forecast + Simulation" accent="#A78BFA">
          <div className="mb-2 text-[10px] text-slate-500">
            {forecastSummary.forecastCount} forecasts · avg risk {pct(forecastSummary.averageRisk)}
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {forecasts.map(forecast => (
              <li key={forecast.id} className="rounded border border-white/10 p-2 text-slate-300">
                <div className="font-semibold text-violet-200">{forecast.scenario}</div>
                <div className="mt-1 text-[10px] text-slate-500">risk {pct(forecast.risk)} · confidence {forecast.confidence}</div>
              </li>
            ))}
            {simulations.map(({ scenario, riskDelta }) => (
              <li key={scenario.id} className="rounded border border-violet-500/20 p-2 text-slate-300">
                <div className="font-semibold text-violet-100">Simulation: {scenario.title}</div>
                <div className="mt-1 text-[10px] text-slate-500">risk reduction {pct(riskDelta)} · {scenario.approvalBoundary}</div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Background Worker Monitor" accent="#FBBF24">
          <div className="mb-2 text-[10px] text-slate-500">
            {workerSummary.total} monitors · ready {workerSummary.ready} · external execution allowed: {String(workerSummary.externalExecutionAllowed)}
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {workers.map(worker => (
              <li key={worker.id} className="rounded border border-white/10 p-2 text-slate-300">
                <div className="font-semibold text-amber-200">{worker.label}</div>
                <div className="mt-1 text-[10px] text-slate-500">{worker.kind} · every {worker.cadenceMinutes}m · {worker.health}</div>
                <div className="mt-1 text-[10px] text-slate-400">Emits: {worker.emits.join(', ')}</div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Resource Awareness" accent="#94A3B8">
          <div className="grid gap-2 text-[10px] sm:grid-cols-2">
            <div className="rounded border border-white/10 p-2 text-slate-300">Queue pressure: {resources.queuePressure}</div>
            <div className="rounded border border-white/10 p-2 text-slate-300">Worker health: {resources.workerHealth}</div>
            <div className="rounded border border-white/10 p-2 text-slate-300">Source health: {resources.sourceHealth}</div>
            <div className="rounded border border-white/10 p-2 text-slate-300">Retrieval success: {pct(resources.retrievalSuccess)}</div>
          </div>
          <ul className="mt-2 space-y-1 text-[10px] text-slate-400">
            {resources.scalingBottlenecks.map(item => <li key={item}>Bottleneck: {item}</li>)}
          </ul>
        </Panel>

        <Panel title="Agent Evolution Proposals" accent="#2DD4BF">
          <div className="mb-2 text-[10px] text-slate-500">
            {agentSummary.proposed} proposed · approval-bound: {String(agentSummary.approvalBound)}
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {agentProposals.map(proposal => (
              <li key={proposal.id} className="rounded border border-white/10 p-2 text-slate-300">
                <div className="font-semibold text-teal-200">{proposal.agent}</div>
                <div className="mt-1 text-[10px] text-slate-500">confidence {pct(proposal.confidence)} · Commander approval required</div>
                <div className="mt-1 text-[10px] text-slate-400">{proposal.reason}</div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Escalation Queue" accent="#F87171">
          <div className="mb-2 text-[10px] text-slate-500">
            {escalationSummary.queued} queued · high/critical {escalationSummary.highOrCritical} · auto-send: {String(escalationSummary.autoSendEnabled)}
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {escalations.map(plan => (
              <li key={plan.id} className="rounded border border-white/10 p-2 text-slate-300">
                <div className="font-semibold text-red-200">{plan.title}</div>
                <div className="mt-1 text-[10px] text-slate-500">{plan.type} · {plan.priority} · {plan.recommendedChannel}</div>
                <div className="mt-1 text-[10px] text-slate-400">{plan.trigger}</div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Patterns + Workflow Learning" accent="#86EFAC">
          <div className="grid gap-2 lg:grid-cols-2">
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {patterns.map(pattern => (
                <li key={pattern.id} className="rounded border border-white/10 p-2 text-slate-300">
                  <div className="font-semibold text-lime-200">{pattern.title}</div>
                  <div className="mt-1 text-[10px] text-slate-500">{pattern.recommendedDoctrineAction} · confidence {pct(pattern.confidence)}</div>
                </li>
              ))}
            </ul>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {workflows.map(workflow => (
                <li key={workflow.id} className="rounded border border-white/10 p-2 text-slate-300">
                  <div className="font-semibold text-lime-100">{workflow.name}</div>
                  <div className="mt-1 text-[10px] text-slate-500">success {pct(workflow.successRate)} · {workflow.permissionBoundary}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            Active anomaly watches: {anomalies.length}. Recommendations remain Commander-controlled.
          </div>
        </Panel>
      </div>
    </section>
  )
}
