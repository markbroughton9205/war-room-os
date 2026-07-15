import Link from 'next/link'

export default function WorkspacePage() {
  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <section className="mx-auto max-w-5xl">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-400">War Room Workspace</p>
        <h1 className="mt-3 text-3xl font-bold">Contributor Workspace</h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Personal proposal space for authenticated workspace contributors. Family/council execution is not enabled in this phase.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <SummaryTile label="Role" value="workspace_contributor" />
          <SummaryTile label="AI access" value="enabled by membership" />
          <SummaryTile label="Authority" value="proposal-only" />
        </div>
        <div className="mt-8 flex gap-3">
          <Link className="rounded border border-yellow-500/50 px-4 py-2 text-sm font-bold text-yellow-300" href="/workspace/proposals">
            Open proposals
          </Link>
          <Link className="rounded border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-300" href="/workspace/proposals/new">
            New proposal
          </Link>
        </div>
      </section>
    </main>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/70 p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">{label}</p>
      <p className="mt-2 text-sm text-zinc-100">{value}</p>
    </div>
  )
}
