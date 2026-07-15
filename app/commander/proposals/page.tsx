export default function CommanderProposalsPage() {
  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <section className="mx-auto max-w-6xl">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-400">Commander</p>
        <h1 className="mt-2 text-2xl font-bold">Workspace Proposal Queue</h1>
        <div className="mt-8 rounded border border-zinc-800 bg-zinc-950/70 p-5">
          <p className="text-sm text-zinc-400">Commander queue is served by <code>/api/commander/proposals</code> after environment and Commander session gates.</p>
        </div>
      </section>
    </main>
  )
}
