// AGI Wave 1 — Prompt Intelligence contracts. Naming is deliberately PromptArtifact/MissionPrompt,
// never bare "Mission*" — three other Mission concepts already exist in this repo
// (lib/missions, lib/opportunity-mission-bridge, lib/mission-runtime's RuntimeMission*).

export type PromptIntent =
  | 'GIVE_CLAUDE_NEXT_PROMPT'
  | 'GIVE_KIMI_RESEARCH_PROMPT'
  | 'GIVE_CODEX_BUILD_PROMPT'
  | 'GENERIC_AGENT_MISSION_PROMPT'

export type TargetAgentProfile = {
  agentId: string
  displayName: string
  source: 'engineering_agent_registry' | 'council_capability_registry' | 'generic'
  role: string
  availability: string
  notes: string
}

export type ComposePromptInput = {
  intent: PromptIntent
  conversationId: string | null
  projectId: string | null
  genericTargetLabel?: string
  contextPromptText: string
  project: { name: string; current_objective: string | null; current_phase: string | null } | null
  topOpenLoop: { title: string; description: string | null; next_action: string | null } | null
  /** AGI Wave 2 (Phase 35) — open knowledge gaps and unresolved contradictions for the active
   * project, so GIVE_KIMI_RESEARCH_PROMPT targets exactly what's unresolved instead of repeating
   * completed research. Empty arrays for intents that don't use them. */
  openKnowledgeGaps?: { question: string; gapType: string }[]
  unresolvedContradictions?: { claimAText: string; claimBText: string }[]
}

export type ComposedPrompt = {
  targetAgent: TargetAgentProfile
  promptText: string
}

export type PromptArtifact = {
  id: string
  conversation_id: string | null
  project_id: string | null
  context_snapshot_id: string | null
  intent: PromptIntent
  target_agent_id: string
  prompt_text: string
  status: 'draft' | 'delivered' | 'superseded'
  created_at: string
}

export type PromptOutcome = {
  id: string
  prompt_artifact_id: string
  outcome: 'accepted' | 'rejected' | 'partial' | 'unknown'
  commander_note: string | null
  recorded_at: string
}
