'use client'

import { useCallback, useEffect, useState } from 'react'

type Project = { id: string; name: string; status: string; current_objective: string | null }
type OpenLoop = { id: string; title: string; status: string; priority: number; next_action: string | null }
type NextActionRecommendation = { kind: string; title: string; rationale: string }
type PromptArtifact = { id: string; intent: string; target_agent_id: string; prompt_text: string }

const PROMPT_INTENTS: Array<{ label: string; intent: string }> = [
  { label: 'Give Claude the next prompt', intent: 'GIVE_CLAUDE_NEXT_PROMPT' },
  { label: 'Give Codex the build prompt', intent: 'GIVE_CODEX_BUILD_PROMPT' },
  { label: 'Give Kimi the research prompt', intent: 'GIVE_KIMI_RESEARCH_PROMPT' },
]

/**
 * Secondary inspection surface for the AGI Wave 1 spine (project/open-loop state, "what's next",
 * prompt intelligence). The primary interface stays natural-language chat via the intent
 * pre-router (lib/intent-prerouter) — this panel is optional visual convenience, gated behind
 * persistenceAvailable like the other builderExtras panels, and fails soft (empty states) when
 * the phase50 migrations haven't been applied yet.
 */
export function AgiWaveOnePanel({
  conversationId,
  persistenceAvailable,
}: {
  conversationId: string | null
  persistenceAvailable: boolean
}) {
  const [project, setProject] = useState<Project | null>(null)
  const [openLoops, setOpenLoops] = useState<OpenLoop[]>([])
  const [recommendation, setRecommendation] = useState<NextActionRecommendation | null>(null)
  const [promptArtifact, setPromptArtifact] = useState<PromptArtifact | null>(null)
  const [busyIntent, setBusyIntent] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!conversationId || !persistenceAvailable) return
    let activeProjectId: string | null = null
    try {
      const convRes = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`)
      const convData = await convRes.json().catch(() => null)
      activeProjectId = typeof convData?.conversation?.active_project_id === 'string' ? convData.conversation.active_project_id : null
    } catch {
      activeProjectId = null
    }

    if (activeProjectId) {
      try {
        const projectRes = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}`)
        const projectData = await projectRes.json().catch(() => null)
        setProject(projectData?.project ?? null)
      } catch {
        setProject(null)
      }
    } else {
      setProject(null)
    }

    try {
      const loopsRes = await fetch(`/api/open-loops?conversationId=${encodeURIComponent(conversationId)}`)
      const loopsData = await loopsRes.json().catch(() => ({ openLoops: [] }))
      setOpenLoops(Array.isArray(loopsData.openLoops) ? loopsData.openLoops : [])
    } catch {
      setOpenLoops([])
    }
  }, [conversationId, persistenceAvailable])

  useEffect(() => {
    // Deferred a tick — this repo's react-hooks/set-state-in-effect lint rule flags a setState
    // call reachable by static analysis from an effect body (see
    // components/war-room/terra/useTerraAircraftTrails.ts for the same escape hatch).
    const timeout = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(timeout)
  }, [refresh])

  const askWhatsNext = useCallback(async () => {
    if (!conversationId) return
    setRecommendation(null)
    try {
      const res = await fetch(`/api/whats-next?conversationId=${encodeURIComponent(conversationId)}`)
      const data = await res.json().catch(() => null)
      if (data?.recommendation) setRecommendation(data.recommendation)
    } catch {
      setRecommendation(null)
    }
  }, [conversationId])

  const requestPrompt = useCallback(
    async (intent: string) => {
      if (!conversationId) return
      setBusyIntent(intent)
      setPromptArtifact(null)
      try {
        const res = await fetch('/api/prompt-intelligence', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ intent, conversationId }),
        })
        const data = await res.json().catch(() => null)
        if (data?.promptArtifact) setPromptArtifact(data.promptArtifact)
      } catch {
        setPromptArtifact(null)
      } finally {
        setBusyIntent(null)
      }
    },
    [conversationId],
  )

  if (!persistenceAvailable || !conversationId) return null

  return (
    <div className="space-y-3 rounded border border-white/10 p-3 text-xs" style={{ color: '#cbd5e1' }}>
      <div className="text-[9px] uppercase tracking-widest" style={{ color: '#94a3b8' }}>
        AGI Wave 1 — Project &amp; Prompt Intelligence
      </div>

      <div>
        <span className="font-semibold">Active project: </span>
        {project ? `${project.name} (${project.status})` : 'none set for this conversation'}
      </div>

      {openLoops.length > 0 ? (
        <ul className="space-y-1">
          {openLoops.slice(0, 3).map(loop => (
            <li key={loop.id}>
              <span className="opacity-70">[{loop.status}, p{loop.priority}]</span> {loop.title}
              {loop.next_action ? <span className="opacity-70"> — next: {loop.next_action}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="opacity-70">No open loops recorded yet.</div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void askWhatsNext()}
          className="rounded border border-white/20 px-2 py-1 hover:border-white/40"
        >
          What&apos;s next?
        </button>
        {PROMPT_INTENTS.map(({ label, intent }) => (
          <button
            key={intent}
            type="button"
            disabled={busyIntent === intent}
            onClick={() => void requestPrompt(intent)}
            className="rounded border border-white/20 px-2 py-1 hover:border-white/40 disabled:opacity-50"
          >
            {busyIntent === intent ? 'Composing…' : label}
          </button>
        ))}
      </div>

      {recommendation ? (
        <div className="rounded border border-white/10 p-2">
          <div className="font-semibold">{recommendation.title}</div>
          <div className="opacity-80">{recommendation.rationale}</div>
        </div>
      ) : null}

      {promptArtifact ? (
        <div className="rounded border border-white/10 p-2">
          <div className="mb-1 font-semibold">
            {promptArtifact.intent} → {promptArtifact.target_agent_id}
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px]">{promptArtifact.prompt_text}</pre>
        </div>
      ) : null}
    </div>
  )
}
