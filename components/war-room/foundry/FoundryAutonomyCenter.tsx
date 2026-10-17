'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutonomyStatus, CommandView } from '@/lib/agents/ops/engineering/autonomy/controller'
import { FoundryEngineeringMissions } from './FoundryEngineeringMissions'

const TONE: Record<string, string> = { run: 'bg-sky-700', ok: 'bg-green-700', bad: 'bg-red-700', warn: 'bg-amber-600', idle: 'bg-gray-600' }
const stateTone = (s: string) => (s === 'DELIVERED' ? 'ok' : s === 'BLOCKED' || s === 'FAILED' ? 'bad' : s === 'STOPPED' || s === 'PAUSED' || s === 'WAITING_RESOURCES' || s === 'AWAITING_AUTHORITY' ? 'warn' : s === 'CANCELLED' ? 'idle' : 'run')
const capTone = (s: string) => (s === 'GRANTED' ? 'text-green-300' : s === 'UNAVAILABLE' ? 'text-red-300' : 'text-amber-300')
const OPEN = ['INTERPRETING', 'AWAITING_AUTHORITY', 'QUEUED', 'WAITING_RESOURCES', 'RUNNING', 'PAUSED', 'PROVING']

function Ladder({ c }: { c: CommandView }) {
  const l = c.ladder
  const chips: [string, boolean | null, string][] = [
    ['Code generated', l.codeGenerated, 'Foundry wrote the change'],
    ['Tests passed', l.testsPassed, 'tests that are part of this change ran and passed'],
    ['Verified', l.verificationPassed, 'the independent verifier and the repository gates passed'],
    ['Build created', l.buildCreated, 'a versioned build exists'],
    ['Installed', l.installed, 'the build is installed beside the existing ones'],
    ['Running', l.running, 'the installed build was started and driven with real input'],
    ['Pointer/UI proof', l.uiProof === 'NOT_APPLICABLE' ? null : l.uiProof === 'PASSED', l.uiProof === 'NOT_APPLICABLE' ? 'not applicable' : `UI proof: ${l.uiProof.toLowerCase()}`],
    ['Promoted', l.promoted, 'the canonical launcher points at this build'],
  ]
  return (
    <div data-testid="command-ladder" className="mt-1 flex flex-wrap gap-1 text-[11px]">
      {chips.filter(([, v]) => v !== null).map(([label, v, title]) => (
        <span key={label} title={title} className={`px-1.5 py-0.5 ${v ? 'bg-green-800' : 'bg-gray-700 text-gray-400'}`}>{v ? '✓' : '·'} {label}</span>
      ))}
    </div>
  )
}

export function FoundryAutonomyCenter() {
  const [status, setStatus] = useState<AutonomyStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<CommandView | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (): Promise<AutonomyStatus | null> => {
    try {
      const r = await fetch('/api/foundry/autonomy', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as AutonomyStatus
      setStatus(j); setErr(null)
      if (open) { const d = await fetch(`/api/foundry/autonomy?command=${encodeURIComponent(open)}`, { cache: 'no-store' }); if (d.ok) setDetail(((await d.json()) as { command: CommandView }).command) }
      return j
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed to load'); return null }
  }, [open])
  useEffect(() => {
    let stop = false
    const tick = async () => { const s = await load(); if (stop) return; timer.current = setTimeout(tick, s && s.active.length ? 2000 : 8000) }
    void tick()
    return () => { stop = true; if (timer.current) clearTimeout(timer.current) }
  }, [load])

  const post = async (body: Record<string, unknown>, label: string): Promise<{ ok: boolean; json: Record<string, unknown> }> => {
    setBusy(true); setNotice(null)
    try {
      const r = await fetch('/api/foundry/autonomy', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wr-agent-ops': '1' }, body: JSON.stringify(body) })
      const j = (await r.json()) as Record<string, unknown>
      setNotice(r.ok ? `${label}: done` : `${label} refused: ${String(j.error ?? 'error')}`)
      setBusy(false); void load()
      return { ok: r.ok, json: j }
    } catch (e) { setNotice(`${label} failed: ${e instanceof Error ? e.message : 'error'}`); setBusy(false); return { ok: false, json: {} } }
  }
  const send = async () => {
    const t = text.trim()
    if (!t) return
    const r = await post({ action: 'command', text: t }, 'Command')
    if (r.ok) { setText(''); const cid = String(r.json.commandId ?? ''); if (cid) setOpen(cid); setNotice(`Foundry took it: command ${cid}${r.json.missionId ? `, mission ${String(r.json.missionId)}` : ' (queued)'} — ${String(r.json.reason ?? '')}`) }
  }

  const cfg = status?.config
  const stopped = !!status?.emergencyStop
  const pill = stopped ? ['EMERGENCY STOP', 'bad'] : cfg?.paused ? ['PAUSED', 'warn'] : cfg?.fullAutonomy ? ['FULL AUTONOMY ON', 'ok'] : ['FULL AUTONOMY OFF', 'idle']

  return (
    <section data-testid="autonomy-center" className="mb-8 border border-sky-800 p-3 bg-gray-950">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-lg mr-2">Foundry — tell it what to build</h2>
        <span data-testid="autonomy-pill" className={`px-2 py-0.5 text-xs ${TONE[pill[1]]}`}>{pill[0]}</span>
        <span className="flex-1" />
        {cfg && !cfg.fullAutonomy && !stopped && <button data-testid="autonomy-enable" type="button" disabled={busy} className="px-3 py-1 text-sm bg-green-700 disabled:opacity-50" onClick={() => void post({ action: 'settings', settings: { fullAutonomy: true } }, 'Enable Full Autonomy')}>Enable Full Autonomy</button>}
        {cfg?.fullAutonomy && !stopped && <button data-testid="autonomy-disable" type="button" disabled={busy} className="px-3 py-1 text-sm bg-gray-700 disabled:opacity-50" onClick={() => void post({ action: 'settings', settings: { fullAutonomy: false } }, 'Disable Full Autonomy')}>Turn Full Autonomy off</button>}
        {cfg?.fullAutonomy && !stopped && !cfg.paused && <button data-testid="autonomy-pause" type="button" disabled={busy} className="px-3 py-1 text-sm bg-amber-700 disabled:opacity-50" title="Stop at the next safe point; the mission keeps its checkpoint" onClick={() => void post({ action: 'pause' }, 'Pause')}>Pause</button>}
        {cfg?.paused && !stopped && <button data-testid="autonomy-resume" type="button" disabled={busy} className="px-3 py-1 text-sm bg-sky-700 disabled:opacity-50" onClick={() => void post({ action: 'resume' }, 'Resume')}>Resume</button>}
        {!stopped && <button data-testid="autonomy-estop" type="button" disabled={busy} className="px-3 py-1 text-sm bg-red-700 font-bold disabled:opacity-50" title="Kills every running tool and model call and refuses all further work until cleared" onClick={() => void post({ action: 'estop', reason: 'Emergency Stop pressed in the Autonomy Control Center' }, 'Emergency Stop')}>EMERGENCY STOP</button>}
        {stopped && <button data-testid="autonomy-clear-stop" type="button" disabled={busy} className="px-3 py-1 text-sm bg-amber-600 disabled:opacity-50" onClick={() => void post({ action: 'clear-stop' }, 'Clear Emergency Stop')}>Clear Emergency Stop</button>}
      </div>
      {stopped && status?.emergencyStop && <p data-testid="autonomy-stop-detail" className="text-xs text-red-300 mb-2">Stopped {status.emergencyStop.at} by {status.emergencyStop.by}: {status.emergencyStop.reason}. {status.emergencyStop.killedProcesses.length} process(es) killed, {status.emergencyStop.abortedModelCalls} model call(s) aborted, {status.emergencyStop.missions.length} mission(s) checkpointed and left resumable. No new work starts until this is cleared.</p>}
      {cfg && !cfg.fullAutonomy && (
        <p className="text-xs text-gray-300 mb-2" data-testid="autonomy-authority-note">Full Autonomy lets Foundry carry a plain-language request through by itself: it finds the files, plans, writes and tests code in isolated workspaces, repairs failures, makes git branches and commits, and builds versioned installations beside your existing ones. It never uses sudo, never creates accounts or spends money, never touches security configuration, and your current War Room stays as it is until a verified build is promoted. Set once; it persists.</p>
      )}
      <div className="grid gap-2 mb-3">
        <textarea data-testid="command-input" className="bg-gray-800 p-2 text-sm" rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void send() }}
          placeholder={'Foundry, change my mouse pointer inside War Room to a small futuristic spaceship that glows and pulses when I click…\n(plain language — no files, no criteria, no forms)'} disabled={stopped} />
        <div>
          <button data-testid="command-send" type="button" disabled={busy || !text.trim() || stopped || !cfg?.fullAutonomy} title={!cfg?.fullAutonomy ? 'Turn Full Autonomy on first' : 'Ctrl+Enter'} className="px-4 py-1.5 bg-sky-700 disabled:opacity-40" onClick={() => void send()}>Build it</button>
          {notice && <span data-testid="command-notice" className="ml-3 text-xs text-amber-300">{notice}</span>}
        </div>
      </div>
      {err && <p data-testid="autonomy-error" className="text-xs text-red-300">Autonomy API unavailable: {err}</p>}

      {status && status.metrics.finished > 0 && (
        <p data-testid="autonomy-metrics" className="text-xs text-gray-400 mb-2">
          Measured: {status.metrics.delivered}/{status.metrics.finished} finished commands delivered · autonomous completion {status.metrics.autonomousCompletionRate === null ? 'n/a' : `${Math.round(status.metrics.autonomousCompletionRate * 100)}%`} (delivered with no Commander action) · {status.metrics.failuresDiagnosed} failure(s) diagnosed, {status.metrics.failuresRecovered} recovered · {status.metrics.escalations.local} local escalation(s), {status.metrics.escalations.localSucceeded} delivered{status.metrics.meanMinutesToDelivery !== null ? ` · mean ${status.metrics.meanMinutesToDelivery} min to delivery` : ''}{status.metrics.interventions.length ? ` · Commander actions: ${status.metrics.interventions.map((i) => `${i.kind.toLowerCase()} ×${i.count}`).join(', ')}` : ''}
        </p>
      )}
      <h3 className="text-sm text-gray-300 mt-2 mb-1">Active</h3>
      {status && status.active.length === 0 && <p data-testid="autonomy-idle" className="text-xs text-gray-400 mb-2">Nothing is running. Type a request above.</p>}
      {status?.active.map((c) => <CommandCard key={c.id} c={c} detail={open === c.id ? detail : null} open={open === c.id} onToggle={() => { setOpen(open === c.id ? null : c.id); setDetail(null) }} busy={busy} post={post} />)}

      <h3 className="text-sm text-gray-300 mt-3 mb-1">Worker activity</h3>
      <div data-testid="autonomy-workers" className="text-xs text-gray-300 mb-2">
        {status?.workers.length ? status.workers.map((w) => <div key={w.missionId}>worker {w.workerId} (pid {w.pid}) on {w.missionId} · builder {w.builder} · heartbeat {w.heartbeatAgeSec} s ago · last progress {w.progressAgeSec} s ago · {w.note}</div>) : <div className="text-gray-500">no engineering worker is running</div>}
        {status && <div className="text-gray-500">{status.activity.children.length} tool process(es) and {status.activity.modelCalls} model call(s) in flight{status.activity.stopped ? ' — held by Emergency Stop' : ''}{status.resources ? ` · resources: ${status.resources.ok ? 'ok' : 'WAIT'} (${status.resources.reason}); GPU free ${status.resources.reading.gpuFreeMiB ?? '?'} MiB, RAM available ${status.resources.reading.ramAvailableMiB ?? '?'} MiB` : ''}</div>}
      </div>

      <details data-testid="autonomy-authority" className="mb-2" open>
        <summary className="text-sm text-gray-300 cursor-pointer">Current operational authority (probed on this machine, not assumed)</summary>
        <div className="text-xs mt-1">
          {status?.capabilities.map((c) => (
            <div key={c.id} data-testid={`cap-${c.id}`}><span className={`inline-block w-28 ${capTone(c.state)}`}>{c.state.replace('_', ' ')}</span> {c.label} <span className="text-gray-500">— {c.evidence}</span></div>
          ))}
        </div>
      </details>

      <h3 className="text-sm text-gray-300 mt-3 mb-1">History</h3>
      <div data-testid="autonomy-history" className="text-xs">
        {status && status.recent.length === 0 && <div className="text-gray-500">No finished commands yet.</div>}
        {status?.recent.map((c) => <CommandCard key={c.id} c={c} detail={open === c.id ? detail : null} open={open === c.id} onToggle={() => { setOpen(open === c.id ? null : c.id); setDetail(null) }} busy={busy} post={post} compact />)}
      </div>

      <details data-testid="autonomy-advanced" className="mt-3">
        <summary className="text-xs text-gray-400 cursor-pointer">Advanced — settings and the manual mission form (optional; you never need these)</summary>
        {cfg && (
          <div className="text-xs mt-2 grid gap-1">
            <label title="A verified, installed build may replace the canonical launcher target. A rollback copy is always made."><input data-testid="set-deploy" type="checkbox" checked={cfg.deploymentAuthority} disabled={busy} onChange={(e) => void post({ action: 'settings', settings: { deploymentAuthority: e.target.checked } }, 'Deployment authority')} /> Deployment authority: Foundry may promote an independently verified, proven-running build to the launcher (rollback copy kept; takes effect on the next launch)</label>
            <label><input type="checkbox" checked={cfg.autoInstall} disabled={busy} onChange={(e) => void post({ action: 'settings', settings: { autoInstall: e.target.checked } }, 'Auto install')} /> Build a versioned installation for application changes</label>
            <label><input type="checkbox" checked={cfg.autoRecover} disabled={busy} onChange={(e) => void post({ action: 'settings', settings: { autoRecover: e.target.checked } }, 'Auto recover')} /> Resume interrupted missions from their checkpoint automatically</label>
            <div className="text-gray-500">Attempts per request before Foundry reports it BLOCKED: {cfg.maxStrategyAttempts} · automatic resumes per mission: {cfg.maxAutoResumes} · settings last changed {cfg.updatedAt.slice(0, 19)} by {cfg.updatedBy}</div>
          </div>
        )}
        <div className="mt-3"><FoundryEngineeringMissions /></div>
      </details>
    </section>
  )
}

export function CommandCard({ c, detail, open, onToggle, busy, post, compact }: { c: CommandView; detail: CommandView | null; open: boolean; onToggle: () => void; busy: boolean; post: (b: Record<string, unknown>, l: string) => Promise<unknown>; compact?: boolean }) {
  const tone = stateTone(c.state)
  const m = c.mission
  const d = detail ?? c
  return (
    <div data-testid={`command-${c.id}`} className="mb-2 border border-gray-700 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="command-state" className={`px-2 py-0.5 text-xs ${TONE[tone]}`}>{c.state.replace(/_/g, ' ')}</span>
        <span className="font-medium">{c.interpretation.title}</span>
        <span className="text-xs text-gray-400">{c.id}</span>
        {m && <span data-testid="command-mission" className="text-xs bg-gray-800 px-1">mission {m.id} · {m.state}</span>}
        {c.steps.length > 1 && <span className="text-xs bg-gray-800 px-1">step {c.currentStep + 1}/{c.steps.length}</span>}
        {c.origin.kind === 'council' && <span className="text-xs bg-fuchsia-900 px-1" title="Started from a Council conversation; results are returned there">from Council</span>}
      </div>
      <div className="text-xs text-gray-400 mt-0.5 whitespace-pre-wrap">“{c.text.length > 200 ? c.text.slice(0, 200) + '…' : c.text}”</div>
      <div data-testid="command-reason" className="text-xs text-gray-300 mt-1">{c.stateReason}</div>
      {m && !compact && <div className="text-xs text-gray-400">steps {m.progress.stepsDone}/{m.progress.stepsTotal || '?'} · model calls {m.progress.modelCalls} · repairs {m.progress.repairs} · files changed {m.progress.filesChanged.length} · attempts {m.attempts.length} · builder {m.config.builder}{m.worker ? ` · heartbeat ${m.worker.heartbeatAgeSec}s ago` : ''}</div>}
      <Ladder c={c} />
      {!compact && m && m.events.slice(-4).map((e, i) => <div key={i} className="text-[11px] text-gray-500">{e.at.slice(11, 19)} {e.kind}: {e.detail.slice(0, 160)}</div>)}
      <div className="mt-1">
        <button type="button" className="mr-3 text-xs underline text-sky-300" onClick={onToggle}>{open ? 'Hide details' : 'Details'}</button>
        {c.controls.includes('cancel') && <button data-testid="command-cancel" type="button" disabled={busy} className="mr-3 text-xs underline text-red-300" onClick={() => void post({ action: 'cancel', commandId: c.id, reason: 'Commander cancelled from the Autonomy Control Center' }, 'Cancel')}>Cancel</button>}
        {(c.state === 'BLOCKED' || c.state === 'FAILED') && <button data-testid="command-reopen" type="button" disabled={busy} className="mr-3 text-xs underline text-sky-300" title="Continue from the last checkpoint: verified work is kept, the failure is diagnosed again" onClick={() => void post({ action: 'reopen', commandId: c.id }, 'Continue')}>Continue from checkpoint</button>}
        {c.state === 'STOPPED' && <button data-testid="command-restart" type="button" disabled={busy} className="mr-3 text-xs underline text-sky-300" onClick={() => void post({ action: 'restart', commandId: c.id }, 'Restart')}>Restart from checkpoint</button>}
      </div>
      {open && (
        <div data-testid="command-detail" className="mt-2 text-xs text-gray-300">
          <div className="font-medium">What Foundry worked out</div>
          <div>{d.interpretation.kind} · {d.interpretation.complexity} · {d.interpretation.interpretedBy}{d.interpretation.notes.length ? ' · ' + d.interpretation.notes.join(' · ') : ''}</div>
          {d.interpretation.discovery.matches.length > 0 && <div className="text-gray-400">files it found: {d.interpretation.discovery.matches.slice(0, 5).map((x) => x.path).join(', ')}</div>}
          {d.steps.map((s) => (
            <div key={s.n} className="mt-1"><span className="font-medium">Step {s.n}: {s.title}</span> — {s.state}{s.integratedCommit ? ` · integrated ${s.integratedCommit.slice(0, 8)}` : ''}
              <div className="text-gray-400">targets: {s.subtask.targets.map((t) => `${t.action} ${t.path}`).join(', ') || 'planned by the engine'}</div>
              <ol className="list-decimal ml-5 text-gray-400">{s.subtask.acceptance.map((a, i) => <li key={i}>{a.slice(0, 260)}</li>)}</ol>
              {s.missions.map((x) => <div key={x.id} className="text-gray-400">attempt: {x.id} ({x.strategy}{x.builder ? `, worker ${x.builder}` : ''}) → {x.endState ?? 'running'}</div>)}
            </div>
          ))}
          {d.decisions && d.decisions.length > 0 && (
            <div data-testid="command-decisions" className="mt-1"><div className="font-medium">Recovery decisions (cause, evidence, choice, rejected alternatives)</div>
              {d.decisions.map((x, i) => (
                <div key={i} className="mb-1 pl-2 border-l border-gray-700">
                  <div><span className="text-amber-300">{x.cause}</span> · step {x.step} · mission {x.missionId} · worker {x.worker.builder}{x.worker.escalatedTo ? ` → escalated to ${x.worker.escalatedTo}` : ''}</div>
                  <div className="text-gray-400">evidence: {x.evidence.slice(0, 3).join(' | ').slice(0, 300) || '—'}</div>
                  <div>chose: {x.chosen} — {x.reason}</div>
                  {x.rejected.slice(0, 4).map((r, j) => <div key={j} className="text-gray-500">not chosen: {r.option} — {r.why.slice(0, 200)}</div>)}
                </div>
              ))}
            </div>
          )}
          {d.lessonsApplied && d.lessonsApplied.length > 0 && <div className="mt-1 text-gray-400">lessons from earlier missions applied: {d.lessonsApplied.join(', ')}</div>}
          {d.evidence.uiProof && <div className="mt-1"><div className="font-medium">UI proof ({d.evidence.uiProof.passed ? 'passed' : 'FAILED'}) — {d.evidence.uiProof.dir}</div>{d.evidence.uiProof.steps.map((s, i) => <div key={i} className={s.ok ? 'text-green-300' : 'text-red-300'}>{s.ok ? '✓' : '✗'} {s.label} — {s.detail}</div>)}</div>}
          {d.evidence.install && <div className="mt-1">installation: {d.evidence.install.path}</div>}
          {d.evidence.promotion && <div>promoted: launcher was {d.evidence.promotion.previousTarget}; rollback copy {d.evidence.promotion.backup}</div>}
          <div className="font-medium mt-1">Timeline</div>
          {d.timeline.slice(-30).map((t, i) => <div key={i} className="text-gray-400">{t.at.slice(11, 19)} {t.kind}: {t.detail}</div>)}
        </div>
      )}
    </div>
  )
}
