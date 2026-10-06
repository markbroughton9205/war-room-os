'use client'

import { useState, type ReactNode } from 'react'
import type { CouncilIntelligencePublic } from '@/lib/council/intelligence/types'
import type { EbcPublicSnapshot } from '@/lib/council/evidence-board/types'
import { councilSourcesFromSnapshot } from '@/lib/council/source-links'
import { CouncilSourceList } from './CouncilSourceList'

const TABS = [
  'Contract',
  'Strategy',
  'Team',
  'Plan',
  'Engine 01',
  'Engine 02',
  'Engine 03',
  'Engine 04',
  'Engine 05',
  'World Model',
  'Deliberation',
  'Portfolio',
  'Watch',
  'Trust',
  'Governance',
  'Live Tasks',
  'Work Products',
  'Question Graph',
  'Hypotheses',
  'Tool Decisions',
  'Verification Queue',
  'Replans',
  'Completion',
  'Budget',
  'Model Routing',
  'Telemetry',
  'Mission Replay',
  'Mission History',
  'Mission Diff',
  'Parallel Timeline',
  'Agent Contributions',
  'Tool Efficiency',
  'Model Routing History',
  'Commander Corrections',
  'Failure Clusters',
  'Playbooks',
  'Learning Records',
  'WRIM Eval Staging',
  'Task Graph',
  'Questions',
  'Evidence',
  'Scenarios',
  'Conflicts',
  'Risks',
  'Authority',
  'Receipts',
  'Knowledge',
  'Evaluation',
] as const

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">{title}</p>
      <div className="space-y-0.5 font-mono text-[10px] text-slate-300">{children}</div>
    </section>
  )
}

export function CouncilIntelligenceInspector({
  payload,
  ebc,
}: {
  payload?: CouncilIntelligencePublic | null
  ebc?: Partial<EbcPublicSnapshot> | null
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Contract')
  if (!payload) {
    return <p className="text-slate-500">No intelligence artifacts on this turn. Normal chat stays clean.</p>
  }
  const orch = payload.orchestration
  return (
    <div data-testid="council-intelligence-inspector" className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {TABS.map(name => (
          <button
            key={name}
            type="button"
            data-testid={`intel-tab-${name.replace(/\s+/g, '-').toLowerCase()}`}
            className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${tab === name ? 'bg-cyan-900 text-cyan-100' : 'bg-slate-800 text-slate-400'}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === 'Contract' && (
        <Block title="Mission Contract">
          <p>class {payload.intelligence_class}</p>
          <p>objective {payload.contract?.objective}</p>
          <p>authority commit={String(payload.contract?.authority.commit)} push={String(payload.contract?.authority.push)} deploy={String(payload.contract?.authority.production_deploy)}</p>
          <p>exclusions {(payload.contract?.explicit_exclusions ?? []).join(', ') || 'none'}</p>
        </Block>
      )}
      {tab === 'Strategy' && (
        <Block title="Cognitive Strategy">
          <p>{orch?.strategy.id ?? 'n/a'} · {orch?.strategy.reason}</p>
          <p>deliberation {orch?.deliberation} · budget {orch?.budget.budget}</p>
        </Block>
      )}
      {tab === 'Team' && (
        <Block title="Assembly">
          <p>{(orch?.assembly.selected_seats ?? []).join(', ') || 'none'}</p>
          <p>phoenix {String(orch?.assembly.phoenix_required)} · aurora_final_only {String(orch?.assembly.aurora_final_only)}</p>
        </Block>
      )}
      {tab === 'Plan' && (
        <Block title="Plan">
          {(payload.plan?.steps ?? []).length
            ? payload.plan!.steps.map(step => (
              <p key={step.step_id}>{step.step_id} {step.title} [{step.status}]</p>
            ))
            : <p>ATLAS not invoked</p>}
        </Block>
      )}
      {tab === 'Engine 01' && (
        <Block title="Engine 01 inspector">
          <div data-testid="council-engine-01-inspector">
            <p>research / source authority / evidence / calibration</p>
            <p>ebc_truth_spine {payload.ebc_truth_spine ? 'YES' : 'NO'} grants {String(orch?.grants_authority ?? false)}</p>
          </div>
        </Block>
      )}
      {tab === 'Engine 02' && (
        <Block title="Engine 02 inspector">
          <div data-testid="council-engine-02-inspector">
            <p>schema {orch?.engines02?.schema ?? 'n/a'} atlas {orch?.engines02?.atlas_role ?? 'ATLAS'} grants {String(orch?.engines02?.grants_authority ?? false)}</p>
            <p>tool {orch?.engines02?.tool_selection?.decision ?? 'n/a'} {orch?.engines02?.tool_selection?.selected_tool ?? 'none'} {orch?.engines02?.tool_selection?.reason ?? ''}</p>
            <p>plan stopped={String(orch?.engines02?.plan?.stopped_for_completion ?? false)} change={orch?.engines02?.plan?.change_reason ?? 'none'}</p>
            {(orch?.engines02?.plan_tree ?? []).slice(0, 16).map(node => (
              <p key={node.id}>{node.kind} {node.id} [{node.status}] auth={node.authority_requirement}</p>
            ))}
            {(orch?.engines02?.context_meta ?? []).map(row => (
              <p key={row.role}>context {row.role} tokens={row.tokens_used}/{row.token_budget} excluded={row.excluded}</p>
            ))}
            <p>diagnosis {orch?.engines02?.diagnosis?.category ?? 'none'} {orch?.engines02?.diagnosis?.confidence_state ?? ''} persist={String(orch?.engines02?.diagnosis?.persist_as_proven ?? false)}</p>
            <p>next test {orch?.engines02?.diagnosis?.next_discriminating_check ?? 'n/a'}</p>
          </div>
        </Block>
      )}
      {tab === 'Engine 03' && (
        <Block title="Engine 03 inspector">
          <div data-testid="council-engine-03-inspector">
            <p>schema {orch?.engines03?.schema ?? 'n/a'} proof {orch?.engines03?.proof_level ?? 'n/a'} grants {String(orch?.engines03?.grants_authority ?? false)}</p>
            <p>production_invoked={String(orch?.engines03?.production_invoked ?? false)} injection={String(orch?.engines03?.injection ?? false)} phases={(orch?.engines03?.phases ?? []).join('→') || 'none'}</p>
            <p>decision {orch?.engines03?.decision ?? 'n/a'} dispatches={orch?.engines03?.dispatches ?? 0} avoided={orch?.engines03?.avoided_tool_calls ?? 0}</p>
            <p>parallelism {orch?.engines03?.parallelism ?? 'SERIAL'} overlap_ms={orch?.engines03?.overlap_ms ?? 0} completion={orch?.engines03?.completion ?? 'n/a'}</p>
            {(orch?.engines03?.waves ?? []).map(wave => (
              <p key={wave.wave_id}>{wave.wave_id} {wave.parallelism} overlap={wave.overlap_ms} tasks={wave.task_ids.join(',')}</p>
            ))}
            {(orch?.engines03?.tasks ?? []).map(row => (
              <p key={row.task_id}>{row.task_id} [{row.state}] tool={row.selected_tool ?? 'none'}</p>
            ))}
            <p>authority waits {(orch?.engines03?.authority_waits ?? []).join(',') || 'none'} cancelled={(orch?.engines03?.cancelled ?? []).join(',') || 'none'} replans={orch?.engines03?.replans ?? 0}</p>
            <p>context tokens {orch?.engines03?.context_tokens ?? 0}</p>
            {orch?.engines03?.approval_request ? <p>{orch.engines03.approval_request}</p> : null}
          </div>
        </Block>
      )}
      {tab === 'Engine 04' && (
        <Block title="Engine 04 inspector">
          <div data-testid="council-engine-04-inspector">
            <p>schema {orch?.engines04?.schema ?? 'n/a'} grants {String(orch?.engines04?.grants_authority ?? false)} ebc {String(orch?.engines04?.ebc_canonical ?? true)}</p>
            <p>mission {orch?.engines04?.mission_id ?? 'n/a'} state {orch?.engines04?.mission_state ?? 'n/a'} phase {orch?.engines04?.phase ?? 'none'}</p>
            <p>checkpoint {orch?.engines04?.checkpoint ?? 'none'} resume_cursor {orch?.engines04?.resume_cursor ?? 'none'} resume_available={String(orch?.engines04?.resume_available ?? false)}</p>
            <p>completed {orch?.engines04?.completed_tasks ?? 0} pending {orch?.engines04?.pending_tasks ?? 0} authority {orch?.engines04?.authority_state ?? 'NONE'}</p>
            <p>budget_remaining {orch?.engines04?.budget_remaining ?? 'n/a'} memory_refs {orch?.engines04?.memory_refs ?? 0} refresh {orch?.engines04?.refresh ?? 'n/a'}</p>
            {orch?.engines04?.commander_status ? <p>{orch.engines04.commander_status}</p> : null}
          </div>
        </Block>
      )}
      {tab === 'Engine 05' && (
        <Block title="Engine 05 inspector">
          <div data-testid="council-engine-05-inspector">
            <p>schema {orch?.engines05?.schema ?? 'n/a'} grants {String(orch?.engines05?.grants_authority ?? false)} ebc {String(orch?.engines05?.ebc_canonical ?? true)}</p>
            <p>trains_wrim {String(orch?.engines05?.trains_wrim ?? false)} auto_promotes {String(orch?.engines05?.auto_promotes ?? false)}</p>
            <p>benchmark {orch?.engines05?.benchmark_run ?? 'none'} candidate {orch?.engines05?.policy_candidate ?? 'none'} status {orch?.engines05?.policy_status ?? 'none'}</p>
            <p>routing {orch?.engines05?.routing ?? 'none'} task_class {orch?.engines05?.routing_task_class ?? 'none'}</p>
            <p>counterfactual {orch?.engines05?.counterfactual ?? 'none'} promotion {orch?.engines05?.promotion ?? 'none'}</p>
            {orch?.engines05?.commander_status ? <p>{orch.engines05.commander_status}</p> : null}
          </div>
        </Block>
      )}
      {tab === 'World Model' && (
        <Block title="World Model">
          <div data-testid="council-world-model-inspector">
            <p>schema {orch?.enginesFinal?.schema ?? 'n/a'} ebc {String(orch?.enginesFinal?.ebc_canonical ?? true)} grants {String(orch?.enginesFinal?.grants_authority ?? false)}</p>
            <p>entities {orch?.enginesFinal?.world_entities ?? 0}</p>
          </div>
        </Block>
      )}
      {tab === 'Deliberation' && (
        <Block title="Deliberation">
          <div data-testid="council-deliberation-inspector">
            <p>deliberation {orch?.enginesFinal?.deliberation ?? 'none'}</p>
            <p>auto_promotes {String(orch?.enginesFinal?.auto_promotes ?? false)}</p>
          </div>
        </Block>
      )}
      {tab === 'Portfolio' && (
        <Block title="Portfolio">
          <div data-testid="council-portfolio-inspector">
            <p>portfolio {orch?.enginesFinal?.portfolio ?? 'none'}</p>
          </div>
        </Block>
      )}
      {tab === 'Watch' && (
        <Block title="Watch / Change Detection">
          <div data-testid="council-watch-inspector">
            <p>watch {orch?.enginesFinal?.watch ?? 'none'}</p>
          </div>
        </Block>
      )}
      {tab === 'Trust' && (
        <Block title="Trust / Security">
          <div data-testid="council-trust-inspector">
            <p>trust {orch?.enginesFinal?.trust ?? 'none'}</p>
          </div>
        </Block>
      )}
      {tab === 'Governance' && (
        <Block title="Governance">
          <div data-testid="council-governance-inspector">
            <p>approval {orch?.enginesFinal?.approval ?? 'none'} live_trial {orch?.enginesFinal?.live_trial ?? 'none'} graduation {orch?.enginesFinal?.graduation ?? 'none'}</p>
            {orch?.enginesFinal?.commander_status ? <p>{orch.enginesFinal.commander_status}</p> : null}
          </div>
        </Block>
      )}
      {tab === 'Task Graph' && (
        <Block title="Task Graph">
          {(orch?.task_graph.tasks ?? []).map(task => (
            <p key={task.task_id}>{task.task_id} {task.status} → {task.assigned_role}</p>
          ))}
        </Block>
      )}
      {tab === 'Questions' && (
        <Block title="Questions">
          {(orch?.questions.questions ?? []).map(q => (
            <p key={q.question_id}>{q.priority} {q.type}: {q.text}</p>
          ))}
        </Block>
      )}
      {tab === 'Evidence' && (
        <Block title="Evidence / EBC">
          <p>truth spine {payload.ebc_truth_spine ? 'YES' : 'NO'}</p>
          <p>evidence {payload.metrics.evidence_count} · seats {payload.metrics.seat_count} · tools {payload.metrics.tool_calls}</p>
          {ebc ? (
            <>
              <p>domain {ebc.research_domain ?? 'n/a'} · freshness window {ebc.freshness_window_days ?? 'none'}</p>
              <p>selected {ebc.selected_source_count ?? 0} · failed {ebc.failed_source_count ?? 0} · usable {ebc.usable_source_count ?? 0} · public rows {(ebc.sources ?? []).filter(row => row.usable).length}</p>
              <CouncilSourceList links={councilSourcesFromSnapshot(ebc)} collapsedByDefault={false} />
              {(ebc.evidence ?? []).slice(0, 8).map(row => (
                <p key={row.id}>{row.verification_state} {row.support_type} claims {(row.claim_ids ?? []).length}</p>
              ))}
            </>
          ) : null}
        </Block>
      )}
      {tab === 'Hypotheses' && (
        <Block title="Hypotheses">
          {(orch?.hypotheses ?? []).length
            ? orch!.hypotheses.map(h => <p key={h.id}>{h.id} [{h.status}] {h.statement}</p>)
            : <p>No diagnostic hypotheses</p>}
        </Block>
      )}
      {tab === 'Scenarios' && (
        <Block title="Scenarios">
          {payload.scenarios?.invoked
            ? payload.scenarios.scenarios.map(row => <p key={row.scenario_id}>{row.family} {row.option} · {row.reversibility}</p>)
            : <p>JANUS skipped: {payload.scenarios?.skip_reason ?? 'n/a'}</p>}
        </Block>
      )}
      {tab === 'Conflicts' && (
        <Block title="Conflicts">
          {(orch?.conflicts ?? []).length
            ? orch!.conflicts.map(c => <p key={c.conflict_id}>{c.kind} unresolved={String(c.unresolved)} {c.disputed_claim}</p>)
            : <p>No preserved conflicts</p>}
        </Block>
      )}
      {tab === 'Risks' && (
        <Block title="Risks">
          {payload.risks?.invoked
            ? payload.risks.risks.map(row => <p key={row.risk_id}>{row.category} {row.severity} {row.blocking ? 'BLOCKING' : row.action}</p>)
            : <p>SENTINEL skipped</p>}
        </Block>
      )}
      {tab === 'Authority' && (
        <Block title="Authority / Governor">
          {payload.governor.length
            ? payload.governor.slice(0, 12).map(row => <p key={`${row.step_id}-${row.capability_id}`}>{row.capability_id} {row.verdict}</p>)
            : <p>No governed steps</p>}
        </Block>
      )}
      {tab === 'Receipts' && (
        <Block title="Receipts">
          {payload.receipts.length
            ? payload.receipts.slice(0, 8).map(row => <p key={row.receipt_id}>{row.capability} {row.success ? 'ok' : 'fail'} {row.authority_result}</p>)
            : <p>No receipts</p>}
        </Block>
      )}
      {tab === 'Knowledge' && (
        <Block title="Knowledge / Temporal">
          <p>nodes {payload.knowledge.node_count} · edges {payload.knowledge.edge_count}</p>
          <p>current install {payload.knowledge.current_install ?? 'unknown'}</p>
          {payload.self_awareness ? (
            <>
              <p>install {payload.self_awareness.install_id ?? 'unverified'}</p>
              <p>3847 pid {payload.self_awareness.runtime_3847.pid ?? 'none'} · 3848 pid {payload.self_awareness.runtime_3848.pid ?? 'none'}</p>
              <p>council {payload.self_awareness.council_state} · local {payload.self_awareness.local_backend_state}</p>
            </>
          ) : null}
        </Block>
      )}
      {tab === 'Evaluation' && (
        <Block title="Evaluation">
          <p>completion {orch?.completion ?? 'n/a'}</p>
          <p>trains_wrim {String(orch?.evaluation?.trains_wrim ?? false)}</p>
          <p>grants_authority {String(orch?.grants_authority ?? false)}</p>
        </Block>
      )}
      {tab === 'Live Tasks' && (
        <Block title="Live Tasks">
          {(orch?.task_graph.tasks ?? []).map(task => (
            <p key={task.task_id}>{task.task_id} {task.status} {task.assigned_role} deps={(task.depends_on ?? []).join(',') || 'none'}</p>
          ))}
          <p>parallel groups {(orch?.task_graph.parallel_groups ?? []).length}</p>
        </Block>
      )}
      {tab === 'Work Products' && (
        <Block title="Work Products">
          {(orch?.work_products ?? []).map(p => (
            <p key={p.work_product_id}>{p.agent} {p.type} {p.work_product_id}</p>
          ))}
          {(orch?.live?.work_product_edges ?? []).map(e => (
            <p key={`${e.product_id}-${e.to}`}>{e.from} → {e.to} ({e.reason})</p>
          ))}
        </Block>
      )}
      {tab === 'Question Graph' && (
        <Block title="Question Graph">
          {(orch?.questions.questions ?? []).map(q => (
            <p key={q.question_id}>{q.priority} {q.answer_state} {q.assigned_role}: {q.text}</p>
          ))}
        </Block>
      )}
      {tab === 'Tool Decisions' && (
        <Block title="Tool Decisions">
          {(orch?.live?.tool_decisions ?? []).length
            ? (orch?.live?.tool_decisions ?? []).map((d, i) => (
              <p key={`${d.tool}-${i}`}>{d.chosen ? 'CHOSEN' : 'REJECTED'} {d.tool} {d.reason}{d.alternate ? ` alt=${d.alternate}` : ''}</p>
            ))
            : (orch?.tool_values ?? []).map(v => <p key={v.tool}>{v.tool} gain={v.expected_information_gain} auth={v.authority}</p>)}
        </Block>
      )}
      {tab === 'Verification Queue' && (
        <Block title="Verification Queue">
          {(orch?.verification ?? []).map(v => (
            <p key={v.claim_id}>{v.claim_id} score={v.score} verify={String(v.verify)} impact={v.impact}</p>
          ))}
        </Block>
      )}
      {tab === 'Replans' && (
        <Block title="Replans">
          {(orch?.revisions ?? []).length
            ? orch!.revisions.map(r => <p key={r.receipt_id}>{r.reason} rev={r.revision} affected={(r.affected_tasks ?? []).join(',')}</p>)
            : <p>No ATLAS revisions</p>}
        </Block>
      )}
      {tab === 'Completion' && (
        <Block title="Completion">
          <p>{orch?.completion ?? 'n/a'}</p>
          <p>phoenix {orch?.live?.phoenix?.invoked ? orch.live.phoenix.reason : 'not invoked'}</p>
        </Block>
      )}
      {tab === 'Budget' && (
        <Block title="Budget">
          <p>{orch?.budget.budget} tools={orch?.budget.tool_calls} turns={orch?.budget.agent_turns}</p>
          <p>optional skipped {(orch?.budget.optional_work_skipped ?? []).join(', ') || 'none'}</p>
          <p>safety_not_skipped {String(orch?.budget.safety_not_skipped ?? true)}</p>
        </Block>
      )}
      {tab === 'Model Routing' && (
        <Block title="Model Routing">
          {(orch?.job_routes ?? []).map(r => (
            <p key={r.job}>{r.job} → {r.model_target} {r.placement} fake_local={String(r.fake_local)}</p>
          ))}
        </Block>
      )}
      {tab === 'Telemetry' && (
        <Block title="Telemetry">
          <p>strategy {orch?.telemetry.strategy} tasks={orch?.telemetry.task_count} replans={orch?.telemetry.replans}</p>
          <p>evidence {orch?.telemetry.evidence_count} conflicts={orch?.telemetry.conflicts} latency={orch?.telemetry.latency_ms}ms</p>
          <p>persisted {String(orch?.live?.persisted ?? false)}</p>
        </Block>
      )}
      {tab === 'Mission Replay' && (
        <Block title="Mission Replay (read-only)">
          {orch?.live?.replay
            ? (
              <>
                <p>executable {String(orch.live.replay.executable)}</p>
                <p>strategy {orch.live.replay.strategy} completion {orch.live.replay.completion}</p>
                <p>agents {(orch.live.replay.assembly ?? []).join(', ')}</p>
                <p>learning trains_wrim {String(orch.live.learning?.trains_wrim ?? false)} auto_ingest {String(orch.live.learning?.auto_ingest ?? false)}</p>
              </>
            )
            : <p>No replay record</p>}
        </Block>
      )}
      {tab === 'Mission History' && (
        <Block title="Mission History">
          <p>{orch?.live?.adaptive?.experience?.mission_id ?? 'none'} {orch?.live?.adaptive?.experience?.strategy} {orch?.live?.adaptive?.experience?.completion_state}</p>
        </Block>
      )}
      {tab === 'Mission Diff' && (
        <Block title="Mission Diff">
          {orch?.live?.adaptive?.mission_diff
            ? Object.entries(orch.live.adaptive.mission_diff).map(([k, v]) => <p key={k}>{k}: {v}</p>)
            : <p>No diff this turn</p>}
        </Block>
      )}
      {tab === 'Parallel Timeline' && (
        <Block title="Parallel Timeline">
          {(orch?.live?.adaptive?.waves ?? []).map(w => (
            <p key={w.wave}>wave {w.wave} {w.concurrent ? 'PARALLEL' : 'SERIAL'} {(w.task_ids ?? []).join(',')}</p>
          ))}
          <p>speedup {orch?.live?.adaptive?.timing?.speedup ?? 'n/a'} seq={orch?.live?.adaptive?.timing?.sequential_ms} par={orch?.live?.adaptive?.timing?.parallel_ms}</p>
        </Block>
      )}
      {tab === 'Agent Contributions' && (
        <Block title="Agent Contributions">
          {(orch?.live?.adaptive?.agent_value ?? []).map(a => (
            <p key={a.seat}>{a.seat} {a.value} products={a.work_products} evidence={a.new_evidence}</p>
          ))}
        </Block>
      )}
      {tab === 'Tool Efficiency' && (
        <Block title="Tool Efficiency">
          {(orch?.live?.adaptive?.tool_history ?? []).length
            ? orch!.live!.adaptive!.tool_history.map(t => <p key={t.tool}>{t.tool} {t.successful}/{t.attempted} auto_disabled={String(t.auto_disabled)}</p>)
            : <p>No tool history this turn</p>}
        </Block>
      )}
      {tab === 'Model Routing History' && (
        <Block title="Model Routing History">
          {(orch?.live?.adaptive?.model_history ?? []).map(m => (
            <p key={`${m.job}-${m.model_target}`}>{m.job} → {m.model_target} hard_bind={String(m.hard_bind)}</p>
          ))}
        </Block>
      )}
      {tab === 'Commander Corrections' && (
        <Block title="Commander Corrections">
          {(orch?.live?.adaptive?.corrections ?? []).length
            ? orch!.live!.adaptive!.corrections.map(c => <p key={c.turn_id}>{c.correction_type} fact={String(c.is_automatic_fact)}</p>)
            : <p>No correction signal</p>}
        </Block>
      )}
      {tab === 'Failure Clusters' && (
        <Block title="Failure Clusters">
          <p>{(orch?.live?.adaptive?.failure_clusters ?? []).join(', ') || 'none'}</p>
        </Block>
      )}
      {tab === 'Playbooks' && (
        <Block title="Playbooks">
          <p>{orch?.live?.adaptive?.playbook?.status} auto={String(orch?.live?.adaptive?.playbook?.auto_usable)}</p>
        </Block>
      )}
      {tab === 'Learning Records' && (
        <Block title="Learning Records">
          <p>screen {orch?.live?.adaptive?.screening ?? 'n/a'} trains_wrim {String(orch?.live?.adaptive?.trains_wrim ?? false)}</p>
        </Block>
      )}
      {tab === 'WRIM Eval Staging' && (
        <Block title="WRIM Eval Staging">
          <p>staged {String(orch?.live?.adaptive?.wrim_eval_staged ?? false)} trains_wrim false purpose evaluation</p>
        </Block>
      )}
    </div>
  )
}
