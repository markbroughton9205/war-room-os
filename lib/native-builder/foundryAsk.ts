/**
 * Foundry Ask: a read-only answer path.
 *
 * Ask reads project files with the existing read-only reader and asks the local model to answer from
 * those excerpts. It has NO tool access and NO write path, so it cannot change the project by
 * construction: the only dependencies are readFile (read-only), a file listing, and a text completion.
 *
 * Dependencies are injected so the logic is unit-testable without a model or a filesystem.
 */

export type AskReadResult = { ok: true; content: string } | { ok: false; error?: string }
export type AskCompletion = { ok: true; text: string; model: string } | { ok: false; detail: string }

export type AskDeps = {
  readFile: (relPath: string) => Promise<AskReadResult>
  fileNames: readonly string[]
  complete: (input: { system: string; prompt: string }) => Promise<AskCompletion>
}

export type AskOutcome =
  | { ok: true; answer: string; filesUsed: string[]; model: string }
  | { ok: false; detail: string }

const MAX_FILES = 5
const MAX_FILE_CHARS = 4000
const MAX_ANSWER_CHARS = 3000

export const ASK_SYSTEM_PROMPT = [
  'You are Foundry, a careful software engineer answering a question about a project.',
  'Answer only from the SOURCE excerpts provided. You are read-only: you cannot change files or run commands, and you must never claim to have done so.',
  'If the excerpts do not contain the answer, say what is missing instead of guessing.',
  'Be concise and concrete. Name files and functions where relevant.',
].join(' ')

/** @path references in the question, e.g. "what does @backend/api.py do". */
export function extractMentionedPaths(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/(?:^|\s)@([\w./-]+\.[A-Za-z0-9]+)/g)) {
    if (!found.includes(match[1])) found.push(match[1])
  }
  return found
}

const SOURCE_EXT = /\.(py|ts|tsx|js|jsx|mjs|cjs|md|json|css|html|go|rs|java|rb|sh|sql)$/i
const NOISE = /(^|\/)(node_modules|__pycache__|\.war-room|\.git|\.next|dist|build|archive)\/|(^|\/)(commander-facts|foundry-memory)\.json$/

function baseStem(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.[^.]+$/, '').toLowerCase()
}

/** Mentioned files first, then files the question names, then representative source files. Never invents paths. */
export function pickAskFiles(input: { question: string; mentioned: readonly string[]; fileNames: readonly string[]; limit?: number }): string[] {
  const limit = input.limit ?? MAX_FILES
  const known = new Set(input.fileNames)
  const picked: string[] = []
  const add = (path: string) => { if (known.has(path) && !picked.includes(path) && picked.length < limit) picked.push(path) }
  for (const path of input.mentioned) add(path)
  const q = input.question.toLowerCase()
  for (const path of input.fileNames) {
    if (NOISE.test(path) || !SOURCE_EXT.test(path)) continue
    const stem = baseStem(path)
    if (stem.length >= 3 && q.includes(stem)) add(path)
  }
  const isTest = (path: string) => /(^|\/)(tests?|__tests__)\//.test(path) || /(^|\/)test_[^/]*$|\.test\.[a-z]+$/.test(path)
  for (const path of input.fileNames) {
    if (NOISE.test(path) || !SOURCE_EXT.test(path) || /(^|\/)readme/i.test(path) || isTest(path)) continue
    add(path)
  }
  return picked
}

export function buildAskPrompt(question: string, files: readonly { path: string; text: string }[], fileNames: readonly string[]): string {
  const listing = fileNames.filter(name => !NOISE.test(name)).slice(0, 60).join(', ')
  const sources = files.map(file => `SOURCE ${file.path}\n${file.text.slice(0, MAX_FILE_CHARS)}`).join('\n\n')
  return [`QUESTION: ${question.trim()}`, `PROJECT FILES: ${listing || '(none listed)'}`, sources].filter(Boolean).join('\n\n')
}

export async function answerAsk(deps: AskDeps, question: string): Promise<AskOutcome> {
  const text = question.trim()
  if (!text) return { ok: false, detail: 'Ask Foundry a question first.' }
  const paths = pickAskFiles({ question: text, mentioned: extractMentionedPaths(text), fileNames: deps.fileNames })
  const files: { path: string; text: string }[] = []
  for (const path of paths) {
    const read = await deps.readFile(path)
    if (read.ok) files.push({ path, text: read.content })
  }
  const completion = await deps.complete({ system: ASK_SYSTEM_PROMPT, prompt: buildAskPrompt(text, files, deps.fileNames) })
  if (!completion.ok) return { ok: false, detail: completion.detail }
  const answer = completion.text.trim().slice(0, MAX_ANSWER_CHARS)
  if (!answer) return { ok: false, detail: 'The model returned an empty answer.' }
  const filesUsed = files.map(file => file.path)
  return {
    ok: true,
    answer: filesUsed.length ? `${answer}\n\nSources: ${filesUsed.join(', ')}` : answer,
    filesUsed,
    model: completion.model,
  }
}
