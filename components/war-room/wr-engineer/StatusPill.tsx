/**
 * Shared status-pill primitive for WR-Engineer — same visual pattern as
 * components/war-room/terra/TerraCoverageBadge.tsx (7-state enum -> color map -> small
 * uppercase-tracked text), generalized to any label/color pair so node connection status, pairing
 * state, and agent state all render consistently without three bespoke badge components.
 */
const COLOR_CLASS: Record<string, string> = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  slate: 'text-slate-400',
  cyan: 'text-cyan-400',
}

export function StatusPill({ label, color }: { label: string; color: keyof typeof COLOR_CLASS }) {
  return <span className={`text-[10px] font-bold uppercase tracking-widest ${COLOR_CLASS[color]}`}>{label}</span>
}
