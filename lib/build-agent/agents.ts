import type { BuildAgentDefinition } from './types'

/** Planning roster — roles only; connection state is honest until integrations exist. */
export const BUILD_AGENT_DEFINITIONS: BuildAgentDefinition[] = [
  {
    id: 'codex',
    name: 'Codex Agent',
    role: 'Ships implementation patches and focused code generation under Council briefs.',
    connection_label: 'Not connected',
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    role: 'Preferred Commander-approved engineering workspace and repo-aware task packet receiver.',
    connection_label: 'Available/manual',
  },
  {
    id: 'repo-analyst',
    name: 'Repo Analyst',
    role: 'Maps structure, ownership, and risk hotspots across the repository graph.',
    connection_label: 'Not connected',
  },
  {
    id: 'qa-sentinel',
    name: 'QA Sentinel',
    role: 'Guards regressions with test plans, edge cases, and acceptance criteria.',
    connection_label: 'Not connected',
  },
  {
    id: 'deployment-watcher',
    name: 'Deployment Watcher',
    role: 'Tracks release readiness, rollout windows, and post-deploy health signals.',
    connection_label: 'Not connected',
  },
]
