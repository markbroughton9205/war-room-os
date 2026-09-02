export type PreRouterIntent =
  | 'WHATS_NEXT'
  | 'GIVE_CLAUDE_NEXT_PROMPT'
  | 'GIVE_CODEX_BUILD_PROMPT'
  | 'GIVE_KIMI_RESEARCH_PROMPT'
  | 'REMEMBER_DIRECTIVE'

export type PreRouterMatch = {
  intent: PreRouterIntent
  /** Only set for REMEMBER_DIRECTIVE — the directive text after the trigger phrase. */
  directiveContent?: string
}

export type PreRouterHandledResult = {
  responseText: string
  promptArtifactId: string | null
  contextSnapshotId: string | null
  intent: PreRouterIntent
}
