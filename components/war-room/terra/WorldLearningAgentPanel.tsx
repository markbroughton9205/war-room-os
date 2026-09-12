'use client'

/**
 * #22 Phase 13 — Bounded Commander UI for WORLD_LEARNING_AGENT.
 * Calls the Next API. Does not run Search/Research in the renderer.
 */
import { useState } from 'react'

const TASKS = [
  'LEARN_TOPIC',
  'COMPARE_SOURCES',
  'VERIFY_CLAIM',
  'BUILD_TOPIC_MAP',
  'IDENTIFY_KNOWLEDGE_GAPS',
  'RECOMMEND_CORPUS_ENTRY',
] as const

export function WorldLearningAgentPanel({ compact }: { compact?: boolean }) {
  const [task, setTask] = useState<(typeof TASKS)[number]>('LEARN_TOPIC')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string>('Fixture Helsinki harbor / Digitraffic topic. Research Agent remains canonical discovery.')
  const [status, setStatus] = useState<string>('IDLE')

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/ascension/world-learning-agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task_type: task,
          topic: 'Public Helsinki harbor vessel-traffic information systems (Digitraffic marine API)',
          domain: 'transportation',
          use_fixture: true,
          internet_available: true,
          live_search_allowed: false,
        }),
      })
      const json = (await res.json()) as {
        result?: {
          status?: string
          summary?: string
          live_discovery?: string
          production_corpus_persisted?: boolean
        }
        error?: string
      }
      setStatus(json.result?.status ?? (res.ok ? 'OK' : 'ERROR'))
      setSummary(
        json.result?.summary ??
          json.error ??
          'No result. WORLD_LEARNING_AGENT remains bounded; renderer has no Search privilege.',
      )
    } catch (err) {
      setStatus('ERROR')
      setSummary(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`pointer-events-auto rounded border border-emerald-400/25 bg-black/75 backdrop-blur-sm ${compact ? 'p-2' : 'p-3'}`}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">World Learning Agent</p>
      <p className="mb-2 text-[10px] text-slate-400">
        Bounded world-knowledge acquisition. Candidates only · no training · #23 NOT_STARTED.
      </p>
      <label className="mb-2 block text-[10px] text-slate-300">
        Task
        <select
          className="mt-1 w-full rounded border border-white/15 bg-black/60 px-2 py-1 font-mono text-[10px] text-emerald-100"
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
        className="w-full rounded border border-emerald-400/40 bg-emerald-950/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 disabled:opacity-50"
      >
        {busy ? 'Running…' : 'Learn fixture topic'}
      </button>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-amber-200">{status}</p>
      <p className="mt-1 text-[10px] leading-snug text-slate-400">{summary}</p>
    </div>
  )
}
