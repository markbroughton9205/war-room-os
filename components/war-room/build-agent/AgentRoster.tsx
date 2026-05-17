import type { BuildAgentDefinition } from '@/lib/build-agent/types'

const cardClass =
  'rounded-xl border border-white/10 bg-black/40 p-4 shadow-[inset_0_0_0_1px_rgba(255,215,0,0.06),0_12px_40px_-20px_rgba(0,0,0,0.75)] backdrop-blur-sm'

function connectionTone(label: BuildAgentDefinition['connection_label']) {
  if (label === 'Available/manual') return 'text-emerald-300'
  if (label === 'Future integration') return 'text-slate-500'
  if (label === 'Standby') return 'text-slate-400'
  return 'text-slate-500'
}

export function AgentRoster({ agents }: { agents: BuildAgentDefinition[] }) {
  return (
    <div>
      <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-[#00ff41]/90">
        Agent roster
      </h3>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {agents.map((agent) => (
          <li key={agent.id} className={cardClass}>
            <p className="font-mono text-sm font-semibold tracking-tight text-[#FFD700]">{agent.name}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">{agent.role}</p>
            <p className={`mt-3 font-mono text-[10px] uppercase tracking-[0.2em] ${connectionTone(agent.connection_label)}`}>
              {agent.connection_label}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
