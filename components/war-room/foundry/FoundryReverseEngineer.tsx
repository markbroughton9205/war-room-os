'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AnalysisRecord, Basis, Claim, Depth, OutputOption } from '@/lib/agents/ops/engineering/reverse/types'
import { REVERSE_HELP } from '@/lib/agents/ops/engineering/reverse/help'

type Row = { id: string; createdAt: string; target: string; depth: string; kind: string; owners: string[]; evidenceCount: number; unknowns: number; readOnlyUnchanged: boolean; summary: string }
const BASIS: Record<Basis, string> = { FACT: 'bg-green-800', INFERENCE: 'bg-amber-700', UNKNOWN: 'bg-gray-600' }
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const API = '/api/foundry/engineering/missions'
const SEEN_KEY = 'foundry.reverse.guidance.v1'

function Badge({ b }: { b: Basis }) { return <span className={`px-1 mr-1 text-[10px] ${BASIS[b]}`}>{b}</span> }
function Ev({ ids }: { ids: string[] }) { return <span className="text-[10px] text-gray-500">{ids.length ? ` [${ids.slice(0, 6).join(' ')}${ids.length > 6 ? ' …' : ''}]` : ''}</span> }
function ClaimLine({ c }: { c: Claim }) { return <div className="mb-1"><Badge b={c.basis} />{c.text}<Ev ids={c.evidence} /></div> }
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) { return <div data-testid={`re-${id}`} className="mt-3"><div className="font-medium border-b border-gray-700 mb-1">{title}</div>{children}</div> }

/** Reverse Engineer: explain an existing implementation before changing it. Read-only; every conclusion is labelled FACT / INFERENCE / UNKNOWN and cites its evidence. */
export function FoundryReverseEngineer() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState<AnalysisRecord | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState('')
  const [depth, setDepth] = useState<Depth>('standard')
  const [outs, setOuts] = useState<OutputOption[]>(['all'])
  const [build, setBuild] = useState({ title: '', request: '', acceptance: '', write: '' })
  const [guide, setGuide] = useState(false)

  useEffect(() => { try { if (!window.localStorage.getItem(SEEN_KEY)) setGuide(true) } catch { setGuide(true) } }, [])
  const dismiss = () => { setGuide(false); try { window.localStorage.setItem(SEEN_KEY, '1') } catch { /* per-viewer convenience only */ } }

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}?analyses=1`, { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setRows(((await r.json()) as { analyses: Row[] }).analyses); setErr(null)
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed to load') }
  }, [])
  useEffect(() => { void load() }, [load])

  const show = async (id: string) => {
    const r = await fetch(`${API}?analysis=${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (r.ok) setOpen(((await r.json()) as { analysis: AnalysisRecord }).analysis); else setNotice(`could not open ${id}: HTTP ${r.status}`)
  }
  const toggleOut = (o: OutputOption) => setOuts((cur) => o === 'all' ? ['all'] : (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur.filter((x) => x !== 'all'), o]).slice() || ['all'])
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wr-agent-ops': '1' }, body: JSON.stringify(body) })
    return { ok: r.ok, j: (await r.json()) as Record<string, unknown> & { error?: string; code?: string } }
  }
  const analyze = async () => {
    setBusy(true); setNotice('Analyzing (read-only)…')
    try {
      const { ok, j } = await post({ action: 'analyze', target, depth, outputs: outs.length ? outs : ['all'] })
      if (!ok) setNotice(`Analysis refused: ${j.error ?? 'error'}${j.code ? ` (${j.code})` : ''}`)
      else { setNotice(`Analysis ${String(j.analysisId)} recorded: ${String(j.kind)}, ${(j.owners as string[]).length} owner file(s), ${String(j.evidence)} evidence item(s)`); await load(); await show(String(j.analysisId)) }
    } catch (e) { setNotice(`Analysis failed: ${e instanceof Error ? e.message : 'error'}`) }
    setBusy(false)
  }
  const startBuild = async () => {
    if (!open) return
    setBusy(true)
    const { ok, j } = await post({ action: 'start', fromAnalysis: open.id, title: build.title, request: build.request, acceptance: lines(build.acceptance), scope: { paths: [], write: lines(build.write) } })
    setNotice(ok ? `Build mission ${String(j.missionId)} started from analysis ${open.id}. Follow it under Engineering missions.` : `Build refused: ${j.error ?? 'error'}${j.code ? ` (${j.code})` : ''}`)
    setBusy(false)
  }

  const r = open?.result
  const evById = new Map((open?.evidence ?? []).map((e) => [e.id, e]))
  return (
    <section data-testid="reverse-engineer" className="mb-8">
      <h2 className="text-lg border-b border-gray-700 mb-2">Reverse Engineer</h2>
      <p data-testid="re-help" className="text-xs text-gray-400 mb-2">Explains how an existing feature, route, file or subsystem actually works before you change it: entry points, data flow, dependencies, what depends on it, where state lives, what could break, and the evidence for each conclusion. {REVERSE_HELP.readOnly} Code analysis only; device / protocol reverse engineering is not part of this.</p>
      {guide && <div data-testid="re-guide" className="border border-sky-800 bg-sky-950 p-2 mb-2 text-xs">First time here? Type what you want to understand (a file, an /api route, or words like “how a mission is cancelled”), pick a depth, press Analyze. Look for the FACT / INFERENCE / UNKNOWN labels, then use “Start a build from this analysis” if you want to change it. <button type="button" className="underline ml-2" onClick={dismiss}>Got it</button></div>}
      <div className="grid gap-2 text-sm mb-3">
        <textarea data-testid="re-target" className="bg-gray-800 p-1" rows={2} maxLength={600} placeholder="Target: file / directory / /api route / symbol / natural-language description" title={REVERSE_HELP.target} value={target} onChange={(e) => setTarget(e.target.value)} />
        <div className="flex gap-3 flex-wrap items-center text-xs">
          <label>Depth <select data-testid="re-depth" className="bg-gray-800 p-1 text-white" value={depth} onChange={(e) => setDepth(e.target.value as Depth)} title={REVERSE_HELP.depth[depth]}>
            <option value="quick">Quick</option><option value="standard">Standard</option><option value="deep">Deep</option></select></label>
          <span className="text-gray-400">{REVERSE_HELP.depth[depth]}</span>
        </div>
        <div className="flex gap-3 flex-wrap text-xs">{(['explanation', 'dependencyMap', 'dataFlowMap', 'changeImpact', 'all'] as OutputOption[]).map((o) => (
          <label key={o} title={REVERSE_HELP.outputs[o]}><input data-testid={`re-out-${o}`} type="checkbox" checked={outs.includes(o)} onChange={() => toggleOut(o)} /> {({ explanation: 'Explanation', dependencyMap: 'Dependency map', dataFlowMap: 'Data-flow map', changeImpact: 'Change-impact report', all: 'All' } as Record<string, string>)[o]}</label>))}</div>
        <div><button data-testid="re-analyze" type="button" disabled={busy || target.trim().length < 2} className="px-3 py-1 bg-sky-700 disabled:opacity-50" onClick={analyze}>Analyze</button>{notice && <span data-testid="re-notice" className="ml-3 text-xs text-amber-300">{notice}</span>}</div>
      </div>
      {err && <p data-testid="re-error" className="text-xs text-red-300">Analyses unavailable: {err}</p>}
      {rows && rows.length === 0 && <p className="text-xs text-gray-400">No analyses yet.</p>}
      {rows?.map((a) => (
        <div key={a.id} data-testid={`analysis-${a.id}`} className="mb-2 border border-gray-700 p-2 text-sm">
          <div className="flex gap-2 items-center flex-wrap"><span className="font-medium">{a.target.slice(0, 90)}</span><span className="text-xs text-gray-400">{a.id}</span><span className="text-xs bg-gray-700 px-1">{a.kind}</span><span className="text-xs bg-gray-700 px-1">{a.depth}</span>{a.readOnlyUnchanged && <span className="text-xs bg-green-800 px-1">source unchanged</span>}</div>
          <div className="text-xs text-gray-300">{a.summary}</div>
          <div className="text-xs text-gray-400">{a.owners.length} owner(s) · {a.evidenceCount} evidence · {a.unknowns} unknown(s) · {a.createdAt.slice(0, 19).replace('T', ' ')}</div>
          <button type="button" data-testid="re-open" className="text-xs underline text-sky-300" onClick={() => (open?.id === a.id ? setOpen(null) : void show(a.id))}>{open?.id === a.id ? 'Hide' : 'Open'}</button>
        </div>
      ))}
      {open && r && (
        <div data-testid="re-detail" className="border border-sky-800 p-3 text-xs text-gray-200">
          <div className="text-sm font-medium">Analysis {open.id}</div>
          <div data-testid="re-readonly" className="text-gray-400">Target resolved as <b>{open.target.kind}</b> ({open.target.how}) · tree fingerprint before/after: {open.readOnly.unchanged ? 'IDENTICAL — no source was modified' : 'CHANGED during analysis (not by Foundry)'} · {open.provenance.commandsRun.length} command(s) run · model: {open.provenance.model ?? 'none (explanation built from deterministic findings)'}</div>
          <Section id="summary" title="Summary">{r.summary?.map((c, i) => <ClaimLine key={i} c={c} />)}</Section>
          {r.entryPoints && <Section id="entry" title="Entry points">{r.entryPoints.length === 0 ? <div className="text-gray-400">none found</div> : r.entryPoints.map((e, i) => <div key={i}><Badge b={e.claim.basis} />{e.file}{e.line ? `:${e.line}` : ''} — {e.kind}: {e.claim.text}<Ev ids={e.claim.evidence} /></div>)}</Section>}
          {r.flow && <Section id="flow" title="Call / data flow">{r.maps?.flow ? <pre data-testid="re-flow-map" className="bg-black/40 p-2 overflow-x-auto whitespace-pre">{r.maps.flow.text}</pre> : <div className="text-gray-400">no path established</div>}
            {r.flow.map((s) => <div key={s.n}><Badge b={s.basis} />{s.n}. [{s.layer}] {s.file}{s.line ? `:${s.line}` : ''} via {s.via}<Ev ids={s.evidence} /></div>)}</Section>}
          {r.dependencies && <Section id="deps" title="Dependencies (direct)">{r.dependencies.map((d) => <div key={d.file} className="mb-1"><b>{d.file}</b> → {d.internal.length ? d.internal.map((i) => i.path).join(', ') : 'no internal imports'}{d.external.length ? <div className="text-gray-400">packages: {d.external.join(', ')}</div> : null}</div>)}
            {r.maps?.imports && <pre className="bg-black/40 p-2 overflow-x-auto" data-testid="re-imports-map">{r.maps.imports.text}</pre>}</Section>}
          {r.reverseDependents && <Section id="rdeps" title="Reverse dependents (what depends on it)">{r.reverseDependents.map((d) => <div key={d.file} className="mb-1"><b>{d.file}</b>: {d.direct.length} direct{d.direct.length ? ` — ${d.direct.map((x) => x.path).slice(0, 10).join(', ')}` : ''}{d.transitive.length ? `; ${d.transitive.length} transitive (${d.transitive.slice(0, 6).map((x) => `${x.path} @${x.hops}`).join(', ')})` : ''}</div>)}
            {r.maps?.reverse && <pre className="bg-black/40 p-2 overflow-x-auto" data-testid="re-reverse-map">{r.maps.reverse.text}</pre>}</Section>}
          {r.state && <Section id="state" title="State / storage">
            {r.state.states.map((s) => <div key={s.name + s.file}><Badge b="FACT" />{s.name} ({s.file}:{s.line}): {s.values.join(' | ')}<Ev ids={s.evidence} /></div>)}
            {(['create', 'change', 'delete', 'db', 'browser-storage', 'read', 'ui-state', 'env'] as const).map((op) => { const x = r.state!.storage.filter((s) => s.op === op); return x.length ? <div key={op}><span className="text-gray-400">{op}: </span>{x.slice(0, 8).map((s) => `${s.file}:${s.line} ${s.api}${s.target ? `(${s.target.slice(0, 30)})` : ''}`).join('; ')}</div> : null })}
            {r.state.assignments.length > 0 && <div><span className="text-gray-400">state values set: </span>{r.state.assignments.slice(0, 10).map((a) => `${a.field}='${a.value}' @${a.file}:${a.line}`).join('; ')}</div>}
            {r.maps?.states && <pre className="bg-black/40 p-2 overflow-x-auto">{r.maps.states.text}</pre>}</Section>}
          {r.routes && <Section id="routes" title="API / routes">{r.routes.length === 0 ? <div className="text-gray-400">no routes involved</div> : r.routes.map((x) => <div key={x.path} className="mb-1"><Badge b="FACT" /><b>{x.path}</b> [{x.methods.map((m) => m.method).join(', ') || 'none exported'}] {x.file}<div className="text-gray-400">statuses: {x.statuses.map((s) => s.status).join(', ') || 'none literal'} · actions: {x.actions.map((a) => a.value).join(', ') || 'none'} · callers: {x.callers.map((c) => `${c.file}:${c.line} ${c.method}`).join('; ') || 'none found'}</div></div>)}</Section>}
          {r.ui && <Section id="ui" title="UI connections">{r.ui.length === 0 ? <div className="text-gray-400">no UI files connected</div> : r.ui.map((u) => <div key={u.file} className="mb-1"><b>{u.file}</b>{u.surfaces.filter((s) => s.reachesApi.length).slice(0, 6).map((s, i) => <div key={i} className="ml-3">“{s.label}” ({s.handler ?? 'inline'}) → {s.reachesApi.join(', ')}</div>)}{u.testIds.length ? <div className="ml-3 text-gray-400">selectors: {u.testIds.slice(0, 8).join(', ')}</div> : null}</div>)}</Section>}
          {r.tests && <Section id="tests" title="Test coverage">{r.tests.relevant.map((t) => <div key={t.path}><Badge b={t.basis} />{t.path} — {t.why}</div>)}{r.tests.missing.map((c, i) => <ClaimLine key={i} c={c} />)}{!r.tests.relevant.length && !r.tests.missing.length && <div className="text-gray-400">none</div>}</Section>}
          {r.changeImpact && <Section id="impact" title="Change impact">{r.changeImpact.summary.map((c, i) => <ClaimLine key={i} c={c} />)}{r.changeImpact.perOwner.map((o) => <div key={o.file} className="text-gray-400">{o.file}: tests to run — {o.testsToRun.join(', ') || 'none found'}; routes — {o.routesAffected.join(', ') || 'none'}</div>)}</Section>}
          <Section id="risks" title="Risks / unknowns">{r.risks.map((c, i) => <ClaimLine key={i} c={c} />)}</Section>
          <Section id="evidence" title={`Evidence (${open.evidence.length})`}><div className="max-h-64 overflow-y-auto">{[...evById.values()].map((e) => <div key={e.id} className="text-gray-400"><span className="text-gray-300">{e.id}</span> {e.kind} {e.file}{e.line ? `:${e.line}` : ''} — {e.note}</div>)}</div></Section>
          <Section id="provenance" title="Provenance">
            <div>files inspected: {open.provenance.filesInspected.length} · symbols: {open.provenance.symbolsInspected.length} · routes: {open.provenance.routesInspected.join(', ') || 'none'}</div>
            <div>methods: {open.provenance.methods.join('; ')}</div><div>deterministic tools: {open.provenance.deterministicTools.join(', ')}</div>
            <div>snapshot: {open.provenance.snapshot.fileCount} files, head {open.provenance.snapshot.head?.slice(0, 10) ?? 'unknown'}, fingerprint {open.provenance.snapshot.fingerprint.slice(0, 16)}{open.provenance.snapshot.truncated ? ' (TRUNCATED)' : ''} · {open.durationMs} ms</div>
          </Section>
          <Section id="handoff" title="Start a build from this analysis">
            <p className="text-gray-400 mb-1">This does not run automatically. It starts a normal engineering mission seeded with this analysis (owners as seed files{open.target.basis === 'FACT' ? ' and target files' : '; the owner set is an inference, so name the write scope yourself'}); the build, tests and verifier then run as usual.</p>
            <div className="grid gap-1">
              <input data-testid="re-build-title" className="bg-gray-800 p-1" placeholder="Title" value={build.title} onChange={(e) => setBuild({ ...build, title: e.target.value })} />
              <textarea data-testid="re-build-request" className="bg-gray-800 p-1" rows={2} placeholder="What to change (at least 20 characters)" value={build.request} onChange={(e) => setBuild({ ...build, request: e.target.value })} />
              <textarea data-testid="re-build-acceptance" className="bg-gray-800 p-1" rows={3} placeholder="Acceptance criteria, one per line" value={build.acceptance} onChange={(e) => setBuild({ ...build, acceptance: e.target.value })} />
              <textarea data-testid="re-build-write" className="bg-gray-800 p-1" rows={2} placeholder={open.handoff.targetFiles.length && open.target.basis === 'FACT' ? `Write scope (default: ${open.handoff.targetFiles.slice(0, 3).join(', ')})` : 'Write scope, one path per line (required)'} value={build.write} onChange={(e) => setBuild({ ...build, write: e.target.value })} />
              <div><button data-testid="re-build-start" type="button" disabled={busy} className="px-3 py-1 bg-sky-700 disabled:opacity-50" onClick={startBuild}>Start build from analysis</button></div>
            </div>
          </Section>
        </div>
      )}
    </section>
  )
}
