'use client'

import type { FoundryResourceView } from '@/lib/native-builder/foundryResourceGovernorTypes'

function meter(used: number, limit: number | null, kind: 'tokens' | 'calls' | 'ms'): string {
  if (kind === 'ms') {
    const usedM = Math.round(used / 60000)
    const limitM = limit != null ? Math.round(limit / 60000) : null
    return limitM == null ? `${usedM}m` : `${usedM}m / ${limitM}m`
  }
  if (kind === 'tokens') {
    const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))
    return limit == null ? fmt(used) : `${fmt(used)} / ${fmt(limit)}`
  }
  return limit == null ? String(used) : `${used} / ${limit}`
}

export function FoundryResourceGovernorPanel({
  view,
  advanced,
  onExtend,
}: {
  view?: FoundryResourceView | null
  advanced?: boolean
  onExtend?: () => void
}) {
  if (!view || view.status === 'NONE') return null
  return (
    <div className="mt-2 rounded border border-cyan-400/20 p-2" data-testid="foundry-resources" aria-label="Mission resources">
      <p className="text-[9px] uppercase tracking-widest text-cyan-300">RESOURCES</p>
      {view.warning ? (
        <p
          className={`text-[10px] uppercase tracking-widest ${view.warning.includes('EXHAUSTED') ? 'text-red-300' : 'text-amber-300'}`}
          data-testid="foundry-resource-warning"
        >
          {view.warning === 'RESOURCE BUDGET EXHAUSTED' ? 'RESOURCE BUDGET EXHAUSTED' : view.warning === 'RESOURCE BUDGET 80% USED' ? 'RESOURCE BUDGET 80% USED' : view.warning}
          {view.warning.includes('80%') ? ' Foundry will continue within remaining authorized budget.' : ' Commander action required.'}
        </p>
      ) : null}
      <p className="text-[10px] text-slate-300">Tokens: {meter(view.tokensUsed, view.tokensLimit, 'tokens')}</p>
      <p className="text-[10px] text-slate-300">Model calls: {meter(view.modelCallsUsed, view.modelCallsLimit, 'calls')}</p>
      <p className="text-[10px] text-slate-300">Wall time: {meter(view.wallMsUsed, view.wallMsLimit, 'ms')}</p>
      <p className="text-[10px] text-slate-300">Tests: {meter(view.testsUsed, view.testsLimit, 'calls')}</p>
      <p className="text-[10px] text-slate-300">Replans: {meter(view.replansUsed, view.replansLimit, 'calls')}</p>
      <p className="text-[10px] text-slate-300" data-testid="foundry-resource-cost">
        {view.localProvider ? 'REMOTE COST: $0.00' : view.remoteCostLabel === 'COST UNKNOWN' ? 'Remote cost: COST UNKNOWN' : `Remote cost: ${view.remoteCostLabel}`}
      </p>
      {view.localProvider ? <p className="text-[9px] text-slate-500">Local execution still consumes tokens, calls, and wall time.</p> : null}
      {view.warning === 'RESOURCE BUDGET EXHAUSTED' && onExtend ? (
        <button type="button" className="mt-1 rounded border border-amber-400/40 px-2 py-0.5 text-[9px] uppercase text-amber-200" data-testid="foundry-extend-budget" onClick={onExtend}>
          Extend Budget
        </button>
      ) : null}
      {advanced && view.providers.length ? (
        <div className="mt-1" data-testid="foundry-resource-advanced">
          {view.providers.map(item => (
            <p key={`${item.provider}:${item.model}`} className="text-[9px] text-slate-500">
              {item.provider}/{item.model} calls {item.calls} tokens {item.tokens} {item.costLabel}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
