/** Phase 10 continuation: assignments + specialist need/reuse/creation. Run: pnpm run validate:agent-eng-lifecycle */
import { harness, engWorld, addAgent, draftFor, doneAssignment, passed, C, NOW, mins } from './engtestkit'
import { AgentOpsLog } from '../log'
import { AgentTransitionError } from '../lifecycle'
import { deriveAgents } from '../registry'
import {
  ASSIGNMENT_CEILINGS, AssignmentError, MAX_RUNNING_ASSIGNMENTS, acknowledgeCancel, assign, blockAssignment, completeAssignment, deriveAssignments, executionGate, failAssignment, finalizeCancel,
  handOffAssignment, pauseAssignment, recoverInterruptedAssignments, requestCancel, resumeAssignment, startAssignment, unblockAssignment,
} from './assignments'
import { capabilityEvidence, decideSpecialist, needFromAssignments, proposeSpecialist } from './engineeringNeed'
import { NeedGateError } from '../registry'

const { check, finish } = harness('AGENT_ENG_LIFECYCLE_VALIDATION')
const code = (fn: () => unknown) => { try { fn(); return 'none' } catch (e) { return e instanceof AssignmentError ? e.code : e instanceof NeedGateError ? 'NEED_GATE' : e instanceof AgentTransitionError ? e.code : 'other' } }

// ---- assignments: authorization, idempotence, limits
{
  const w = engWorld(); const a = addAgent(w, 'agent-gen')
  const { assignment, created } = assign(w.log, draftFor(a.id, 'm1', 'add a notes feature'), C, NOW)
  check('J01_assignment_records_parent_outputs_conditions_workspace_tools_limits', created && assignment.parentMission.id === 'm1' && assignment.expectedOutputs.length > 0 && assignment.completionConditions.length > 0 && assignment.workspace?.id === 'ws1' && assignment.tools.includes('run_workspace_tests') && assignment.limits.maxSteps === 10)
  const again = assign(w.log, draftFor(a.id, 'm1', 'add a notes feature'), C, NOW)
  check('J02_same_logical_work_is_not_duplicated', !again.created && again.assignment.id === assignment.id && deriveAssignments(w.log).assignments.size === 1)
  check('J03_tools_outside_the_agents_scope_refused', (() => { const x = addAgent(w, 'agent-ro', 'codebase_triage', ['read_workspace']); return code(() => assign(w.log, draftFor(x.id, 'm2', 'edit', { tools: ['read_workspace', 'write_workspace'] }), C, NOW)) === 'NOT_AUTHORIZED' })())
  check('J04_write_access_needs_commander_and_a_bound_workspace', code(() => assign(w.log, draftFor(a.id, 'm3', 'sys write'), 'system:mission:m3', NOW)) === 'NOT_AUTHORIZED' && code(() => assign(w.log, draftFor(a.id, 'm4', 'no ws', { workspace: null }), C, NOW)) === 'WORKSPACE' && code(() => assign(w.log, draftFor(a.id, 'm5', 'x', { workspace: { id: 'w', root: 'relative/path', kind: 'sandbox' } }), C, NOW)) === 'WORKSPACE')
  check('J05_ceilings_cannot_be_raised', code(() => assign(w.log, draftFor(a.id, 'm6', 'x', { limits: { maxSteps: 41, maxRuntimeMs: 1, maxModelCalls: 1, maxRetries: 1 } }), C, NOW)) === 'LIMIT' && code(() => assign(w.log, draftFor(a.id, 'm7', 'x', { limits: { maxSteps: 1, maxRuntimeMs: ASSIGNMENT_CEILINGS.maxRuntimeMs + 1, maxModelCalls: 1, maxRetries: 1 } }), C, NOW)) === 'LIMIT')
  check('J06_required_fields_and_unknown_dependency_refused', code(() => assign(w.log, draftFor(a.id, 'm8', 'x', { expectedOutputs: [] }), C, NOW)) === 'INVALID' && code(() => assign(w.log, draftFor(a.id, 'm9', 'x', { dependencies: ['nope'] }), C, NOW)) === 'DEPENDENCY')
  check('J07_retired_agent_gets_no_new_assignments', (() => { const r = addAgent(w, 'agent-old'); w.reg.transition(r.id, 'RETIRED', C, 'obsolete', NOW); return code(() => assign(w.log, draftFor(r.id, 'm10', 'x'), C, NOW)) === 'AGENT_NOT_ACTIVE' })())
}

// ---- state machine, controls, cancellation dispositions
{
  const w = engWorld(); const a = addAgent(w, 'agent-a'); const b = addAgent(w, 'agent-b'); const c = addAgent(w, 'agent-c'); const d = addAgent(w, 'agent-d')
  const x = assign(w.log, draftFor(a.id, 'm1', 'one'), C, NOW).assignment
  check('J08_illegal_transitions_fail_closed', code(() => completeAssignment(w.log, x.id, 'system:r', passed(), NOW)) === 'ILLEGAL_TRANSITION' && code(() => pauseAssignment(w.log, x.id, C, 'p', NOW)) === 'ILLEGAL_TRANSITION' && deriveAssignments(w.log).assignments.get(x.id)!.state === 'QUEUED')
  startAssignment(w.log, x.id, 'system:r', NOW)
  check('J09_pause_blocks_execution_resume_continues_only_by_commander', (pauseAssignment(w.log, x.id, C, 'pause', NOW), executionGate(w.log, x.id).reason === 'PAUSED') && code(() => resumeAssignment(w.log, x.id, 'system:r', 'x', NOW)) === 'NOT_AUTHORIZED' && (resumeAssignment(w.log, x.id, C, 'go', NOW), executionGate(w.log, x.id).proceed))
  blockAssignment(w.log, x.id, 'system:r', 'tests cannot run: missing dependency', NOW)
  const bv = deriveAssignments(w.log).assignments.get(x.id)!
  check('J10_blocked_state_carries_the_blocker_and_clears_on_unblock', bv.state === 'BLOCKED' && bv.blocker!.includes('missing dependency') && !executionGate(w.log, x.id).proceed && (unblockAssignment(w.log, x.id, 'system:r', 'installed', NOW), deriveAssignments(w.log).assignments.get(x.id)!.blocker === undefined))
  check('J11_only_a_commander_can_request_cancellation', code(() => requestCancel(w.log, x.id, 'system:r', 'x', NOW)) === 'NOT_AUTHORIZED' && code(() => requestCancel(w.log, x.id, 'agent:self', 'x', NOW)) === 'NOT_AUTHORIZED')
  requestCancel(w.log, x.id, C, 'operator cancel', NOW)
  const s1 = deriveAssignments(w.log).assignments.get(x.id)!
  const g1 = executionGate(w.log, x.id)
  acknowledgeCancel(w.log, x.id, 'system:r', NOW)
  const s2 = deriveAssignments(w.log).assignments.get(x.id)!
  finalizeCancel(w.log, x.id, 'system:r', 'STOPPED', 'stopped at step boundary', NOW)
  const s3 = deriveAssignments(w.log).assignments.get(x.id)!
  check('J12_cancellation_phases_requested_acknowledged_stopped_are_distinct_and_stop_new_work', s1.cancellation === 'REQUESTED' && !g1.proceed && g1.reason === 'CANCEL_REQUESTED' && s2.cancellation === 'STOPPING' && s3.state === 'CANCELLED' && s3.disposition === 'STOPPED' && s3.stopReason === 'operator cancel')
  const y = assign(w.log, draftFor(b.id, 'm2', 'two'), C, NOW).assignment; startAssignment(w.log, y.id, 'system:r', NOW); requestCancel(w.log, y.id, C, 'cancel mid-step', NOW)
  finalizeCancel(w.log, y.id, 'system:r', 'UNABLE_TO_SAFELY_INTERRUPT', 'step could not be interrupted safely; it completed before stopping', NOW)
  const yv = deriveAssignments(w.log).assignments.get(y.id)!
  check('J13_unable_to_safely_interrupt_is_a_distinct_final_disposition', yv.state === 'CANCELLED' && yv.disposition === 'UNABLE_TO_SAFELY_INTERRUPT' && yv.cancellation === 'UNABLE_TO_SAFELY_INTERRUPT')
  const z = assign(w.log, draftFor(c.id, 'm3', 'three'), C, NOW).assignment; startAssignment(w.log, z.id, 'system:r', NOW)
  w.reg.transition(c.id, 'RETIRED', C, 'retire while running', NOW)
  check('J14_retiring_an_agent_stops_its_running_work_at_the_gate', executionGate(w.log, z.id).reason === 'AGENT_NOT_ACTIVE' && !executionGate(w.log, z.id).proceed)
  const hf = assign(w.log, draftFor(d.id, 'm4', 'four'), C, NOW).assignment; startAssignment(w.log, hf.id, 'system:r', NOW)
  failAssignment(w.log, hf.id, 'system:r', 'tests failed after 2 repairs', passed({ validation: 'FAILED', summary: 'validation failed' }), NOW)
  check('J15_failures_stay_visible_with_reason_and_outcome', deriveAssignments(w.log).assignments.get(hf.id)!.state === 'FAILED' && deriveAssignments(w.log).assignments.get(hf.id)!.stopReason!.includes('tests failed') && deriveAssignments(w.log).assignments.get(hf.id)!.outcome!.validation === 'FAILED')
  check('J16_handoff_records_successor', (() => { const h = engWorld(); const p = addAgent(h, 'p'); const q = addAgent(h, 'q'); const t = assign(h.log, draftFor(p.id, 'mh', 'handoff me'), C, NOW).assignment; startAssignment(h.log, t.id, 'system:r', NOW); handOffAssignment(h.log, t.id, 'system:r', q.id, 'specialist failed; handing to successor', NOW); const v = deriveAssignments(h.log).assignments.get(t.id)!; return v.state === 'HANDED_OFF' && v.handoffTo === q.id })())
}

// ---- concurrency, dependencies, recovery, forged records
{
  const w = engWorld(); const ags = ['a', 'b', 'c', 'd'].map((n) => addAgent(w, `agent-${n}`))
  const ids = ags.map((a, i) => assign(w.log, draftFor(a.id, `m${i}`, `obj ${i}`), C, NOW).assignment.id)
  for (let i = 0; i < MAX_RUNNING_ASSIGNMENTS; i++) startAssignment(w.log, ids[i], 'system:r', NOW)
  check('J17_global_concurrency_limit_enforced', code(() => startAssignment(w.log, ids[3], 'system:r', NOW)) === 'LIMIT')
  const dup = assign(w.log, draftFor(ags[0].id, 'mx', 'second for a'), C, NOW).assignment
  check('J18_per_agent_live_limit_enforced', code(() => startAssignment(w.log, dup.id, 'system:r', NOW)) === 'LIMIT')
  const w2 = engWorld(); const g = addAgent(w2, 'agent-g')
  const first = assign(w2.log, draftFor(g.id, 'd1', 'first'), C, NOW).assignment
  const second = assign(w2.log, draftFor(g.id, 'd2', 'second', { dependencies: [first.id] }), C, NOW).assignment
  check('J19_dependency_must_complete_before_start', (() => { const e = code(() => startAssignment(w2.log, second.id, 'system:r', NOW)); startAssignment(w2.log, first.id, 'system:r', NOW); completeAssignment(w2.log, first.id, 'system:r', passed(), NOW); startAssignment(w2.log, second.id, 'system:r', NOW); return e === 'DEPENDENCY' })())
  // recovery
  const w3 = engWorld(); const r = addAgent(w3, 'agent-r'); const t = assign(w3.log, draftFor(r.id, 'mr', 'recover me'), C, NOW).assignment; startAssignment(w3.log, t.id, 'system:r', NOW)
  const early = recoverInterruptedAssignments(w3.log, mins(1)); const late = recoverInterruptedAssignments(w3.log, mins(10)); const again = recoverInterruptedAssignments(w3.log, mins(20))
  check('J20_interrupted_assignment_recovery_waits_for_staleness_and_is_idempotent', early.length === 0 && late.join() === t.id && again.length === 0 && deriveAssignments(w3.log).assignments.get(t.id)!.state === 'INTERRUPTED')
  // forged
  const w4 = engWorld(); const f = addAgent(w4, 'agent-f', 'feature_implementation', ['read_workspace'])
  w4.log.append({ t: 'assignment', assignment: { ...draftFor(f.id, 'mf', 'forged write'), id: 'asg-forged', createdBy: 'agent:self', createdAt: NOW.toISOString() } })
  w4.log.append({ t: 'assignment', assignment: { ...draftFor(f.id, 'mf2', 'forged tools', { tools: ['write_workspace'] }), id: 'asg-forged2', createdBy: C, createdAt: NOW.toISOString() } })
  const ok = assign(w4.log, draftFor(f.id, 'mf3', 'legit', { tools: ['read_workspace'], workspace: null }), C, NOW).assignment
  w4.log.append({ t: 'assignmentEvent', assignmentId: ok.id, kind: 'COMPLETED', by: 'agent:self', at: NOW.toISOString(), reason: 'forged completion' })
  check('J21_forged_assignment_and_event_records_are_ignored_on_replay', deriveAssignments(w4.log).assignments.size === 1 && deriveAssignments(w4.log).assignments.get(ok.id)!.state === 'QUEUED' && deriveAssignments(w4.log).rejectedEvents === 3)
  check('J22_state_survives_restart', (() => { const re = deriveAssignments(new AgentOpsLog(w2.dir)).assignments; return re.get(first.id)!.state === 'COMPLETED' && re.get(second.id)!.state === 'RUNNING' })())
}

// ---- specialist need, reuse vs creation
{
  const w = engWorld(); const gen = addAgent(w, 'agent-generalist', 'codebase_triage', ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local'])
  const none = engWorld()
  const d0 = decideSpecialist(none.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] }, NOW)
  check('K01_no_agents_and_no_evidence_means_no_specialist_and_creation_refused_with_NO_EVIDENCE', d0.action === 'NO_SPECIALIST_AVAILABLE' && d0.creation!.allowed === false && d0.creation!.missingCriteria.length === 7 && d0.reasons.some((r) => r.includes('NO EVIDENCE')))
  const a0 = capabilityEvidence(w.log, deriveAgents(w.log).agents.get(gen.id)!, 'feature_implementation')
  const d1 = decideSpecialist(w.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] }, NOW)
  check('K02_label_only_suitability_is_INFERRED_not_proven_and_only_reused_as_unproven', a0.type === 'INFERRED' && !a0.proven && d1.action === 'REUSE_UNPROVEN' && d1.agentId === gen.id && d1.benefit.includes('not yet proven'))
  check('K03_creation_refused_without_recurring_evidence', (() => { try { proposeSpecialist(w.log, { taskClass: 'feature_implementation', capability: 'feature_implementation', name: 'x', purpose: 'y', workspaceNote: '' }, NOW); return false } catch (e) { return e instanceof NeedGateError && e.missing.length === 7 } })())
  doneAssignment(w, gen.id, 'm1', 'feature one')
  check('K04_one_validated_run_is_EVIDENCE_BACKED_and_reusable_as_proven', capabilityEvidence(w.log, deriveAgents(w.log).agents.get(gen.id)!, 'feature_implementation').type === 'EVIDENCE_BACKED' && decideSpecialist(w.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] }, NOW).action === 'REUSE')
  const w2 = engWorld(); const g2 = addAgent(w2, 'agent-g2', 'codebase_triage', ['read_workspace'])
  void g2
  // generalist without the required tool scope cannot be chosen; evidence for creation comes from other agents' completed work
  const w3 = engWorld(); const lone = addAgent(w3, 'agent-lone', 'codebase_triage', ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local'])
  doneAssignment(w3, lone.id, 'p1', 'feature p1', passed()); doneAssignment(w3, lone.id, 'p2', 'feature p2', passed())
  // make lone busy so the proven candidate is unavailable -> concrete shortfall with recurring evidence
  const busy = assign(w3.log, draftFor(lone.id, 'p3', 'busy work'), C, NOW).assignment; startAssignment(w3.log, busy.id, 'system:r', NOW)
  const d2 = decideSpecialist(w3.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] }, NOW)
  check('K05_proven_but_busy_agent_plus_recurring_evidence_justifies_a_creation_proposal_with_real_refs', d2.action === 'CREATE_PROPOSAL' && d2.creation!.allowed && d2.reasons.some((r) => r.includes('proven candidates are unavailable')) && d2.benefit.includes('recurring pattern') && !/parallel/i.test(d2.benefit))
  const nd = needFromAssignments(w3.log, 'feature_implementation', NOW)
  check('K06_need_evidence_is_built_from_real_assignments_only', nd.missing.length === 0 && nd.refs.length === 2 && nd.need!.evidence.every((e) => e.evidenceRefs.length > 0 && e.summary.length >= 10) && nd.need!.evidence[0].evidenceRefs.every((r) => r.startsWith('assignment:asg-')))
  const spec = proposeSpecialist(w3.log, { taskClass: 'feature_implementation', capability: 'feature_implementation', name: 'Feature specialist', purpose: 'implement multi-layer features', workspaceNote: '' }, NOW)
  const again = proposeSpecialist(w3.log, { taskClass: 'feature_implementation', capability: 'feature_implementation', name: 'Feature specialist', purpose: 'implement multi-layer features', workspaceNote: '' }, NOW)
  const pv = deriveAgents(w3.log).agents.get(spec.agentId)!
  check('K07_specialist_is_proposed_not_activated_and_creation_is_idempotent', spec.created && !again.created && pv.state === 'PROPOSED' && pv.spec.toolScope!.includes('write_workspace') && deriveAgents(w3.log).agents.size === 2 && code(() => assign(w3.log, draftFor(spec.agentId, 'p9', 'x'), C, NOW)) === 'AGENT_NOT_ACTIVE')
  w3.reg.transition(spec.agentId, 'APPROVED', C, 'approve specialist', NOW); w3.reg.transition(spec.agentId, 'ACTIVE', C, 'activate specialist', NOW)
  const done = busy
  completeAssignment(w3.log, done.id, 'system:r', passed(), NOW)
  const d3 = decideSpecialist(w3.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] }, NOW)
  check('K08_specialist_without_validated_outcomes_is_not_preferred_over_a_demonstrated_agent', d3.action === 'REUSE' && d3.agentId === lone.id && d3.candidates.find((c) => c.agentId === spec.agentId)!.weakest === 'INFERRED')
  // repeated request reuses the same specialist once it has evidence
  doneAssignment(w3, spec.agentId, 'p5', 'feature p5', passed()); doneAssignment(w3, spec.agentId, 'p6', 'feature p6', passed())
  const second = decideSpecialist(w3.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'], excludeAgents: [lone.id] }, NOW)
  check('K09_repeated_request_reuses_the_demonstrated_specialist_no_new_agent', second.action === 'REUSE' && second.agentId === spec.agentId && second.candidates[0].weakest === 'DEMONSTRATED' && deriveAgents(w3.log).agents.size === 2)
  // failing specialist is not reused
  const w4 = engWorld(); const bad = addAgent(w4, 'agent-bad', 'feature_implementation')
  const f1 = assign(w4.log, draftFor(bad.id, 'b1', 'f1'), C, NOW).assignment; startAssignment(w4.log, f1.id, 'system:r', NOW); failAssignment(w4.log, f1.id, 'system:r', 'validation failed', passed({ validation: 'FAILED' }), NOW)
  const dBad = decideSpecialist(w4.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] }, NOW)
  check('K10_contradicted_agent_is_not_reused', capabilityEvidence(w4.log, deriveAgents(w4.log).agents.get(bad.id)!, 'feature_implementation').contradicted && dBad.action === 'NO_SPECIALIST_AVAILABLE')
  check('K11_decisions_are_explainable_every_candidate_has_basis', d2.candidates.every((c) => c.assessments.every((a) => a.basis.length > 0)) && d2.reasons.length >= 2)
  const w5 = engWorld(); const a5 = addAgent(w5, 'agent-x5', 'feature_implementation', ['read_workspace'])
  check('K12_candidate_must_cover_required_tools', decideSpecialist(w5.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] }, NOW).candidates.length === 0 && a5.id.length > 0)
}
finish()
