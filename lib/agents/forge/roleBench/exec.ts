import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Runs model-written code for a role benchmark. Node's permission model is on: no fs writes, no child processes, no worker threads, no network
 * (only a read grant for the one temp directory). This is containment for fixtures, not a general sandbox.
 */
export type ExecResult = { ok: boolean; exitCode: number | null; timedOut: boolean; stdout: string; stderr: string }
export async function runModule(source: string, timeoutMs = 6000): Promise<ExecResult> {
  const dir = mkdtempSync(path.join(tmpdir(), 'rolebench-'))
  const file = path.join(dir, 'case.mjs')
  writeFileSync(file, source)
  try {
    return await new Promise<ExecResult>((resolve) => {
      const p = spawn(process.execPath, ['--permission', `--allow-fs-read=${dir}`, file], { cwd: dir, env: { PATH: process.env.PATH ?? '' } as unknown as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = '', err = '', done = false
      const t = setTimeout(() => { if (!done) { p.kill('SIGKILL'); resolve({ ok: false, exitCode: null, timedOut: true, stdout: out, stderr: err }) } }, timeoutMs)
      p.stdout.on('data', (d) => { out += d; if (out.length > 20000) out = out.slice(0, 20000) })
      p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(0, 20000) })
      p.on('close', (code) => { done = true; clearTimeout(t); resolve({ ok: code === 0, exitCode: code, timedOut: false, stdout: out, stderr: err }) })
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** First fenced code block, else the whole reply with any stray fences removed. */
export function extractCode(reply: string): string {
  const m = /```(?:[a-zA-Z]+)?\n([\s\S]*?)```/.exec(reply)
  return (m ? m[1] : reply.replace(/```[a-zA-Z]*/g, '')).trim()
}
export function extractJson<T = unknown>(reply: string): T | null {
  const fenced = /```(?:json)?\n([\s\S]*?)```/.exec(reply)
  const candidates = [fenced?.[1], reply, reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)].filter((x): x is string => !!x && x.trim().length > 0)
  for (const c of candidates) { try { return JSON.parse(c) as T } catch { /* next */ } }
  return null
}
/** Fraction of original lines that are not present (as a multiset) in the answer: a measure of how much was rewritten. */
export function changedRatio(original: string, answer: string): number {
  const norm = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
  const a = norm(original), b = norm(answer)
  const counts = new Map<string, number>()
  for (const l of b) counts.set(l, (counts.get(l) ?? 0) + 1)
  let kept = 0
  for (const l of a) { const n = counts.get(l) ?? 0; if (n > 0) { kept++; counts.set(l, n - 1) } }
  return a.length ? 1 - kept / a.length : 0
}
