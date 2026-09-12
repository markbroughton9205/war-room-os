'use client'

import { useCallback, useEffect, useState } from 'react'

type EnvStatus = {
  WRIM_ENVIRONMENT?: string
  WRIM_PYTORCH_PORT?: string
  pytorch?: string
  cuda_detected?: boolean
  gpu?: string | null
  precision?: Record<string, string>
  training_authorization?: string
  train_button?: boolean
  next_authorized_pass?: string
}

export function WrimEnvironmentPanel() {
  const [status, setStatus] = useState<EnvStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wrim-environment/status')
    const json = (await res.json()) as EnvStatus
    setStatus(json)
  }, [])

  useEffect(() => {
    void refresh().catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [refresh])

  const precision = status?.precision ?? {}

  return (
    <section className="space-y-3 rounded border border-cyan-800 bg-zinc-950 p-4 text-sm text-cyan-100">
      <p className="text-xs uppercase tracking-widest text-cyan-400">WRIM PyTorch environment · Stage 0 · no training</p>
      {error ? <p className="text-red-400">{error}</p> : null}
      <article className="grid gap-1 text-xs">
        <p>environment: {status?.WRIM_ENVIRONMENT ?? '…'} · port: {status?.WRIM_PYTORCH_PORT ?? '…'}</p>
        <p>PyTorch: {status?.pytorch ?? '…'} · CUDA detected: {String(status?.cuda_detected ?? false)}</p>
        <p>GPU: {status?.gpu ?? 'n/a'}</p>
        <p>precision: FP32 {precision.FP32 ?? '…'} · TF32 {precision.TF32 ?? '…'} · FP16 {precision.FP16 ?? '…'} · BF16 {precision.BF16 ?? '…'}</p>
        <p>WRIM-0 Stage 0 equivalence: {status?.WRIM_PYTORCH_PORT ?? '…'}</p>
        <p>training authorization: {status?.training_authorization ?? 'OFF'} · train button: {String(status?.train_button ?? false)}</p>
        <p>next pass: {status?.next_authorized_pass ?? 'READY_FOR_STAGE1_AUTHORIZATION'} (not started)</p>
      </article>
      <button type="button" className="rounded border border-cyan-600 px-3 py-1 text-xs" onClick={() => void refresh()}>
        Refresh environment status
      </button>
    </section>
  )
}
