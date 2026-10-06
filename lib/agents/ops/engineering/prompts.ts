import { mergeAppend } from './editMerge'
import type { EngineeringCodePlan } from './codePlanner'
import { planContextForModel } from './codePlanner'

export const ENGINEER_SYSTEM = [
  "You are Foundry's engineering worker. You edit ONE file at a time inside a bounded workspace.",
  'How to reply:',
  '- NEW file: reply with its complete content in one fenced code block.',
  '- EXISTING file: do NOT rewrite it. Reply with edits only, using any mix of:',
  '  (a) ADD new code at the end of the file, in a fenced block whose language tag is append:',
  '```append',
  'new code here',
  '```',
  '  (b) CHANGE existing code with exact search/replace blocks (the SEARCH text must match the current file exactly and appear once):',
  '<<<<<<< SEARCH',
  'exact existing text',
  '=======',
  'replacement text',
  '>>>>>>> REPLACE',
  '- If the file needs no change for this feature, reply with exactly: NO_CHANGE',
  'Rules:',
  '- Keep every existing export and behavior that the feature does not need to change; add new exports instead of replacing existing ones.',
  '- Use ES modules (import/export). Use only Node.js built-in modules. Do not add dependencies.',
  '- Do not invent files, functions or routes that are not in the provided code unless the task requires them; use the exact names that exist in the provided code.',
  '- Keep the code simple and correct.',
].join('\n')

export const ENGINEER_REWRITE_SYSTEM = [
  "You are Foundry's engineering worker. You produce ONE complete file inside a bounded workspace.",
  'How to reply:',
  '- Reply with the COMPLETE new content of the requested file in exactly one fenced code block, and nothing else.',
  '- If the file needs no change for this feature, reply with exactly: NO_CHANGE',
  'Rules:',
  '- Keep all existing behavior and structure that the feature does not need to change; new code must be placed where it actually runs (for example inside the existing request handler, not after it).',
  '- Use ES modules (import/export). Use only Node.js built-in modules. Do not add dependencies.',
  '- Use the exact names that exist in the provided code; do not invent files.',
  '- Keep the code simple and correct.',
].join('\n')

export type EditMode = 'new' | 'rewrite' | 'edits'
/** Files other modules import are edited (so exports cannot be dropped); small leaf files are rewritten whole (insertion points matter). */
export function chooseMode(exists: boolean, lines: number, keepExports: string[]): EditMode {
  if (!exists) return 'new'
  return keepExports.length === 0 && lines <= 160 ? 'rewrite' : 'edits'
}

export const ANALYST_SYSTEM = `You are Foundry's debugging analyst. You are given REAL tool output from a failed command and the code involved.
Reply with ONE JSON object: {"hypothesis": "...", "file": "<one of the candidate files>", "differs": "..."}.
- hypothesis: the most likely root cause in one or two sentences, grounded in a specific line of the output.
- file: the single candidate file that must change to fix it.
- differs: if earlier attempts are listed, one sentence on how this attempt differs from them; otherwise "first attempt".
If the output does not establish a cause, say so in hypothesis and still choose the most likely file.`

export type FileJob = { path: string; layer: string; exists: boolean; current: string; role: 'feature' | 'test' }

export function featurePrompt(input: { request: string; acceptance: string[]; plan: EngineeringCodePlan; job: FileJob; related: { path: string; text: string }[]; lessons: string[]; priorNotes: string[]; keepExports?: string[]; mode?: EditMode }): string {
  const rel = input.related.map((r) => `--- ${r.path} ---\n${r.text}`).join('\n\n')
  return [
    `TASK: ${input.request}`,
    `ACCEPTANCE CRITERIA:\n${input.acceptance.map((a) => `- ${a}`).join('\n')}`,
    `PLAN (from code evidence):\n${planContextForModel(input.plan, 1500)}`,
    input.lessons.length ? `LESSONS FROM EARLIER WORK (apply them):\n${input.lessons.map((l) => `- ${l}`).join('\n')}` : '',
    input.priorNotes.length ? `ALREADY DONE IN THIS FEATURE:\n${input.priorNotes.map((n) => `- ${n}`).join('\n')}` : '',
    rel ? `RELATED CODE (use these exact names and signatures):\n${rel}` : '',
    `FILE TO ${input.job.exists ? 'EDIT' : 'CREATE'}: ${input.job.path}  (layer: ${input.job.layer}, role: ${input.job.role})`,
    input.job.exists ? `CURRENT CONTENT OF ${input.job.path}:\n\`\`\`\n${input.job.current}\n\`\`\`` : `${input.job.path} does not exist yet.`,
    input.job.exists && input.keepExports?.length ? `EXISTING EXPORTS OF ${input.job.path} THAT OTHER FILES IMPORT (they must all still exist afterwards): ${input.keepExports.join(', ')}` : '',
    input.job.role === 'test' ? `Write node:test tests (import test from 'node:test'; import assert from 'node:assert') that prove the feature through the real functions above. Use a temporary data file via the environment variable the code reads.` : '',
    !input.job.exists || input.mode === 'rewrite' ? `Reply with the complete ${input.job.exists ? 'new content' : 'content'} of ${input.job.path} in one fenced block${input.job.exists ? ', or NO_CHANGE' : ''}.` : `Reply with edits for ${input.job.path} (append and/or search/replace), or NO_CHANGE.`,
  ].filter(Boolean).join('\n\n')
}

export function analystPrompt(input: { failureOutput: string; candidates: { path: string; text: string }[]; prior: string[] }): string {
  return [
    `FAILED COMMAND OUTPUT (real, trimmed):\n${input.failureOutput.slice(-2500)}`,
    `CANDIDATE FILES:\n${input.candidates.map((c) => `--- ${c.path} ---\n${c.text.slice(0, 3500)}`).join('\n\n')}`,
    input.prior.length ? `EARLIER ATTEMPTS ON THIS FAILURE:\n${input.prior.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : '',
    'Reply with the JSON object only.',
  ].filter(Boolean).join('\n\n')
}

export function repairPrompt(input: { failureOutput: string; hypothesis: string; file: string; current: string; related: { path: string; text: string }[]; request: string; lessons: string[]; mode?: EditMode }): string {
  return [
    `FEATURE: ${input.request}`,
    input.lessons.length ? `LESSONS (apply them):\n${input.lessons.map((l) => `- ${l}`).join('\n')}` : '',
    `FAILED COMMAND OUTPUT (real, trimmed):\n${input.failureOutput.slice(-2000)}`,
    `HYPOTHESIS (grounded in that output): ${input.hypothesis}`,
    input.related.length ? `RELATED CODE:\n${input.related.map((r) => `--- ${r.path} ---\n${r.text.slice(0, 3000)}`).join('\n\n')}` : '',
    `FILE TO FIX: ${input.file}\nCURRENT CONTENT:\n\`\`\`\n${input.current}\n\`\`\``,
    input.mode === 'rewrite' ? `Fix the cause. Reply with the complete corrected content of ${input.file} in one fenced block.` : `Fix the cause with the smallest change. Reply with edits for ${input.file} (append and/or search/replace blocks), not a rewrite.`,
  ].filter(Boolean).join('\n\n')
}

/** Extract the first fenced block; NO_CHANGE is explicit. Anything else is a refusal to guess. */
export function parseCodeReply(text: string): { kind: 'code'; content: string } | { kind: 'no_change' } | { kind: 'invalid'; reason: string } {
  const t = text.trim()
  if (t === 'NO_CHANGE' || t === '`NO_CHANGE`') return { kind: 'no_change' }
  const m = /```[a-zA-Z0-9]*\n([\s\S]*?)```/.exec(t) ?? /```[a-zA-Z0-9]*\n([\s\S]*)$/.exec(t)
  if (!m) return { kind: 'invalid', reason: 'no fenced code block in the reply' }
  const content = m[1].replace(/\s+$/, '') + '\n'
  if (content.trim().length < 10) return { kind: 'invalid', reason: 'the fenced block is empty' }
  return { kind: 'code', content }
}

/**
 * Parse a worker reply against the CURRENT file: edits (append / search-replace) are applied and validated; a full fenced block
 * is treated as a rewrite (still subject to the API-compat gate). Unmatched or ambiguous SEARCH text is refused, never guessed.
 */
export function parseEditReply(text: string, current: string | null, rel = 'file.mjs'): { kind: 'code'; content: string; mode: 'rewrite' | 'edits' | 'new' } | { kind: 'no_change' } | { kind: 'invalid'; reason: string } {
  const t = text.trim()
  if (t === 'NO_CHANGE' || t === '`NO_CHANGE`') return { kind: 'no_change' }
  const blocks = [...t.matchAll(/<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g)]
  const appends = [...t.matchAll(/```append\n([\s\S]*?)```/g)]
  if (current !== null && (blocks.length || appends.length)) {
    let out = current
    for (const b of blocks) {
      const search = b[1]
      const n = search.length ? out.split(search).length - 1 : 0
      if (n === 0) return { kind: 'invalid', reason: `SEARCH text not found in the file (first line: "${search.split('\n')[0].slice(0, 80)}"); it must match exactly` }
      if (n > 1) return { kind: 'invalid', reason: `SEARCH text appears ${n} times; include more surrounding lines so it is unique` }
      out = out.replace(search, () => b[2])
    }
    for (const a of appends) out = mergeAppend(rel, out, a[1].replace(/\s+$/, '')).content
    if (out === current) return { kind: 'invalid', reason: 'the edits change nothing' }
    return { kind: 'code', content: out, mode: 'edits' }
  }
  const full = parseCodeReply(text)
  if (full.kind === 'code') return { kind: 'code', content: full.content, mode: current === null ? 'new' : 'rewrite' }
  return full
}
