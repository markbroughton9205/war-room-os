'use client'

import type { FoundryEngineeringCapabilitiesView } from '@/lib/native-builder/foundryEngineeringGraduationTypes'

export function FoundryEngineeringCapabilitiesPanel({ view }: { view?: FoundryEngineeringCapabilitiesView | null }) {
  const rows = view?.rows ?? []
  return (
    <section className="rounded border border-cyan-400/20 bg-black/30 p-2" data-testid="foundry-engineering-capabilities" aria-label="Engineering Capabilities">
      <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-cyan-300">Engineering Capabilities</p>
      <p className="text-[10px] text-slate-500">Factual fixture certification. Distinguish REFERENCE VERIFIED from MODEL DRIVEN VERIFIED. Reference harness is not model-driven proof. Production-proven only where a class row records installed production evidence. Not AGI.</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-[10px] text-slate-500">No graduation runs recorded.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map(row => (
            <li
              key={row.projectClass}
              className="flex flex-col gap-0.5 text-[10px]"
              data-testid="foundry-engineering-capability-row"
              data-class={row.projectClass}
              data-proof={row.proofLabel}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="uppercase tracking-widest text-slate-200">{row.label}</span>
                <span className="text-cyan-200">{row.proofLabel === 'UNTESTED' ? row.status : `${row.proofLabel.replace(' VERIFIED', '')} · ${row.status}`}</span>
              </span>
              <span className="text-slate-400">
                {row.modelDrivenDistinctFixturePassCount ?? row.modelDrivenPassCount} model-driven distinct / {row.modelDrivenPassCount} passing
                {row.distinctFixturePassCount !== row.modelDrivenPassCount ? ` · ${row.distinctFixturePassCount} total fixture passes` : ''}
                {row.referencePassCount > 0 ? ` · ${row.referencePassCount} reference` : ''}
              </span>
              {row.provenProviders?.length ? (
                <span className="text-slate-500">
                  Proven with: {row.provenProviders.map((provider, index) => `${provider}${row.provenModels?.[index] ? ` / ${row.provenModels[index]}` : ''}`).join('; ')} — this host/provider only, not universal capability. Not provider-independent.
                </span>
              ) : null}
              {row.projectClass === 'DATABASE_APP' ? (
                <span className="text-slate-500">Recorded technology: SQLite via node:sqlite. Not PostgreSQL certification.</span>
              ) : null}
              {row.projectClass === 'DESKTOP_APP' ? (
                <span className="text-slate-500">Recorded technology: Electron. Not all desktop frameworks.</span>
              ) : null}
              {row.projectClass === 'LIBRARY_PACKAGE' ? (
                <span className="text-slate-500">Recorded technology: Node/JavaScript package. Not Rust/Python library capability.</span>
              ) : null}
              {row.projectClass === 'STATIC_WEB' ? (
                <span className="text-slate-500">Scope: static browser site / no custom backend. Not React/frontend-app certification.</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
