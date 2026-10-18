/**
 * Operational Foundry agent roles. These are tool/context/output/gate assignments, not personalities.
 */
import type { FoundryAgentRole } from './foundryAgentTypes'

export type FoundryRoleSpec = {
  role: FoundryAgentRole
  responsibility: string
  expectedOutputs: string[]
  validationGate: string
  mutating: boolean
  tools: string[]
  skillHints: string[]
  routingReason: string
}

const READ = [
  'workspace.inspect',
  'workspace.search',
  'file.read',
  'engineering.memory_recall',
]
const WRITE = [...READ, 'file.write', 'file.replace_unique', 'engineering.boundary', 'engineering.consistency']
const TEST = [...READ, 'terminal.execute', 'test.run', 'engineering.diagnose', 'engineering.test_review']
const BROWSER = [...READ, 'browser.start', 'browser.navigate', 'browser.get_text', 'browser.inspect', 'browser.screenshot']
const PROCESS = [...READ, 'process.start', 'process.status', 'process.stop', 'port.inspect']

export const FOUNDRY_ROLE_CATALOG: Record<FoundryAgentRole, FoundryRoleSpec> = {
  ARCHITECT: {
    role: 'ARCHITECT',
    responsibility: 'Turn the approved spec into a task graph, contracts, and write-set boundaries.',
    expectedOutputs: ['architecture_contract', 'schema_contract', 'api_contract'],
    validationGate: 'Contracts exist and requirement IDs are bound before implementation starts.',
    mutating: true,
    tools: [...WRITE, 'engineering.plan', 'engineering.contracts'],
    skillHints: ['architecture', 'planning'],
    routingReason: 'architecture/reasoning — strongest available reasoning model',
  },
  RESEARCHER: {
    role: 'RESEARCHER',
    responsibility: 'Gather sourced research without mutating product source or persistent data.',
    expectedOutputs: ['task_result'],
    validationGate: 'Every claim has a source or is marked unpublished.',
    mutating: false,
    tools: [...READ, 'engineering.memory_remember'],
    skillHints: ['research'],
    routingReason: 'research — research-capable provider',
  },
  BACKEND: {
    role: 'BACKEND',
    responsibility: 'Implement server, routes, and persistence against the shared API contract.',
    expectedOutputs: ['task_result'],
    validationGate: 'Contract endpoints exist; tests cover create/read/update.',
    mutating: true,
    tools: [...WRITE, 'terminal.execute'],
    skillHints: ['node', 'http', 'sqlite'],
    routingReason: 'local repetitive coding — local coder when available',
  },
  FRONTEND: {
    role: 'FRONTEND',
    responsibility: 'Implement UI against the shared API contract without changing the contract.',
    expectedOutputs: ['task_result'],
    validationGate: 'UI surfaces match contract fields; no silent API drift.',
    mutating: true,
    tools: [...WRITE],
    skillHints: ['html', 'css', 'javascript'],
    routingReason: 'local repetitive coding — local coder when available',
  },
  DATABASE: {
    role: 'DATABASE',
    responsibility: 'Own schema, migrations, and data-path isolation from source workspaces.',
    expectedOutputs: ['schema_contract'],
    validationGate: 'Persistent user data is not the test workspace database.',
    mutating: true,
    tools: [...WRITE],
    skillHints: ['sqlite', 'schema'],
    routingReason: 'local repetitive coding — local coder when available',
  },
  TEST: {
    role: 'TEST',
    responsibility: 'Run project tests against isolated runtime data, never live Commander data.',
    expectedOutputs: ['test_evidence'],
    validationGate: 'Test command exit 0 against the isolated database path.',
    mutating: false,
    tools: TEST,
    skillHints: ['testing'],
    routingReason: 'verification — deterministic tools + model review',
  },
  DEBUGGER: {
    role: 'DEBUGGER',
    responsibility: 'Assign and repair a failed verification to the owning surface.',
    expectedOutputs: ['repair'],
    validationGate: 'Retry count stays inside maxRetries; repair history is recorded.',
    mutating: true,
    tools: [...WRITE, ...TEST],
    skillHints: ['debug'],
    routingReason: 'architecture/reasoning — strongest available reasoning model',
  },
  REVIEWER: {
    role: 'REVIEWER',
    responsibility: 'Independently inspect spec, diff, tests, runtime, and risks. Before PROJECT READY, challenge assumptions, edge cases, security, integration, requirements, weak tests, accidental complexity, and regressions. Does not trust implementer reports.',
    expectedOutputs: ['review'],
    validationGate: 'Review artifact exists before PROJECT READY.',
    mutating: false,
    tools: [...READ, 'engineering.review', 'git.diff'],
    skillHints: ['review'],
    routingReason: 'architecture/reasoning — strongest available reasoning model',
  },
  VERIFIER: {
    role: 'VERIFIER',
    responsibility: 'Launch local preview and verify in War Room Browser / Foundry browser tools.',
    expectedOutputs: ['preview', 'test_evidence'],
    validationGate: 'HTTP probe plus browser evidence; no public deploy.',
    mutating: false,
    tools: [...BROWSER, ...PROCESS],
    skillHints: ['browser', 'preview'],
    routingReason: 'verification — deterministic tools + model review',
  },
  RELEASE: {
    role: 'RELEASE',
    responsibility: 'Assemble result artifacts. Never commit, push, or live-deploy.',
    expectedOutputs: ['task_result'],
    validationGate: 'AUTO_COMMIT=0 AUTO_PUSH=0 AUTO_DEPLOY=0.',
    mutating: false,
    tools: READ,
    skillHints: ['release'],
    routingReason: 'verification — deterministic tools + model review',
  },
}

export function roleAllowsTool(role: FoundryAgentRole, tool: string): boolean {
  return FOUNDRY_ROLE_CATALOG[role].tools.includes(tool)
}

export function roleIsMutating(role: FoundryAgentRole): boolean {
  return FOUNDRY_ROLE_CATALOG[role].mutating
}

export function assignRepairRole(failure: string): FoundryAgentRole {
  const text = failure.toLowerCase()
  if (/sql|sqlite|schema|database|migration/.test(text)) return 'DATABASE'
  if (/css|layout|dom|frontend|ui|html/.test(text)) return 'FRONTEND'
  if (/route|api|server|http|backend/.test(text)) return 'BACKEND'
  if (/browser|preview|screenshot/.test(text)) return 'VERIFIER'
  if (/cross|integrat|contract/.test(text)) return 'DEBUGGER'
  return 'DEBUGGER'
}
