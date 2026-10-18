/**
 * logs.tail / logs.search / logs.capture — bounded, redacted access to a fixed, named set of log
 * sources. Deliberately NOT arbitrary-file log reading: a source is one of a short allowlist, not
 * a caller-supplied path, so this can never become a whole-machine data-exfiltration primitive.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot, resolveBaseRepoRoot } from '@/lib/repo/paths'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import { redactSecretsFromOutput } from './outputRedaction'
import { getCommandOutputTail } from './commandOutput'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

export type LogSource = 'audit_ledger' | 'build_log' | 'desktop_main' | 'mission_output'

export const LOG_SOURCES: readonly LogSource[] = ['audit_ledger', 'build_log', 'desktop_main', 'mission_output'] as const

function resolveSourcePath(source: Exclude<LogSource, 'mission_output'>): string {
  switch (source) {
    case 'audit_ledger':
      return path.join(resolveBaseRepoRoot(), '.war-room', 'audit', 'code-operator.jsonl')
    case 'build_log':
      return path.join(resolveBaseRepoRoot(), '.war-room', 'build.log')
    case 'desktop_main':
      return path.join(resolveLocalAppDataPaths().logs, 'desktop-main.log')
  }
}

async function readSourceLines(source: LogSource, repairId?: string): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  if (source === 'mission_output') {
    if (!repairId) return { ok: false, error: 'mission_output requires repairId (the current mission id).' }
    return { ok: true, lines: getCommandOutputTail(repairId, 2000).map(e => `[${e.at}] [${e.stream}] ${e.text}`) }
  }
  const filePath = resolveSourcePath(source)
  if (!existsSync(filePath)) return { ok: true, lines: [] }
  try {
    const raw = await readFile(filePath, 'utf8')
    return { ok: true, lines: raw.split('\n') }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export type LogsTailResult = { ok: true; source: LogSource; lines: string[] } | { ok: false; error: string }

export async function logsTail(input: { source: LogSource; lines?: number; repairId?: string }): Promise<LogsTailResult> {
  const bound = Math.min(Math.max(input.lines ?? 200, 1), 2000)
  const read = await readSourceLines(input.source, input.repairId)
  if (!read.ok) return read
  const tail = read.lines.slice(-bound).map(l => redactSecretsFromOutput(l))
  return { ok: true, source: input.source, lines: tail }
}

export type LogsSearchResult = { ok: true; source: LogSource; matches: { lineNumber: number; text: string }[] } | { ok: false; error: string }

/** Case-insensitive substring search, newest matches last, bounded to maxMatches. */
export async function logsSearch(input: { source: LogSource; query: string; maxMatches?: number; repairId?: string }): Promise<LogsSearchResult> {
  if (!input.query.trim()) return { ok: false, error: 'query must be non-empty.' }
  const read = await readSourceLines(input.source, input.repairId)
  if (!read.ok) return read
  const needle = input.query.toLowerCase()
  const cap = Math.min(Math.max(input.maxMatches ?? 200, 1), 1000)
  const matches: { lineNumber: number; text: string }[] = []
  read.lines.forEach((line, idx) => {
    if (line.toLowerCase().includes(needle)) matches.push({ lineNumber: idx + 1, text: redactSecretsFromOutput(line) })
  })
  return { ok: true, source: input.source, matches: matches.slice(-cap) }
}

export type LogsCaptureResult = { ok: true; path: string; source: LogSource; lineCount: number } | { ok: false; error: string }

/** Snapshots the current tail of a source into a timestamped evidence file under
 * .war-room/engineer/log-captures/, mirroring the existing screenshot evidence convention. */
export async function logsCapture(input: { source: LogSource; lines?: number; repairId?: string }): Promise<LogsCaptureResult> {
  const tailed = await logsTail(input)
  if (!tailed.ok) return tailed
  const dir = path.join(resolveRepoRoot(), '.war-room', 'engineer', 'log-captures')
  await mkdir(dir, { recursive: true })
  const filename = `${input.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`
  const outPath = path.join(dir, filename)
  await writeFile(outPath, tailed.lines.join('\n'), 'utf8')
  await logWarRoomRepoAudit('engineer: logs.capture', { source: input.source, path: outPath, lineCount: tailed.lines.length })
  return { ok: true, path: outPath, source: input.source, lineCount: tailed.lines.length }
}
