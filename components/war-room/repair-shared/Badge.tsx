export function Badge({ label }: { label: string }) {
  const color = /risk|security|rejected|broken|critical|high/i.test(label)
    ? '#F87171'
    : /approval|awaiting|schema|runtime/i.test(label)
      ? '#FBBF24'
      : '#38BDF8'
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label.replace(/_/g, ' ')}
    </span>
  )
}
