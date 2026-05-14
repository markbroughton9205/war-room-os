/**
 * Standing permissions: catalog of action kinds that may be auto-allowed per mode.
 * Dangerous kinds are never auto-allowed — see `isDangerousAction` in `./policy`.
 */

export type StandingPermissionMode = 'manual' | 'operator' | 'commander'

/** Passive / server-only kinds for manual mode (UI prompts stay empty for most actions). */
export const STANDING_AUTO_ALLOW_BY_MODE: Record<StandingPermissionMode, readonly string[]> = {
  /** Ask for most: no standing auto-allow for interactive POSTs (empty catalog). */
  manual: [],
  operator: [
    'internet_research',
    'provider_health',
    'red_sentinel_scan',
    'repo_read_status',
    'repo_scan_readonly',
    'diff_preview',
    'audit_logging',
    'action_queue_create',
    'thread_persistence',
    'memory_proposal',
    'engine_probe',
    'deployment_status',
    'background_brief',
  ],
  commander: [
    'internet_research',
    'provider_health',
    'red_sentinel_scan',
    'repo_read_status',
    'repo_scan_readonly',
    'diff_preview',
    'audit_logging',
    'action_queue_create',
    'thread_persistence',
    'memory_proposal',
    'engine_probe',
    'deployment_status',
    'background_brief',
    'route_planning',
    'qa_readonly',
  ],
}

export function isStandingPermissionMode(value: string): value is StandingPermissionMode {
  return value === 'manual' || value === 'operator' || value === 'commander'
}
