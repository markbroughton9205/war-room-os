import type { CommandApprovals, EngineStatus } from './types'

export type CommandClass =
  | 'read_only_query'
  | 'internet'
  | 'research'
  | 'repo_read'
  | 'repo_mutation'
  | 'terminal'

const REPO_MUTATION_PATTERN = new RegExp(
  [
    '\\bgit\\s+commit\\b',
    '\\bgit\\s+push\\b',
    '\\bgit\\s+merge\\b',
    '\\bgit\\s+rebase\\b',
    '\\bgit\\s+reset\\b',
    '\\bgit\\s+checkout\\s+-',
    '\\bapply\\s+patch\\b',
    '\\bpatch\\s+-p\\b',
    '\\brm\\s+-rf\\b',
    '\\brmdir\\b',
    '\\bdel\\s+/',
    '\\brollback\\s+apply\\b',
    '\\bwrite\\s+file\\b',
    '\\bedit\\s+file\\b',
    '\\bcommit\\s+changes\\b',
  ].join('|'),
  'i',
)

const REPO_READ_PATTERN = /\bgit\s+(status|diff|log|show)\b|\bread\s+repo\b|\bscan\s+repo\b/i
const INTERNET_PATTERN = /\b(search|browse|tavily|firecrawl|internet|web\s+look|look\s+up\s+online)\b/i
const RESEARCH_PATTERN = /\bresearch\b|\binvestigate\s+sources\b|\bliterature\b/i
const TERMINAL_PATTERN = /\brun\s+command\b|\bterminal\b|\bshell\b|\bexecute\s+npm\b|\bpnpm\s+(install|exec)\b/i

export function classifyCommand(command: string): CommandClass {
  const t = command.trim()
  if (t.length === 0) return 'read_only_query'
  if (REPO_MUTATION_PATTERN.test(t)) return 'repo_mutation'
  if (TERMINAL_PATTERN.test(t)) return 'terminal'
  if (INTERNET_PATTERN.test(t)) return 'internet'
  if (RESEARCH_PATTERN.test(t)) return 'research'
  if (REPO_READ_PATTERN.test(t)) return 'repo_read'
  return 'read_only_query'
}

/** Derive coarse permissions from engine status (pure). */
export function computeEnginePermissions(engine: Pick<EngineStatus, 'functional' | 'reachable' | 'capabilities'>) {
  const caps = new Set(engine.capabilities)
  const base = engine.functional && engine.reachable

  return {
    allowPromptOnly: base && (caps.has('chat_completion') || caps.has('chat')),
    allowInternet: base && (caps.has('internet') || caps.has('research_assist')),
    allowResearch: base && caps.has('research'),
    allowRepoRead: base && caps.has('repo_read'),
    allowRepoWrite: base && caps.has('repo_write'),
  }
}

/**
 * Per-command approval policy (pure). When the engine is not functional/reachable, always true.
 * For a healthy engine: `read_only_query` ⇒ false; `repo_read` ⇒ false; `internet`, `research`,
 * `repo_mutation`, and `terminal` ⇒ true until explicit approval flags are supplied by the caller.
 */
export function computeApprovalRequired(engine: Pick<EngineStatus, 'functional' | 'reachable'>, commandClass: CommandClass): boolean {
  if (!engine.functional || !engine.reachable) return true
  if (commandClass === 'repo_mutation' || commandClass === 'terminal') return true
  if (commandClass === 'internet' || commandClass === 'research') return true
  if (commandClass === 'repo_read') return false
  return false
}

function approvalFlagForClass(commandClass: CommandClass, approvals: CommandApprovals | undefined): boolean {
  if (!approvals) return false
  if (commandClass === 'repo_mutation') return Boolean(approvals.write || approvals.commit || approvals.rollback)
  if (commandClass === 'terminal') return Boolean(approvals.terminal)
  if (commandClass === 'internet') return Boolean(approvals.internet)
  if (commandClass === 'research') return Boolean(approvals.research)
  return false
}

/**
 * Phase 2 routing gate: never allow repo mutation paths unless explicit approval flag is true.
 * Safe prompt-only routing is allowed only when the chosen engine is functional + reachable.
 */
export function canExecuteRouting(
  engine: Pick<EngineStatus, 'functional' | 'reachable' | 'capabilities'>,
  commandClass: CommandClass,
  approvals?: CommandApprovals,
): boolean {
  if (!engine.functional || !engine.reachable) return false

  if (commandClass === 'repo_mutation' || commandClass === 'terminal') {
    return approvalFlagForClass(commandClass, approvals)
  }

  if (commandClass === 'internet') {
    return approvalFlagForClass(commandClass, approvals)
  }

  if (commandClass === 'research') {
    return approvalFlagForClass(commandClass, approvals)
  }

  if (commandClass === 'repo_read') {
    return computeEnginePermissions(engine).allowRepoRead
  }

  return computeEnginePermissions(engine).allowPromptOnly
}
