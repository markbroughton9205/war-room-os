'use client'

import { actionsForContext, type FoundryContextKind } from '@/lib/native-builder/foundryUxContract'

export type FoundryContextMenuState = {
  kind: FoundryContextKind
  x: number
  y: number
  target: string
} | null

export function FoundryContextMenu({
  menu,
  onClose,
  onAction,
}: {
  menu: FoundryContextMenuState
  onClose: () => void
  onAction: (action: string, target: string, kind: FoundryContextKind) => void
}) {
  if (!menu) return null
  const items = actionsForContext(menu.kind)
  return (
    <div
      data-testid="foundry-context-menu"
      className="fixed z-50 min-w-[200px] rounded border border-white/15 bg-neutral-950 py-1 shadow-2xl"
      style={{ left: menu.x, top: menu.y }}
      onMouseLeave={onClose}
    >
      <p className="truncate px-3 pb-1 pt-1 text-[9px] uppercase tracking-widest text-slate-500">{menu.target}</p>
      {items.map(action => (
        <button
          key={action}
          type="button"
          className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-200 hover:bg-emerald-950/60 hover:text-emerald-200"
          onClick={() => {
            onAction(action, menu.target, menu.kind)
            onClose()
          }}
        >
          {action}
        </button>
      ))}
    </div>
  )
}
