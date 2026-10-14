'use client'

import { HELP } from '@/lib/agents/ops/engineering/reverse/help'

const TONE = { AVAILABLE: 'bg-green-800', NOT_IN_THIS_BUILD: 'bg-gray-600', FUTURE: 'bg-fuchsia-800' } as const
const LABEL = { AVAILABLE: 'available', NOT_IN_THIS_BUILD: 'not in this build', FUTURE: 'future' } as const

/** Learn Foundry: what each control does in this build, in plain language. Controls that do not exist here say so. */
export function FoundryHelp() {
  return (
    <section data-testid="foundry-help" className="mb-8">
      <h2 className="text-lg border-b border-gray-700 mb-2">Learn Foundry</h2>
      <p className="text-xs text-gray-400 mb-3">What the controls do in this build. Hover a control anywhere in Foundry for a one-line hint; this panel has the longer explanation.</p>
      {HELP.map((h) => (
        <details key={h.id} data-testid={`help-${h.id}`} className="mb-1 border border-gray-700 p-2 text-sm">
          <summary className="cursor-pointer"><span className="font-medium">{h.title}</span> <span className={`text-[10px] px-1 ml-1 ${TONE[h.status]}`}>{LABEL[h.status]}</span> <span className="text-xs text-gray-400 ml-2">{h.short}</span></summary>
          <div className="mt-1 text-xs text-gray-300">{h.body.map((p, i) => <p key={i} className="mb-1">{p}</p>)}</div>
        </details>
      ))}
    </section>
  )
}
