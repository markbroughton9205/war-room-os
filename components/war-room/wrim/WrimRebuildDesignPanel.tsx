'use client'

import { useCallback, useEffect, useState } from 'react'

type DesignStatus = {
  WRIM_REBUILD_DESIGN?: string
  decision?: string
  next_authorized_pass?: string
  train_button?: boolean
  training_authorization?: string
  official_run_id?: string
  parent?: string
  tokenizer?: string
  peak_lr?: number
  packing?: string
  tool_use?: string
  current_production_wrim?: string
  current_training?: string
  rael?: string
  notes?: string[]
}

export function WrimRebuildDesignPanel() {
  const [status, setStatus] = useState<DesignStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wrim-rebuild-design/status')
    const json = (await res.json()) as DesignStatus
    setStatus(json)
  }, [])

  useEffect(() => {
    void refresh().catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [refresh])

  return (
    <section className="space-y-3 rounded border border-sky-800 bg-zinc-950 p-4 text-sm text-sky-100">
      <p className="text-xs uppercase tracking-widest text-sky-400">WRIM-1 Nebula rebuild design · #23 · plan only</p>
      {error ? <p className="text-red-400">{error}</p> : null}
      <article className="grid gap-1 text-xs">
        <p>design: {status?.WRIM_REBUILD_DESIGN ?? 'COMPLETE'}</p>
        <p>decision: {status?.decision ?? 'READY_FOR_NEBULA_ENVIRONMENT_SETUP'}</p>
        <p>next authorized pass: {status?.next_authorized_pass ?? 'NEBULA_PYTORCH_CUDA_ENVIRONMENT_SETUP'}</p>
        <p>parent: {status?.parent ?? 'WRIM-0'} · tokenizer: {status?.tokenizer ?? 'WR-TOKENIZER-0'}</p>
        <p>official run ID (not started): {status?.official_run_id ?? 'WRIM1-RUN-000003'}</p>
        <p>peak LR: {status?.peak_lr ?? 3e-5} · packing: {status?.packing ?? 'contiguous'} · tool-use: {status?.tool_use ?? 'EXCLUDED'}</p>
        <p>training authorization: {status?.training_authorization ?? 'OFF'} · train button: {String(status?.train_button ?? false)}</p>
        <p>production WRIM: {status?.current_production_wrim ?? 'NOT_IMPLEMENTED'} · training: {status?.current_training ?? 'NOT_RUNNING'} · Ra&apos;el: {status?.rael ?? 'NOT_IMPLEMENTED'}</p>
      </article>
      <button type="button" className="rounded border border-sky-600 px-3 py-1 text-xs" onClick={() => void refresh()}>
        Refresh rebuild-design status
      </button>
    </section>
  )
}
