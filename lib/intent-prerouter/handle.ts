import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { assembleContext } from '@/lib/context-assembler/assemble'
import { createSupabaseContextAssemblerStore } from '@/lib/context-assembler/supabaseStore'
import { resolveNextAction } from '@/lib/next-action/resolve'
import type { NextActionInput } from '@/lib/next-action/types'
import { composePrompt } from '@/lib/prompt-intelligence/compose'
import { getPendingPromptArtifacts, persistPromptArtifact } from '@/lib/prompt-intelligence/persist'
import type { PromptIntent } from '@/lib/prompt-intelligence/types'
import { writeDirectiveWithSupersession } from '@/lib/memory-records/persist'
import { captureExperience } from '@/lib/agi-experience/capture'
import { listOpenKnowledgeGaps, listUnresolvedContradictionsWithClaimText } from '@/lib/world-learning/knowledgeGaps'
import { detectPreRouterIntent } from './detect'
import type { PreRouterHandledResult } from './types'

const GIVE_PROMPT_INTENT_BY_KIND: Record<'GIVE_CLAUDE_NEXT_PROMPT' | 'GIVE_CODEX_BUILD_PROMPT' | 'GIVE_KIMI_RESEARCH_PROMPT', PromptIntent> = {
  GIVE_CLAUDE_NEXT_PROMPT: 'GIVE_CLAUDE_NEXT_PROMPT',
  GIVE_CODEX_BUILD_PROMPT: 'GIVE_CODEX_BUILD_PROMPT',
  GIVE_KIMI_RESEARCH_PROMPT: 'GIVE_KIMI_RESEARCH_PROMPT',
}

async function insertAssistantMessage(conversationId: string, content: string, metadata: Record<string, unknown>) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data } = await sup.client
    .from('war_room_messages')
    .insert({ conversation_id: conversationId, role: 'assistant', content, family: 'war_room', metadata })
    .select('id')
    .single()
  return (data?.id as string) ?? null
}

/**
 * Returns null when the message doesn't match one of the fixed pre-router phrasings, so the
 * caller (app/api/chat/execute.ts) falls through to the normal multi-provider Council pipeline
 * unchanged. Returns a structured, grounded result when it does — deterministic, not a model
 * guess, per the mission brief's Phase 16 instruction.
 */
export async function tryHandleIntentPreRouter(
  message: string,
  conversationId: string | null,
): Promise<PreRouterHandledResult | null> {
  const match = detectPreRouterIntent(message)
  if (!match || !conversationId) return null

  const store = createSupabaseContextAssemblerStore()
  const assembled = await assembleContext(
    { conversationId, modelTarget: { source: 'intent_prerouter', intent: match.intent } },
    store,
  )
  const conversation = await store.getConversation(conversationId)
  const projectId = conversation?.active_project_id ?? null
  const project = projectId ? await store.getProject(projectId) : null

  let responseText: string
  let promptArtifactId: string | null = null

  if (match.intent === 'WHATS_NEXT') {
    const openLoops = projectId ? await store.getOpenLoops(projectId) : []
    const pending = await getPendingPromptArtifacts(conversationId)
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
    const recommendation = resolveNextAction(input)
    responseText = `${recommendation.title}\n\n${recommendation.rationale}`
  } else if (match.intent === 'REMEMBER_DIRECTIVE') {
    const scope = projectId ? 'project' : 'global_war_room'
    const result = await writeDirectiveWithSupersession({
      content: match.directiveContent ?? '',
      memoryType: 'architecture_decision',
      scope,
      projectId,
      conversationId,
      sourceType: 'commander_message',
      sourceRef: { conversationId },
    })
    if (!result) {
      responseText = 'Could not write that to memory — persistence is unavailable right now.'
    } else if (result.superseded) {
      responseText = `Recorded. This supersedes the previous decision: "${result.superseded.content}"`
    } else {
      responseText = 'Recorded as a durable memory record.'
    }
  } else {
    const promptIntent = GIVE_PROMPT_INTENT_BY_KIND[match.intent]
    const openLoops = projectId ? await store.getOpenLoops(projectId) : []
    const topOpenLoop = openLoops[0] ?? null
    const [openGaps, unresolvedContradictions] = promptIntent === 'GIVE_KIMI_RESEARCH_PROMPT'
      ? await Promise.all([listOpenKnowledgeGaps(projectId), listUnresolvedContradictionsWithClaimText(projectId)])
      : [[], []]
    const composed = composePrompt({
      intent: promptIntent,
      conversationId,
      projectId,
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
      intent: promptIntent,
      targetAgentId: composed.targetAgent.agentId,
      promptText: composed.promptText,
    })
    promptArtifactId = artifact?.id ?? null
    responseText = `Prompt for ${composed.targetAgent.displayName}:\n\n${composed.promptText}`
  }

  const messageId = await insertAssistantMessage(conversationId, responseText, {
    source: 'intent_prerouter',
    intent: match.intent,
  })

  await captureExperience({
    conversationId,
    messageId,
    contextSnapshotId: assembled.snapshot?.id ?? null,
    promptArtifactId,
    modelTarget: { source: 'intent_prerouter', intent: match.intent },
    turnKind: 'assistant_response',
    outcomeSignal: 'none',
  })

  return {
    responseText,
    promptArtifactId,
    contextSnapshotId: assembled.snapshot?.id ?? null,
    intent: match.intent,
  }
}
