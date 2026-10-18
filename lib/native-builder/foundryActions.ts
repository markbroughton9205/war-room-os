/**
 * Schema-validated Foundry actions. Malformed/unauthorized actions are rejected.
 * Execution always goes through Engineering Core tools — never a raw shell string.
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeEngineerTool, isEngineerToolName, type EngineerToolName } from './engineerTools'
import { assertCanonicalRepoPath, readRepoFile, resolveRepoRelativePath } from './repositoryInspector'
import { classifyArgv } from './commandPolicy'
import { terminalRepoDiff, terminalRepoStatus } from './terminalExecutor'
import type { NativeValidationOperation } from './types'
import { isFoundryRole, type FoundryRole } from './foundryRoles'
import {
  DEV_SERVER_REQUIREMENT_PASS,
  isDevPackageScript,
  isDevServerLaunch,
  isUnnecessaryDevScriptPackageMutation,
} from './foundryDevRuntime'

export const FOUNDRY_ACTION_TYPES = [
  'READ_FILE',
  'SEARCH_CODE',
  'CREATE_FILE',
  'REPLACE_FILE',
  'PATCH_FILE',
  'APPEND_FILE',
  'DELETE_FILE',
  'RUN_COMMAND',
  'START_PROCESS',
  'STOP_PROCESS',
  'RUN_VALIDATION',
  'INSPECT_DIFF',
  'ASK_SPECIALIST',
  'COMPLETE_MISSION',
  'NOTE',
  'TOOL_CALL',
] as const

export type FoundryActionType = (typeof FOUNDRY_ACTION_TYPES)[number]

export type FoundryAction =
  | { type: 'READ_FILE'; path: string }
  | { type: 'SEARCH_CODE'; query: string }
  | { type: 'CREATE_FILE'; path: string; content: string; reason?: string }
  | { type: 'REPLACE_FILE'; path: string; content: string; reason: string }
  | { type: 'PATCH_FILE'; path: string; matchText: string; replacementText: string; reason?: string }
  | { type: 'APPEND_FILE'; path: string; content: string; reason: string }
  | { type: 'DELETE_FILE'; path: string; commanderConfirmed?: boolean; reason?: string }
  | { type: 'RUN_COMMAND'; operation: NativeValidationOperation }
  | { type: 'START_PROCESS'; cmd: string; args: string[]; label?: string }
  | { type: 'STOP_PROCESS' }
  | { type: 'RUN_VALIDATION'; operation?: NativeValidationOperation }
  | { type: 'INSPECT_DIFF' }
  | { type: 'ASK_SPECIALIST'; specialist: FoundryRole; task: string }
  | { type: 'COMPLETE_MISSION'; summary?: string }
  | { type: 'NOTE'; text: string }
  | { type: 'TOOL_CALL'; tool: EngineerToolName; input: Record<string, unknown> }

export type FoundryActionResult = {
  ok: boolean
  type: FoundryActionType
  detail: string
  result?: unknown
}

const ALLOWED = new Set<string>(FOUNDRY_ACTION_TYPES)

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parseFoundryActions(payload: Record<string, unknown>): { ok: true; actions: FoundryAction[]; summary: string; role?: FoundryRole } | { ok: false; error: string } {
  const summary = asString(payload.summary) || asString(payload.diagnosis) || asString(payload.text)
  const rawActions = Array.isArray(payload.actions) ? payload.actions : payload.type ? [payload] : []
  if (!rawActions.length && summary) {
    return { ok: true, actions: [{ type: 'NOTE', text: summary }], summary, role: isFoundryRole(asString(payload.role)) ? payload.role as FoundryRole : undefined }
  }
  const actions: FoundryAction[] = []
  for (const item of rawActions) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Action is not an object.' }
    const row = item as Record<string, unknown>
    const type = asString(row.type)
    if (!ALLOWED.has(type)) return { ok: false, error: `Rejected unauthorized action type: ${type || '(missing)'}` }
    const parsed = parseOne(type as FoundryActionType, row)
    if (!parsed.ok) return parsed
    actions.push(parsed.action)
  }
  if (!actions.length) return { ok: false, error: 'No schema-valid actions in model output.' }
  return {
    ok: true,
    actions,
    summary,
    role: isFoundryRole(asString(payload.role)) ? (payload.role as FoundryRole) : undefined,
  }
}

function parseOne(type: FoundryActionType, row: Record<string, unknown>): { ok: true; action: FoundryAction } | { ok: false; error: string } {
  switch (type) {
    case 'READ_FILE':
      if (!asString(row.path)) return { ok: false, error: 'READ_FILE requires path.' }
      return { ok: true, action: { type, path: asString(row.path) } }
    case 'SEARCH_CODE':
      if (!asString(row.query)) return { ok: false, error: 'SEARCH_CODE requires query.' }
      return { ok: true, action: { type, query: asString(row.query) } }
    case 'CREATE_FILE':
      if (!asString(row.path) || typeof row.content !== 'string') return { ok: false, error: 'CREATE_FILE requires path and content.' }
      return { ok: true, action: { type, path: asString(row.path), content: String(row.content), reason: asString(row.reason) || undefined } }
    case 'REPLACE_FILE':
      if (!asString(row.path) || typeof row.content !== 'string' || !asString(row.reason)) {
        return { ok: false, error: 'REPLACE_FILE requires path, complete content, and reason.' }
      }
      return { ok: true, action: { type, path: asString(row.path), content: String(row.content), reason: asString(row.reason) } }
    case 'PATCH_FILE':
      if (!asString(row.path) || typeof row.matchText !== 'string' || typeof row.replacementText !== 'string') {
        return { ok: false, error: 'PATCH_FILE requires path, matchText, and replacementText.' }
      }
      return { ok: true, action: { type, path: asString(row.path), matchText: String(row.matchText), replacementText: String(row.replacementText), reason: asString(row.reason) || undefined } }
    case 'APPEND_FILE':
      if (!asString(row.path) || typeof row.content !== 'string' || !asString(row.reason)) {
        return { ok: false, error: 'APPEND_FILE requires path, complete appended content, and reason.' }
      }
      return { ok: true, action: { type, path: asString(row.path), content: String(row.content), reason: asString(row.reason) } }
    case 'DELETE_FILE':
      if (!asString(row.path)) return { ok: false, error: 'DELETE_FILE requires path.' }
      return { ok: true, action: { type, path: asString(row.path), commanderConfirmed: row.commanderConfirmed === true, reason: asString(row.reason) || undefined } }
    case 'RUN_COMMAND':
    case 'RUN_VALIDATION': {
      const operation = (row.operation && typeof row.operation === 'object' ? row.operation : { id: 'node_test' }) as NativeValidationOperation
      if (!operation.id) return { ok: false, error: `${type} requires a typed operation.id.` }
      if (type === 'RUN_COMMAND') return { ok: true, action: { type: 'RUN_COMMAND', operation } }
      return { ok: true, action: { type: 'RUN_VALIDATION', operation } }
    }
    case 'START_PROCESS': {
      const cmd = asString(row.cmd)
      const args = Array.isArray(row.args) ? row.args.map(String) : []
      if (!cmd) return { ok: false, error: 'START_PROCESS requires cmd and args array.' }
      if (isDevServerLaunch(cmd, args)) return { ok: true, action: { type, cmd, args, label: asString(row.label) || undefined } }
      const policy = classifyArgv(cmd, args)
      if (policy.policyClass !== 'SAFE_LOCAL') return { ok: false, error: policy.reason }
      return { ok: true, action: { type, cmd, args, label: asString(row.label) || undefined } }
    }
    case 'STOP_PROCESS':
      return { ok: true, action: { type } }
    case 'INSPECT_DIFF':
      return { ok: true, action: { type } }
    case 'ASK_SPECIALIST': {
      const specialist = asString(row.specialist)
      if (!isFoundryRole(specialist)) return { ok: false, error: 'ASK_SPECIALIST requires a known specialist role.' }
      return { ok: true, action: { type, specialist, task: asString(row.task) } }
    }
    case 'COMPLETE_MISSION':
      return { ok: true, action: { type, summary: asString(row.summary) || undefined } }
    case 'NOTE':
      return { ok: true, action: { type, text: asString(row.text) || asString(row.summary) } }
    case 'TOOL_CALL': {
      const toolName = asString(row.tool)
      if (!isEngineerToolName(toolName)) return { ok: false, error: `TOOL_CALL requires a known tool name, got: ${toolName || '(missing)'}` }
      const toolInput = row.input && typeof row.input === 'object' && !Array.isArray(row.input) ? (row.input as Record<string, unknown>) : {}
      return { ok: true, action: { type, tool: toolName, input: toolInput } }
    }
  }
}

function skippedDevRuntime(type: FoundryActionType): FoundryActionResult {
  return {
    ok: true,
    type,
    detail: DEV_SERVER_REQUIREMENT_PASS,
    result: { skipped: true, packageJsonUnchanged: true, devRuntimeRequired: false, requirement: 'PASS' },
  }
}

async function sourceSyntaxDefect(file: string, content: string): Promise<string | null> {
  if (!/\.(?:mjs|cjs|js)$/.test(file)) return null
  const dir = await mkdtemp(path.join(os.tmpdir(), 'foundry-source-preflight-'))
  const target = path.join(dir, path.basename(file))
  try {
    await writeFile(target, content, 'utf8')
    const result = await new Promise<{ code: number | null; stderr: string }>(resolve => {
      const child = spawn(process.execPath, ['--check', target], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000) })
      child.on('error', error => resolve({ code: null, stderr: error.message }))
      child.on('close', code => resolve({ code, stderr }))
    })
    return result.code === 0 ? null : `SOURCE_SYNTAX_REJECTED: ${result.stderr.trim() || `node --check exited ${result.code}`}`
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function executeFoundryAction(action: FoundryAction, ctx: { repairId: string }): Promise<FoundryActionResult> {
  if (isUnnecessaryDevScriptPackageMutation(action)) return skippedDevRuntime(action.type)
  if (action.type === 'START_PROCESS' && isDevServerLaunch(action.cmd, action.args)) return skippedDevRuntime(action.type)
  if ((action.type === 'RUN_COMMAND' || action.type === 'RUN_VALIDATION') && isDevPackageScript(action.operation)) {
    return skippedDevRuntime(action.type)
  }
  switch (action.type) {
    case 'READ_FILE': {
      const result = await executeEngineerTool({ tool: 'file.read', input: { path: action.path } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `Read ${action.path}` : result.error ?? 'read failed', result: result.result }
    }
    case 'SEARCH_CODE': {
      const result = await executeEngineerTool({ tool: 'workspace.search', input: { query: action.query } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `Searched ${action.query}` : result.error ?? 'search failed', result: result.result }
    }
    case 'CREATE_FILE': {
      const existing = await readRepoFile(action.path)
      if (existing.ok) {
        return { ok: false, type: action.type, detail: `CREATE_FILE cannot overwrite existing ${action.path}.` }
      }
      const testPath = /(?:^|\/)(?:test|tests|spec|specs)(?:\/|\.|$)|\.(?:test|spec)\.[^.]+$/i.test(action.path)
      const candidateIsTest = /(?:from\s+['"]node:test['"]|require\s*\(\s*['"]node:test['"]\s*\))/.test(action.content)
      if (/(?:^|\/)browser\.(?:test|spec)\.[^.]+$/i.test(action.path)) {
        return { ok: false, type: action.type, detail: `SOURCE_ROLE_REJECTED: ${action.path} cannot establish browser acceptance. The executor owns real Playwright UI, reload, restart, console, and persistence verification; keep source tests focused on the real server integration.` }
      }
      if (!testPath && candidateIsTest) {
        return { ok: false, type: action.type, detail: `SOURCE_ROLE_REJECTED: ${action.path} is a product path. Put node:test code in a separate *.test.* or test.* file.` }
      }
      const syntax = await sourceSyntaxDefect(action.path, action.content)
      if (syntax) return { ok: false, type: action.type, detail: syntax }
      const absolute = resolveRepoRelativePath(action.path)
      await assertCanonicalRepoPath(absolute, true)
      await mkdir(path.dirname(absolute), { recursive: true })
      const result = await executeEngineerTool({ tool: 'file.write', input: { path: action.path, content: action.content, reason: action.reason } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `Wrote ${action.path}` : result.error ?? 'write failed', result: result.result }
    }
    case 'REPLACE_FILE': {
      const existing = await readRepoFile(action.path)
      if (!existing.ok) {
        return { ok: false, type: action.type, detail: `REPLACE_FILE requires existing ${action.path}; use CREATE_FILE for a new path.` }
      }
      const testPath = /(?:^|\/)(?:test|tests|spec|specs)(?:\/|\.|$)|\.(?:test|spec)\.[^.]+$/i.test(action.path)
      const originalWasTest = /(?:from\s+['"]node:test['"]|require\s*\(\s*['"]node:test['"]\s*\))/.test(existing.content)
      const candidateIsTest = /(?:from\s+['"]node:test['"]|require\s*\(\s*['"]node:test['"]\s*\))/.test(action.content)
      if (!testPath && !originalWasTest && candidateIsTest) {
        return { ok: false, type: action.type, detail: `SOURCE_ROLE_REJECTED: ${action.path} is product source. Create a separate test file instead of replacing the product with test code.` }
      }
      const syntax = await sourceSyntaxDefect(action.path, action.content)
      if (syntax) return { ok: false, type: action.type, detail: syntax }
      const result = await executeEngineerTool({ tool: 'file.write', input: { path: action.path, content: action.content, reason: action.reason } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `Replaced ${action.path}` : result.error ?? 'replace failed', result: result.result }
    }
    case 'APPEND_FILE': {
      const read = await readRepoFile(action.path)
      if (!read.ok) return { ok: false, type: action.type, detail: `APPEND_FILE requires existing ${action.path}; use CREATE_FILE for a new path.` }
      const appendedTestName = action.content.match(/\btest\s*\(\s*(['"])(.*?)\1/)?.[2]
      if (appendedTestName) {
        const escaped = appendedTestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (new RegExp(`\\btest\\s*\\(\\s*['"]${escaped}['"]`).test(read.content)) {
          return { ok: false, type: action.type, detail: `DUPLICATE_TEST_CASE: ${action.path} already registers ${appendedTestName}; patch that complete existing test block instead of appending another copy.` }
        }
      }
      const separator = read.content.endsWith('\n') ? '\n' : '\n\n'
      const next = read.content + separator + action.content.trim() + '\n'
      const syntax = await sourceSyntaxDefect(action.path, next)
      if (syntax) return { ok: false, type: action.type, detail: syntax }
      const result = await executeEngineerTool({ tool: 'file.write', input: { path: action.path, content: next, reason: action.reason } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `Appended ${action.path}` : result.error ?? 'append failed', result: result.result }
    }
    case 'PATCH_FILE': {
      // Patch against the complete bounded repository file. compactFileRead is appropriate for
      // model context, but using its excerpt here would silently truncate the candidate source.
      const read = await readRepoFile(action.path)
      const content = read.ok ? read.content : ''
      if (!content.includes(action.matchText)) {
        return { ok: false, type: action.type, detail: `PATCH_FILE matchText not found in ${action.path}` }
      }
      if (action.matchText === action.replacementText) {
        return { ok: false, type: action.type, detail: `PATCH_FILE_NO_OP: replacementText is identical to matchText in ${action.path}` }
      }
      const declarations = (text: string) => new Set([...text.matchAll(/^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]))
      const currentBindings = declarations(content)
      const replacedBindings = declarations(action.matchText)
      const duplicateBinding = [...declarations(action.replacementText)].find(name => currentBindings.has(name) && !replacedBindings.has(name))
      if (duplicateBinding) {
        return { ok: false, type: action.type, detail: `PATCH_FILE_DUPLICATE_BINDING: replacementText redeclares existing top-level ${duplicateBinding} outside matchText in ${action.path}. Patch only the exact declaration or hook that must change; do not paste unchanged helpers or tests into a narrow replacement.` }
      }
      const next = content.replace(action.matchText, () => action.replacementText)
      const syntax = await sourceSyntaxDefect(action.path, next)
      if (syntax) return { ok: false, type: action.type, detail: syntax }
      const result = await executeEngineerTool({ tool: 'file.write', input: { path: action.path, content: next, reason: action.reason } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `Patched ${action.path}` : result.error ?? 'patch failed' }
    }
    case 'DELETE_FILE': {
      const result = await executeEngineerTool({ tool: 'file.delete', input: { path: action.path, commanderConfirmed: action.commanderConfirmed === true, reason: action.reason } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `Deleted ${action.path}` : result.error ?? 'delete denied' }
    }
    case 'RUN_COMMAND':
    case 'RUN_VALIDATION': {
      const operation = action.type === 'RUN_COMMAND' ? action.operation : (action.operation ?? { id: 'node_test' as const })
      const result = await executeEngineerTool({ tool: 'validation.run', input: { operation } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `${operation.id} passed` : result.error ?? `${operation.id} failed`, result: result.result }
    }
    case 'START_PROCESS': {
      const result = await executeEngineerTool({ tool: 'process.start', input: { cmd: action.cmd, args: action.args, label: action.label } }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `Started ${action.cmd}` : result.error ?? 'start failed', result: result.result }
    }
    case 'STOP_PROCESS': {
      const result = await executeEngineerTool({ tool: 'process.stop', input: {} }, ctx)
      return { ok: result.ok, type: action.type, detail: 'Stopped owned processes' }
    }
    case 'INSPECT_DIFF': {
      const diff = await terminalRepoDiff()
      const status = await terminalRepoStatus()
      return { ok: true, type: action.type, detail: `Diff ${status.changedFiles.length} file(s)`, result: { diff, status } }
    }
    case 'ASK_SPECIALIST':
      return { ok: true, type: action.type, detail: `Handing off to ${action.specialist}: ${action.task}` }
    case 'COMPLETE_MISSION':
      return { ok: true, type: action.type, detail: action.summary || 'Mission complete requested.' }
    case 'NOTE':
      return { ok: true, type: action.type, detail: action.text.slice(0, 400) }
    case 'TOOL_CALL': {
      const result = await executeEngineerTool({ tool: action.tool, input: action.input }, ctx)
      return { ok: result.ok, type: action.type, detail: result.ok ? `${action.tool} ok` : result.error ?? `${action.tool} failed`, result: result.result }
    }
  }
}
