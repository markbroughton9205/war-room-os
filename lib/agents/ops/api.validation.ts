/** Phase 10 API / read-model / built-in worker validation. Run: pnpm run validate:agent-ops-api */
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { harness, freshOps, fullNeed, draft, NOW, tmp } from './testkit'
import { AgentOpsLog } from './log'
import { commanderActor, handleOpsControl, handleOpsRead } from './api'
import { buildOpsSnapshot } from './readModel'
import { deriveAgents } from './registry'
import { freshLog as p9Log, ev as p9Ev, NOW as P9NOW } from '@/lib/recursive-learning/testkit'

const { check, finish } = harness('AGENT_OPS_API_VALIDATION')
const C = 'commander:mark'
const ctl = (log: AgentOpsLog, body: Record<string, unknown>, actor: string | null = C) => handleOpsControl(body, actor, log, NOW)
const get = (log: AgentOpsLog, q: string) => handleOpsRead(new URL(`http://x/?${q}`), log, NOW)

// identity / refusal
{
  const o = freshOps()
  const need = fullNeed()
  check('E01_no_session_or_non_commander_actor_is_403', (await ctl(o.log, { action: 'detectNeed', title: 't', evidence: [] }, null)).status === 403 && (await ctl(o.log, { action: 'detectNeed', title: 't', evidence: [] }, 'agent:self')).status === 403 && (await ctl(o.log, { action: 'detectNeed', title: 't', evidence: [] }, 'system:governor')).status === 403 && o.log.view().records.length === 0)
  check('E02_actor_derivation_sanitizes_session_id', commanderActor('abc-123_X.y') === 'commander:abc-123_X.y' && commanderActor('a b;c') === 'commander:abc' && commanderActor('') === null && commanderActor(null) === null && commanderActor('!!!') === null)
  check('E03_unknown_action_400', (await ctl(o.log, { action: 'rm -rf' })).status === 400)
  await ctl(o.log, { action: 'detectNeed', title: need.title, evidence: need.evidence })
  const recorded = [...deriveAgents(o.log).needs.values()][0]
  const prop = await ctl(o.log, { action: 'proposeAgent', needId: recorded.id, draft: draft() })
  check('E04_need_to_proposal_flow', prop.status === 201)
  const agentId = (prop.body as { agent: { id: string } }).agent.id
  const spoof = await ctl(o.log, { action: 'transitionAgent', agentId, to: 'APPROVED', reason: 'ok', by: 'commander:impostor', actor: 'commander:impostor' }, 'commander:realuser')
  check('E05_body_supplied_identity_is_ignored', spoof.status === 200 && deriveAgents(o.log).agents.get(agentId)!.history[0].by === 'commander:realuser')
  check('E06_typed_errors_map_to_http', (await ctl(o.log, { action: 'transitionAgent', agentId, to: 'PAUSED', reason: 'x' })).status === 409 && (await ctl(o.log, { action: 'transitionAgent', agentId, to: 'ACTIVE', reason: '' })).status === 400)
  const thin = fullNeed('thin'); thin.evidence.pop()
  const thinId = ((await ctl(o.log, { action: 'detectNeed', title: thin.title, evidence: thin.evidence })).body as { need: { id: string } }).need.id
  const gated = await ctl(o.log, { action: 'proposeAgent', needId: thinId, draft: draft({ id: 'agent-thin' }) })
  check('E07_need_gate_is_422_with_missing_list', gated.status === 422 && (gated.body as { missing: string[] }).missing.length === 1)
  const before = o.log.view().records.length
  const sec = await ctl(o.log, { action: 'detectNeed', title: 'leak', evidence: [{ criterion: 'recurring_task_pattern', summary: 'password=hunter2hunter2 in use', evidenceRefs: ['r'] }] })
  check('E08_credential_content_refused_nothing_written', sec.status === 400 && o.log.view().records.length === before)
}

// full governed flow with built-in workers
{
  const docsDir = path.join(tmp(), 'docs'); mkdirSync(docsDir, { recursive: true })
  writeFileSync(path.join(docsDir, 'fresh.md'), '# fresh'); writeFileSync(path.join(docsDir, 'old.md'), '# old')
  const old = new Date(Date.now() - 200 * 86_400_000); utimesSync(path.join(docsDir, 'old.md'), old, old)
  process.env.WAR_ROOM_DOCS_DIR = docsDir
  const p9 = p9Log()
  for (let i = 1; i <= 6; i++) p9.recordEvent(p9Ev('ollama', 'code_modification', 'SUCCESS', i), P9NOW)
  process.env.WAR_ROOM_LEARNING_DIR = path.dirname(p9.file)
  const p9Before = readFileSync(p9.file, 'utf8')

  const o = freshOps()
  const mkAgent = async (name: string, spec: string, perms: string[], mem: string[]) => {
    const need = fullNeed(name)
    const nid = ((await ctl(o.log, { action: 'detectNeed', title: need.title, evidence: need.evidence })).body as { need: { id: string } }).need.id
    const a = (await ctl(o.log, { action: 'proposeAgent', needId: nid, draft: draft({ id: `agent-${name}`, specialization: spec as never, permissionScope: perms as never, memoryScope: mem as never }) })).body as { agent: { id: string } }
    await ctl(o.log, { action: 'transitionAgent', agentId: a.agent.id, to: 'APPROVED', reason: 'ok' }); await ctl(o.log, { action: 'transitionAgent', agentId: a.agent.id, to: 'ACTIVE', reason: 'go' })
    return a.agent.id
  }
  const docsAgent = await mkAgent('docs', 'documentation_synthesis', ['read_docs', 'write_own_reports'], ['docs'])
  const evalAgent = await mkAgent('eval', 'provider_evaluation', ['read_learning_log', 'write_own_reports'], ['learning_evidence'])
  const limits = { maxRuntimeMs: 5000, maxRunsPerDay: 20, maxConsecutiveFailures: 3, cadenceMinutes: 60 }
  await ctl(o.log, { action: 'registerWorker', draft: { id: 'w-docs', agentId: docsAgent, category: 'documentation_freshness', version: '1.0.0', mission: 'docs freshness', permissionScope: ['read_docs'], memoryScope: ['docs'], limits } })
  await ctl(o.log, { action: 'registerWorker', draft: { id: 'w-eval', agentId: evalAgent, category: 'evaluation_scoring', version: '1.0.0', mission: 'phase9 summary', permissionScope: ['read_learning_log'], memoryScope: ['learning_evidence'], limits } })
  await ctl(o.log, { action: 'registerWorker', draft: { id: 'w-eval-noperm', agentId: docsAgent, category: 'evaluation_scoring', version: '1.0.0', mission: 'should lack capability', permissionScope: ['read_docs'], memoryScope: ['docs'], limits } })
  await ctl(o.log, { action: 'registerWorker', draft: { id: 'w-incident', agentId: docsAgent, category: 'incident_watch', version: '1.0.0', mission: 'no runner', permissionScope: ['read_docs'], memoryScope: ['docs'], limits } })

  const rDocs = await ctl(o.log, { action: 'runWorker', workerId: 'w-docs' })
  const dRun = (rDocs.body as { run: { status: string; outputs: { summary: string }[]; toolsUsed: string[] } }).run
  check('E09_docs_freshness_worker_real_read_only_run', rDocs.status === 200 && dRun.status === 'SUCCEEDED' && dRun.outputs[0].summary === '2 markdown docs scanned; 1 older than 90 days' && dRun.toolsUsed.includes('fs.lstat'))
  const rEval = await ctl(o.log, { action: 'runWorker', workerId: 'w-eval' })
  const eRun = (rEval.body as { run: { status: string; outputs: { summary: string }[] } }).run
  check('E10_evaluation_worker_consumes_phase9_read_only', eRun.status === 'SUCCEEDED' && eRun.outputs[0].summary.includes('6 active') && readFileSync(p9.file, 'utf8') === p9Before)
  const rNo = await ctl(o.log, { action: 'runWorker', workerId: 'w-eval-noperm' })
  check('E11_capability_not_in_scope_fails_closed', (rNo.body as { run: { status: string; errors: { message: string }[] } }).run.status === 'FAILED' && (rNo.body as { run: { errors: { message: string }[] } }).run.errors[0].message.includes('not authorized'))
  check('E12_category_without_runner_is_409_not_faked', (await ctl(o.log, { action: 'runWorker', workerId: 'w-incident' })).status === 409 && (await ctl(o.log, { action: 'runWorker', workerId: 'nope' })).status === 404)
  process.env.WAR_ROOM_DOCS_DIR = path.join(docsDir, 'does-not-exist')
  const emptyDocs = await ctl(o.log, { action: 'runWorker', workerId: 'w-docs' })
  check('E13_missing_docs_dir_reports_NOT_AVAILABLE_not_zero', (emptyDocs.body as { run: { outputs: { summary: string }[] } }).run.outputs[0].summary.startsWith('NOT AVAILABLE'))
  await ctl(o.log, { action: 'stopWorker', workerId: 'w-docs', reason: 'operator' })
  check('E14_stop_via_api_blocks_run_resume_restores', (await ctl(o.log, { action: 'runWorker', workerId: 'w-docs' })).status === 409 && (await ctl(o.log, { action: 'resumeWorker', workerId: 'w-docs', reason: 'ok' })).status === 200 && (await ctl(o.log, { action: 'runWorker', workerId: 'w-docs' })).status === 200)

  // read model equals durable state
  const snap = buildOpsSnapshot(o.log, NOW)
  const v = o.log.view()
  check('E15_snapshot_matches_durable_state', snap.totals.agents === 2 && snap.totals.activeAgents === 2 && snap.totals.workers === 4 && snap.totals.runs === v.records.filter((r) => r.t === 'run' && r.rid.endsWith(':end')).length && snap.agents.length === 2 && snap.workers.length === 4)
  const wDocs = snap.workers.find((w) => w.view.spec.id === 'w-docs')!
  check('E16_worker_health_progress_and_usage_are_evidence_based', wDocs.health === 'IDLE' && wDocs.lastMeaningfulProgress !== 'NO EVIDENCE' && snap.workers.find((w) => w.view.spec.id === 'w-incident')!.lastMeaningfulProgress === 'NO EVIDENCE' && snap.resourceUsage.find((u) => u.workerId === 'w-docs')!.costUsd === 'UNKNOWN')
  check('E17_errors_listed_with_recovery', snap.errors.some((e) => e.workerId === 'w-eval-noperm' && e.recovery.length > 0))
  check('E18_snapshot_declares_no_boot_autostart', snap.governance.autoStartOnBoot === false)
  // read API
  const bytes = readFileSync(o.log.file, 'utf8')
  const ro = new AgentOpsLog(o.dir, { readOnly: true })
  const sections = ['summary', 'agents', 'workers', 'runs', 'approvals', 'evaluations', 'errors']
  const runId = snap.recentRuns[0].runId
  check('E19_read_sections_serve_and_never_write', sections.every((s) => get(ro, `section=${s}`).status === 200) && get(ro, `section=run&id=${runId}`).status === 200 && get(ro, 'section=run&id=nope').status === 404 && get(ro, 'section=bogus').status === 400 && readFileSync(o.log.file, 'utf8') === bytes)
  const ev = await ctl(o.log, { action: 'evaluateAgent', agentId: docsAgent, persist: true })
  check('E20_evaluate_control_returns_recommendation_not_applied', ev.status === 200 && (ev.body as { recommendation: { applied: boolean; action: string } }).recommendation.applied === false && deriveAgents(o.log).agents.get(docsAgent)!.state === 'ACTIVE')
  const rec1 = await ctl(o.log, { action: 'recoverRuns' }); const rec2 = await ctl(o.log, { action: 'recoverRuns' })
  check('E21_recover_runs_idempotent', rec1.status === 200 && JSON.stringify(rec1.body) === JSON.stringify(rec2.body))
  const only = new AgentOpsLog(o.dir)
  check('E22_only_agent_foundry_file_written', path.basename(only.file) === 'agent-foundry.jsonl' && !readFileSync(only.file, 'utf8').includes('hunter2'))
}

// route source
{
  const route = readFileSync('app/api/foundry/agents/ops/route.ts', 'utf8')
  check('E23_route_shape_commander_gated_header_required_actor_from_session', /export async function GET/.test(route) && /export async function POST/.test(route) && !/export async function (PUT|PATCH|DELETE)/.test(route) && (route.match(/requireCommanderSession\('Foundry'\)/g) ?? []).length === 2 && route.includes("x-wr-agent-ops") && route.includes('commanderActor(commander.userId)') && !/body\.(by|actor)/.test(route) && route.includes('readOnly: true'))
}
finish()
