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
      className="fixed z-50 min-w-[220px] rounded-lg border border-emerald-400/30 bg-black/90 py-1 shadow-[0_0_24px_rgba(0,255,140,0.12)] backdrop-blur-md"
      style={{ left: menu.x, top: menu.y }}
      onMouseLeave={onClose}
    >
      <p className="truncate px-3 pb-1 pt-1 text-[9px] uppercase tracking-widest text-emerald-500/70">{menu.target}</p>
      {items.map(action => (
        <button
          key={action}
          type="button"
          className="block w-full px-3 py-1.5 text-left text-[12px] text-emerald-100 hover:bg-emerald-950/70 hover:text-emerald-200"
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
