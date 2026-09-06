'use client'

export function CouncilLiveRoundBanner({
  status,
  agents,
  streamingAgent,
  streamingText,
}: {
  status: string
  agents: string[]
  streamingAgent: string | null
  streamingText: string
}) {
  return (
    <div
      className="mb-3 rounded border px-3 py-2"
      style={{ borderColor: 'rgba(52,211,153,0.35)', background: 'rgba(0,20,8,0.55)' }}
      data-testid="council-live-round"
      aria-live="polite"
    >
      <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#86EFAC' }}>
        Nebula Council · {status.replaceAll('_', ' ')}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: '#94A3B8' }}>
        {streamingAgent ? `${streamingAgent} working` : 'ASTRA coordinating'}
        {agents.length ? ` · ${agents.join(' · ')}` : ''}
      </div>
      {streamingText ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
          {streamingText}
          <span className="ml-0.5 animate-pulse" aria-hidden>▍</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-400">ASTRA coordinating…</p>
      )}
    </div>
  )
}
