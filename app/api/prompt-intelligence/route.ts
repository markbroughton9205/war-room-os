import { NextResponse } from 'next/server'
import { assembleContext } from '@/lib/context-assembler/assemble'
import { createSupabaseContextAssemblerStore } from '@/lib/context-assembler/supabaseStore'
import { composePrompt } from '@/lib/prompt-intelligence/compose'
import { persistPromptArtifact } from '@/lib/prompt-intelligence/persist'
import type { PromptIntent } from '@/lib/prompt-intelligence/types'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { listOpenKnowledgeGaps, listUnresolvedContradictionsWithClaimText } from '@/lib/world-learning/knowledgeGaps'

export const dynamic = 'force-dynamic'

const INTENTS: PromptIntent[] = [
  'GIVE_CLAUDE_NEXT_PROMPT',
  'GIVE_KIMI_RESEARCH_PROMPT',
  'GIVE_CODEX_BUILD_PROMPT',
  'GENERIC_AGENT_MISSION_PROMPT',
]

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 })

  let body: { intent?: string; conversationId?: string; projectId?: string; genericTargetLabel?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const intent = INTENTS.find(i => i === body.intent)
  if (!intent) return NextResponse.json({ error: `intent must be one of: ${INTENTS.join(', ')}` }, { status: 400 })

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null

  const store = createSupabaseContextAssemblerStore()
  let projectId = typeof body.projectId === 'string' ? body.projectId : null
  if (!projectId && conversationId) {
    const conversation = await store.getConversation(conversationId)
    projectId = conversation?.active_project_id ?? null
  }

  const assembled = await assembleContext({ conversationId, projectIdOverride: projectId }, store)
  const project = projectId ? await store.getProject(projectId) : null
  const openLoops = projectId ? await store.getOpenLoops(projectId) : []
  const topOpenLoop = openLoops[0] ?? null

  const [openGaps, unresolvedContradictions] = intent === 'GIVE_KIMI_RESEARCH_PROMPT'
    ? await Promise.all([listOpenKnowledgeGaps(projectId), listUnresolvedContradictionsWithClaimText(projectId)])
    : [[], []]

  const composed = composePrompt({
    intent,
    conversationId,
    projectId,
    genericTargetLabel: typeof body.genericTargetLabel === 'string' ? body.genericTargetLabel : undefined,
    contextPromptText: assembled.promptText,
    project: project ? { name: project.name, current_objective: project.current_objective, current_phase: project.current_phase } : null,
    topOpenLoop: topOpenLoop
      ? { title: topOpenLoop.title, description: topOpenLoop.description, next_action: topOpenLoop.next_action }
      : null,
    openKnowledgeGaps: openGaps.map(g => ({ question: g.question, gapType: g.gap_type })),
    unresolvedContradictions,
  })

  const artifact = await persistPromptArtifact({
    conversationId,
    projectId,
    contextSnapshotId: assembled.snapshot?.id ?? null,
    intent,
    targetAgentId: composed.targetAgent.agentId,
    promptText: composed.promptText,
  })

  if (!artifact) return NextResponse.json({ error: 'Failed to persist prompt artifact.' }, { status: 500 })

  return NextResponse.json({ promptArtifact: artifact, targetAgent: composed.targetAgent }, { status: 201 })
}
