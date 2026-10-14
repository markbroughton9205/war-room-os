/**
 * Reverse Engineer validation: read-only behaviour, dependency / reverse-dependent / route / state tracing, evidence, unknowns, persistence, handoff into a normal mission,
 * workspace isolation, help truthfulness. Uses a real fixture repository on disk (files, a symlink, a gitignored directory), and a smoke run on the real War Room tree.
 * Run: pnpm run validate:foundry-reverse
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentOpsLog } from '../../log'
import { MissionStore } from '../missions/store'
import { createMission, validateDraft, type RunnerDeps } from '../missions/runner'
import { analyzeSnapshot } from './analyze'
import { HELP, REVERSE_HELP } from './help'
import { AnalysisError, buildDraftFromAnalysis, getAnalysis, listAnalyses, normalizeRequest, runAnalysis } from './service'
import { takeSnapshot } from './snapshot'
import { AnalysisStore } from './store'
import type { AnalysisRecord } from './types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (name: string, cond: unknown, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) } }
const w = (root: string, rel: string, body: string) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body) }

/** Hash of every file, symlink and directory entry (names, sizes, mtimes, content): proves "nothing was modified" without trusting the analyzer. */
function treeHash(root: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n), st = lstatSync(p)
      h.update(`${path.relative(root, p)}|${st.isSymbolicLink() ? 'L' : st.isDirectory() ? 'D' : 'F'}|${st.size}|${Math.trunc(st.mtimeMs)}\n`)
      if (st.isDirectory() && !st.isSymbolicLink()) walk(p); else if (st.isFile()) h.update(readFileSync(p))
    }
  }
  walk(root)
  return h.digest('hex')
}

function makeFixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), 're-fixture-'))
  const root = path.join(base, 'repo'), outside = path.join(base, 'outside-secret')
  mkdirSync(root, { recursive: true }); mkdirSync(outside, { recursive: true })
  writeFileSync(path.join(outside, 'leak.ts'), `export const OUTSIDE_MARKER_7731 = 'must never be read'\n`)
  writeFileSync(path.join(base, 'sibling.ts'), `export const SIBLING_MARKER_5520 = 1\n`)
  w(root, '.gitignore', '/node_modules\n/generated\n')
  w(root, 'components/CancelButton.tsx', `'use client'
import { useState } from 'react'
export function CancelButton({ id }: { id: string }) {
  const [note, setNote] = useState('')
  const cancel = async () => {
    const r = await fetch(\`/api/missions/\${id}/cancel\`, { method: 'POST', body: JSON.stringify({ action: 'cancel' }) })
    setNote(r.ok ? 'cancelled' : 'refused')
  }
  const other = () => setNote('x')
  return <div><button data-testid="cancel-btn" onClick={cancel}>Cancel mission</button><button data-testid="noop" onClick={other}>Nothing</button><span data-testid="note">{note}</span></div>
}
`)
  w(root, 'app/api/missions/[id]/cancel/route.ts', `import { NextResponse } from 'next/server'
import { cancelMission } from '@/lib/missions/service'
export async function POST(req: Request) {
  const body = await req.json()
  if (body.action === 'cancel') {
    const r = cancelMission('m1')
    if (!r) return NextResponse.json({ error: 'illegal' }, { status: 409 })
    return NextResponse.json({ ok: true }, { status: 202 })
  }
  return NextResponse.json({ error: 'unknown' }, { status: 400 })
}
`)
  w(root, 'lib/missions/service.ts', `import { loadMission, saveMission } from './store'
export function cancelMission(id: string): boolean {
  const m = loadMission(id)
  if (!m || m.state === 'COMPLETED') return false
  m.state = 'CANCELLED'
  saveMission(m)
  return true
}
`)
  w(root, 'lib/missions/store.ts', `import { readFileSync, writeFileSync } from 'node:fs'
export type MissionState = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
export type Mission = { id: string; state: MissionState }
const FILE = process.env.MISSIONS_FILE ?? '/tmp/missions.json'
export function loadMission(id: string): Mission | null { try { return (JSON.parse(readFileSync(FILE, 'utf8')) as Mission[]).find((m) => m.id === id) ?? null } catch { return null } }
export function saveMission(m: Mission): void { writeFileSync(FILE, JSON.stringify([m])) }
`)
  w(root, 'lib/missions/service.validation.ts', `import { cancelMission } from './service'\nconsole.log(cancelMission('x'))\n`)
  w(root, 'lib/other/unrelated.ts', `export const unrelated = 1\n`)
  // a five-hop import chain for depth behaviour
  for (let i = 1; i <= 6; i++) w(root, `lib/chain/c${i}.ts`, i === 1 ? `export const c1 = 1\n` : `import { c${i - 1} } from './c${i - 1}'\nexport const c${i} = c${i - 1} + 1\n`)
  // a client that fetches a URL it cannot resolve statically
  w(root, 'lib/client/dynamic.ts', `export async function go(u: string) { return fetch(u) }\n`)
  w(root, 'generated/copy.ts', `export const GENERATED_MARKER_9911 = 1\n`)
  w(root, 'node_modules/pkg/index.js', `module.exports = 1\n`)
  symlinkSync(outside, path.join(root, 'lib', 'linked-outside'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture'], { cwd: root })
  return { base, root, outside }
}

const fx = makeFixture()
try {
  const before = treeHash(fx.base)
  const snap = takeSnapshot(fx.root)
  const run = (target: string, depth: 'quick' | 'standard' | 'deep' = 'standard') => analyzeSnapshot(snap, { target, depth, outputs: ['all'] })

  console.log('snapshot / workspace isolation')
  ok('snapshot reads only the root', [...snap.files.keys()].every((f) => !f.startsWith('..') && !path.isAbsolute(f)))
  ok('symlink to outside is not followed and is reported', !snap.files.has('lib/linked-outside/leak.ts') && snap.skipped.some((s) => s.path === 'lib/linked-outside' && /symlink/.test(s.reason)))
  ok('gitignored directory is skipped', !snap.files.has('generated/copy.ts') && snap.skipped.some((s) => s.path === 'generated'))
  ok('node_modules is skipped', ![...snap.files.keys()].some((f) => f.startsWith('node_modules')))
  const leak = JSON.stringify(run('lib/missions/service.ts'))
  ok('no outside / sibling / ignored content in a result', !/OUTSIDE_MARKER_7731|SIBLING_MARKER_5520|GENERATED_MARKER_9911/.test(leak))
  for (const t of ['../outside-secret/leak.ts', '../../etc/passwd', '/etc/passwd', 'lib/linked-outside/leak.ts']) {
    const o = run(t)
    ok(`escape target "${t}" resolves to nothing`, o.target.kind === 'unresolved' || !o.target.owners.some((f) => f.includes('leak') || f.includes('passwd')), JSON.stringify(o.target.owners))
  }

  console.log('dependency tracing')
  const svc = run('lib/missions/service.ts')
  ok('target resolved as exact file (FACT)', svc.target.kind === 'file' && svc.target.basis === 'FACT')
  const dep = svc.result.dependencies[0]
  ok('direct dependency store.ts found', dep.internal.some((i) => i.path === 'lib/missions/store.ts'))
  ok('dependency evidence is the import line', svc.evidence.some((e) => e.kind === 'import' && e.file === 'lib/missions/service.ts' && e.line === 1))
  ok('external packages listed for the store', run('lib/missions/store.ts').result.dependencies[0].external.includes('node:fs'))

  console.log('reverse-dependent tracing')
  const store = run('lib/missions/store.ts')
  const rd = store.result.reverseDependents[0]
  ok('service.ts is a direct dependent of store.ts', rd.direct.some((d) => d.path === 'lib/missions/service.ts'))
  ok('route reached transitively at 2 hops', rd.transitive.some((t) => t.path.endsWith('cancel/route.ts') && t.hops === 2))
  ok('the UI is reached through the fetch edge', store.result.changeImpact.perOwner[0].uiAffected.includes('components/CancelButton.tsx'))
  ok('the validation file is a test to run', store.result.changeImpact.perOwner[0].testsToRun.includes('lib/missions/service.validation.ts'))
  const q = run('lib/chain/c1.ts', 'quick'), d = run('lib/chain/c1.ts', 'deep')
  ok('quick reaches fewer hops than deep', q.result.reverseDependents[0].transitive.length < d.result.reverseDependents[0].transitive.length, `${q.result.reverseDependents[0].transitive.length} vs ${d.result.reverseDependents[0].transitive.length}`)
  ok('impact counts the whole chain regardless of depth', d.result.changeImpact.perOwner[0].transitiveDependents === 5)

  console.log('route mapping')
  const route = run('/api/missions/abc/cancel')
  ok('a concrete URL resolves to the dynamic-segment route file', route.target.kind === 'route' && route.target.owners[0] === 'app/api/missions/[id]/cancel/route.ts')
  const ri = route.result.routes[0]
  ok('method POST', ri.methods.some((m) => m.method === 'POST'))
  ok('statuses 202, 409, 400 listed', [202, 409, 400].every((s) => ri.statuses.some((x) => x.status === s)))
  ok('action vocabulary captured', ri.actions.some((a) => a.value === 'cancel'))
  ok('caller found through a template-literal URL', ri.callers.some((c) => c.file === 'components/CancelButton.tsx' && c.method === 'POST'))

  console.log('data flow and UI')
  const kinds = route.result.flow.map((s) => s.layer)
  ok('flow is UI -> API -> SERVICE -> STORE in order', kinds.join('>') === 'UI>API>SERVICE>STORE', kinds.join('>'))
  ok('flow picks the button that reaches the API, not the first handler', /Cancel mission/.test(route.result.flow[0].label), route.result.flow[0].label)
  ok('map text is built from the flow steps', (route.result.maps.flow?.text.match(/\[(UI|API|SERVICE|STORE)\]/g) ?? []).length === 4)
  ok('every flow edge after the first carries evidence', route.result.flow.slice(1).every((s) => s.evidence.length > 0))
  const ui = route.result.ui.find((u) => u.file === 'components/CancelButton.tsx')
  ok('UI handler traced to the API call', !!ui && ui.surfaces.some((s) => s.label === 'Cancel mission' && s.reachesApi.includes('POST /api/missions/{}/cancel')), JSON.stringify(ui?.surfaces))
  ok('a handler that reaches no API is not claimed to', !!ui && ui.surfaces.filter((s) => s.label === 'Nothing').every((s) => s.reachesApi.length === 0))
  ok('selectors reported', !!ui && ui.testIds.includes('cancel-btn'))

  console.log('state / storage mapping')
  const st = run('lib/missions/service.ts').result.state
  ok('state vocabulary found', st.states.some((s) => s.name === 'MissionState' && s.values.join() === 'QUEUED,RUNNING,COMPLETED,CANCELLED'))
  ok('state value assignment found with line', st.assignments.some((a) => a.value === 'CANCELLED' && a.file === 'lib/missions/service.ts' && a.line === 5))
  ok('file write located in the store', st.storage.some((s) => s.file === 'lib/missions/store.ts' && s.op === 'create' && s.api === 'writeFileSync'))
  ok('file read located', st.storage.some((s) => s.file === 'lib/missions/store.ts' && s.op === 'read'))
  ok('env config located', st.storage.some((s) => s.op === 'env' && s.target === 'MISSIONS_FILE'))
  ok('UI state located', run('components/CancelButton.tsx').result.state.storage.some((s) => s.op === 'ui-state' && s.api === 'useState'))

  console.log('tests, evidence, unknowns')
  const tcov = run('lib/missions/store.ts').result.tests
  ok('a test that imports the owner transitively is not claimed as direct coverage', !tcov.relevant.some((t) => t.basis === 'FACT' && t.path === 'lib/missions/service.validation.ts'))
  ok('direct test is FACT', run('lib/missions/service.ts').result.tests.relevant.some((t) => t.path === 'lib/missions/service.validation.ts' && t.basis === 'FACT'))
  ok('missing coverage reported for an untested file', run('lib/other/unrelated.ts').result.tests.missing.length === 1)
  const allClaims = (o: ReturnType<typeof run>) => [...o.result.summary, ...o.result.risks, ...o.result.tests.missing, ...o.result.changeImpact.summary, ...o.result.entryPoints.map((e) => e.claim)]
  const o1 = run('/api/missions/abc/cancel')
  const ids = new Set(o1.evidence.map((e) => e.id))
  ok('every cited evidence id exists', [...allClaims(o1).flatMap((c) => c.evidence), ...o1.result.flow.flatMap((s) => s.evidence), ...o1.result.state.storage.flatMap((s) => s.evidence)].every((id) => ids.has(id)))
  ok('every evidence item points at a real file and line', o1.evidence.every((e) => e.file.startsWith('(') || (snap.files.has(e.file) && (!e.line || e.line <= snap.files.get(e.file)!.split('\n').length))))
  ok('no FACT claim without evidence', allClaims(o1).filter((c) => c.basis === 'FACT').every((c) => c.evidence.length > 0))
  for (const junk of ['the', 'how does this work', 'qwertyuiop flarbnaggle']) ok(`junk description "${junk}" is unresolved, not a guess`, run(junk).target.kind === 'unresolved')
  ok('a described feature matches files containing its terms', ['lib/missions/service.ts', 'components/CancelButton.tsx', 'app/api/missions/[id]/cancel/route.ts'].some((f) => run('how a mission is cancelled').target.owners.includes(f)) && !run('how a mission is cancelled').target.owners.includes('lib/other/unrelated.ts'))
  const un = run('zzqq nothing matches this at all')
  ok('unmatched target is UNRESOLVED with no owners', un.target.kind === 'unresolved' && un.target.owners.length === 0)
  ok('unresolved analysis claims nothing as FACT', un.result.summary.every((c) => c.basis === 'UNKNOWN') && un.result.flow.length === 0 && un.result.risks.every((c) => c.basis !== 'FACT'))
  const nl = run('how a mission is cancelled')
  ok('natural language target is INFERENCE', nl.target.kind === 'feature' && nl.target.basis === 'INFERENCE' && nl.result.risks.some((c) => c.basis === 'INFERENCE' && /natural-language/.test(c.text)))
  ok('non-literal fetch is reported UNKNOWN', run('lib/client/dynamic.ts').result.risks.some((c) => c.basis === 'UNKNOWN' && /not a literal/.test(c.text)))
  ok('no upstream UI is reported UNKNOWN, not guessed', run('lib/other/unrelated.ts').result.risks.some((c) => c.basis === 'UNKNOWN' && /No UI file/.test(c.text)))
  ok('static-analysis limits always declared', o1.result.risks.some((c) => c.basis === 'UNKNOWN' && /Static analysis only/.test(c.text)))
  const tiny = takeSnapshot(fx.root, { maxFiles: 3, maxFileBytes: 180_000, maxDepth: 14 })
  ok('a truncated snapshot is declared UNKNOWN', tiny.truncated && analyzeSnapshot(tiny, { target: 'lib/missions/service.ts', depth: 'quick', outputs: ['all'] }).result.risks.some((c) => c.basis === 'UNKNOWN' && /file cap/.test(c.text)))

  console.log('read-only behaviour')
  ok('fixture tree byte-identical after all analyses', treeHash(fx.base) === before)
  const logDir = mkdtempSync(path.join(os.tmpdir(), 're-log-'))
  const log = new AgentOpsLog(logDir)
  const treeBefore = treeHash(fx.root)
  const rec = runAnalysis({ target: '/api/missions/abc/cancel', depth: 'standard', outputs: ['all'] }, 'commander:test', { log, repo: fx.root })
  ok('service reports unchanged fingerprints', rec.readOnly.unchanged && rec.readOnly.treeFingerprintBefore === rec.readOnly.treeFingerprintAfter && rec.readOnly.sourceModified === false)
  ok('repository tree identical after a recorded analysis', treeHash(fx.root) === treeBefore)
  ok('git sees no change in the repository', execFileSync('git', ['status', '--porcelain'], { cwd: fx.root }).toString().trim() === '')
  ok('no commands were run and no model used', rec.provenance.commandsRun.length === 0 && rec.provenance.model === null)
  ok('analysis wrote only under the agent-foundry directory', existsSync(path.join(logDir, 'engineering-analyses', rec.id, 'analysis.json')))
  const importLines = ['analyze.ts', 'signals.ts', 'snapshot.ts'].map((f) => readFileSync(path.join(HERE, f), 'utf8').split('\n').filter((l) => /^import /.test(l)).join('\n')).join('\n')
  ok('analysis modules import no process-spawning API', !/child_process|node:vm|worker_threads/.test(importLines))
  ok('analysis and signal modules import no fs write API', !/\b(writeFile|writeFileSync|appendFile|appendFileSync|rmSync|rm|unlinkSync|renameSync|mkdirSync|copyFileSync)\b/.test(importLines))
  const snapSrc = readFileSync(path.join(HERE, 'snapshot.ts'), 'utf8')
  ok('snapshot imports only read operations from fs', /import \{ ([^}]+) \} from 'node:fs'/.exec(snapSrc)![1].split(',').map((s) => s.trim()).every((n) => ['lstatSync', 'readFileSync', 'readdirSync', 'realpathSync', 'existsSync'].includes(n)))

  console.log('persistence')
  const reopened = getAnalysis(rec.id, { log: new AgentOpsLog(logDir) })
  ok('record reloads identically from disk with a fresh log/store', !!reopened && JSON.stringify(reopened) === JSON.stringify(rec))
  ok('listing includes it with its summary', listAnalyses({ log: new AgentOpsLog(logDir) }).some((r) => r.id === rec.id && r.readOnlyUnchanged && r.summary.length > 0))
  let dup = false; try { new AnalysisStore(log).create(rec) } catch { dup = true }
  ok('ids are never reused / records never rewritten', dup)
  const events = new AnalysisStore(log).events(rec.id)
  ok('event log written', events.some((e) => e.kind === 'ANALYSIS_RECORDED'))
  const onlyChange = runAnalysis({ target: 'lib/missions/store.ts', outputs: ['changeImpact'] }, 'commander:test', { log, repo: fx.root })
  ok('output selection omits unrequested sections but keeps unknowns', onlyChange.omitted.includes('flow') && onlyChange.result.flow === undefined && !!onlyChange.result.changeImpact && onlyChange.result.risks.length > 0 && !!onlyChange.result.summary)

  console.log('request validation / isolation of configuration')
  for (const [name, body] of [['empty target', { target: ' ' }], ['bad depth', { target: 'lib/x.ts', depth: 'abyss' }], ['bad outputs', { target: 'lib/x.ts', outputs: ['everything'] }], ['huge target', { target: 'x'.repeat(601) }]] as const) {
    let code = ''; try { normalizeRequest(body as Record<string, unknown>) } catch (e) { code = e instanceof AnalysisError ? e.code : 'other' }
    ok(`rejects ${name}`, code === 'INVALID')
  }
  let scope = ''; try { runAnalysis({ target: 'lib/x.ts' }, 'commander:test', { log, repo: null }) } catch (e) { scope = e instanceof AnalysisError ? e.code : 'other' }
  ok('no configured repository -> SCOPE, not a guess', scope === 'SCOPE')
  const bodyWithRoot = runAnalysis({ target: 'lib/missions/service.ts', repo: '/etc', root: '/etc', path: '/etc' }, 'commander:test', { log, repo: fx.root })
  ok('a repository path in the request body is ignored', bodyWithRoot.provenance.snapshot.root === 'repo' && bodyWithRoot.target.owners[0] === 'lib/missions/service.ts')

  console.log('handoff into a normal mission')
  const draftIn = { request: 'Make cancelling a mission also record who cancelled it.', paths: [] as string[], write: [] as string[], targets: [] as { path: string; action: 'create' | 'modify' }[] }
  const fileRec = runAnalysis({ target: 'lib/missions/service.ts' }, 'commander:test', { log, repo: fx.root })
  const hd = buildDraftFromAnalysis(fileRec, draftIn)
  ok('FACT target seeds paths, write scope and targets', hd.paths.includes('lib/missions/service.ts') && hd.paths.includes('lib/missions/store.ts') && hd.write.join() === 'lib/missions/service.ts' && hd.targets[0]?.path === 'lib/missions/service.ts')
  ok('analysis context rides in the request, within the request limit', /REVERSE ENGINEER CONTEXT/.test(hd.request) && hd.request.length <= 2000 && hd.request.startsWith('Make cancelling'))
  const nlRec = runAnalysis({ target: 'how a mission is cancelled' }, 'commander:test', { log, repo: fx.root })
  const hn = buildDraftFromAnalysis(nlRec, draftIn)
  ok('INFERENCE target seeds context only: no write scope or targets are invented', hn.write.length === 0 && hn.targets.length === 0)
  ok('user-supplied scope is never overridden', buildDraftFromAnalysis(fileRec, { ...draftIn, write: ['lib/missions'], paths: ['lib/missions/service.ts'] }).write.join() === 'lib/missions')
  const v = validateDraft({ title: 'cancel records actor', request: hd.request, acceptance: ['cancel records the actor'], targets: hd.targets, scope: { write: hd.write, source: { repo: fx.root, paths: hd.paths } } })
  ok('the seeded draft passes the normal mission validation', v.targets.length === 1 && v.scope.source!.paths.includes('lib/missions/store.ts'))
  const mdeps: RunnerDeps = {
    log, store: new MissionStore(log), workspacesRoot: path.join(logDir, 'ws'), integrationRoot: path.join(logDir, 'integ'),
    lineup: () => ({ builder: { label: 'scripted', model: { async complete() { throw new Error('not called') } } as never }, testCandidates: [], simulated: true }),
  }
  const mission = await createMission(mdeps, { title: 'cancel records actor', request: hd.request, acceptance: ['cancel records the actor'], targets: hd.targets, scope: { write: hd.write, source: { repo: fx.root, paths: hd.paths } }, analysisId: fileRec.id }, 'commander:test')
  ok('mission record carries the analysis id', mission.analysisId === fileRec.id && mdeps.store.read(mission.id)?.analysisId === fileRec.id)
  ok('mission creation event cites the analysis', mdeps.store.events(mission.id).some((e) => e.kind === 'CREATED' && e.detail.includes(fileRec.id)))
  ok('the analysis record is unchanged by being used', JSON.stringify(getAnalysis(fileRec.id, { log })) === JSON.stringify(fileRec))
  ok('a malformed analysis id is not stored on a mission', !(await createMission(mdeps, { title: 't2', request: draftIn.request + ' again', acceptance: ['a'], analysisId: '../../etc' } as never, 'commander:test').catch((e) => ({ analysisId: 'ERR:' + e.message }))).analysisId?.startsWith('../'))

  console.log('help truthfulness')
  const byId = new Map(HELP.map((h) => [h.id, h]))
  for (const id of ['build-feature', 'reverse-engineer', 'run-command', 'pause', 'resume', 'cancel', 'retry', 'receipts', 'provenance', 'specialists', 'verifier', 'device-lab']) ok(`help entry ${id}`, byId.has(id))
  ok('Run Command is stated as not in this build', byId.get('run-command')!.status === 'NOT_IN_THIS_BUILD')
  ok('Device / Protocol Lab is labelled FUTURE and not implemented', byId.get('device-lab')!.status === 'FUTURE' && /FUTURE — DEVICE \/ PROTOCOL LAB/.test(byId.get('device-lab')!.short) && /not implemented/i.test(byId.get('device-lab')!.short))
  ok('Reverse Engineer help says read-only, FACT/INFERENCE/UNKNOWN, no source changes', /read-only/i.test(byId.get('reverse-engineer')!.short) && /FACT/.test(byId.get('reverse-engineer')!.body.join(' ')) && /does not modify source/.test(byId.get('reverse-engineer')!.body.join(' ')))
  ok('help states Reverse Engineer is code analysis only', /Device and protocol reverse engineering is a separate/.test(byId.get('reverse-engineer')!.body.join(' ')))
  ok('real controls named in help exist in the UI source', ['Resume from checkpoint', 'Cancel'].every((l) => readFileSync(path.join(HERE, '../../../../../components/war-room/foundry/FoundryEngineeringMissions.tsx'), 'utf8').includes(l)) && readFileSync(path.join(HERE, '../../uiState.ts'), 'utf8').includes("label: 'Pause'"))
  ok('UI help covers depth and every output option', ['quick', 'standard', 'deep'].every((k) => (REVERSE_HELP.depth as Record<string, string>)[k]) && ['explanation', 'dependencyMap', 'dataFlowMap', 'changeImpact', 'all'].every((k) => (REVERSE_HELP.outputs as Record<string, string>)[k]))

  console.log('real War Room subsystem smoke')
  const realRoot = path.resolve(HERE, '../../../../..')
  if (existsSync(path.join(realRoot, 'app/api/foundry/engineering/missions/route.ts'))) {
    const rs = takeSnapshot(realRoot)
    const real = analyzeSnapshot(rs, { target: 'lib/agents/ops/engineering/missions/store.ts', depth: 'standard', outputs: ['all'] })
    ok('real: store.ts is imported by the mission service', real.result.reverseDependents[0].direct.some((x) => x.path.endsWith('missions/service.ts')))
    ok('real: flow reaches the missions API route and the Foundry UI', real.result.flow.some((s) => s.layer === 'API' && s.file.includes('api/foundry/engineering/missions')) && real.result.flow[0].layer === 'UI')
    ok('real: route statuses and actions mapped', real.result.routes.some((r) => r.statuses.some((s) => s.status === 202) && r.actions.some((a) => a.value === 'start')))
    ok('real: reverse engineer API is part of the mapped route', real.result.routes.some((r) => r.actions.some((a) => a.value === 'analyze')))
  } else ok('real: skipped (not inside the War Room tree)', true)
} finally {
  rmSync(fx.base, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
