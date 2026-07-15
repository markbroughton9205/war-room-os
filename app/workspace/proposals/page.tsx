import Link from 'next/link'

export default function WorkspaceProposalsPage() {
  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <section className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-400">Workspace</p>
            <h1 className="mt-2 text-2xl font-bold">Proposals</h1>
          </div>
          <Link className="rounded border border-yellow-500/50 px-4 py-2 text-sm font-bold text-yellow-300" href="/workspace/proposals/new">
            New proposal
          </Link>
        </div>
        <div className="mt-8 rounded border border-zinc-800 bg-zinc-950/70 p-5">
          <p className="text-sm text-zinc-400">Your proposal list loads through <code>/api/workspace/proposals</code>. No sample proposals are rendered in this foundation phase.</p>
        </div>
      </section>
    </main>
  )
}
