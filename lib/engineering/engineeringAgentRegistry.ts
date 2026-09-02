import { spawn } from 'node:child_process'
import { CURSOR_ENGINEERING_AGENT } from './cursorEngineeringAgent'
import { CODEX_ENGINEERING_AGENT } from './codexEngineeringAgent'

export type EngineeringAgentId =
  | 'cursor'
  | 'codex'
  | 'claude_code'
  | 'claude_architecture_reviewer'
  | 'red_team_risk_reviewer'

export type EngineeringAgentRole =
  | 'preferred_manual_executor'
  | 'planned_cloud_executor'
  | 'architecture_reviewer'
  | 'risk_reviewer'

export type EngineeringAgentAvailability =
  | 'available_manual'
  | 'available'
  | 'configured'
  | 'detected'
  | 'not_connected'
  | 'unavailable'
  | 'planned'

export type EngineeringAgentRegistryEntry = {
  id: EngineeringAgentId
  name: string
  role: EngineeringAgentRole
  availability: EngineeringAgentAvailability
  approvalRequired: true
  canMutateFromWarRoom: false
  notes: string
}

/**
 * The static registry reports DECLARED availability only — what War Room has actually wired, not
 * what might exist on this machine. Codex is honestly 'not_connected': no bridge exists, so the
 * registry says so. Detection of a local CLI binary (detectCliEngineeringAgents below) is reported
 * separately and never upgrades a registry entry's availability on its own — a binary on PATH is
 * not a configured, authenticated, invocable integration.
 */
export const ENGINEERING_AGENT_REGISTRY: EngineeringAgentRegistryEntry[] = [
  {
    id: CURSOR_ENGINEERING_AGENT.id,
    name: CURSOR_ENGINEERING_AGENT.name,
    role: CURSOR_ENGINEERING_AGENT.role,
    availability: CURSOR_ENGINEERING_AGENT.availability,
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: CURSOR_ENGINEERING_AGENT.notes,
  },
  {
    id: CODEX_ENGINEERING_AGENT.id,
    name: CODEX_ENGINEERING_AGENT.name,
    role: CODEX_ENGINEERING_AGENT.role,
    availability: CODEX_ENGINEERING_AGENT.availability,
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: CODEX_ENGINEERING_AGENT.missingConfiguration,
  },
  {
    id: 'claude_code',
    name: 'Claude Code',
    role: 'preferred_manual_executor',
    availability: 'available_manual',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Commander-run CLI/IDE coding agent for this repo. War Room prepares a copy-paste mission prompt (via Prompt Intelligence); Claude Code execution is manual, visible, and approval-gated — distinct from claude_architecture_reviewer, which is review-only.',
  },
  {
    id: 'claude_architecture_reviewer',
    name: 'Claude',
    role: 'architecture_reviewer',
    availability: 'available',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Reviews implementation plans, architecture, invariants, and cross-module risk.',
  },
  {
    id: 'red_team_risk_reviewer',
    name: 'Red Team',
    role: 'risk_reviewer',
    availability: 'available',
    approvalRequired: true,
    canMutateFromWarRoom: false,
    notes: 'Reviews failure modes, approval boundaries, rollback risk, and regression exposure.',
  },
]
export function getPreferredEngineeringAgent() {
  return ENGINEERING_AGENT_REGISTRY.find(agent => agent.id === 'cursor') ?? ENGINEERING_AGENT_REGISTRY[0]
}

export function listEngineeringAgents() {
  return ENGINEERING_AGENT_REGISTRY.map(agent => ({ ...agent }))
}

// ---------------------------------------------------------------------------
// Local CLI detection — honest, cached, never faked.
// ---------------------------------------------------------------------------

export type CliDetectionResult = {
  cli: 'codex' | 'claude'
  detected: boolean
  /** First line of `<cli> --version` output when detected; never an invented string. */
  versionLine?: string
  detail: string
}

let detectionCache: CliDetectionResult[] | null = null

function probeCli(cli: 'codex' | 'claude'): Promise<CliDetectionResult> {
  return new Promise(resolve => {
    let settled = false
    const done = (result: CliDetectionResult) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    let child
    try {
      child = spawn(cli, ['--version'], { windowsHide: true, shell: process.platform === 'win32' })
    } catch (error) {
      done({ cli, detected: false, detail: `spawn failed: ${error instanceof Error ? error.message : String(error)}` })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already exited */
      }
      done({ cli, detected: false, detail: 'version probe timed out (3s)' })
    }, 3000)
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', error => {
      clearTimeout(timer)
      done({ cli, detected: false, detail: `not found on PATH (${error.message})` })
    })
    child.on('exit', code => {
      clearTimeout(timer)
      const versionLine = out.split('\n').map(l => l.trim()).find(Boolean)
      if (code === 0 && versionLine) {
        done({ cli, detected: true, versionLine, detail: `binary found on PATH: ${versionLine}` })
      } else {
        done({ cli, detected: false, detail: `probe exited ${code ?? 'null'}` })
      }
    })
  })
}

/**
 * Detects whether `codex` / `claude` CLI binaries exist on this machine's PATH. Detection is NOT
 * connection: a detected CLI is reported as `detected: true` with its real version line, but no
 * War Room code path invokes it, and the static registry entry's availability stays whatever it
 * honestly is ('not_connected' for Codex) until a real bridge is wired. Result is cached per
 * process (PATH does not change meaningfully within a server process's lifetime).
 */
export async function detectCliEngineeringAgents(): Promise<CliDetectionResult[]> {
  if (detectionCache) return detectionCache
  detectionCache = await Promise.all([probeCli('codex'), probeCli('claude')])
  return detectionCache
}
