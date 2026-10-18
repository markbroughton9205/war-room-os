/**
 * Failure signatures, retry-loop detection, and callsite repair.
 * A repeated command on the same source with the same signature is a retry loop.
 * A new strategy or a changed source fingerprint is a different attempt.
 */
import { createHash } from 'node:crypto'
import type { FoundryEngineeringFailureAttempt } from './foundryEngineeringEvents'

export const LIVE_REPAIR_STRATEGIES = [
  'DIRECT_FIX',
  'ROOT_CAUSE_TRACE',
  'MINIMAL_REPRODUCTION',
  'CALLSITE_TRACE',
] as const

export const ALL_REPAIR_STRATEGIES = [
  ...LIVE_REPAIR_STRATEGIES,
  'DEPENDENCY_DIAGNOSIS',
  'TYPE_ERROR_TRACE',
  'TEST_FAILURE_ISOLATION',
  'RUNTIME_STATE_DIAGNOSIS',
  'CONFIG_DIAGNOSIS',
  'ENVIRONMENT_DIAGNOSIS',
  'ROLLBACK_AND_RETRY',
  'ALTERNATIVE_IMPLEMENTATION',
  'SPECIALIST_REVIEW',
] as const

export type RepairStrategyClass = (typeof ALL_REPAIR_STRATEGIES)[number]

export type FailureSignatureInput = {
  tool?: string
  command?: string
  exitCode?: number
  exceptionClass?: string
  stackLocation?: string
  message?: string
  failedTestIds?: string[]
  diagnosticIds?: string[]
  file?: string
  phase?: string
}

export type FailureSignature = {
  id: string
  normalized: string
  exceptionClass?: string
  message: string
  file?: string
  stackLocation?: string
}

export type FailureContinuation =
  | { action: 'allow'; reason: string }
  | { action: 'change_strategy'; strategy: RepairStrategyClass; previousStrategy: string; reason: string }
  | { action: 'block'; reason: string }

const UNEXPECTED_KW = /([A-Za-z_][\w.]*)\(\)\s+got an unexpected keyword argument ['"]([^'"]+)['"]/
const TRACE_FILE = /File ["']([^"']+)["'], line (\d+)/g

export function normalizeFailureMessage(message: string): string {
  return message
    .replace(/\/[^\s:'"]+/g, '<path>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>')
    .replace(/:\d+\b/g, ':<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

export function buildFailureSignature(input: FailureSignatureInput): FailureSignature {
  const message = normalizeFailureMessage(input.message ?? '')
  const file = input.file ? input.file.split(/[/\\]/).pop() : undefined
  const normalized = [
    input.tool ?? '',
    input.command ?? '',
    input.exitCode ?? '',
    input.exceptionClass ?? '',
    input.stackLocation ?? '',
    message,
    (input.failedTestIds ?? []).join(','),
    (input.diagnosticIds ?? []).join(','),
    file ?? '',
    input.phase ?? '',
  ].join('|')
  const id = createHash('sha256').update(normalized).digest('hex').slice(0, 16)
  return {
    id,
    normalized,
    exceptionClass: input.exceptionClass,
    message,
    file,
    stackLocation: input.stackLocation,
  }
}

export function sourceFingerprint(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

export function decideFailureContinuation(input: {
  history: FoundryEngineeringFailureAttempt[]
  nextSignature: string
  nextStrategy: string
  sourceFingerprint: string
  strategies?: readonly RepairStrategyClass[]
}): FailureContinuation {
  const strategies = input.strategies ?? LIVE_REPAIR_STRATEGIES
  const same = input.history.filter(item =>
    item.signature === input.nextSignature
    && item.sourceFingerprint === input.sourceFingerprint
    && item.strategy === input.nextStrategy
  )
  if (same.length === 0) {
    return { action: 'allow', reason: 'New signature, source state, or strategy.' }
  }
  const used = new Set(
    input.history
      .filter(item => item.signature === input.nextSignature && item.sourceFingerprint === input.sourceFingerprint)
      .map(item => item.strategy),
  )
  const next = strategies.find(strategy => !used.has(strategy))
  if (next) {
    return {
      action: 'change_strategy',
      strategy: next,
      previousStrategy: input.nextStrategy,
      reason: `Same failure on unchanged source under ${input.nextStrategy}. Switching to ${next}.`,
    }
  }
  return {
    action: 'block',
    reason: 'Repeated identical failure signature on unchanged source after bounded strategies were exhausted.',
  }
}

export type UnexpectedKeywordFailure = {
  callable: string
  keyword: string
  file?: string
  line?: number
  traceback: string
}

export function parseTraceFrames(text: string): { file: string; line: number }[] {
  return [...text.matchAll(TRACE_FILE)].map(hit => ({ file: hit[1], line: Number(hit[2]) }))
}

export function parseUnexpectedKeyword(text: string): UnexpectedKeywordFailure | null {
  const match = text.match(UNEXPECTED_KW)
  if (!match) return null
  let file: string | undefined
  let line: number | undefined
  for (const hit of text.matchAll(TRACE_FILE)) {
    file = hit[1]
    line = Number(hit[2])
  }
  return {
    callable: match[1],
    keyword: match[2],
    file,
    line,
    traceback: text.slice(0, 4000),
  }
}

type CallSpan = {
  name: string
  open: number
  close: number
  argsStart: number
  argsEnd: number
}

function findCalls(source: string): CallSpan[] {
  const calls: CallSpan[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '#' ) {
      const nl = source.indexOf('\n', i)
      i = nl === -1 ? source.length : nl + 1
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i += 1
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1
        i += 1
      }
      i += 1
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const nameStart = i
      while (i < source.length && /[\w.]/.test(source[i])) i += 1
      const name = source.slice(nameStart, i)
      if (source[i] === '(') {
        const open = i
        let depth = 0
        let j = i
        let quote: string | null = null
        for (; j < source.length; j++) {
          const c = source[j]
          if (quote) {
            if (c === '\\') { j += 1; continue }
            if (c === quote) quote = null
            continue
          }
          if (c === '"' || c === "'") { quote = c; continue }
          if (c === '(') depth += 1
          else if (c === ')') {
            depth -= 1
            if (depth === 0) break
          }
        }
        if (depth === 0 && j < source.length) {
          calls.push({ name, open, close: j, argsStart: open + 1, argsEnd: j })
          i = open + 1
          continue
        }
      }
      continue
    }
    i += 1
  }
  return calls
}

function removeKwarg(args: string, keyword: string): { args: string; value: string } | null {
  const re = new RegExp(`(^|,)\\s*${keyword}\\s*=\\s*([^,\\n]+)`)
  const match = args.match(re)
  if (!match || match.index === undefined) return null
  const value = match[2].trim()
  const without = `${args.slice(0, match.index)}${match[1] === ',' ? '' : ''}${args.slice(match.index + match[0].length)}`
  const cleaned = without.replace(/^\s*,\s*/, '').replace(/\s*,\s*$/, '').replace(/,\s*,/g, ', ').trim()
  return { args: cleaned, value }
}

function addKwarg(args: string, keyword: string, value: string): string {
  if (new RegExp(`(^|,)\\s*${keyword}\\s*=`).test(args)) return args
  if (!args.trim()) return `${keyword}=${value}`
  return `${args.trim().replace(/,\s*$/, '')}, ${keyword}=${value}`
}

function callableMatches(callName: string, callable: string): boolean {
  const leaf = callable.split('.').pop() ?? callable
  return callName === callable || callName.endsWith(`.${leaf}`) || callName === leaf
}

function outputParent(calls: CallSpan[], inner: CallSpan): CallSpan | null {
  const parents = calls.filter(call =>
    call.open < inner.open
    && call.close > inner.close
    && (call.name === 'print' || call.name.endsWith('.write') || call.name === 'write')
  )
  parents.sort((a, b) => b.open - a.open)
  return parents[0] ?? null
}

export type KeywordRepairPlan = {
  nextSource: string
  start: number
  end: number
  hypothesis: string
  keyword: string
  callable: string
  movedTo?: string
}

function ownsKeyword(source: string, call: CallSpan, keyword: string, calls: CallSpan[]): boolean {
  let args = source.slice(call.argsStart, call.argsEnd)
  const nested = calls
    .filter(other => other.open > call.open && other.close < call.close)
    .sort((a, b) => b.open - a.open)
  for (const child of nested) {
    const childText = source.slice(child.open - child.name.length, child.close + 1)
    const rel = (child.open - child.name.length) - call.argsStart
    if (rel < 0 || rel > args.length) continue
    args = `${args.slice(0, rel)} ${args.slice(rel + childText.length)}`
  }
  return new RegExp(`(^|,)\\s*${keyword}\\s*=`).test(args)
}

function lineStartOffset(source: string, line: number): number | null {
  if (line < 1) return null
  if (line === 1) return 0
  const start = source.split('\n').slice(0, line - 1).join('\n').length + 1
  return start <= source.length ? start : null
}

export function planUnexpectedKeywordRepair(source: string, failure: UnexpectedKeywordFailure): KeywordRepairPlan | null {
  const calls = findCalls(source)
  let withKw = calls.filter(call => ownsKeyword(source, call, failure.keyword, calls))
  if (failure.line) {
    const start = lineStartOffset(source, failure.line)
    const end = start === null ? -1 : (source.indexOf('\n', start) === -1 ? source.length : source.indexOf('\n', start))
    const onLine = start === null ? [] : withKw.filter(call => call.open >= start && call.open <= end)
    if (onLine.length) withKw = onLine
  }
  const named = withKw.filter(call => callableMatches(call.name, failure.callable))
  const target = named[0] ?? withKw.sort((a, b) => b.open - a.open)[0]
  if (!target) return null
  const args = source.slice(target.argsStart, target.argsEnd)
  const removed = removeKwarg(args, failure.keyword)
  if (!removed) return null
  const parent = outputParent(calls, target)
  if (parent) {
    const parentArgs = source.slice(parent.argsStart, parent.argsEnd)
    const innerOriginal = source.slice(target.open - target.name.length, target.close + 1)
    const innerNext = `${target.name}(${removed.args})`
    if (!parentArgs.includes(innerOriginal)) return null
    const replacedParentArgs = parentArgs.replace(innerOriginal, innerNext)
    const parentNextArgs = failure.keyword === 'flush' || failure.keyword === 'end'
      ? addKwarg(replacedParentArgs, failure.keyword, removed.value)
      : replacedParentArgs
    const parentOriginal = source.slice(parent.open - parent.name.length, parent.close + 1)
    const parentNext = `${parent.name}(${parentNextArgs})`
    const start = parent.open - parent.name.length
    const end = parent.close + 1
    return {
      nextSource: source.slice(0, start) + parentNext + source.slice(end),
      start,
      end,
      hypothesis: `${failure.callable}() does not accept ${failure.keyword}. Move ${failure.keyword}=${removed.value} to the ${parent.name} output call.`,
      keyword: failure.keyword,
      callable: failure.callable,
      movedTo: parent.name,
    }
  }
  const assigned = new RegExp(`([A-Za-z_]\\w*)\\s*=\\s*${target.name.replace('.', '\\.')}\\(`).exec(source.slice(Math.max(0, target.open - 80), target.close + 1))
  const name = assigned?.[1]
  if (name && failure.keyword === 'flush') {
    const printRe = new RegExp(`print\\(\\s*${name}\\s*\\)`)
    const printMatch = printRe.exec(source)
    if (printMatch && printMatch.index !== undefined) {
      const innerStart = target.open - target.name.length
      const innerEnd = target.close + 1
      const innerNext = `${target.name}(${removed.args})`
      let next = source.slice(0, innerStart) + innerNext + source.slice(innerEnd)
      const shifted = printMatch.index + (innerNext.length - (innerEnd - innerStart))
      const printText = printMatch[0]
      const printNext = printText.replace(')', `, ${failure.keyword}=${removed.value})`)
      next = next.slice(0, shifted) + printNext + next.slice(shifted + printText.length)
      return {
        nextSource: next,
        start: Math.min(innerStart, shifted),
        end: Math.max(innerEnd, printMatch.index + printText.length),
        hypothesis: `${failure.callable}() rejected ${failure.keyword}. Keep serialization pure and pass ${failure.keyword}=${removed.value} to print(${name}).`,
        keyword: failure.keyword,
        callable: failure.callable,
        movedTo: 'print',
      }
    }
  }
  const start = target.open - target.name.length
  const end = target.close + 1
  const nextCall = failure.keyword === 'flush'
    ? `print(${target.name}(${removed.args}), flush=${removed.value})`
    : `${target.name}(${removed.args})`
  return {
    nextSource: source.slice(0, start) + nextCall + source.slice(end),
    start,
    end,
    hypothesis: `${failure.callable}() got unexpected keyword ${failure.keyword}. Remove it from that call${failure.keyword === 'flush' ? ' and flush at the print boundary' : ''}.`,
    keyword: failure.keyword,
    callable: failure.callable,
    movedTo: failure.keyword === 'flush' ? 'print' : undefined,
  }
}

export function pythonSignatureProbe(dotted: string, keyword: string): string {
  return [
    'import importlib, inspect, json',
    `name = ${JSON.stringify(dotted)}`,
    'if name == "print":',
    '    target = print',
    'else:',
    '    module_name, _, attr = name.rpartition(".")',
    '    if not module_name:',
    '        raise SystemExit("no-module")',
    '    target = importlib.import_module(module_name)',
    '    for part in attr.split("."):',
    '        if not part: continue',
    '        target = getattr(target, part)',
    'sig = inspect.signature(target)',
    `print("yes" if ${JSON.stringify(keyword)} in sig.parameters else "no")`,
  ].join('\n')
}

export type TrainingObservation = {
  label: string
  step?: string
  tokens?: string
  gradient?: string
  stage?: string
  elapsedHint?: string
}

export function trainerScriptNames(pySource: string): string[] {
  const block = pySource.match(/TRAINER_SCRIPTS\s*=\s*\{([^}]+)\}/)
  if (!block) return []
  return [...block[1].matchAll(/"([^"]+)"/g)].map(match => match[1])
}

export function parseTrainingTelemetry(line: string): TrainingObservation | null {
  const step = line.match(/step\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/i)
  const tokens = line.match(/tokens?\s*[:=]?\s*([\d,]+)\s*\/\s*([\d,]+)/i)
  const gradient = line.match(/gradient\s*[:=]?\s*([0-9.]+)\s*(\w+)?/i)
  const stage = line.match(/stage3\s*[:=]?\s*(\d+\s*\/\s*\d+)/i)
  if (!step && !tokens && !gradient) return null
  return {
    label: 'TRAINING',
    step: step ? `${step[1]} / ${step[2]}` : undefined,
    tokens: tokens ? `${tokens[1]} / ${tokens[2]}` : undefined,
    gradient: gradient ? `${gradient[1]}${gradient[2] ? ` ${gradient[2]}` : ''}` : undefined,
    stage: stage?.[1],
  }
}
