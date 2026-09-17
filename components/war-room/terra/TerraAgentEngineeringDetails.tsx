'use client'

import { CrossAgentIntegrationPanel } from './CrossAgentIntegrationPanel'
import { NavigationAgentPanel } from './NavigationAgentPanel'
import { WorldLearningAgentPanel } from './WorldLearningAgentPanel'

/** Fixture / engineering controls — Advanced, Inspector, and Terra Workspace only. */
export function TerraAgentEngineeringDetails({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details
      className="pointer-events-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm"
      {...(defaultOpen ? { open: true } : {})}
      data-testid="terra-agent-engineering"
    >
      <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-slate-500">
        Advanced agent tools
      </summary>
      <div className="mt-2 max-h-[min(28rem,46vh)] space-y-2 overflow-y-auto overscroll-contain pr-1">
        <NavigationAgentPanel compact />
        <WorldLearningAgentPanel compact />
        <CrossAgentIntegrationPanel compact />
      </div>
    </details>
  )
}
