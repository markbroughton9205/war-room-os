import type { LocalAgentEngine, LocalAgentEngineId, LocalAgentTaskLifecycle } from './types'

export const LOCAL_AGENT_ENGINES: LocalAgentEngine[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local model server, commonly available on port 11434.',
    defaultEndpoint: 'http://localhost:11434/api/tags',
    configurable: false,
  },
  {
    id: 'lm_studio',
    name: 'LM Studio',
    description: 'OpenAI-compatible local server, commonly available on port 1234.',
    defaultEndpoint: 'http://localhost:1234/v1/models',
    configurable: false,
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    description: 'Local coding-agent workspace service, endpoint configurable later.',
    defaultEndpoint: null,
    configurable: true,
  },
  {
    id: 'aider',
    name: 'Aider',
    description: 'CLI coding assistant, future bridge integration.',
    defaultEndpoint: null,
    configurable: true,
  },
  {
    id: 'continue',
    name: 'Continue',
    description: 'IDE assistant bridge, future local integration.',
    defaultEndpoint: null,
    configurable: true,
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Local agent framework, future bridge integration.',
    defaultEndpoint: null,
    configurable: true,
  },
]

export const LOCAL_AGENT_ENGINE_NAMES: Record<LocalAgentEngineId, string> = LOCAL_AGENT_ENGINES.reduce(
  (acc, engine) => {
    acc[engine.id] = engine.name
    return acc
  },
  {} as Record<LocalAgentEngineId, string>,
)

export const LOCAL_AGENT_TASK_LIFECYCLE: LocalAgentTaskLifecycle[] = [
  'requested',
  'planned',
  'diff_ready',
  'qa_running',
  'approval_required',
  'approved',
  'applied',
  'committed',
  'failed',
  'rolled_back',
]

export const LOCAL_AGENT_RELIABILITY_PRINCIPLES = [
  'diff-first edits',
  'lint/typecheck gate',
  'rollback before apply',
  "Ra'el approval required",
  'no autonomous commits',
  'no silent file changes',
  'full action log',
] as const
