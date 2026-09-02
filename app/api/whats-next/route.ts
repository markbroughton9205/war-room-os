import { NextResponse } from 'next/server'
import { createSupabaseContextAssemblerStore } from '@/lib/context-assembler/supabaseStore'
import { resolveNextAction } from '@/lib/next-action/resolve'
import type { NextActionInput } from '@/lib/next-action/types'
import { getPendingPromptArtifacts } from '@/lib/prompt-intelligence/persist'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 })
  }

  const url = new URL(req.url)
  const conversationId = url.searchParams.get('conversationId')
  let projectId = url.searchParams.get('projectId')

  const store = createSupabaseContextAssemblerStore()
  if (!projectId && conversationId) {
    const conversation = await store.getConversation(conversationId)
    projectId = conversation?.active_project_id ?? null
  }

  const project = projectId ? await store.getProject(projectId) : null
  const openLoops = projectId ? await store.getOpenLoops(projectId) : []
  const pending = conversationId ? await getPendingPromptArtifacts(conversationId) : []

  const input: NextActionInput = {
    project: project ? { id: project.id, name: project.name, status: project.status, current_objective: project.current_objective } : null,
    openLoops: openLoops.map(l => ({
      id: l.id,
      title: l.title,
      status: l.status,
      priority: l.priority,
      next_action: l.next_action,
      updated_at: l.updated_at,
    })),
    pendingPromptArtifacts: pending.map(p => ({
      id: p.id as string,
      target_agent_id: p.target_agent_id as string,
      intent: p.intent as string,
      created_at: p.created_at as string,
    })),
  }

  return NextResponse.json({ recommendation: resolveNextAction(input) })
}
