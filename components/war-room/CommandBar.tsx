'use client'

export function CommandBar() {
  return (
    <div className="pointer-events-none sticky bottom-0 z-20 flex justify-center px-3 pb-3 pt-1">
      <div
        className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-xl border border-white/10 bg-slate-950/50 px-4 py-2.5 shadow-[0_0_0_1px_rgba(212,175,55,0.08),0_12px_48px_-20px_rgba(56,189,248,0.45)] backdrop-blur-xl transition-shadow duration-300 focus-within:border-[#d4af37]/35 focus-within:shadow-[0_0_0_1px_rgba(212,175,55,0.2),0_16px_56px_-16px_rgba(56,189,248,0.55)]"
        role="search"
      >
        <span className="select-none text-slate-500" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="opacity-80">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.25" />
            <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          readOnly
          placeholder="Command palette not connected on this legacy route"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 outline-none"
          aria-label="Command palette not connected on this legacy route"
          title="Missing dependency: connect this legacy shell to the main War Room command dispatcher before accepting commands."
        />
        <kbd className="hidden shrink-0 rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-400 shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)] sm:inline-block">
          ⌘K
        </kbd>
      </div>
    </div>
  )
}
