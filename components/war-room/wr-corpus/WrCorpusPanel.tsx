'use client'

import { useCallback, useEffect, useState } from 'react'

type StatusPayload = {
  ok?: boolean
  wr_corpus?: string
  roadmap_23?: string
  notes?: string[]
  versions?: Array<{
    canonical_id: string
    historical_id: string
    record_count: number
    training_eligibility: string
    classification: Record<string, unknown>
    provenance?: Record<string, unknown>
    bytes: number
    artifact_relpath: string
    quality_status?: string
    source_types?: string[]
    active?: boolean
  }>
  artifactBytes?: number
  root?: string
  candidate_review_queue?: Array<{
    candidate_id: string
    review_state: string
    freshness: string
    recommended_disposition: string
    source_agent: string
  }>
  tombstones?: Array<{ record_id: unknown; policy: unknown; historical_source_preserved: boolean }>
  delete_layers?: Record<string, string>
}

export function WrCorpusPanel() {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [query, setQuery] = useState('Alice')
  const [hits, setHits] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wr-corpus/status')
    const json = (await res.json()) as StatusPayload
    setStatus(json)
  }, [])

  useEffect(() => {
    void refresh().catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [refresh])

  async function runQuery() {
    setError(null)
    const res = await fetch('/api/wr-corpus/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, ownerUserId: 'local-commander' }),
    })
    const json = await res.json()
    setHits(JSON.stringify(json, null, 2))
  }

  return (
    <section className="space-y-4 rounded border border-emerald-800 bg-zinc-950 p-4 text-sm text-emerald-100">
      <p className="text-xs uppercase tracking-widest text-emerald-400">
        WR-CORPUS v1 · #23 ACTIVE · WR-TOKENIZER-0 reconciled · no Train button
      </p>
      {error ? <p className="text-red-400">{error}</p> : null}
      <div className="grid gap-2 md:grid-cols-2">
        {(status?.versions ?? []).map(v => (
          <article key={v.canonical_id} className="rounded border border-emerald-900 p-3">
            <h2 className="font-semibold">{v.canonical_id}</h2>
            <p>historical: {v.historical_id}</p>
            <p>records: {v.record_count}</p>
            <p>source classes: {(v.source_types ?? []).join(', ') || 'n/a'}</p>
            <p>eligibility: {v.training_eligibility}</p>
            <p>active: {String(v.active ?? true)}</p>
            <p>bytes: {v.bytes}</p>
            <p className="text-xs text-emerald-500">{v.quality_status ?? String(v.classification.canonical_name ?? '')}</p>
          </article>
        ))}
      </div>
      <p className="text-xs text-emerald-500">
        storage: {status?.root ?? '(not migrated yet)'} · footprint {status?.artifactBytes ?? 0} bytes
      </p>
      <p className="text-xs text-amber-200">
        HISTORICAL WR-TOKENIZER-0 is TRAINED+VALIDATED and now the canonical reconciled tokenizer (KEEP_AND_EXTEND_LATER).
        Tokenizer training is still NOT_STARTED. HISTORICAL WRIM-0 remains lineage only. Qwen remains third-party local RAG.
      </p>
      <p className="text-xs text-amber-300">
        ACTIVE_CORPUS_DELETE removes live retrieval and writes a tombstone. HISTORICAL_RECOVERY_SOURCE_PRESERVED: the Mac
        recovery dump is never deleted by active delete.
      </p>
      <div>
        <p className="mb-1 text-xs uppercase tracking-widest text-emerald-400">Candidate review queue</p>
        {(status?.candidate_review_queue ?? []).length === 0 ? (
          <p className="text-xs text-emerald-600">No owner-scoped durable candidates listed for local-commander.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {(status?.candidate_review_queue ?? []).map(c => (
              <li key={c.candidate_id}>
                {c.candidate_id} · {c.review_state} · {c.freshness} · {c.source_agent}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ul className="list-disc pl-5 text-xs text-emerald-500">
        {(status?.notes ?? []).map(note => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-emerald-800 bg-black px-2 py-1"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="WR-CORPUS query"
        />
        <button type="button" className="rounded border border-emerald-500 px-3 py-1" onClick={() => void runQuery()}>
          Query
        </button>
        <button type="button" className="rounded border border-emerald-700 px-3 py-1" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {hits ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-black p-2 text-xs text-emerald-200">{hits}</pre>
      ) : null}
    </section>
  )
}
