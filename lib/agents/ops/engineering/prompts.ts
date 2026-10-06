import type { EngineeringCodePlan } from './codePlanner'
import { planContextForModel } from './codePlanner'

export const ENGINEER_SYSTEM = `You are Foundry's engineering worker. You edit ONE file at a time inside a bounded workspace.
Rules:
- Reply with the COMPLETE new content of the requested file in exactly one fenced code block, and nothing else.
- If the file needs no change for this feature, reply with exactly: NO_CHANGE
- Keep every existing export and behavior that the feature does not need to change.
- Use ES modules (import/export). Use only Node.js built-in modules. Do not add dependencies.
- Do not invent files, functions or routes that are not in the provided code unless the task requires them; use the exact names that exist in the provided code.
- Keep the code simple and correct.`

export const ANALYST_SYSTEM = `You are Foundry's debugging analyst. You are given REAL tool output from a failed command and the code involved.
Reply with ONE JSON object: {"hypothesis": "...", "file": "<one of the candidate files>", "differs": "..."}.
- hypothesis: the most likely root cause in one or two sentences, grounded in a specific line of the output.
- file: the single candidate file that must change to fix it.
- differs: if earlier attempts are listed, one sentence on how this attempt differs from them; otherwise "first attempt".
If the output does not establish a cause, say so in hypothesis and still choose the most likely file.`

export type FileJob = { path: string; layer: string; exists: boolean; current: string; role: 'feature' | 'test' }

export function featurePrompt(input: { request: string; acceptance: string[]; plan: EngineeringCodePlan; job: FileJob; related: { path: string; text: string }[]; lessons: string[]; priorNotes: string[] }): string {
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
    input.job.role === 'test' ? `Write node:test tests (import test from 'node:test'; import assert from 'node:assert') that prove the feature through the real functions above. Use a temporary data file via the environment variable the code reads.` : '',
    `Reply with the complete new content of ${input.job.path} in one fenced block, or NO_CHANGE.`,
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

export function repairPrompt(input: { failureOutput: string; hypothesis: string; file: string; current: string; related: { path: string; text: string }[]; request: string; lessons: string[] }): string {
  return [
    `FEATURE: ${input.request}`,
    input.lessons.length ? `LESSONS (apply them):\n${input.lessons.map((l) => `- ${l}`).join('\n')}` : '',
    `FAILED COMMAND OUTPUT (real, trimmed):\n${input.failureOutput.slice(-2000)}`,
    `HYPOTHESIS (grounded in that output): ${input.hypothesis}`,
    input.related.length ? `RELATED CODE:\n${input.related.map((r) => `--- ${r.path} ---\n${r.text.slice(0, 3000)}`).join('\n\n')}` : '',
    `FILE TO FIX: ${input.file}\nCURRENT CONTENT:\n\`\`\`\n${input.current}\n\`\`\``,
    `Fix the cause. Reply with the complete corrected content of ${input.file} in one fenced block.`,
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
