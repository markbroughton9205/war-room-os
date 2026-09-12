'use client'

import { useCallback, useEffect, useState } from 'react'

type WrimStatus = {
  historical_wrim0?: string
  historical_wrim1?: string
  wrim1_run_000001?: string
  wrim1_run_000002?: string
  recovery?: string
  continuation?: string
  nebula_readiness?: unknown
  training_authorization?: string
  train_button?: boolean
  current_production_wrim?: string
  current_training?: string
  dense_baseline_required?: boolean
  notes?: string[]
}

export function WrimReconciliationPanel() {
  const [status, setStatus] = useState<WrimStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wrim-reconciliation/status')
    const json = (await res.json()) as WrimStatus
    setStatus(json)
  }, [])

  useEffect(() => {
    void refresh().catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [refresh])

  const hw = status?.nebula_readiness as { cpuName?: string; gpuName?: string; gpuVramMiB?: number } | undefined

  return (
    <section className="space-y-3 rounded border border-amber-800 bg-zinc-950 p-4 text-sm text-amber-100">
      <p className="text-xs uppercase tracking-widest text-amber-400">WRIM reconciliation · #23 · no training controls</p>
      {error ? <p className="text-red-400">{error}</p> : null}
      <article className="grid gap-1 text-xs">
        <p>WRIM-0 historical: {status?.historical_wrim0 ?? 'TRAINED_RESEARCH_ARTIFACT'}</p>
        <p>WRIM-1 rejected: {status?.historical_wrim1 ?? 'REJECTED_COLLAPSED'} (000001 {status?.wrim1_run_000001 ?? 'COLLAPSED'} · 000002 {status?.wrim1_run_000002 ?? 'FAILED'})</p>
        <p>WRIM-1.1 recovery/test: {status?.recovery ?? 'TEST_ONLY'}</p>
        <p>continuation: {status?.continuation ?? 'B_REBUILD_WRIM_1_FROM_WRIM_0'}</p>
        <p>Nebula: {hw?.cpuName ?? '…'} · {hw?.gpuName ?? ''} · VRAM {hw?.gpuVramMiB ?? 'n/a'} MiB</p>
        <p>training authorization: {status?.training_authorization ?? 'OFF'} · train button: {String(status?.train_button ?? false)}</p>
        <p>production WRIM: {status?.current_production_wrim ?? 'NOT_IMPLEMENTED'} · training: {status?.current_training ?? 'NOT_RUNNING'}</p>
        <p>dense baseline required: {String(status?.dense_baseline_required ?? true)}</p>
      </article>
      <button type="button" className="rounded border border-amber-600 px-3 py-1 text-xs" onClick={() => void refresh()}>
        Refresh WRIM status
      </button>
    </section>
  )
}
