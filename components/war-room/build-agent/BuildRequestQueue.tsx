import type { ReactNode } from 'react'
import type { BuildRequest } from '@/lib/build-agent/types'

const statusTone: Record<BuildRequest['status'], string> = {
  drafted: 'text-slate-400 border-slate-600/50',
  reviewing: 'text-sky-300 border-sky-500/40',
  ready: 'text-sky-200/90 border-sky-400/35',
  blocked: 'text-amber-400 border-amber-500/40',
  completed: 'text-[#d4af37] border-[#d4af37]/35',
}

const priorityTone: Record<BuildRequest['priority'], string> = {
  low: 'text-slate-500',
  medium: 'text-sky-300/90',
  high: 'text-rose-300/90',
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-600">{label}</p>
      <div className="mt-1 text-sm text-slate-200">{children}</div>
    </div>
  )
}

export function BuildRequestQueue({ requests }: { requests: BuildRequest[] }) {
  if (requests.length === 0) {
    return (
      <div>
        <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-[#00ff41]/90">
          Build request queue
        </h3>
        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center font-mono text-sm text-slate-500">
          No build requests created yet.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-[#00ff41]/90">
        Build request queue
      </h3>

      {/* Mobile: stacked cards */}
      <div className="space-y-3 md:hidden">
        {requests.map((req) => (
          <article
            key={req.id}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-4 font-mono text-xs backdrop-blur-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-[10px] uppercase tracking-widest text-slate-500">{req.request_id}</p>
              <span
                className={[
                  'rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                  statusTone[req.status],
                ].join(' ')}
              >
                {req.status}
              </span>
            </div>
            {req.local_only && (
              <p className="mt-2 text-[10px] uppercase tracking-widest text-amber-400/90">Local draft only</p>
            )}
            <p className="mt-2 text-sm font-semibold tracking-tight text-white">{req.title}</p>
            <p className="mt-1 text-slate-400">{req.description || '—'}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Type">{req.type}</Field>
              <Field label="Priority">
                <span className={priorityTone[req.priority]}>{req.priority}</span>
              </Field>
              <Field label="Assigned">{req.assigned_agent ?? '—'}</Field>
              <Field label="Created">{new Date(req.created_at).toLocaleString()}</Field>
            </div>
          </article>
        ))}
      </div>

      {/* md+: horizontal scroll table */}
      <div className="-mx-1 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[56rem] border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-[0.2em] text-slate-500">
              <th className="px-3 py-2 font-medium">request_id</th>
              <th className="px-3 py-2 font-medium">title</th>
              <th className="px-3 py-2 font-medium">description</th>
              <th className="px-3 py-2 font-medium">type</th>
              <th className="px-3 py-2 font-medium">status</th>
              <th className="px-3 py-2 font-medium">assigned_agent</th>
              <th className="px-3 py-2 font-medium">created_at</th>
              <th className="px-3 py-2 font-medium">priority</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <tr key={req.id} className="border-b border-white/[0.06] text-slate-300">
                <td className="whitespace-nowrap px-3 py-2.5 text-[#d4af37]/90">{req.request_id}</td>
                <td className="max-w-[10rem] truncate px-3 py-2.5 text-white" title={req.title}>
                  {req.title}
                </td>
                <td className="max-w-[14rem] truncate px-3 py-2.5 text-slate-400" title={req.description || ''}>
                  {req.description || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">{req.type}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span
                    className={[
                      'inline-block rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                      statusTone[req.status],
                    ].join(' ')}
                  >
                    {req.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[#FFD700]/85">{req.assigned_agent ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{req.created_at}</td>
                <td className={`whitespace-nowrap px-3 py-2.5 font-medium ${priorityTone[req.priority]}`}>
                  {req.priority}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
