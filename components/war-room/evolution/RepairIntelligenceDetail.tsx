'use client'

import type { RepairIntelligenceItem, RepairIntelligenceSection, RepairIntelligenceSnapshot } from '@/lib/evolution/types'

const SECTION_LABELS: Record<RepairIntelligenceSection, string> = {
  system_readiness: 'System Readiness',
  missing_configuration: 'Missing Configuration',
  required_migrations: 'Required Migrations',
  provider_issues: 'Provider Issues',
  schema_drift: 'Schema Drift',
  runtime_degradation: 'Runtime Degradation',
  repair_queue: 'Repair Queue',
  next_required_action: 'Next Required Action',
}

const SECTION_ORDER: RepairIntelligenceSection[] = [
  'system_readiness',
  'missing_configuration',
  'required_migrations',
  'provider_issues',
  'schema_drift',
  'runtime_degradation',
  'repair_queue',
  'next_required_action',
]

function severityColor(severity: string): string {
  if (severity === 'BLOCKER') return '#F87171'
  if (severity === 'HIGH') return '#FB923C'
  if (severity === 'MEDIUM') return '#FBBF24'
  if (severity === 'LOW') return '#38BDF8'
  return '#94A3B8'
}

function RepairRow({ item }: { item: RepairIntelligenceItem }) {
  return (
    <article className="rounded border border-white/10 bg-black/20 p-2">
      <ItemHeader item={item} />
      <p className="mt-1 text-[9px] text-slate-400">
        {item.affectedPanel}
        {item.affectedRoute ? ` · ${item.affectedRoute}` : ''}
      </p>
      {item.evidence.length ? (
        <ul className="mt-2 space-y-0.5 text-[8px] text-slate-500">
          {item.evidence.slice(0, 4).map(line => (
            <li key={`${item.id}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {item.dependencyChain.length ? (
        <p className="mt-1 text-[8px] text-slate-600">Depends on: {item.dependencyChain.join(' → ')}</p>
      ) : null}
      {item.suggestedFiles.length ? (
        <p className="mt-1 font-mono text-[8px] text-slate-500">Files: {item.suggestedFiles.slice(0, 4).join(', ')}</p>
      ) : null}
      {item.suggestedSqlMigration ? (
        <p className="mt-1 text-[8px] text-amber-200/80">{item.suggestedSqlMigration}</p>
      ) : null}
      {item.validationCommands.length ? (
        <p className="mt-1 font-mono text-[8px] text-slate-600">Validate: {item.validationCommands.join(' · ')}</p>
      ) : null}
    </article>
  )
}

function ItemHeader({ item }: { item: RepairIntelligenceItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className="rounded px-1 py-0.5 text-[7px] font-bold uppercase tracking-widest"
        style={{ color: severityColor(item.severity), border: `1px solid ${severityColor(item.severity)}44` }}
      >
        {item.severity}
      </span>
      <span className="text-[8px] uppercase tracking-widest text-slate-500">{item.issueType.replace(/_/g, ' ')}</span>
      {item.repairPacketAvailable ? (
        <span className="text-[7px] uppercase tracking-widest text-violet-300">packet</span>
      ) : null}
      <h4 className="w-full text-[10px] font-semibold text-slate-200">{item.title}</h4>
    </div>
  )
}

export function RepairIntelligenceDetail({ snapshot }: { snapshot: RepairIntelligenceSnapshot }) {
  return (
    <div className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-1">
      {SECTION_ORDER.map(section => {
        const items = snapshot.sections[section]
        if (!items.length) return null
        return (
          <section key={section}>
            <h3 className="text-[8px] font-bold uppercase tracking-widest text-slate-400">
              {SECTION_LABELS[section]} ({items.length})
            </h3>
            <div className="mt-1 space-y-1">
              {items.map(item => (
                <RepairRow key={item.id} item={item} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
