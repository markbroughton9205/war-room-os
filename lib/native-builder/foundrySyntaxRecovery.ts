/**
 * Bounded recovery for an edit that would leave a parseable source file unparseable. The file is never touched; the rejection is recorded against the
 * source digest so an identical retry is refused at once (REPEATED_BAD_PATCH), the model is told exactly why the patch broke syntax, and after two failed
 * retries on the same digest the controller may escalate to one coherent whole-file rewrite (short, task-owned files only, and only if it parses before it is written).
 */
import { createHash } from 'node:crypto'

export const SYNTAX_ESCALATION_AFTER = 2
const MAX_RECORDED = 6

export type SyntaxRejection = { signature: string; error: string }
export type SyntaxRecovery = { path: string; sourceSha: string; count: number; rejected: SyntaxRejection[]; anchorId?: string }

export function candidateSignature(path: string, sourceSha: string, matchText: string, replacementText: string): string {
  return createHash('sha256').update([path, sourceSha, matchText, replacementText].join('\u0000')).digest('hex').slice(0, 16)
}

const sameSource = (state: SyntaxRecovery | undefined, path: string, sourceSha: string): state is SyntaxRecovery =>
  Boolean(state) && state!.path === path && state!.sourceSha === sourceSha

/** An identical candidate against the same unchanged source was already rejected. */
export function isRepeatedBadCandidate(state: SyntaxRecovery | undefined, path: string, sourceSha: string, signature: string): boolean {
  return sameSource(state, path, sourceSha) && state.rejected.some(item => item.signature === signature)
}

/** Record a rejection. A different path or a changed source digest starts a fresh record (the file moved on, so the earlier failures no longer apply). */
export function recordSyntaxRejection(state: SyntaxRecovery | undefined, path: string, sourceSha: string, signature: string, error: string, anchorId?: string): SyntaxRecovery {
  const base: SyntaxRecovery = sameSource(state, path, sourceSha) ? state : { path, sourceSha, count: 0, rejected: [] }
  return { ...base, anchorId: anchorId ?? base.anchorId, count: base.count + 1, rejected: [...base.rejected.filter(item => item.signature !== signature), { signature, error }].slice(-MAX_RECORDED) }
}

/** Two failed syntax retries on the same unchanged source: the whole-file rewrite becomes available. */
export function syntaxEscalated(state: SyntaxRecovery | undefined, path: string, sourceSha: string): boolean {
  return sameSource(state, path, sourceSha) && state.count >= SYNTAX_ESCALATION_AFTER
}

/** Numbered source lines around a range, bounded. */
export function syntaxWindow(source: string, startLine: number, endLine: number, pad = 3, limit = 16): string {
  const lines = source.split('\n')
  const from = Math.max(1, startLine - pad)
  const to = Math.min(lines.length, Math.max(endLine, startLine) + pad, from + limit - 1)
  const out: string[] = []
  for (let n = from; n <= to; n++) out.push(`${n}: ${lines[n - 1] ?? ''}`)
  return out.join('\n')
}

export function describeSyntaxRejection(input: {
  path: string
  parserError: string
  anchorId?: string
  startLine: number
  endLine: number
  matched: string
  replacement: string
  window: string
  count: number
  wholeFileAllowed: boolean
}): string {
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text)
  const lines = [
    `PATCH_BREAKS_SYNTAX: this edit would leave ${input.path} unparseable. Nothing was written; the file is unchanged.`,
    `PARSER_ERROR: ${input.parserError}`,
    `WRITABLE_RANGE: ${input.anchorId ? `anchor ${input.anchorId}, ` : ''}lines ${input.startLine}-${input.endLine}`,
    `MATCHED_REGION (your replacementText replaces exactly this text): ${JSON.stringify(clip(input.matched, 240))}`,
    `YOUR_REJECTED_REPLACEMENT: ${JSON.stringify(clip(input.replacement, 400))}`,
    'SOURCE_WINDOW:',
    input.window,
    'RETRY_RULES: do NOT repeat this replacement (an identical retry is rejected as REPEATED_BAD_PATCH). Return ONE corrected bounded patch. The replacement must replace only the matched region and keep every surrounding line syntactically valid.',
  ]
  if (input.count >= SYNTAX_ESCALATION_AFTER) {
    lines.push(input.wholeFileAllowed
      ? `ESCALATION (${input.count} failed attempts on this source): rewrite the whole file with file.write (complete corrected contents). It is only written if it parses.`
      : `ESCALATION (${input.count} failed attempts on this source): use a smaller range around the line that must change.`)
  }
  return lines.join('\n')
}

export function repeatedBadPatchMessage(path: string, error: string, count = 1, wholeFileAllowed = false): string {
  const base = `REPEATED_BAD_PATCH: this exact replacement for ${path} was already rejected (${error}). Nothing was written. Send a DIFFERENT corrected patch; repeating it does not change the outcome.`
  if (count < SYNTAX_ESCALATION_AFTER) return base
  return `${base}\n${wholeFileAllowed
    ? `ESCALATION (${count} failed attempts on this source): rewrite the whole file with file.write (complete corrected contents). It is only written if it parses.`
    : `ESCALATION (${count} failed attempts on this source): use a smaller range around the line that must change.`}`
}

/**
 * What a REPLAN or COMPLETE refusal says while a rejected syntax patch is outstanding: the model has to answer with a TOOL decision carrying a corrected patch,
 * not another plan. Names the last parser error and the exact call shape (the replacement text itself always comes from the model).
 */
export function syntaxRetryInstruction(state: SyntaxRecovery | undefined): string | null {
  if (!state || state.count < 1) return null
  const last = state.rejected[state.rejected.length - 1]
  const args = state.anchorId
    ? `{"path":"${state.path}","anchorId":"${state.anchorId}","replacementText":"<corrected text for the anchored region only>","reason":"..."}`
    : `{"path":"${state.path}","matchText":"<exact text>","replacementText":"<corrected text>","reason":"..."}`
  return [
    `SYNTAX_RETRY_REQUIRED: your last edit to ${state.path} was rejected (${last?.error ?? 'syntax error'}); ${state.path} is unchanged.`,
    'Do not REPLAN and do not COMPLETE. Reply with decision TOOL, tool file.replace_unique and a corrected replacementText that keeps the surrounding syntax valid:',
    `{"decision":"TOOL","tool":{"name":"file.replace_unique","args":${args}}}`,
  ].join('\n')
}

const TOP_LEVEL_DECLARATION = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm

/** Top-level declarations of a source file, by name. */
export function topLevelDeclarations(source: string): string[] {
  return [...source.matchAll(TOP_LEVEL_DECLARATION)].map(match => match[1])
}

/** Declarations the original has that a whole-file rewrite no longer has: an escalated rewrite fixes the broken line, it does not delete working code. */
export function droppedDeclarations(before: string, after: string): string[] {
  const kept = new Set(topLevelDeclarations(after))
  return [...new Set(topLevelDeclarations(before))].filter(name => !kept.has(name))
}

export function droppedDeclarationsMessage(path: string, dropped: string[]): string {
  return `WHOLE_FILE_DROPS_CODE: the complete file you wrote for ${path} no longer declares ${dropped.join(', ')}, which the current file declares. Nothing was written; the file is unchanged. Return the COMPLETE file with every existing declaration kept as it is and only the line the task names changed.`
}
