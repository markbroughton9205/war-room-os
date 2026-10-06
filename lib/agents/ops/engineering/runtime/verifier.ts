import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { redactText } from '@/lib/recursive-learning/ingestion/redact'
import type { CommandRecord } from './ports'
import type { FinalVerification } from '../workflow'

/**
 * Independent verification supplied by the Commander/acceptance harness (NOT an agent tool). The script lives outside the
 * workspace, is not visible to the engineering worker, and is run with a scrubbed environment and a timeout.
 */
export function makeIndependentVerification(label: string, dir: string, scriptName: string, scriptSource: string, workspaceRoot: string, timeoutMs = 120_000): FinalVerification {
  mkdirSync(dir, { recursive: true })
  const script = path.join(dir, scriptName)
  writeFileSync(script, scriptSource)
  const argv = ['node', script, workspaceRoot]
  return {
    label, argv,
    run: () => new Promise<CommandRecord>((resolve) => {
      const started = new Date(); const t0 = Date.now()
      execFile('node', [script, workspaceRoot], { cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C.UTF-8' } as unknown as NodeJS.ProcessEnv, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
        const clip = (t: string) => redactText(String(t ?? '')).slice(-20_000)
        const out = clip(stdout); const er = clip(stderr)
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null
        resolve({ argv, cwd: dir, exitCode: e ? (typeof e.code === 'number' ? e.code : null) : 0, timedOut: !!e?.killed, stdout: out, stderr: er, durationMs: Date.now() - t0, startedAt: started.toISOString(), outputHash: createHash('sha256').update(out + '\n' + er).digest('hex') })
      })
    }),
  }
}
