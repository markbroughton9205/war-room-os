'use client'

import { useId, useState, type FormEvent } from 'react'
import type { BuildAgentDefinition, BuildPriority, BuildRequest, BuildRequestType } from '@/lib/build-agent/types'

function nextLocalId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `local-${crypto.randomUUID()}`
  }
  return `local-${Date.now()}`
}

function nextLocalRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `LOCAL-${crypto.randomUUID().slice(0, 8)}`
  }
  return `LOCAL-${Date.now()}`
}

type FormState = {
  title: string
  description: string
  type: BuildRequestType
  priority: BuildPriority
  assigned_agent: string
}

const emptyForm = (): FormState => ({
  title: '',
  description: '',
  type: 'feature',
  priority: 'medium',
  assigned_agent: '',
})

export function DraftBuildRequestButton({
  agents,
  onPersisted,
  onPersistFailed,
}: {
  agents: BuildAgentDefinition[]
  onPersisted: () => Promise<void>
  onPersistFailed: (row: BuildRequest) => void
}) {
  const dialogTitleId = useId()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    setForm(emptyForm())
    setSaveError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSaveError(null)

    const assigned =
      form.assigned_agent.trim() ||
      agents[0]?.name ||
      null
    const title = form.title.trim() || 'Untitled request'
    const description = form.description.trim()

    const payload = {
      title,
      description: description || null,
      type: form.type,
      priority: form.priority,
      status: 'drafted' as const,
      assigned_agent: assigned,
    }

    const fallbackRow: BuildRequest = {
      id: nextLocalId(),
      request_id: nextLocalRequestId(),
      title,
      description: description || '—',
      type: form.type,
      status: 'drafted',
      assigned_agent: assigned,
      created_at: new Date().toISOString(),
      priority: form.priority,
      local_only: true,
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/build-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        await onPersisted()
        close()
        return
      }

      const errJson: unknown = await res.json().catch(() => ({}))
      const errMsg =
        typeof errJson === 'object' && errJson !== null && 'error' in errJson
          ? String((errJson as { error?: unknown }).error ?? '')
          : ''

      if (res.status === 503 || res.status === 501) {
        onPersistFailed(fallbackRow)
        close()
        return
      }

      setSaveError(errMsg || `Could not save (${res.status}).`)
    } catch {
      onPersistFailed(fallbackRow)
      close()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSaveError(null)
          setOpen(true)
        }}
        className="rounded-lg border border-[#FFD700]/35 bg-[#FFD700]/10 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[#FFD700] shadow-[0_0_24px_-8px_rgba(255,215,0,0.35)] transition hover:border-[#FFD700]/55 hover:bg-[#FFD700]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]/60"
      >
        Draft Build Request
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) close()
          }}
        >
          <div
            role="dialog"
            aria-modal
            aria-labelledby={dialogTitleId}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0a1628] p-6 shadow-[0_0_60px_-12px_rgba(0,255,65,0.12)]"
          >
            <h2 id={dialogTitleId} className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-[#00ff41]">
              New build request
            </h2>
            <p className="mt-2 text-xs text-slate-500">
              Creates a row in Supabase when configured. No shell, deploy, or autonomous actions are triggered from here.
            </p>

            {saveError && (
              <p className="mt-3 rounded border border-rose-500/35 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-100/95">
                {saveError}
              </p>
            )}

            <form className="mt-6 space-y-4" onSubmit={submit}>
              <label className="block">
                <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Title</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600 focus:border-[#d4af37]/50 focus:outline-none"
                  placeholder="Brief title"
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Description</span>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600 focus:border-[#d4af37]/50 focus:outline-none"
                  placeholder="Scope, acceptance notes, links…"
                />
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Type</span>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, type: e.target.value as BuildRequestType }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white focus:border-[#d4af37]/50 focus:outline-none"
                  >
                    <option value="feature">feature</option>
                    <option value="bugfix">bugfix</option>
                    <option value="refactor">refactor</option>
                    <option value="research">research</option>
                    <option value="deployment">deployment</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Priority</span>
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, priority: e.target.value as BuildPriority }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white focus:border-[#d4af37]/50 focus:outline-none"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Assigned agent</span>
                <select
                  value={form.assigned_agent}
                  onChange={(e) => setForm((f) => ({ ...f, assigned_agent: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white focus:border-[#d4af37]/50 focus:outline-none"
                >
                  <option value="">Default to first roster agent</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-white/15 px-4 py-2 font-mono text-xs uppercase tracking-widest text-slate-400 transition hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg border border-[#00ff41]/40 bg-[#00ff41]/10 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-[#00ff41] transition hover:bg-[#00ff41]/15 disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Submit request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
