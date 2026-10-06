/** Phase 10 validation. Run: pnpm run validate:agent-ops */
import { appendFileSync, readFileSync } from 'node:fs'
import { harness, freshOps, fullNeed, draft, activeAgent, NOW, tmp } from './testkit'
import { AgentOpsLog } from './log'
import { AgentRegistry, NeedGateError, deriveAgents } from './registry'
import { AgentTransitionError, assertTransition } from './lifecycle'
import { detectNeed, missingCriteria } from './need'
import { NEED_CRITERIA, type AgentState } from './types'

const { check, finish } = harness('AGENT_OPS_VALIDATION')

// ---- P10-A: need gate, lifecycle, durability
{
  const o = freshOps()
  const partial = detectNeed({ title: 'vague idea', evidence: NEED_CRITERIA.slice(0, 5).map((criterion) => ({ criterion, summary: `evidence for ${criterion}`, evidenceRefs: ['r'] })) }, NOW)
  o.reg.recordNeed(partial)
  let gate: NeedGateError | null = null
  try { o.reg.propose(partial.id, draft(), NOW) } catch (e) { gate = e as NeedGateError }
  check('A01_proposal_refused_without_all_seven_criteria', gate instanceof NeedGateError && gate.missing.join() === 'known_escalation_path,failure_drift_review_process' && o.reg.list().length === 0, gate?.message ?? '')
  const thin = detectNeed({ title: 't', evidence: NEED_CRITERIA.map((criterion) => ({ criterion, summary: 'x', evidenceRefs: [] })) }, NOW)
  check('A02_empty_or_ref_less_evidence_does_not_count', missingCriteria(thin).length === 7)

  const need = fullNeed(); o.reg.recordNeed(need)
  const spec = o.reg.propose(need.id, draft(), NOW)
  check('A03_valid_proposal_creates_PROPOSED_agent_with_stable_id', o.reg.get(spec.id)?.state === 'PROPOSED' && spec.id.startsWith('agent-documentation_synthesis-') && spec.version === 1)
  const bad = (d: Parameters<typeof draft>[0]) => { try { o.reg.propose(need.id, draft({ id: 'x-' + Math.random(), ...d }), NOW); return false } catch { return true } }
  check('A04_scope_validation', bad({ permissionScope: [] }) && bad({ permissionScope: ['external_action' as never] }) && bad({ memoryScope: ['everything' as never] }) && bad({ escalationPath: ' ' }) && bad({ specialization: 'vibes' as never }))

  const expectErr = (fn: () => unknown, code: string) => { try { fn(); return false } catch (e) { return e instanceof AgentTransitionError && e.code === code } }
  check('A05_only_commander_approves_and_activates', expectErr(() => o.reg.transition(spec.id, 'APPROVED', 'agent:self', 'self approve', NOW), 'ACTOR_NOT_AUTHORIZED') && expectErr(() => o.reg.transition(spec.id, 'APPROVED', 'system:governor', 'x', NOW), 'ACTOR_NOT_AUTHORIZED') && expectErr(() => o.reg.transition(spec.id, 'APPROVED', 'commander:', 'x', NOW), 'ACTOR_NOT_AUTHORIZED') && o.reg.get(spec.id)!.state === 'PROPOSED')
  check('A06_illegal_transitions_fail_closed_and_write_nothing', expectErr(() => o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'skip approval', NOW), 'ILLEGAL_TRANSITION') && expectErr(() => o.reg.transition(spec.id, 'PAUSED', 'commander:mark', 'x', NOW), 'ILLEGAL_TRANSITION') && o.log.view().records.filter((r) => r.t === 'transition').length === 0)
  o.reg.transition(spec.id, 'APPROVED', 'commander:mark', 'ok', NOW)
  o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'go', NOW)
  check('A07_system_governor_may_only_make_safer', o.reg.transition(spec.id, 'PAUSED', 'system:governor', 'failure trip', NOW).state === 'PAUSED' && expectErr(() => o.reg.transition(spec.id, 'ACTIVE', 'system:governor', 'self resume', NOW), 'ACTOR_NOT_AUTHORIZED') && o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'resume', NOW).state === 'ACTIVE')
  o.reg.transition(spec.id, 'RETIRED', 'commander:mark', 'low value', NOW)
  const states: AgentState[] = ['PROPOSED', 'APPROVED', 'ACTIVE', 'PAUSED', 'UNDER_REVIEW', 'REJECTED', 'RETIRED']
  check('A08_retired_is_terminal_for_every_target', states.every((s) => expectErr(() => assertTransition('RETIRED', s, 'commander:mark'), 'TERMINAL_STATE')) && expectErr(() => o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'revive', NOW), 'TERMINAL_STATE'))

  // durability: restart, torn line, duplicates, forged transition
  const dir = o.dir
  const reopened = new AgentRegistry(new AgentOpsLog(dir))
  check('A09_state_survives_restart_with_history', reopened.get(spec.id)?.state === 'RETIRED' && reopened.get(spec.id)!.history.map((h) => h.to).join() === 'APPROVED,ACTIVE,PAUSED,ACTIVE,RETIRED')
  appendFileSync(o.log.file, '{"t":"transition","rid":"torn')
  const forged = JSON.stringify({ t: 'transition', rid: 'forged-1', tr: { agentId: spec.id, from: 'RETIRED', to: 'ACTIVE', by: 'commander:mark', at: NOW.toISOString(), reason: 'forged' } })
  new AgentOpsLog(dir).append({ t: 'need', need: fullNeed('another') }) // append after torn line repairs newline
  appendFileSync(o.log.file, forged + '\n')
  const lines = readFileSync(o.log.file, 'utf8').split('\n').filter(Boolean)
  appendFileSync(o.log.file, lines[1] + '\n') // duplicate record line
  const v = new AgentOpsLog(dir).view()
  const d = deriveAgents(new AgentOpsLog(dir))
  check('A10_torn_duplicate_and_forged_records_are_tolerated', v.corruptLines === 1 && v.duplicateLines === 1 && d.rejectedTransitions === 1 && d.agents.get(spec.id)!.state === 'RETIRED', `corrupt=${v.corruptLines} dup=${v.duplicateLines} rejected=${d.rejectedTransitions}`)
  let secret = false
  try { new AgentOpsLog(tmp()).append({ t: 'need', need: detectNeed({ title: 'sk-abcdefghijklmnopqrstuvwxyz123456', evidence: [] }, NOW) }) } catch { secret = true }
  check('A11_records_with_credentials_are_refused', secret)
  let ro = false
  try { new AgentOpsLog(dir, { readOnly: true }).append({ t: 'need', need: fullNeed('x') }) } catch { ro = true }
  check('A12_read_only_log_refuses_writes', ro)
  const a = activeAgent()
  check('A13_agent_identity_independent_of_provider', !('provider' in a.spec) && !('model' in a.spec) && a.reg.get(a.spec.id)!.state === 'ACTIVE')
}
finish()
