'use client'

type PersistenceTruth = {
  status?: string
  backend?: string
  readable?: boolean
  writable?: boolean
  store_path?: string
  last_readback_at?: string | null
}

type GodsEyeTruth = {
  configured?: boolean
  registered?: boolean
  healthy?: boolean
  terra_linked?: boolean
  status?: string
  capability_count?: number
  runtime_owner?: string
}

export type RuntimeTruthSnapshot = {
  status?: string
  persistence?: PersistenceTruth | null
  godsEye?: GodsEyeTruth | null
}

export function RuntimeTruthDetails({ truth }: { truth: RuntimeTruthSnapshot | null }) {
  const persistence = truth?.persistence
  const godsEye = truth?.godsEye
  return (
    <details className="mt-3 rounded border border-emerald-900/30" style={{ background: 'rgba(0,0,0,0.24)' }} data-testid="runtime-truth-details">
      <summary className="cursor-pointer px-3 py-2 text-[9px] font-bold uppercase tracking-widest" style={{ color: '#86EFAC' }}>
        Runtime Details
      </summary>
      <div className="space-y-2 px-3 pb-3 text-[10px] uppercase tracking-widest text-slate-300">
        <p data-testid="runtime-global-status">Global {truth?.status ?? 'STARTING'}</p>
        <p data-testid="runtime-persistence-status">
          Persistence {persistence?.status ?? 'UNKNOWN'} · {persistence?.backend ?? 'none'} · read {persistence?.readable ? 'yes' : 'no'} · write {persistence?.writable ? 'yes' : 'no'}
        </p>
        <p data-testid="runtime-persistence-store">Store {persistence?.store_path ?? 'unresolved'} · readback {persistence?.last_readback_at ?? 'none'}</p>
        <p data-testid="runtime-gods-eye-status">
          God&apos;s Eye {godsEye?.status ?? 'UNKNOWN'} · configured {godsEye?.configured ? 'yes' : 'no'} · registered {godsEye?.registered ? 'yes' : 'no'} · health {godsEye?.healthy ? 'yes' : 'no'} · Terra linked {godsEye?.terra_linked ? 'yes' : 'no'} · capabilities {godsEye?.capability_count ?? 0} · owner {godsEye?.runtime_owner ?? 'terra'}
        </p>
      </div>
    </details>
  )
}
