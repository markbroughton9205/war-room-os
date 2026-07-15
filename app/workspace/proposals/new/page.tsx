export default function NewWorkspaceProposalPage() {
  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <section className="mx-auto max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-400">Workspace</p>
        <h1 className="mt-2 text-2xl font-bold">New Proposal</h1>
        <form className="mt-8 space-y-5 rounded border border-zinc-800 bg-zinc-950/70 p-5">
          <label className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Title
            <input className="mt-2 w-full rounded border border-zinc-700 bg-black px-3 py-2 text-sm text-white" name="title" />
          </label>
          <label className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Category
            <select className="mt-2 w-full rounded border border-zinc-700 bg-black px-3 py-2 text-sm text-white" name="category" defaultValue="feature">
              <option value="feature">Feature</option>
              <option value="ui">UI</option>
              <option value="workflow">Workflow</option>
              <option value="council_behavior">Council behavior</option>
            </select>
          </label>
          <label className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Description
            <textarea className="mt-2 min-h-40 w-full rounded border border-zinc-700 bg-black px-3 py-2 text-sm text-white" name="description" />
          </label>
          <label className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Attachments
            <input className="mt-2 w-full rounded border border-zinc-700 bg-black px-3 py-2 text-sm text-white" name="file" type="file" multiple />
          </label>
          <p className="text-xs text-zinc-500">Submission uses the workspace proposal APIs after authentication and membership checks.</p>
        </form>
      </section>
    </main>
  )
}
