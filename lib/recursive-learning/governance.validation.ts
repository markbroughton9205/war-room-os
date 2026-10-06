/** P9-N governance proof. Run: pnpm run validate:recursive-learning-governance */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { harness, freshLog, ev, missionFixture, tmpDir, NOW } from './testkit'
import { handleLearningRead, SECTIONS } from './api'
import { LearningLog } from './store'
import { buildSnapshot } from './readModel'
import { buildDoctrineProposals, buildMemoryCandidates, decideProposal, promoteMemoryCandidate, proposalStatus, submitProposal } from './proposals'
import { detectRecurringFailures } from './analysis'
import { recommendRouting, routingProposalDraft } from './recommendations'
import { scoreMatrix } from './scoring'
import { missionToEvents } from './ingestion/missionAdapter'
import { containsSecret } from './ingestion/redact'
import { learningDir } from './paths'

const { check, finish } = harness('RECURSIVE_LEARNING_GOVERNANCE_VALIDATION')

const PROTECTED = ['docs/war-room-constitution.md', 'CLAUDE.md', 'docs/phases/phase-9.md', 'middleware.ts', 'lib/learning/doctrineEngine.ts', 'lib/security/commanderSession.ts']
const ROUTING = ['lib/native-builder/foundryWorkerRouting.ts', 'lib/native-builder/foundryModelProviders.ts', 'lib/model-router/registry.ts', 'lib/model-router/dispatch.ts', 'lib/council-routing/route.ts']
const present = (fs: string[]) => fs.filter((f) => existsSync(f))
const hashOf = (fs: string[]) => present(fs).map((f) => createHash('sha256').update(readFileSync(f)).digest('hex')).join()
const protectedBefore = hashOf(PROTECTED)
const routingBefore = hashOf(ROUTING)

// scenario with everything the layer can produce
const log = freshLog()
for (let i = 1; i <= 6; i++) { log.recordEvent(ev('claude', 'risk_review', 'SUCCESS', i, { metrics: { costUsd: 0.5 } }), NOW); log.recordEvent(ev('gpt', 'risk_review', 'SUCCESS', i, { metrics: { costUsd: 0.01 } }), NOW) }
for (let i = 1; i <= 5; i++) log.recordEvent(ev('gpt', 'code_modification', 'FAILURE', i, { errorClass: 'skipped_deploy_gate' }), NOW)
const dir = path.dirname(log.file)
const bytesBefore = readFileSync(log.file, 'utf8')

// N1/N2: the read-only API and recommendation engine never change policy or routing
const ro = () => new LearningLog(dir, { readOnly: true })
for (const s of SECTIONS) handleLearningRead(new URL(`http://x/?section=${s}&target=score:provider:gpt:risk_review`), ro(), NOW)
const rec = recommendRouting(log.view().activeEvents, 'risk_review', NOW, { weights: { cost: 0.5 } })
buildSnapshot(ro(), NOW)
check('N01_read_api_changes_no_policy_or_log', hashOf(PROTECTED) === protectedBefore && present(PROTECTED).length >= 4 && readFileSync(log.file, 'utf8') === bytesBefore, `protectedFiles=${present(PROTECTED).length}`)
check('N02_recommendations_do_not_alter_routing', rec.applied === false && rec.recommended !== null && hashOf(ROUTING) === routingBefore && present(ROUTING).length >= 4, `routingFiles=${present(ROUTING).length}`)

// N3: memory candidates do not promote themselves
const failures = detectRecurringFailures(log.view().activeEvents, NOW)
const memDrafts = buildMemoryCandidates(failures, scoreMatrix(log.view().activeEvents, NOW), NOW)
const memProp = submitProposal(log, memDrafts[0], NOW)
let selfPromote = false
try { promoteMemoryCandidate(log, memProp.id, NOW) } catch { /* expected */ }
selfPromote = log.view().promotions.length > 0
check('N03_memory_candidates_do_not_self_promote', !selfPromote && proposalStatus(log.view(), memProp.id) === 'PROPOSED' && memProp.applied === false)

// N4: doctrine proposals stay proposals even when approved
const docProp = submitProposal(log, buildDoctrineProposals(failures)[0], NOW)
decideProposal(log, docProp.id, 'APPROVED', 'commander:mark', 'reviewed', NOW)
const docStored = log.view().proposals.find((p) => p.id === docProp.id)!
check('N04_doctrine_proposals_remain_proposals', docStored.applied === false && docStored.targetsProtectedPolicy === true && hashOf(PROTECTED) === protectedBefore && log.view().promotions.length === 0)

// N5: rejected proposals durable and auditable across reload
const routeProp = submitProposal(log, routingProposalDraft(rec), NOW)
decideProposal(log, routeProp.id, 'REJECTED', 'commander:mark', 'keep claude', NOW)
const reloaded = new LearningLog(dir).view()
check('N05_rejected_proposals_durable', proposalStatus(reloaded, routeProp.id) === 'REJECTED' && reloaded.decisions.some((d) => d.proposalId === routeProp.id && d.reason === 'keep claude') && reloaded.proposals.some((p) => p.id === routeProp.id))

// N6: Commander authority required
const bad = ['agent:claude', 'commander', 'commander:', '', 'system', 'commander:a b', 'Commander:mark']
const accepted = bad.filter((id) => { try { decideProposal(log, memProp.id, 'APPROVED', id, 'x', NOW); return true } catch { return false } })
let noApprovalPromote = false
try { promoteMemoryCandidate(log, memProp.id, NOW); noApprovalPromote = true } catch { /* expected */ }
check('N06_commander_authority_required', accepted.length === 0 && !noApprovalPromote)
decideProposal(log, memProp.id, 'APPROVED', 'commander:mark', 'ok', NOW)
decideProposal(log, memProp.id, 'REJECTED', 'commander:mark', 'changed my mind', NOW)
let rejectedCannotPromote = false
try { promoteMemoryCandidate(log, memProp.id, NOW) } catch { rejectedCannotPromote = true }
check('N06b_latest_decision_governs_promotion', rejectedCannotPromote && new LearningLog(dir).view().decisions.filter((d) => d.proposalId === memProp.id).length === 2)

// N7: storage append-only; cannot overwrite source evidence
const grown = readFileSync(log.file, 'utf8')
log.supersede(log.view().events[0].id, 'probe', undefined, NOW)
check('N07_log_only_grows', readFileSync(log.file, 'utf8').startsWith(grown) && log.view().events.length === 17)
const lib = 'lib/recursive-learning'
const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? files(p) : [p] })
const prod = files(lib).filter((f) => f.endsWith('.ts') && !/validation\.ts$|testkit\.ts$/.test(f))
const writers = prod.filter((f) => /\b(writeFile|writeFileSync|appendFile|appendFileSync|rmSync|unlink|rename|copyFile|truncate|createWriteStream)\b/.test(readFileSync(f, 'utf8')))
check('N08_only_log_and_failure_files_write', writers.map((f) => path.basename(f)).sort().join() === 'failureLog.ts,store.ts', writers.join(','))
const importers = execFileSync('grep', ['-rl', '--include=*.ts', '--include=*.tsx', '--exclude-dir=node_modules', '--exclude-dir=.next', '--exclude-dir=.war-room', '--exclude-dir=recursive-learning', '@/lib/recursive-learning', 'app', 'lib', 'components', 'scripts'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
// Agent Foundry (lib/agents/**) may use the secret-refusal helper everywhere; only the Forge Phase 9 adapter writes to it and the Phase 10 read-only worker reads its snapshot (validators/testkits excluded).
const agentImporters = importers.filter((f) => f.startsWith('lib/agents/'))
const outsideAgents = importers.filter((f) => !f.startsWith('lib/agents/'))
const agentMisuse = agentImporters.filter((f) => !/validation\.ts$|testkit\.ts$/.test(f) && !['lib/agents/forge/phase9.ts', 'lib/agents/ops/builtinWorkers.ts'].includes(f) && /@\/lib\/recursive-learning\/(?!ingestion\/redact['"])/.test(readFileSync(f, 'utf8')))
check('N09_only_sanctioned_outside_dependents', outsideAgents.join() === ['app/api/foundry/learning/route.ts', 'components/war-room/foundry/FoundryLearningPanel.tsx', 'lib/native-builder/foundryMissionStore.ts'].join() && agentMisuse.length === 0, importers.join(',') + ' misuse=' + agentMisuse.join(','))
const forbiddenImports = prod.filter((f) => /from '@\/lib\/(native-builder|model-router|council|council-routing|payments|deploy|security)\b/.test(readFileSync(f, 'utf8')))
const netOrSpend = prod.filter((f) => /\b(fetch\(|https?:\/\/|XMLHttpRequest|child_process|node:https?|node:net)/i.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
check('N10_layer_cannot_reach_routing_deploy_payments_network', forbiddenImports.length === 0 && netOrSpend.length === 0, `imports=${forbiddenImports.join(',')} net=${netOrSpend.join(',')}`)
const mutators = Object.keys(await import('./index')).filter((k) => /^(apply|mutate|rewrite|deploy|push|merge|spend|execute|write|promote(?!Memory))/i.test(k))
check('N11_no_mutating_exports', mutators.length === 0, mutators.join(','))
check('N12_hard_policy_and_routing_unchanged_end_to_end', hashOf(PROTECTED) === protectedBefore && hashOf(ROUTING) === routingBefore)

// N13: ingestion exposes no secrets
const SECRETS = ['sk-abcdefghijklmnopqrstuvwxyz123456', 'Bearer abcdefghijklmnopqrstuvwxyz123456', 'AIzaSyabcdefghijklmnopqrstuvwxyz123', 'ghp_abcdefghijklmnopqrstuvwxyz1234', 'password=hunter2hunter2']
const leaky = missionFixture({
  title: SECRETS[0], userRequest: SECRETS[1], goal: SECRETS[2],
  errors: [{ klass: 'CODE', message: SECRETS[3] }], observations: [{ text: SECRETS[4] }],
  toolCalls: [{ at: '2026-09-20T10:05:00.000Z', tool: 'engineering.review', ok: true, reason: SECRETS[0], excerpt: JSON.stringify(JSON.stringify({ status: 'FAIL', note: SECRETS[1] })) }],
  authorization: { approvalState: 'approved', requestedAt: '2026-09-20T10:01:00.000Z', reason: SECRETS[2] },
  installState: { ok: true, detail: SECRETS[3] },
})
const out = missionToEvents(leaky, { backfilled: false })
const serialized = JSON.stringify(out.events)
check('N13_ingestion_exposes_no_secrets', out.events.length > 0 && SECRETS.every((s) => !serialized.includes(s.slice(0, 20))) && !containsSecret(serialized), `events=${out.events.length}`)
const realLog = path.join(learningDir(), 'recursive-learning.jsonl')
if (existsSync(realLog)) {
  const lines = readFileSync(realLog, 'utf8').split('\n').filter(Boolean)
  check('N14_real_learning_log_contains_no_secrets', lines.every((l) => !containsSecret(l)), `lines=${lines.length}`)
} else check('N14_real_learning_log_contains_no_secrets', true, 'no real log present (skipped)')
// review follow-ups: idempotent promotion; proposals must cite real evidence
{
  const l = freshLog()
  for (let i = 1; i <= 5; i++) l.recordEvent(ev('gpt', 'risk_review', 'FAILURE', i, { errorClass: 'x_gate' }), NOW)
  const f2 = detectRecurringFailures(l.view().activeEvents, NOW)
  const p2 = submitProposal(l, buildMemoryCandidates(f2, [], NOW)[0], NOW)
  decideProposal(l, p2.id, 'APPROVED', 'commander:mark', 'ok', NOW)
  promoteMemoryCandidate(l, p2.id, NOW)
  let twice = false
  try { promoteMemoryCandidate(l, p2.id, NOW); twice = true } catch { /* expected */ }
  check('N15_promotion_is_idempotent_single_record', !twice && l.view().promotions.length === 1)
  let ghost = false
  try { submitProposal(l, { ...buildMemoryCandidates(f2, [], NOW)[0], evidenceEventIds: ['no-such-event'] }, NOW); ghost = true } catch { /* expected */ }
  check('N16_proposal_must_cite_existing_evidence', !ghost)
}
void tmpDir
finish()
