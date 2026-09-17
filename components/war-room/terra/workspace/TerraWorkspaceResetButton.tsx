'use client'

import { useTerraWorkspaceReset } from './TerraWorkspaceLayoutProvider'

export function TerraWorkspaceResetButton() {
  const reset = useTerraWorkspaceReset()
  return (
    <button
      type="button"
      onClick={reset}
      className="w-full rounded border border-cyan-300/35 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-300/10"
      data-testid="terra-workspace-reset-layout"
    >
      Reset layout
    </button>
  )
}
