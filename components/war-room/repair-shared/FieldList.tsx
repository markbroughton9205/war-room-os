export function FieldList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded border border-white/10 bg-black/20 p-3">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{title}</h4>
      <ul className="mt-2 space-y-1 text-[10px] leading-relaxed text-slate-400">
        {(items.length ? items : ['None identified yet.']).slice(0, 8).map(item => (
          <li key={`${title}-${item}`} className="rounded border border-white/10 px-2 py-1">
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
