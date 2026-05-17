'use client'

import { memo, useEffect, useState } from 'react'

import type { ConfigurationStatus } from '@/lib/configuration/configurationRegistry'
import type { ConfigurationSweep } from '@/lib/configuration/configurationHealth'

type SweepState =
  | { phase: 'loading'; data: null; error: null }
  | { phase: 'ready'; data: ConfigurationSweep; error: null }
  | { phase: 'error'; data: null; error: string }

function statusColor(status: ConfigurationStatus): string {
  switch (status) {
    case 'ready':
    case 'configured':
      return '#34D399'
    case 'degraded':
      return '#FBBF24'
    case 'missing_api_key':
    case 'missing_provider':
      return '#FB923C'
    case 'disabled_by_operator':
      return '#A78BFA'
    case 'unavailable':
      return '#F87171'
  }
}

function statusLabel(status: ConfigurationStatus): string {
  return status.replaceAll('_', ' ')
}

function useConfigurationSweep(): SweepState {
  const [state, setState] = useState<SweepState>({ phase: 'loading', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/configuration/sweep', { cache: 'no-store' })
        const json = await res.json() as ConfigurationSweep & { message?: string }
        if (!res.ok) throw new Error(json.message || 'Configuration sweep failed')
        if (!cancelled) setState({ phase: 'ready', data: json, error: null })
      } catch (error) {
        if (!cancelled) {
          setState({
            phase: 'error',
            data: null,
            error: error instanceof Error ? error.message : 'Configuration sweep failed',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

export const ConfigurationHealthSummaryPanel = memo(function ConfigurationHealthSummaryPanel() {
  const state = useConfigurationSweep()

  if (state.phase === 'loading') {
    return (
      <section className="mb-3 rounded border border-white/10 px-3 py-3 text-[10px]" style={{ color: '#64748B' }}>
        Loading configuration health…
      </section>
    )
  }

  if (state.phase === 'error') {
    return (
      <section className="mb-3 rounded border border-red-500/25 px-3 py-3 text-[10px]" style={{ color: '#FCA5A5' }}>
        Configuration health unavailable: {state.error}
      </section>
    )
  }

  const { summary } = state.data

  return (
    <section className="mb-3 rounded border border-emerald-500/15 bg-emerald-950/5 px-3 py-3 text-[10px]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-bold uppercase tracking-widest" style={{ color: '#34D399' }}>Configuration Health</div>
          <div className="mt-1 uppercase tracking-widest" style={{ color: '#64748B' }}>
            Env presence only · checked {new Date(summary.checkedAt).toLocaleTimeString()}
          </div>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        <div className="rounded border border-white/10 px-2 py-2">
          <div style={{ color: '#64748B' }}>CONFIGURED</div>
          <div className="mt-1 font-bold" style={{ color: '#34D399' }}>{summary.totalProvidersConfigured}/{summary.totalProviders}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-2">
          <div style={{ color: '#64748B' }}>MISSING</div>
          <div className="mt-1 font-bold" style={{ color: '#FB923C' }}>{summary.missingProviders}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-2">
          <div style={{ color: '#64748B' }}>DEGRADED</div>
          <div className="mt-1 font-bold" style={{ color: '#FBBF24' }}>{summary.degradedSystems}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-2">
          <div style={{ color: '#64748B' }}>BLOCKERS</div>
          <div className="mt-1 font-bold" style={{ color: summary.criticalBlockers.length ? '#F87171' : '#34D399' }}>{summary.criticalBlockers.length}</div>
        </div>
        <div className="rounded border border-white/10 px-2 py-2">
          <div style={{ color: '#64748B' }}>OPTIONAL</div>
          <div className="mt-1 font-bold" style={{ color: '#93C5FD' }}>{summary.optionalEnhancements.length}</div>
        </div>
      </div>
      {summary.criticalBlockers.length ? (
        <div className="mt-2 rounded border border-red-500/20 px-2 py-2" style={{ color: '#FCA5A5' }}>
          <div className="mb-1 font-bold uppercase tracking-widest">Critical Blockers</div>
          <ul className="space-y-1">
            {summary.criticalBlockers.slice(0, 5).map(blocker => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      ) : null}
      {summary.optionalEnhancements.length ? (
        <div className="mt-2 text-[9px]" style={{ color: '#94A3B8' }}>
          Optional enhancements: {summary.optionalEnhancements.slice(0, 4).join(' · ')}
        </div>
      ) : null}
    </section>
  )
})

export const ConfigurationSweepPanel = memo(function ConfigurationSweepPanel() {
  const state = useConfigurationSweep()
  const [providerTableOpen, setProviderTableOpen] = useState(false)

  if (state.phase === 'loading') {
    return (
      <section className="rounded border border-white/10 px-3 py-3 text-[10px]" style={{ color: '#64748B' }}>
        Loading configuration sweep…
      </section>
    )
  }

  if (state.phase === 'error') {
    return (
      <section className="rounded border border-red-500/25 px-3 py-3 text-[10px]" style={{ color: '#FCA5A5' }}>
        Configuration sweep unavailable: {state.error}
      </section>
    )
  }

  const { providers, tabs, missingProviderGuide, checkedAt } = state.data

  return (
    <section className="mb-4 rounded border border-sky-500/20 bg-slate-950/30 px-3 py-3 text-[10px]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold uppercase tracking-widest" style={{ color: '#7DD3FC' }}>Configuration Sweep</div>
          <div className="mt-1 uppercase tracking-widest" style={{ color: '#64748B' }}>
            Provider setup audit · env names only · checked {new Date(checkedAt).toLocaleTimeString()}
          </div>
        </div>
      </div>

      <div className="mb-3 grid gap-2 md:grid-cols-4">
        {tabs.map(tab => (
          <details key={tab.id} className="rounded border border-white/10 bg-black/20 px-2 py-2">
            <summary className="cursor-pointer list-none">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold tracking-widest" style={{ color: '#E5E7EB' }}>{tab.name}</span>
                <span className="uppercase tracking-widest" style={{ color: statusColor(tab.status) }}>{statusLabel(tab.status)}</span>
              </div>
              <div className="mt-1" style={{ color: '#64748B' }}>{tab.configuredProviders}/{tab.totalProviders} providers configured</div>
            </summary>
            <div className="mt-2 border-t border-white/10 pt-2 leading-relaxed" style={{ color: '#94A3B8' }}>
              <div>{tab.description}</div>
              {tab.criticalBlockers.length ? <div className="mt-1" style={{ color: '#FCA5A5' }}>Blockers: {tab.criticalBlockers.join(' · ')}</div> : null}
              {tab.missingProviders.length ? <div className="mt-1" style={{ color: '#FDBA74' }}>Missing: {tab.missingProviders.join(' · ')}</div> : null}
            </div>
          </details>
        ))}
      </div>

      <details
        className="rounded border border-white/10 bg-black/20 px-3 py-2"
        onToggle={event => setProviderTableOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-bold uppercase tracking-widest" style={{ color: '#7DD3FC' }}>
          Provider detail table ({providers.length}) {providerTableOpen ? 'expanded' : 'deferred'}
        </summary>
        {providerTableOpen ? (
          <div className="mt-3 overflow-x-auto rounded border border-white/10">
            <table className="w-full min-w-[1120px] border-collapse text-left text-[10px]">
              <thead style={{ color: '#94A3B8' }}>
                <tr className="border-b border-white/10">
                  <th className="px-2 py-2 font-bold tracking-widest">PROVIDER</th>
                  <th className="px-2 py-2 font-bold tracking-widest">STATUS</th>
                  <th className="px-2 py-2 font-bold tracking-widest">ENV VAR NAMES</th>
                  <th className="px-2 py-2 font-bold tracking-widest">ALIAS</th>
                  <th className="px-2 py-2 font-bold tracking-widest">CONFIGURED</th>
                  <th className="px-2 py-2 font-bold tracking-widest">LAST CHECK</th>
                  <th className="px-2 py-2 font-bold tracking-widest">MISSING DEPENDENCY</th>
                  <th className="px-2 py-2 font-bold tracking-widest">AFFECTED FEATURES</th>
                  <th className="px-2 py-2 font-bold tracking-widest">NEXT ACTION</th>
                </tr>
              </thead>
              <tbody style={{ color: '#CBD5E1' }}>
                {providers.map(provider => (
                  <tr key={provider.id} className="border-b border-white/5 align-top">
                    <td className="px-2 py-2 font-bold" style={{ color: '#E5E7EB' }}>{provider.name}</td>
                    <td className="px-2 py-2 uppercase tracking-widest" style={{ color: statusColor(provider.status) }}>{statusLabel(provider.status)}</td>
                    <td className="px-2 py-2 font-mono" style={{ color: '#FDBA74' }}>
                      {[...provider.requiredEnvVars, ...provider.optionalEnvVars].join(', ') || 'none'}
                    </td>
                    <td className="px-2 py-2 leading-snug" style={{ color: provider.aliasDetected ? '#FBBF24' : '#94A3B8' }}>
                      {provider.preferredEnvName
                        ? `Preferred: ${provider.preferredEnvName}; alias detected: ${String(provider.aliasDetected)}`
                        : 'none'}
                    </td>
                    <td className="px-2 py-2" style={{ color: provider.configured ? '#34D399' : '#F87171' }}>{String(provider.configured)}</td>
                    <td className="px-2 py-2 leading-snug" style={{ color: '#94A3B8' }}>{provider.lastCheckResult}</td>
                    <td className="px-2 py-2 leading-snug" style={{ color: provider.missingDependency ? '#FCA5A5' : '#64748B' }}>{provider.missingDependency ?? 'none'}</td>
                    <td className="px-2 py-2 leading-snug">{provider.affectedFeatures.join(', ')}</td>
                    <td className="px-2 py-2 leading-snug" style={{ color: '#BAE6FD' }}>{provider.recommendedNextAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-2 text-[9px] uppercase tracking-widest" style={{ color: '#64748B' }}>
            Full provider diagnostics are lazy-rendered until expanded to keep tab switching responsive.
          </div>
        )}
      </details>

      {missingProviderGuide.length ? (
        <details className="mt-3 rounded border border-amber-500/20 bg-amber-950/5 px-3 py-2">
          <summary className="cursor-pointer font-bold uppercase tracking-widest" style={{ color: '#FBBF24' }}>
            Missing Provider Guide ({missingProviderGuide.length})
          </summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {missingProviderGuide.map(entry => (
              <div key={entry.providerId} className="rounded border border-white/10 px-2 py-2 leading-relaxed">
                <div className="font-bold" style={{ color: statusColor(entry.status) }}>{entry.providerName} · {statusLabel(entry.status)}</div>
                <div className="mt-1" style={{ color: '#CBD5E1' }}>Powers: {entry.whatItPowers.join(', ')}</div>
                <div className="mt-1 font-mono" style={{ color: '#FDBA74' }}>Required env: {entry.requiredEnvVarNames.join(', ') || 'none'}</div>
                <div className="mt-1" style={{ color: '#94A3B8' }}>Configure: {entry.whereToConfigure}</div>
                <div className="mt-1" style={{ color: '#BAE6FD' }}>{entry.recommendedNextAction}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
})
