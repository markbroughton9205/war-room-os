'use client'

import { useCallback, useEffect, useState } from 'react'

type LabStatus = {
  status?: string
  bind?: string
  ports?: Record<string, number>
  report_present?: boolean
  classification?: string | null
  run000005?: {
    imported?: boolean
    status?: string
    stream_sha?: string
    recipe_sha?: string
    steps?: Array<{ step: number; had_compact?: boolean }>
  } | null
  services?: Record<string, { port?: number; up?: boolean; bind?: string }> | null
  checkpoint_format_v1?: string
  checkpoint_format_v2?: string
  training_authorization?: string
}

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
  wrim_lab?: LabStatus
}

const TABS = ['OVERVIEW', 'RUNS', 'COMPARE', 'TRAINING', 'EVALUATION', 'PROFILER', 'DATA', 'ARTIFACTS', 'HARDWARE'] as const
type Tab = (typeof TABS)[number]

export function WrimEnvironmentPanel() {
  const [status, setStatus] = useState<EnvStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('OVERVIEW')

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wrim-environment/status')
    const json = (await res.json()) as EnvStatus
    setStatus(json)
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refresh().catch(err => setError(err instanceof Error ? err.message : String(err))))
  }, [refresh])

  const precision = status?.precision ?? {}
  const lab = status?.wrim_lab
  const ports = lab?.ports ?? {}

  return (
    <section className="space-y-3 rounded border border-cyan-800 bg-zinc-950 p-4 text-sm text-cyan-100">
      <p className="text-xs uppercase tracking-widest text-cyan-400">WRIM PyTorch environment · WRIM Lab · Stage 0 verified · no Train button</p>
      {error ? <p className="text-red-400">{error}</p> : null}
      <article className="grid gap-1 text-xs">
        <p>environment: {status?.WRIM_ENVIRONMENT ?? '…'} · port: {status?.WRIM_PYTORCH_PORT ?? '…'}</p>
        <p>PyTorch: {status?.pytorch ?? '…'} · CUDA detected: {String(status?.cuda_detected ?? false)}</p>
        <p>GPU: {status?.gpu ?? 'n/a'}</p>
        <p>precision: FP32 {precision.FP32 ?? '…'} · TF32 {precision.TF32 ?? '…'} · FP16 {precision.FP16 ?? '…'} · BF16 {precision.BF16 ?? '…'}</p>
        <p>WRIM-0 Stage 0 equivalence: {status?.WRIM_PYTORCH_PORT ?? '…'}</p>
        <p>Stage 1: {status?.stage1 ?? '…'} · run {status?.stage1_run_id ?? 'WRIM1-NEBULA-DIAG-000001'}</p>
        <p>Stage 2: {status?.stage2 ?? '…'} · run {status?.stage2_run_id ?? 'WRIM1-NEBULA-STAB-000001'} · TEST_ONLY · not a promotion candidate</p>
        <p>training authorization: {status?.training_authorization ?? 'OFF'} · train button: {String(status?.train_button ?? false)}</p>
        <p>phase 3A: {status?.phase3a_status ?? 'PHASE3A_COMPLETE'} · Stage 3 authorization: {String((status as { stage3_authorization?: string } | null)?.stage3_authorization ?? 'NO')}</p>
        <p>next pass: {status?.next_authorized_pass ?? 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN'} (P2-NEXT-A recipe frozen only; TRAINING_AUTHORIZATION OFF; STAGE3B not authorized; no Train button)</p>
      </article>

      <div className="border-t border-cyan-900 pt-3">
        <p className="mb-2 text-xs uppercase tracking-widest text-cyan-400">WRIM Lab · local-first · loopback dashboards behind these tabs</p>
        <p className="mb-2 text-xs">classification: {lab?.classification ?? '…'} · report: {String(lab?.report_present ?? false)} · bind {lab?.bind ?? '127.0.0.1'}</p>
        <div className="mb-3 flex flex-wrap gap-1">
          {TABS.map(name => (
            <button
              key={name}
              type="button"
              className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide ${tab === name ? 'border-cyan-300 bg-cyan-950 text-cyan-100' : 'border-cyan-800 text-cyan-400'}`}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <LabTab tab={tab} lab={lab} ports={ports} />
      </div>

      <button type="button" className="rounded border border-cyan-600 px-3 py-1 text-xs" onClick={() => void refresh()}>
        Refresh environment status
      </button>
    </section>
  )
}

function LabTab({ tab, lab, ports }: { tab: Tab; lab?: LabStatus; ports: Record<string, number> }) {
  const run5 = lab?.run000005
  if (tab === 'OVERVIEW') {
    return (
      <div className="grid gap-1 text-xs">
        <p>Aim = experiment explorer · TensorBoard = live curves · MLflow = lifecycle registry (not promotion authority)</p>
        <p>DuckDB = analytics · Prometheus = machine telemetry · DVC = lineage · Safetensors = future weights · LM Harness = external lane only</p>
        <p>checkpoint formats: {lab?.checkpoint_format_v1 ?? 'WRIM_CHECKPOINT_SPLIT_V1'} (historical) · {lab?.checkpoint_format_v2 ?? 'WRIM_CHECKPOINT_FORMAT_V2'} (future, non-destructive)</p>
        <p>training authorization inside lab: {lab?.training_authorization ?? 'OFF'}</p>
      </div>
    )
  }
  if (tab === 'RUNS') {
    return (
      <div className="grid gap-1 text-xs">
        <p>WRIM1-RUN-000005: {run5?.status ?? '…'} · imported {String(run5?.imported ?? false)} · IMPORTED_HISTORICAL</p>
        <p>stream {run5?.stream_sha ?? '…'}</p>
        <p>recipe {run5?.recipe_sha ?? '…'}</p>
        <p>trajectory steps: {(run5?.steps ?? []).map(s => s.step).join(', ') || '0, 5, 10, 25, 50'}</p>
        <p>older runs WRIM-0 / 000001–000004 import as IMPORTED_HISTORICAL metadata. Missing metrics stay UNKNOWN.</p>
      </div>
    )
  }
  if (tab === 'COMPARE') {
    return (
      <div className="grid gap-1 text-xs">
        <p>Compare WRIM-0, RUN-000003, RUN-000004, RUN-000005 in Aim (primary explorer) at 127.0.0.1:{ports.aim ?? 43880} when the lab service is started.</p>
        <p>MLflow registry at 127.0.0.1:{ports.mlflow ?? 43882} holds lifecycle tags only. War Room governance remains authoritative.</p>
      </div>
    )
  }
  if (tab === 'TRAINING') {
    return (
      <div className="grid gap-1 text-xs">
        <p>TRAINING_AUTHORIZATION is OFF. This lab does not run optimizer steps.</p>
        <p>TensorBoard scalars/histograms: 127.0.0.1:{ports.tensorboard ?? 43881} · histograms only in OBSERVABILITY_DIAGNOSTIC at cadence 50.</p>
      </div>
    )
  }
  if (tab === 'EVALUATION') {
    return (
      <div className="grid gap-1 text-xs">
        <p>PRIMARY: sovereign WRIM evals (SOVEREIGN_EVAL). EXTERNAL: EleutherAI LM Evaluation Harness (EXTERNAL_STANDARD_EVAL).</p>
        <p>Starter external tasks for a ~19.2M decoder: wikitext, lambada_openai. No MMLU/GSM8K this pass. Harness cannot promote a model.</p>
      </div>
    )
  }
  if (tab === 'PROFILER') {
    return (
      <div className="grid gap-1 text-xs">
        <p>PyTorch Profiler is on-demand only (2–4 steps). It must not silently change the scientific recipe.</p>
        <p>Official scientific runs use OBSERVABILITY_STANDARD.</p>
      </div>
    )
  }
  if (tab === 'DATA') {
    return (
      <div className="grid gap-1 text-xs">
        <p>DuckDB in-process warehouse + Parquet under AppData wrim-environment/sovereign-lab/analytics.</p>
        <p>Views: wrim_runs, wrim_steps, wrim_checkpoints, wrim_eval_results. Canonical IDs/hashes are referenced, not duplicated as authority.</p>
      </div>
    )
  }
  if (tab === 'ARTIFACTS') {
    return (
      <div className="grid gap-1 text-xs">
        <p>DVC tracks large-artifact identity locally. Git keeps pointers. Existing WRIM files are not moved or deleted.</p>
        <p>Safetensors V2 is defined for future weights. Historical checkpoints remain readable in V1 / WRIM-0 combined format.</p>
      </div>
    )
  }
  return (
    <div className="grid gap-1 text-xs">
      <p>Prometheus 127.0.0.1:{ports.prometheus ?? 43883} scrapes WRIM exporter 127.0.0.1:{ports.wrim_exporter ?? 43884}.</p>
      <p>GPU via nvidia-smi · CPU/RAM/disk · Core :3847 · UI :3848 · Ollama :11434. Loopback only. No Grafana. Prometheus cannot control training.</p>
      <p>Services are War Room-managed subprocesses. They do not auto-start with Windows.</p>
    </div>
  )
}
