'use client'

import { useCallback, useEffect, useState } from 'react'

type TokenizerStatus = {
  historical_id?: string
  historical_status?: string
  historical_artifact_present?: boolean
  hash_verified?: boolean
  hash_expected?: string
  vocab_size?: number
  recommendation?: string
  reconciliation?: string
  current_tokenizer?: string
  training?: string
  train_button?: boolean
  compatibility?: { wrim0?: string; wrim1?: string }
  canonical_path?: string | null
}

export function WrTokenizerPanel() {
  const [status, setStatus] = useState<TokenizerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wr-tokenizer/status')
    const json = (await res.json()) as TokenizerStatus
    setStatus(json)
  }, [])

  useEffect(() => {
    void refresh().catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [refresh])

  return (
    <section className="space-y-3 rounded border border-sky-800 bg-zinc-950 p-4 text-sm text-sky-100">
      <p className="text-xs uppercase tracking-widest text-sky-400">WR-TOKENIZER-0 · #23 reconciliation · no training controls</p>
      {error ? <p className="text-red-400">{error}</p> : null}
      <article className="grid gap-1 text-xs">
        <p>identity: {status?.historical_id ?? 'WR-TOKENIZER-0'}</p>
        <p>historical: {status?.historical_status ?? '…'} / {status?.historical_artifact_present ? 'PRESENT' : 'MISSING'}</p>
        <p>validated: {status?.hash_verified ? 'HASH VERIFIED' : 'PENDING'}</p>
        <p>sha: {status?.hash_expected ?? ''}</p>
        <p>vocab: {status?.vocab_size ?? ''}</p>
        <p>corpus compatibility: measured in AppData benchmarks</p>
        <p>WRIM-0 lineage: {status?.compatibility?.wrim0 ?? 'bound'}</p>
        <p>WRIM-1 lineage: {status?.compatibility?.wrim1 ?? 'compatible'} (collapsed, not promoted)</p>
        <p>current recommendation: {status?.recommendation ?? ''}</p>
        <p>current tokenizer: {status?.current_tokenizer ?? ''} · {status?.reconciliation ?? ''}</p>
        <p>training: {status?.training ?? 'NOT_STARTED'} · train button: {String(status?.train_button ?? false)}</p>
      </article>
      <button type="button" className="rounded border border-sky-600 px-3 py-1 text-xs" onClick={() => void refresh()}>
        Refresh tokenizer status
      </button>
    </section>
  )
}
