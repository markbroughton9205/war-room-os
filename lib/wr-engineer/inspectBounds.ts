/**
 * WR-Engineer Phase 4 inspect-loop bounds.
 *
 * Chosen from existing War Room inspection caps (repositoryInspector: 512 KiB/file, 200 search
 * hits, 96 KiB diffs) tightened for a single Commander chat turn so a model cannot dump the repo
 * into context or loop forever. Hitting a bound stops the turn honestly — it never fabricates a
 * proposal to "finish anyway."
 */
export const MAX_TOOL_CALLS_PER_TURN = 12
export const MAX_FILES_READ_PER_TURN = 8
export const MAX_SEARCH_RESULTS = 20
export const MAX_FILE_BYTES_PER_READ = 64 * 1024
export const MAX_TOTAL_CONTEXT_BYTES = 80 * 1024
export const MAX_TREE_ENTRIES = 80
export const MAX_GIT_LOG_ENTRIES = 10
export const MAX_GIT_DIFF_BYTES = 24 * 1024
export const MAX_PROMPT_EXCERPT_BYTES = 8 * 1024
export const MAX_CHANGED_FILES_IN_STATUS = 40

export const INSPECT_BOUNDS = {
  MAX_TOOL_CALLS_PER_TURN,
  MAX_FILES_READ_PER_TURN,
  MAX_SEARCH_RESULTS,
  MAX_FILE_BYTES_PER_READ,
  MAX_TOTAL_CONTEXT_BYTES,
  MAX_TREE_ENTRIES,
  MAX_GIT_LOG_ENTRIES,
  MAX_GIT_DIFF_BYTES,
  MAX_PROMPT_EXCERPT_BYTES,
  MAX_CHANGED_FILES_IN_STATUS,
} as const
