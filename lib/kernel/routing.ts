import type { AgentFamily, ApprovalRisk, Capability, RoutingDecision } from './types'

type AgentRouteProfile = {
  label: string
  role: string
  capabilities: Capability[]
}

export const AGENT_FAMILY_CAPABILITIES: Record<AgentFamily, AgentRouteProfile> = {
  chatgpt: {
    label: 'ChatGPT Family',
    role: 'Strategy, synthesis, communication, and orchestration.',
    capabilities: ['synthesize', 'communicate', 'orchestrate'],
  },
  claude: {
    label: 'Claude Family',
    role: 'Architecture, decomposition, and verification.',
    capabilities: ['architecture', 'decompose', 'verify'],
  },
  grok: {
    label: 'Grok Family',
    role: 'Realtime research and signal detection.',
    capabilities: ['research', 'realtime_research', 'signal_detection'],
  },
  kimi: {
    label: 'Kimi Family',
    role: 'Task sequencing and execution planning.',
    capabilities: ['task_sequencing', 'decompose', 'execute'],
  },
  red_team: {
    label: 'Red Team',
    role: 'Criticism, risk checks, contradiction review, and stress testing.',
    capabilities: ['criticize', 'risk_check', 'verify'],
  },
  baby_ai: {
    label: 'Baby AI Observer',
    role: 'Approved memory, pattern learning, and continuity.',
    capabilities: ['remember', 'pattern_learning', 'synthesize'],
  },
  codex_local: {
    label: 'Codex / Cursor / Local Code Agent',
    role: 'Code, debug, patch planning, and deployment preparation.',
    capabilities: ['code', 'debug', 'patch_planning', 'deploy'],
  },
  opportunity_scout: {
    label: 'Opportunity Scout',
    role: 'Income opportunity discovery and verification workflow.',
    capabilities: ['scout', 'research', 'extract'],
  },
  repo_analyst: {
    label: 'Repo Analyst',
    role: 'Repository structure, route, feature, and build-state analysis.',
    capabilities: ['analyze_repo', 'verify', 'debug'],
  },
}

export const CAPABILITY_ROUTES: Record<Capability, AgentFamily[]> = {
  research: ['grok', 'opportunity_scout', 'chatgpt'],
  decompose: ['claude', 'kimi'],
  synthesize: ['chatgpt', 'baby_ai'],
  criticize: ['red_team', 'claude'],
  execute: ['kimi', 'codex_local'],
  remember: ['baby_ai'],
  notify: ['chatgpt'],
  deploy: ['codex_local'],
  verify: ['claude', 'red_team', 'repo_analyst'],
  extract: ['opportunity_scout', 'grok'],
  scout: ['opportunity_scout'],
  approve: ['chatgpt'],
  code: ['codex_local', 'repo_analyst'],
  debug: ['codex_local', 'repo_analyst', 'claude'],
  analyze_repo: ['repo_analyst', 'codex_local'],
  communicate: ['chatgpt'],
  orchestrate: ['chatgpt', 'claude'],
  architecture: ['claude'],
  realtime_research: ['grok'],
  signal_detection: ['grok'],
  task_sequencing: ['kimi'],
  risk_check: ['red_team'],
  pattern_learning: ['baby_ai'],
  patch_planning: ['codex_local'],
}

export function riskForCapability(capability: Capability): ApprovalRisk {
  if (capability === 'deploy') return 'deployment'
  if (capability === 'approve' || capability === 'execute') return 'high'
  if (capability === 'notify' || capability === 'code' || capability === 'debug' || capability === 'patch_planning') return 'medium'
  return 'low'
}

export function routeCapability(capability: Capability): RoutingDecision {
  const [primaryFamily, ...supportingFamilies] = CAPABILITY_ROUTES[capability]

  return {
    capability,
    primaryFamily,
    supportingFamilies,
    approvalRisk: riskForCapability(capability),
    reason: `${AGENT_FAMILY_CAPABILITIES[primaryFamily].label} owns ${capability} routing in the current kernel map.`,
    autonomousExecutionAllowed: false,
  }
}
