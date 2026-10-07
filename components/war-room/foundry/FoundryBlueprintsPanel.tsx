'use client'

import { useCallback, useEffect, useState } from 'react'
import { approvalView, artifactRows, claimRows, dependencyRows, recoveryLabel, stageRows, writeCapableLabel, type Json } from '@/lib/native-builder/blueprint/uiModel'

const API = '/api/foundry/blueprints'
const HDR = { 'content-type': 'application/json', 'x-wr-blueprints': '1' }
type ListRow = { execId: string; packageId: string; state: string; binding?: { missionId: string; assignmentId: string; workspaceId: string }; importedAt?: number; approved?: boolean }
type ApiErr = { code?: string; message?: string; nextAction?: string }

const j = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const s = (v: unknown): string => (v === null || v === undefined || v === '' ? 'UNKNOWN' : typeof v === 'string' ? v : JSON.stringify(v))
const short = (h: unknown) => (typeof h === 'string' && h.length > 16 ? `${h.slice(0, 12)}…${h.slice(-4)}` : s(h))

async function call(path: string, init?: RequestInit): Promise<{ ok: boolean; data: Json; error?: ApiErr }> {
  try {
    const r = await fetch(path, { cache: 'no-store', ...init })
    const data = (await r.json().catch(() => ({}))) as Json
    return r.ok ? { ok: true, data } : { ok: false, data, error: (data.error as ApiErr) ?? { code: `HTTP_${r.status}`, message: `Request failed (${r.status})` } }
  } catch (e) { return { ok: false, data: {}, error: { code: 'NETWORK', message: e instanceof Error ? e.message : 'request failed' } } }
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section data-testid={`bp-${id}`} className="mb-5 border border-gray-700 rounded p-3"><h3 className="text-sm tracking-wide text-emerald-300 mb-2">{title}</h3>{children}</section>
}
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="text-xs flex gap-2"><span className="w-44 shrink-0 text-gray-400">{k}</span><span className="break-all">{v}</span></div>

export function FoundryBlueprintsPanel() {
  const [list, setList] = useState<{ phase: 'loading' | 'ready' | 'error'; rows: ListRow[]; error?: ApiErr }>({ phase: 'loading', rows: [] })
  const [sel, setSel] = useState<string | null>(null)
  const [detail, setDetail] = useState<Json | null>(null)
  const [receipts, setReceipts] = useState<Json | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [form, setForm] = useState({ raw: '', missionId: '', assignmentId: '', workspaceId: '' })

  const loadList = useCallback(async () => {
    const r = await call(API)
    setList(r.ok ? { phase: 'ready', rows: (r.data.blueprints as ListRow[]) ?? [] } : { phase: 'error', rows: [], error: r.error })
  }, [])
  const loadDetail = useCallback(async (id: string) => {
    const [d, rc] = await Promise.all([call(`${API}/${id}`), call(`${API}/${id}/receipts`)])
    setDetail(d.ok ? d.data : { loadError: d.error }); setReceipts(rc.ok ? rc.data : { loadError: rc.error })
  }, [])
  // Deferred a tick: this repo's react-hooks/set-state-in-effect rule flags synchronous setState reached from an effect body.
  useEffect(() => { const t = setTimeout(() => void loadList(), 0); return () => clearTimeout(t) }, [loadList])
  useEffect(() => { if (!sel) return; const t = setTimeout(() => void loadDetail(sel), 0); return () => clearTimeout(t) }, [sel, loadDetail])
  const choose = (id: string | null) => { setConfirm(false); setDetail(null); setReceipts(null); setSel(id) }
  useEffect(() => { // live refresh while stages run in the background
    if (!sel) return
    const bg = j(detail?.background); const running = bg.startedAt && !bg.finishedAt
    if (!running) return
    const t = setInterval(() => { void loadDetail(sel); void loadList() }, 1500)
    return () => clearInterval(t)
  }, [sel, detail, loadDetail, loadList])

  const act = async (label: string, path: string, body?: Json) => {
    setBusy(true); setMsg(null)
    const r = await call(path, { method: 'POST', headers: HDR, body: JSON.stringify(body ?? {}) })
    setMsg(r.ok ? { kind: 'ok', text: `${label}: accepted` } : { kind: 'err', text: `${label} refused — ${r.error?.code ?? 'ERROR'}: ${r.error?.message ?? ''}${r.error?.nextAction ? ` Next: ${r.error.nextAction}` : ''}` })
    setBusy(false); setConfirm(false)
    if (r.ok && label === 'Import' && typeof r.data.execId === 'string') { await loadList(); choose(r.data.execId); return }
    await loadList(); if (sel) await loadDetail(sel)
  }

  const proj = j(detail?.projection), approval = j(detail?.approval), av = approvalView(detail?.approval), auth = j(detail?.authority)
  const preview = j(detail?.preview), changes = (Array.isArray(preview.changes) ? preview.changes : []) as Json[]
  const lineage = detail?.lineage, arts = artifactRows(detail?.artifacts ?? receipts?.artifacts)
  const state = s(proj.state), bound = j(approval.bound), current = j(approval.current)
  const shownDigest = (approval.packageDigest ?? bound.packageDigest ?? preview.digest ?? proj.normalizedHash) as string | undefined
  const expected = { packageDigest: shownDigest ?? null, baseIdentity: current.baseIdentity ?? null, checkBinding: current.checkBinding ?? null, ownership: current.ownership ?? null, pipeline: current.pipeline ?? null }
  const deps = dependencyRows(detail?.dependencies), notClaimed = (Array.isArray(j(lineage).notClaimed) ? (j(lineage).notClaimed as string[]) : [])
  const runs = (Array.isArray(detail?.stageRuns) ? detail?.stageRuns : []) as Json[]

  return (
    <div data-testid="blueprints-panel" className="bg-gray-900 text-white p-4">
      <h1 className="text-xl mb-1">Blueprint → Build adapter</h1>
      <p data-testid="bp-banner" className="text-xs text-amber-300 mb-4">Commander-gated. Source validation, dependency verification and host-owned build/package stages only. Nothing here installs, deploys, or completes a task, mission or assignment. UNKNOWN means the host could not prove it.</p>
      {msg && <p data-testid="bp-message" className={`p-2 mb-3 text-sm ${msg.kind === 'ok' ? 'bg-emerald-900' : 'bg-red-700'}`}>{msg.text}</p>}
      {list.phase === 'loading' && <p data-testid="bp-loading" className="text-gray-300">Loading blueprints…</p>}
      {list.phase === 'error' && <p data-testid="bp-list-error" className="p-2 bg-red-700">Blueprint API unavailable — {list.error?.code}: {list.error?.message}</p>}

      <div className="grid md:grid-cols-[22rem_1fr] gap-4">
        <div>
          <Section id="list" title="BLUEPRINTS">
            {list.phase === 'ready' && list.rows.length === 0 && <p className="text-xs text-gray-400">No blueprints imported yet.</p>}
            <ul>{list.rows.map(r => (
              <li key={r.execId}><button data-testid={`bp-row-${r.execId}`} onClick={() => choose(r.execId)} className={`w-full text-left text-xs p-1 border-b border-gray-800 ${sel === r.execId ? 'bg-gray-700' : ''}`}>
                <b>{r.packageId}</b> · {r.state}{r.approved ? ' · approved' : ''}<br /><span className="text-gray-400">{r.binding?.missionId} / {r.binding?.assignmentId}</span></button></li>))}</ul>
          </Section>
          <Section id="import" title="IMPORT PACKAGE">
            {(['missionId', 'assignmentId', 'workspaceId'] as const).map(k => <input key={k} data-testid={`bp-in-${k}`} className="block w-full mb-1 bg-black p-1 text-xs border border-gray-700" placeholder={k} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />)}
            <textarea data-testid="bp-in-raw" className="block w-full h-28 bg-black p-1 text-xs border border-gray-700" placeholder="package JSON" value={form.raw} onChange={e => setForm({ ...form, raw: e.target.value })} />
            <button data-testid="bp-import" disabled={busy || !form.raw || !form.missionId || !form.assignmentId || !form.workspaceId} onClick={() => act('Import', `${API}/import`, form)} className="mt-1 px-2 py-1 text-xs bg-emerald-700 disabled:opacity-40">Import &amp; preview</button>
          </Section>
        </div>

        <div>
          {!sel && <p data-testid="bp-none-selected" className="text-sm text-gray-400">Select or import a blueprint.</p>}
          {sel && !detail && <p data-testid="bp-detail-loading" className="text-gray-300">Loading…</p>}
          {sel && detail && !!detail.loadError && <p data-testid="bp-detail-error" className="p-2 bg-red-700">Unavailable — {s(j(detail.loadError).code)}: {s(j(detail.loadError).message)}</p>}
          {sel && detail && !detail.loadError && (<>
            <Section id="package" title="PACKAGE">
              <Row k="blueprint" v={sel} /><Row k="package id" v={s(proj.packageId ?? j(preview.package).id ?? preview.packageId)} /><Row k="package digest" v={short(bound.packageDigest ?? preview.digest ?? proj.normalizedHash)} />
              <Row k="state" v={<b data-testid="bp-state">{state}</b>} /><Row k="goal" v={s(preview.goal)} />
              <Row k="recipe" v={s(j(detail.recipe).pipelineKind)} /><Row k="authorized stages" v={s(j(detail.recipe).authorized)} />
            </Section>

            <Section id="preview" title="PREVIEW (exact changes)">
              {!!detail.previewError && <p className="text-xs text-red-300">Preview unavailable — {s(j(detail.previewError).code)}</p>}
              <p className="text-xs text-amber-300 mb-1">{s(preview.limits)}</p>
              {changes.length === 0 && !detail.previewError && <p className="text-xs text-gray-400">No changes listed.</p>}
              <table className="text-xs w-full"><tbody>{changes.map((c, i) => <tr key={i} data-testid="bp-change"><td className="pr-2">{s(c.operation)}</td><td className="pr-2 break-all">{s(c.path)}</td><td className="pr-2 text-gray-400">{short(c.beforeHash)} → {short(c.afterHash)}</td></tr>)}</tbody></table>
              <div data-testid="bp-deps" className="text-xs mt-2 text-gray-300">Dependencies (plan {deps.plan}; approving a dependency never installs it):
                {deps.rows.length === 0 && <span> none declared, or UNKNOWN</span>}
                {deps.rows.map(d => <div key={`${d.name}@${d.version}`} data-testid="bp-dep" className="flex gap-2 items-center"><span>{d.name}@{d.version}</span><b>{d.state}</b><span>{d.approved}</span><span className="text-gray-400">{d.reasons}</span>
                  {d.approved !== 'APPROVED' && <button data-testid="bp-dep-approve" disabled={busy} onClick={() => act('Approve dependency', `${API}/${sel}/dependencies`, { name: d.name, version: d.version, reason: 'Commander approved this exact declared dependency' })} className="px-1 bg-emerald-800">Approve</button>}
                  {d.approved === 'APPROVED' && <button data-testid="bp-dep-revoke" disabled={busy} onClick={() => act('Revoke dependency', `${API}/${sel}/dependencies`, { name: d.name, version: d.version, action: 'revoke' })} className="px-1 bg-gray-700">Revoke</button>}</div>)}</div>
            </Section>

            <Section id="authority" title="AUTHORITY">
              <Row k="mission" v={`${s(j(auth.mission).id)} · ${s(j(auth.mission).state)}${j(auth.mission).cancelRequested ? ' · CANCEL REQUESTED' : ''}`} />
              <Row k="assignment" v={`${s(j(auth.assignment).id)} · ${s(j(auth.assignment).state)} · ${writeCapableLabel(auth)}`} />
              <Row k="owner / worker" v={`${s(j(auth.assignment).ownerAgent)} (${s(j(auth.assignment).ownerState)}) / ${s(j(auth.assignment).worker)}`} />
              <Row k="ownership complete" v={s(auth.ownershipComplete)} /><Row k="write scope" v={`${s(j(auth.writeScope).established)} · ${s(j(auth.writeScope).count)} path(s)`} />
              <Row k="workspace" v={`${s(j(auth.workspace).id)} · ${j(auth.workspace).resolved ? 'resolved' : 'UNRESOLVED'}`} />
              <Row k="base identity" v={`${s(j(auth.baseIdentity).status)} · ${short(j(auth.baseIdentity).digest)} · ${s(j(auth.baseIdentity).branch)}`} />
              <Row k="lease" v={`${s(j(auth.lease).state)}${j(auth.lease).epoch !== undefined ? ` · epoch ${s(j(auth.lease).epoch)}` : ''}`} />
              <Row k="session" v={`${s(j(auth.session).actorId)} · ${s(j(auth.session).sessionId)}`} />
              <div data-testid="bp-approval" className="mt-2 p-2 border border-gray-600">
                <div className="text-sm">Approval: <b data-testid="bp-approval-label" className={av.label === 'STALE' || av.label === 'EXPIRED' ? 'text-red-400' : 'text-emerald-300'}>{av.label}</b></div>
                <p className="text-xs text-gray-300">{av.detail}</p>
                {av.label !== 'NOT_APPROVED' && av.label !== 'UNKNOWN' && <div className="text-xs mt-1">
                  {(['baseIdentity', 'checkBinding', 'ownership', 'pipeline'] as const).map(k => <div key={k} data-testid={`bp-bound-${k}`} className={av.stale.includes(k) ? 'text-red-400' : ''}>{k}: bound {short(bound[k])} · now {short(current[k])}{av.stale.includes(k) ? ' · STALE' : ''}</div>)}
                  <div>approved by {s(j(approval.approvedBy).actorId)} (session {s(j(approval.approvedBy).sessionId)})</div></div>}
                {(state === 'PREVIEWED' || av.mustReapprove) && <label className="block text-xs mt-2"><input data-testid="bp-confirm" type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} /> I approve exactly this content (digest {short(bound.packageDigest ?? preview.digest ?? proj.normalizedHash)}) with the authority shown above.</label>}
                <div className="mt-2 flex gap-2 flex-wrap">
                  <button data-testid="bp-approve" disabled={busy || !confirm || !(state === 'PREVIEWED' || av.mustReapprove)} onClick={() => act('Approve', `${API}/${sel}/approve`, { expected })} className="px-2 py-1 text-xs bg-emerald-700 disabled:opacity-40">Approve</button>
                </div>
              </div>
            </Section>

            <Section id="execution" title="EXECUTION">
              <div data-testid="bp-claims">{claimRows(proj, lineage).map(c => <Row key={c.key} k={c.label} v={<span data-testid={`bp-claim-${c.key}`}>{c.value}</span>} />)}</div>
              {notClaimed.length > 0 && <p data-testid="bp-notclaimed" className="text-xs text-amber-300 mt-1">NOT claimed: {notClaimed.join(', ')}</p>}
              <table className="text-xs w-full mt-2"><tbody>{stageRows(lineage).map(r => <tr key={r.stage} data-testid={`bp-stage-${r.stage}`}><td className="pr-2">{r.stage}</td><td className="pr-2 font-bold">{r.status}</td><td className="text-gray-400">{r.note}</td></tr>)}</tbody></table>
              {runs.map((r, i) => <div key={i} data-testid="bp-run" className="text-xs mt-1 text-gray-300">{s(r.stage)} attempt {s(r.attempt)}: {s(r.state)} · process {s(r.processState)}{r.elapsedMs != null ? ` · ${s(r.elapsedMs)}ms` : ''}{r.progress ? ` · ${s(r.progress)}` : ''}</div>)}
              {!!detail.lineageError && <p className="text-xs text-red-300">Lineage unavailable — {s(j(detail.lineageError).code)}</p>}
              {!!j(detail.background).startedAt && <p data-testid="bp-bg" className="text-xs mt-1">Background stages: {j(detail.background).finishedAt ? 'finished' : 'RUNNING'}{j(j(detail.background).error).code ? ` · error ${s(j(j(detail.background).error).code)}` : ''}</p>}
              <div className="mt-2 flex gap-2 flex-wrap">
                <button data-testid="bp-run" disabled={busy || !(state === 'APPROVED' && av.label === 'APPROVED_USABLE')} onClick={() => act('Run', `${API}/${sel}/run`, { stages: true })} className="px-2 py-1 text-xs bg-emerald-700 disabled:opacity-40">Run (source → build → package)</button>
                <button data-testid="bp-run-stages" disabled={busy || state !== 'VERIFIED_SOURCE'} onClick={() => act('Run stages', `${API}/${sel}/run`, { stages: true })} className="px-2 py-1 text-xs bg-emerald-800 disabled:opacity-40">Run build/package</button>
                <button data-testid="bp-pause" disabled={busy} onClick={() => act('Pause', `${API}/${sel}/pause`, { reason: 'Commander pause' })} className="px-2 py-1 text-xs bg-gray-700">Pause</button>
                <button data-testid="bp-resume" disabled={busy} onClick={() => act('Resume', `${API}/${sel}/resume`)} className="px-2 py-1 text-xs bg-gray-700">Resume</button>
                <button data-testid="bp-cancel" disabled={busy} onClick={() => act('Cancel', `${API}/${sel}/cancel`, { reason: 'Commander cancel' })} className="px-2 py-1 text-xs bg-red-800">Cancel</button>
                <button data-testid="bp-reconcile" disabled={busy} onClick={() => act('Reconcile', `${API}/${sel}/reconcile`, { action: 'RECONCILE' })} className="px-2 py-1 text-xs bg-gray-700">Reconcile</button>
                <button data-testid="bp-restore" disabled={busy} onClick={() => act('Restore', `${API}/${sel}/restore`)} className="px-2 py-1 text-xs bg-gray-700">Restore</button>
              </div>
            </Section>

            <Section id="receipts" title="RECEIPTS">
              {!receipts || receipts.loadError ? <p className="text-xs text-red-300">Receipts unavailable — {s(j(receipts?.loadError).code)}</p> : (<>
                <Row k="chain" v={s(j(j(receipts.lineage).chain).ok === true ? 'INTACT' : j(receipts.lineage).chain ? 'BROKEN' : 'UNKNOWN')} />
                <ul className="text-xs mt-1">{((Array.isArray(j(receipts.lineage).history) ? j(receipts.lineage).history : Array.isArray(j(j(receipts.lineage).lineage).history) ? j(j(receipts.lineage).lineage).history : []) as Json[]).map((h, i) => <li key={i} data-testid="bp-receipt">{s(h.id)} · {s(h.kind)} · {s(h.status)}{h.broken ? ' · BROKEN' : ''}</li>)}</ul>
                <Row k="run recovery" v={recoveryLabel(receipts.runRecovery)} /><Row k="stage recovery" v={<span data-testid="bp-stage-recovery">{recoveryLabel(receipts.stageRecovery)}</span>} />
              </>)}
            </Section>

            <Section id="artifacts" title="ARTIFACTS">
              <p data-testid="bp-art-verification" className="text-xs text-gray-300 mb-1">Verification: {arts.verification}</p>
              {arts.rows.length === 0 && <p className="text-xs text-gray-400">No artifacts recorded (nothing built/packaged, or UNKNOWN).</p>}
              <table className="text-xs w-full"><tbody>{arts.rows.map((a, i) => <tr key={i} data-testid="bp-artifact"><td className="pr-2">{a.stage}</td><td className="pr-2 break-all">{a.name}</td><td className="pr-2">{short(a.sha256)}</td><td className="pr-2">{a.bytes} B</td><td className="pr-2">run {a.runId.slice(0, 10)}</td><td className="font-bold">{a.verification}</td></tr>)}</tbody></table>
            </Section>
          </>)}
        </div>
      </div>
    </div>
  )
}
