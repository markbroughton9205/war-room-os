export default async function CommanderProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <section className="mx-auto max-w-5xl">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-400">Commander Review</p>
        <h1 className="mt-2 text-2xl font-bold">{id}</h1>
        <div className="mt-8 rounded border border-zinc-800 bg-zinc-950/70 p-5">
          <p className="text-sm text-zinc-400">Proposal details, immutable event history, attachment review, and lifecycle actions are available only through Commander-gated APIs.</p>
        </div>
      </section>
    </main>
  )
}
