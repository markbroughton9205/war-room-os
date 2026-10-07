import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * The engine's own reproduction of "the server does not start": it runs the entry point on a private copy of the workspace and keeps the FULL error output
 * (the independent verifier only reports the last few hundred characters, which usually cuts off the SyntaxError / missing export that names the real cause).
 */
export async function startupProbe(root: string, env: Record<string, string> = {}, entry = 'server.mjs', windowMs = 2500): Promise<{ started: boolean; output: string }> {
  if (!existsSync(path.join(root, entry))) return { started: false, output: `${entry} does not exist` }
  const dir = mkdtempSync(path.join(tmpdir(), 'start-probe-'))
  try {
    cpSync(root, dir, { recursive: true, filter: (s) => !/node_modules/.test(s) })
    return await new Promise((resolve) => {
      const child = spawn('node', [entry], { cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', PORT: String(30000 + Math.floor(Math.random() * 20000)), ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, path.join(dir, v)])) } as unknown as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d: Buffer) => { out += d }); child.stderr.on('data', (d: Buffer) => { out += d })
      const t = setTimeout(() => { child.kill('SIGKILL'); resolve({ started: true, output: out.slice(-2000) }) }, windowMs)
      child.on('exit', () => { clearTimeout(t); resolve({ started: false, output: out.slice(-4000) }) })
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
