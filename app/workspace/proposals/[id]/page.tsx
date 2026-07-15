export default async function WorkspaceProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <section className="mx-auto max-w-5xl">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-400">Workspace Proposal</p>
        <h1 className="mt-2 text-2xl font-bold">{id}</h1>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Panel title="Details" body="Title, description, status, and revision notes load from the proposal detail API." />
          <Panel title="Events" body="Append-only proposal history is exposed for this proposal only." />
          <Panel title="Attachments" body="Contributor attachment metadata is scoped to the proposal owner." />
        </div>
      </section>
    </main>
  )
}

function Panel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/70 p-4">
      <h2 className="text-sm font-bold text-zinc-100">{title}</h2>
      <p className="mt-2 text-sm text-zinc-400">{body}</p>
    </div>
  )
}
