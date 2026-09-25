/** Commander-facing Foundry UX contracts. Used by the shell and validation. */

export const FOUNDRY_FILE_CONTEXT_ACTIONS = [
  'Open',
  'Rename',
  'Delete',
  'Duplicate',
  'Run',
  'Test',
  'Debug',
  'View Diff',
  'Rollback',
  'Open Terminal Here',
  'Ask Foundry About This',
  'Explain',
  'Fix',
  'Refactor',
] as const

export const FOUNDRY_PROJECT_CONTEXT_ACTIONS = [
  'Open in War Room',
  'Open externally',
  'Rename',
  'Duplicate',
  'Run',
  'Test',
  'Build',
  'Project Settings',
  'Open Terminal',
  'Archive',
] as const

export const FOUNDRY_DIFF_CONTEXT_ACTIONS = [
  'Accept Change',
  'Revert Change',
  'Explain Change',
  'Test Change',
] as const

export const FOUNDRY_NORMAL_MODE_HIDDEN_CONTROLS = [
  'Coder Agent',
  'Hosted coder',
  'Accept',
  'Reject',
  'Request replan',
  'Auto-iterate',
  'Pause iteration',
] as const

export const FOUNDRY_BACK_TO_WAR_ROOM_LABEL = '← War Room'
export const FOUNDRY_HOME_HREF = '/'

export type FoundryContextKind = 'file' | 'project' | 'diff'

export function actionsForContext(kind: FoundryContextKind): readonly string[] {
  if (kind === 'file') return FOUNDRY_FILE_CONTEXT_ACTIONS
  if (kind === 'project') return FOUNDRY_PROJECT_CONTEXT_ACTIONS
  return FOUNDRY_DIFF_CONTEXT_ACTIONS
}
