'use client'

/**
 * #22 Phase 12 — Bounded Commander UI for NAVIGATION_AGENT.
 * Calls the Next API. Does not run routing in the renderer.
 */
import { useState } from 'react'
import {
  HELSINKI_FIXTURE_DESTINATION,
  HELSINKI_FIXTURE_ORIGIN,
} from '@/lib/ascension/navigation-agent/reason'

const TASKS = [
  'PLAN_ROUTE',
  'COMPARE_ROUTES',
  'EXPLAIN_ROUTE',
  'INTERPRET_PROGRESS',
  'RECOMMEND_REROUTE',
  'EXPLAIN_ETA',
  'SUMMARIZE_INSTRUCTIONS',
] as const

export function NavigationAgentPanel({ compact }: { compact?: boolean }) {
  const [task, setTask] = useState<(typeof TASKS)[number]>('PLAN_ROUTE')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string>('Fixture Helsinki corridor. Phase 9 engine is authoritative.')
  const [status, setStatus] = useState<string>('IDLE')

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/ascension/navigation-agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task_type: task,
          origin: HELSINKI_FIXTURE_ORIGIN,
          destination: HELSINKI_FIXTURE_DESTINATION,
          location_source: 'fixture',
          use_fixture: true,
        }),
      })
      const json = (await res.json()) as {
        result?: { status?: string; summary?: string; live_traffic?: string; mobile_gnss?: string }
        error?: string
      }
      setStatus(json.result?.status ?? (res.ok ? 'OK' : 'ERROR'))
      setSummary(
        json.result?.summary ??
          json.error ??
          'No result. NAVIGATION_AGENT remains bounded; renderer has no routing privilege.',
      )
    } catch (err) {
      setStatus('ERROR')
      setSummary(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`pointer-events-auto rounded border border-cyan-400/25 bg-black/75 backdrop-blur-sm ${compact ? 'p-2' : 'p-3'}`}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Navigation Agent</p>
      <p className="mb-2 text-[10px] text-slate-400">
        Bounded reasoning over Terra Navigation Foundation. GNSS NOT_SUPPORTED · live traffic NOT_IMPLEMENTED.
      </p>
      <label className="mb-2 block text-[10px] text-slate-300">
        Task
        <select
          className="mt-1 w-full rounded border border-white/15 bg-black/60 px-2 py-1 font-mono text-[10px] text-cyan-100"
          value={task}
          onChange={e => setTask(e.target.value as (typeof TASKS)[number])}
        >
          {TASKS.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="w-full rounded border border-cyan-400/40 bg-cyan-950/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-200 disabled:opacity-50"
      >
        {busy ? 'Running…' : 'Plan fixture route'}
      </button>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-amber-200">{status}</p>
      <p className="mt-1 text-[10px] text-slate-300">{summary}</p>
    </div>
  )
}
