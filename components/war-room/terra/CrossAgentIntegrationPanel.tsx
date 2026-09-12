'use client'

/**
 * #22 Phase 14 — Minimal Commander status surface for cross-agent integration.
 * Fixture/status only. No unsafe execute controls (no commit/push/deploy/SQL).
 */
import { useState } from 'react'

const WORKFLOWS = [
  'KNOWLEDGE_PIPELINE',
  'WORLD_STATE_PIPELINE',
  'ENGINEERING_SAFETY_PIPELINE',
  'OFFLINE_LOCAL_WORKFLOW',
  'VALIDATOR_REVISION_LOOP',
  'ASTRA_MULTI_AGENT_MISSION',
] as const

export function CrossAgentIntegrationPanel({ compact }: { compact?: boolean }) {
  const [kind, setKind] = useState<(typeof WORKFLOWS)[number]>('KNOWLEDGE_PIPELINE')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string>('Governed handoffs. ASTRA remains orchestrator. Autonomy OFF. #23 WR-CORPUS ACTIVE; tokenizer/WRIM not started.')
  const [status, setStatus] = useState<string>('IDLE')

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/ascension/integration/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workflow_kind: kind,
          use_fixture: true,
          internet_available: kind !== 'OFFLINE_LOCAL_WORKFLOW',
          live_search_allowed: false,
        }),
      })
      const json = (await res.json()) as {
        result?: {
          status?: string
          summary?: string
          mission?: { status?: string }
          workflow?: { summary?: string; status?: string }
        }
        error?: string
      }
      const nested = json.result?.workflow?.status ?? json.result?.mission?.status ?? json.result?.status
      setStatus(nested ?? (res.ok ? 'OK' : 'ERROR'))
      setSummary(
        json.result?.workflow?.summary ??
          json.result?.summary ??
          json.error ??
          'No result. Cross-agent integration remains bounded.',
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
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Cross-Agent Integration</p>
      <p className="mb-2 text-[10px] text-slate-400">
        Status + fixture workflows. No commit / push / deploy / SQL. Candidates ≠ training.
      </p>
      <label className="mb-2 block text-[10px] text-slate-300">
        Workflow
        <select
          className="mt-1 w-full rounded border border-white/15 bg-black/60 px-2 py-1 font-mono text-[10px] text-cyan-100"
          value={kind}
          onChange={e => setKind(e.target.value as (typeof WORKFLOWS)[number])}
        >
          {WORKFLOWS.map(item => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="mb-2 rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200 disabled:opacity-40"
      >
        {busy ? 'Running…' : 'Run fixture workflow'}
      </button>
      <p className="font-mono text-[10px] text-cyan-300">{status}</p>
      {!compact ? <p className="mt-1 text-[10px] text-slate-400">{summary}</p> : null}
    </div>
  )
}
