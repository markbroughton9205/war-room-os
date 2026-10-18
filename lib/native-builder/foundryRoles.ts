/**
 * Foundry roles are routing identities over ONE Engineering Core — not separate mutation engines.
 */
export const FOUNDRY_ROLES = [
  'FOUNDRY_MASTER',
  'ARCHITECT',
  'BUILDER',
  'DEBUGGER',
  'TEST_ENGINEER',
  'REVIEWER',
  'SECURITY_ENGINEER',
  'UI_ENGINEER',
  'BACKEND_ENGINEER',
  'RELEASE_ENGINEER',
] as const

export type FoundryRole = (typeof FOUNDRY_ROLES)[number]

const MENTION_ALIASES: Record<string, FoundryRole> = {
  master: 'FOUNDRY_MASTER',
  foundry: 'FOUNDRY_MASTER',
  architect: 'ARCHITECT',
  builder: 'BUILDER',
  debugger: 'DEBUGGER',
  test: 'TEST_ENGINEER',
  reviewer: 'REVIEWER',
  security: 'SECURITY_ENGINEER',
  ui: 'UI_ENGINEER',
  backend: 'BACKEND_ENGINEER',
  release: 'RELEASE_ENGINEER',
}

export function isFoundryRole(value: string): value is FoundryRole {
  return (FOUNDRY_ROLES as readonly string[]).includes(value)
}

export function parseDirectRoleMention(text: string): { role: FoundryRole; remainder: string } | null {
  const match = text.trim().match(/^@([a-z_]+)\b([\s\S]*)$/i)
  if (!match) return null
  const role = MENTION_ALIASES[match[1].toLowerCase()]
  if (!role) return null
  return { role, remainder: match[2].trim() }
}

export function selectSpecialists(commanderRequest: string, directRole?: FoundryRole): FoundryRole[] {
  if (directRole && directRole !== 'FOUNDRY_MASTER') {
    return ['FOUNDRY_MASTER', directRole, 'REVIEWER']
  }
  const t = commanderRequest.toLowerCase()
  const roles: FoundryRole[] = ['FOUNDRY_MASTER', 'ARCHITECT', 'BUILDER']
  if (/\bui\b|web|html|page|frontend|react/.test(t)) roles.push('UI_ENGINEER')
  if (/\bapi\b|rest|backend|server|endpoint/.test(t)) roles.push('BACKEND_ENGINEER')
  if (/\bcli\b|command-line|command line/.test(t)) roles.push('BACKEND_ENGINEER')
  roles.push('TEST_ENGINEER', 'REVIEWER')
  if (/\bauth|security|password|token/.test(t)) roles.push('SECURITY_ENGINEER')
  if (/\brelease|deploy|package/.test(t)) roles.push('RELEASE_ENGINEER')
  if (/\bcrash|fail|bug|fix|debug/.test(t)) roles.push('DEBUGGER')
  return [...new Set(roles)]
}

export function roleBrief(role: FoundryRole): string {
  switch (role) {
    case 'FOUNDRY_MASTER':
      return 'Coordinate the mission. Choose the next specialist and the next structured action. Do not dump an entire product in one turn if a specialist should act.'
    case 'ARCHITECT':
      return 'Produce a short architecture: files to create, data model, commands to run. Do not write large implementations unless asked.'
    case 'BUILDER':
      return 'Create or patch source files. Prefer Node ESM (.mjs) with no third-party packages unless strictly required.'
    case 'DEBUGGER':
      return 'Diagnose the latest validation/runtime failure and propose a minimal repair action.'
    case 'TEST_ENGINEER':
      return 'Write or run tests. Use node:test. Request RUN_VALIDATION when tests exist.'
    case 'REVIEWER':
      return 'Inspect the diff and remaining risks. Request COMPLETE_MISSION only if tests passed.'
    case 'SECURITY_ENGINEER':
      return 'Look for secret leakage, path traversal, and unsafe commands. Do not approve committing .env files.'
    case 'UI_ENGINEER':
      return 'Implement the user-facing HTML/HTTP handlers. Keep UI local and dependency-free when possible.'
    case 'BACKEND_ENGINEER':
      return 'Implement persistence, validation, and API/CLI behavior.'
    case 'RELEASE_ENGINEER':
      return 'Confirm start/test scripts. Never commit, push, or deploy.'
  }
}
