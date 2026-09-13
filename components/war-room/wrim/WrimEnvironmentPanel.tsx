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
  phase3a_status?: string
  stage1?: string
  stage1_run_id?: string
  stage2?: string
  stage2_run_id?: string
  controlled_stability_experiment_id?: string
  controlled_stability_decision?: string | null
  ready_for_stage3_design?: string
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
      <p className="text-xs uppercase tracking-widest text-cyan-400">WRIM PyTorch environment · Stage 0 verified · Stage 1 diagnostic · Stage 2 sentinel-stopped · no Train button</p>
      {error ? <p className="text-red-400">{error}</p> : null}
      <article className="grid gap-1 text-xs">
        <p>environment: {status?.WRIM_ENVIRONMENT ?? '…'} · port: {status?.WRIM_PYTORCH_PORT ?? '…'}</p>
        <p>PyTorch: {status?.pytorch ?? '…'} · CUDA detected: {String(status?.cuda_detected ?? false)}</p>
        <p>GPU: {status?.gpu ?? 'n/a'}</p>
        <p>precision: FP32 {precision.FP32 ?? '…'} · TF32 {precision.TF32 ?? '…'} · FP16 {precision.FP16 ?? '…'} · BF16 {precision.BF16 ?? '…'}</p>
        <p>WRIM-0 Stage 0 equivalence: {status?.WRIM_PYTORCH_PORT ?? '…'}</p>
        <p>Stage 1: {status?.stage1 ?? '…'} · run {status?.stage1_run_id ?? 'WRIM1-NEBULA-DIAG-000001'}</p>
        <p>Stage 2: {status?.stage2 ?? '…'} · run {status?.stage2_run_id ?? 'WRIM1-NEBULA-STAB-000001'} · TEST_ONLY · not a promotion candidate</p>
        <p>controlled stability: {status?.controlled_stability_experiment_id ?? 'WRIM1-NEBULA-CTRL-STAB-000001'} · phase2 {String((status as { phase2_experiment_id?: string } | null)?.phase2_experiment_id ?? 'WRIM1-NEBULA-STABILITY-GRID-000001')} · decision {String(status?.controlled_stability_decision ?? 'pending')} · Stage 3 design {String(status?.ready_for_stage3_design ?? 'NO')}</p>
        <p>training authorization: {status?.training_authorization ?? 'OFF'} · train button: {String(status?.train_button ?? false)}</p>
        <p>phase 3A: {status?.phase3a_status ?? 'PHASE3A_COMPLETE'} · Stage 3 design: {String((status as { stage3_design_status?: string } | null)?.stage3_design_status ?? 'ACCEPTED_FOR_PREPARATION')} · Stage 3 authorization: {String((status as { stage3_authorization?: string } | null)?.stage3_authorization ?? 'NO')}</p>
        <p>execution review: {String((status as { stage3_execution_review?: string } | null)?.stage3_execution_review ?? 'PASS')} · trainer: {String((status as { stage3_trainer_status?: string } | null)?.stage3_trainer_status ?? 'IMPLEMENTED_VALIDATED_ZERO_STEP')}</p>
        <p>STAGE3A readiness: {String((status as { stage3a_execution_readiness?: boolean } | null)?.stage3a_execution_readiness ?? false)} · STAGE3B readiness: {String((status as { stage3b_execution_readiness?: boolean } | null)?.stage3b_execution_readiness ?? false)} · suite: {String((status as { stage3_eval_suite_status?: string } | null)?.stage3_eval_suite_status ?? 'AUTHORED_FROZEN')}</p>
        <p>next pass: {status?.next_authorized_pass ?? 'STAGE3A_COMMANDER_AUTHORIZATION_REVIEW'} (Stage 3 not authorized; training OFF; no Train button)</p>
      </article>
      <button type="button" className="rounded border border-cyan-600 px-3 py-1 text-xs" onClick={() => void refresh()}>
        Refresh environment status
      </button>
    </section>
  )
}
