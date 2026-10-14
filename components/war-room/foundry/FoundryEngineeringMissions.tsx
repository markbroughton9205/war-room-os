'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MissionView } from '@/lib/agents/ops/engineering/missions/service'
import { isActive, roleLine, stateBadge } from '@/lib/agents/ops/engineering/missions/viewModel'

const TONE: Record<string, string> = { run: 'bg-sky-700', ok: 'bg-green-700', bad: 'bg-red-700', warn: 'bg-amber-600', idle: 'bg-gray-600' }
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

/** Engineering missions: give Foundry a real feature, watch the real engine build/test/verify/integrate it, and read an honest receipt. Every number comes from the mission store, never from this page. */
export function FoundryEngineeringMissions() {
  const [missions, setMissions] = useState<MissionView[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<MissionView | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: '', request: '', acceptance: '', paths: '', write: '', targets: '', install: false, verify: '' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/foundry/engineering/missions', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { missions: MissionView[] }
      setMissions(j.missions); setErr(null)
      if (open) { const d = await fetch(`/api/foundry/engineering/missions?id=${encodeURIComponent(open)}`, { cache: 'no-store' }); if (d.ok) setDetail(((await d.json()) as { mission: MissionView }).mission) }
      return j.missions
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed to load'); return null }
  }, [open])
  useEffect(() => {
    let stop = false
    const tick = async () => { const m = await load(); if (stop) return; timer.current = setTimeout(tick, m?.some(isActive) ? 2500 : 12000) }
    void tick()
    return () => { stop = true; if (timer.current) clearTimeout(timer.current) }
  }, [load])

  const post = async (body: Record<string, unknown>, label: string) => {
    setBusy(true); setNotice(null)
    try {
      const r = await fetch('/api/foundry/engineering/missions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wr-agent-ops': '1' }, body: JSON.stringify(body) })
      const j = (await r.json()) as { error?: string; code?: string; missionId?: string }
      setNotice(r.ok ? `${label}: accepted${j.missionId ? ` (${j.missionId})` : ''}` : `${label} refused: ${j.error ?? 'error'}${j.code ? ` (${j.code})` : ''}`)
      if (r.ok && j.missionId && body.action === 'start') { setOpen(j.missionId); setForm((f) => ({ ...f, title: '', request: '', acceptance: '' })) }
    } catch (e) { setNotice(`${label} failed: ${e instanceof Error ? e.message : 'error'}`) }
    setBusy(false); void load()
  }
  const start = () => post({ action: 'start', title: form.title, request: form.request, acceptance: lines(form.acceptance), scope: { paths: lines(form.paths), write: lines(form.write) }, targets: lines(form.targets).map((l) => { const m = /^(create|modify)\s+(\S+)$/i.exec(l); return m ? { action: m[1].toLowerCase(), path: m[2] } : { action: 'modify', path: l } }), install: form.install, ...(form.verify.trim() ? { verifyScript: form.verify } : {}) }, 'Start mission')

  return (
    <section data-testid="agentops-missions" className="mb-8">
      <h2 className="text-lg border-b border-gray-700 mb-2">Engineering missions</h2>
      <p className="text-xs text-gray-400 mb-3">A mission runs the real local engineering engine (Devstral builds, the line-up comes from Forge evidence). It works in an isolated workspace, runs tests and an independent verifier, applies the result to a git branch only if the repository gates pass, and records a receipt computed from the files on disk.</p>
      <div data-testid="mission-form" className="grid gap-2 mb-4 text-sm">
        <input data-testid="mission-title" className="bg-gray-800 p-1" placeholder="Title (what the feature is called)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
        <textarea data-testid="mission-request" className="bg-gray-800 p-1" rows={3} placeholder="Request: describe the feature (at least 20 characters)" value={form.request} onChange={(e) => setForm({ ...form, request: e.target.value })} />
        <textarea data-testid="mission-acceptance" className="bg-gray-800 p-1" rows={4} placeholder="Acceptance criteria, one per line (each a testable statement)" value={form.acceptance} onChange={(e) => setForm({ ...form, acceptance: e.target.value })} />
        <textarea data-testid="mission-paths" className="bg-gray-800 p-1" rows={2} placeholder="Repository paths to work from, one per line (files or folders; the repository itself is configured on the server)" value={form.paths} onChange={(e) => setForm({ ...form, paths: e.target.value })} />
        <textarea data-testid="mission-targets" className="bg-gray-800 p-1" rows={3} placeholder="Files to build, one per line: 'create path' or 'modify path' (optional; when empty Foundry plans the files itself)" value={form.targets} onChange={(e) => setForm({ ...form, targets: e.target.value })} />
        <textarea data-testid="mission-write" className="bg-gray-800 p-1" rows={2} placeholder="Where changes may be applied, one folder or file prefix per line (anything else is refused)" value={form.write} onChange={(e) => setForm({ ...form, write: e.target.value })} />
        <details><summary className="text-xs text-gray-400 cursor-pointer">Independent verifier (optional Node script; receives the workspace path as its first argument; hidden from the builder)</summary>
          <textarea data-testid="mission-verify" className="bg-gray-800 p-1 w-full font-mono text-xs" rows={6} value={form.verify} onChange={(e) => setForm({ ...form, verify: e.target.value })} /></details>
        <label className="text-xs text-amber-200"><input data-testid="mission-install" type="checkbox" checked={form.install} onChange={(e) => setForm({ ...form, install: e.target.checked })} /> Commander approval: after verification, merge the integration branch into the repository branch and build a NEW versioned runtime from it (the launcher is not changed).</label>
        <div><button data-testid="mission-start" type="button" disabled={busy} className="px-3 py-1 bg-sky-700 disabled:opacity-50" onClick={start}>Start mission</button>{notice && <span data-testid="mission-notice" className="ml-3 text-xs text-amber-300">{notice}</span>}</div>
      </div>
      {err && <p data-testid="missions-error" className="text-xs text-red-300">Missions API unavailable: {err}</p>}
      {missions && missions.length === 0 && <p className="text-xs text-gray-400">No engineering missions yet.</p>}
      {missions?.map((m) => {
        const b = stateBadge(m); const d = open === m.id && detail?.id === m.id ? detail : null
        return (
          <div key={m.id} data-testid={`mission-${m.id}`} className="mb-3 border border-gray-700 p-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span data-testid="mission-state" className={`px-2 py-0.5 text-xs ${TONE[b.tone]}`}>{b.label}</span>
              <span className="font-medium">{m.title}</span>
              <span className="text-xs text-gray-400">{m.id}</span>
              {m.config.flags.simulated && <span className="text-xs bg-fuchsia-800 px-1">SIMULATED MODELS</span>}
            </div>
            <div data-testid="mission-note" className="text-xs text-gray-300 mt-1">{b.note}</div>
            <div className="text-xs text-gray-400">steps {m.progress.stepsDone}/{m.progress.stepsTotal || '?'} · model calls {m.progress.modelCalls} · repairs {m.progress.repairs} · files changed {m.progress.filesChanged.length} · attempts {m.attempts.length}{m.assignment ? ` · assignment ${m.assignment.state}: ${m.assignment.doingNow}` : ''}</div>
            <div className="text-xs text-gray-400">builder {m.config.builder}{m.config.testReviewer ? ` · test reviewer ${m.config.testReviewer}` : ''}{m.config.testCandidates.length ? ` · test candidate ${m.config.testCandidates.join(', ')}` : ''}</div>
            {m.recoveries.map((r) => <div key={r.at} className="text-xs text-amber-300">recovery: {r.reason} — {r.resumable ? 'resumable' : 'not resumable'}: {r.resumableWhy}</div>)}
            {m.result && <div data-testid="mission-result" className="text-xs">result: {m.result.status} — {m.result.reason} (verifier exit {String(m.result.verifierExit)})</div>}
            {m.receipt && <div data-testid="mission-receipt-line" className="text-xs">receipt: {m.receipt.filesCreated.length} created, {m.receipt.filesModified.length} modified, {m.receipt.filesDeleted.length} deleted · integration {m.receipt.integration.state}{m.receipt.integration.commit ? ` ${m.receipt.integration.commit.slice(0, 10)} on ${m.receipt.integration.branch}` : ''} · install {m.receipt.install.state}</div>}
            <div className="mt-1">
              <button type="button" className="mr-3 text-xs underline text-sky-300" onClick={() => { setOpen(open === m.id ? null : m.id); setDetail(null) }}>{open === m.id ? 'Hide details' : 'Details'}</button>
              {m.controls.includes('resume') && <button data-testid="mission-resume" type="button" disabled={busy} className="mr-3 text-xs underline text-sky-300" onClick={() => post({ action: 'resume', id: m.id }, 'Resume')}>Resume from checkpoint</button>}
              {m.controls.includes('cancel') && <button data-testid="mission-cancel" type="button" disabled={busy} className="mr-3 text-xs underline text-red-300" onClick={() => post({ action: 'cancel', id: m.id, reason: 'Commander cancelled from the Foundry UI' }, 'Cancel')}>Cancel</button>}
            </div>
            {d && (
              <div data-testid="mission-detail" className="mt-2 text-xs text-gray-300">
                <div className="font-medium">Request</div><div className="whitespace-pre-wrap">{d.request}</div>
                <div className="font-medium mt-1">Acceptance</div><ol className="list-decimal ml-5">{d.acceptance.map((a) => <li key={a}>{a}</li>)}</ol>
                <div className="font-medium mt-1">Workspace</div><div>{d.workspace.root} ({d.workspace.seeded} seeded files, base {d.workspace.baseCommit?.slice(0, 10) ?? 'none'})</div>
                <div className="font-medium mt-1">Attempts</div>{d.attempts.map((a) => <div key={a.n}>#{a.n} {a.kind === 'RESUME' ? 'recovery worker' : 'worker'} {a.workerId} (pid {a.pid}) {a.startedAt} → {a.endState ?? 'running'}{a.endReason ? `: ${a.endReason}` : ''}</div>)}
                {d.receipt && (<>
                  <div className="font-medium mt-1" data-testid="receipt-check">Receipt vs disk: {d.receiptCheck === 'NO_RECEIPT' ? 'none' : d.receiptCheck.ok ? 'MATCHES the filesystem' : `MISMATCH — ${d.receiptCheck.mismatches.join('; ')}`}</div>
                  <div>tree {d.receipt.treeSha256.slice(0, 16)} · receipt {d.receipt.receiptSha256.slice(0, 16)}</div>
                  <div className="font-medium mt-1">Provenance by role</div>{roleLine(d.receipt.provenance.roles).map((l) => <div key={l}>{l}</div>)}
                  {d.receipt.provenance.recoveryWorkers.map((w) => <div key={w.attempt}>recovery worker: attempt {w.attempt} ({w.workerId})</div>)}
                  <div className="font-medium mt-1">Files</div>
                  {d.receipt.filesCreated.map((f) => <div key={f.path}>+ {f.path} — {f.role.replace(/_/g, ' ')}: {f.author}</div>)}
                  {d.receipt.filesModified.map((f) => <div key={f.path}>~ {f.path} — {f.role.replace(/_/g, ' ')}: {f.author}</div>)}
                  {d.receipt.filesDeleted.map((f) => <div key={f.path}>- {f.path}</div>)}
                  <div>tests added: {d.receipt.testsAdded.join(', ') || 'none'}; changed: {d.receipt.testsChanged.join(', ') || 'none'}</div>
                  <div>deterministic repairs: {d.receipt.deterministicRepairs.length ? d.receipt.deterministicRepairs.map((r) => `${r.kind} (${r.file})`).join('; ') : 'none'}</div>
                  <div>verifier: {d.receipt.verifier.label} → exit {String(d.receipt.verifier.exitCode)} {d.receipt.verifier.summary}</div>
                  {d.receipt.integration.gates.map((g) => <div key={g.name}>gate {g.name}: exit {g.exitCode} {g.summary}</div>)}
                  {d.receipt.integration.refused.map((r) => <div key={r} className="text-red-300">refused: {r}</div>)}
                  <div>install: {d.receipt.install.state}{d.receipt.install.path ? ` at ${d.receipt.install.path}` : ''}{d.receipt.install.detail ? ` — ${d.receipt.install.detail}` : ''}</div>
                </>)}
                <div className="font-medium mt-1">Events (latest)</div>
                {d.events.slice(-25).map((e, i) => <div key={i} className="text-gray-400">{e.at.slice(11, 19)} a{e.attempt} {e.kind}: {e.detail}</div>)}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
