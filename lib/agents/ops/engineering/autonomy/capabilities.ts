import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loopbackBaseUrl } from '../runtime/ollamaModel'
import { resolveBin } from '../missions/toolchain'
import { readConfig, type AutonomyConfig } from './config'

/**
 * What Foundry can ACTUALLY do on this machine right now, probed (not assumed). Each row is GRANTED (works, with the evidence), UNAVAILABLE (the OS or environment does not allow it,
 * with the reason) or NOT_AUTHORIZED (possible, but the Commander has not authorized it). An unavailable privilege is never shown as granted.
 */
export type Capability = { id: string; label: string; state: 'GRANTED' | 'UNAVAILABLE' | 'NOT_AUTHORIZED'; evidence: string }

export type ProbeEnv = { repo: string | null; launcher?: string; optRoot?: string; ollamaBase?: string; config?: AutonomyConfig }

const run = (bin: string, args: string[], timeout = 5000) => { try { const r = spawnSync(bin, args, { encoding: 'utf8', timeout }); return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() } } catch (e) { return { status: -1, out: e instanceof Error ? e.message : String(e) } } }
const writable = (p: string) => { try { accessSync(p, constants.W_OK); return true } catch { return false } }

export const defaultLauncher = (): string => process.env.WAR_ROOM_LAUNCHER?.trim() || path.join(os.homedir(), '.local', 'bin', 'war-room-os-user')
export const defaultOptRoot = (): string => process.env.WAR_ROOM_OPT_ROOT?.trim() || path.join(os.homedir(), '.local', 'opt')

export async function probeCapabilities(env: ProbeEnv): Promise<Capability[]> {
  const out: Capability[] = []
  const cfg = env.config ?? readConfig()
  const add = (id: string, label: string, state: Capability['state'], evidence: string) => out.push({ id, label, state, evidence })

  // repository
  if (env.repo && existsSync(path.join(env.repo, '.git'))) {
    const g = run(resolveBin('git'), ['-C', env.repo, 'rev-parse', '--short', 'HEAD'])
    add('repo', 'Read and modify the engineering repository (through isolated workspaces and git branches)', g.status === 0 && writable(env.repo) ? 'GRANTED' : 'UNAVAILABLE', g.status === 0 ? `${env.repo} at ${g.out}` : `git failed: ${g.out.slice(0, 120)}`)
  } else add('repo', 'Read and modify the engineering repository', 'UNAVAILABLE', 'no engineering repository is configured (WAR_ROOM_ENGINEERING_REPO or engineering-config.json)')

  // terminal tools
  const tools = (['node', 'git', 'pnpm'] as const).map((t) => [t, resolveBin(t)] as const)
  const missing = tools.filter(([t, p]) => !path.isAbsolute(p) || !existsSync(p)).map(([t]) => t)
  add('terminal', 'Run builds, tests and validators as the signed-in user', missing.length ? 'UNAVAILABLE' : 'GRANTED', missing.length ? `missing: ${missing.join(', ')}` : tools.map(([t, p]) => `${t}=${p}`).join(' '))

  // sandbox for generated code
  const bw = run('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-all', 'true'])
  add('sandbox', 'Run model-written code inside the OS sandbox (bubblewrap: no network, read-only host)', bw.status === 0 ? 'GRANTED' : 'UNAVAILABLE', bw.status === 0 ? 'bwrap namespace probe succeeded' : `bwrap probe failed: ${bw.out.slice(0, 120)}`)

  // local models
  const base = loopbackBaseUrl(env.ollamaBase)
  try {
    const j = (await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })).json()) as { models?: { name: string }[] }
    add('models', 'Use the installed local models (loopback Ollama only)', 'GRANTED', `${j.models?.length ?? 0} model(s) installed at ${base}`)
  } catch { add('models', 'Use the installed local models', 'UNAVAILABLE', `${base} is not reachable`) }

  // versioned installs
  const opt = env.optRoot ?? defaultOptRoot()
  add('install', 'Build versioned installations beside the existing ones', cfg.autoInstall ? (writable(opt) ? 'GRANTED' : 'UNAVAILABLE') : 'NOT_AUTHORIZED', cfg.autoInstall ? (writable(opt) ? `${opt} is writable; existing installs are never overwritten` : `${opt} is not writable`) : 'autoInstall is off in the Commander settings')

  // the Electron sandbox helper (needs root once per install)
  const sudo = run('sudo', ['-n', 'true'])
  let helper = 'no installation found'
  try {
    const newest = readdirSync(opt).filter((n) => n.startsWith('war-room-os-')).map((n) => path.join(opt, n, 'opt', 'War-Room-OS', 'chrome-sandbox')).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    if (newest) { const st = statSync(newest); helper = `${newest}: owner uid ${st.uid}, mode ${(st.mode & 0o7777).toString(8)}` }
  } catch { /* no opt root */ }
  add('privileged', 'Run commands as root (sudo)', sudo.status === 0 ? 'GRANTED' : 'UNAVAILABLE', sudo.status === 0 ? 'sudo -n works' : 'sudo needs interactive authentication; Foundry cannot run it. A new Electron install needs its chrome-sandbox set root:4755 by the user once (' + helper + ')')

  // deployment
  const launcher = env.launcher ?? defaultLauncher()
  const launcherOk = existsSync(launcher) && writable(launcher)
  add('deploy', 'Promote a verified installation to the canonical launcher (rollback recorded)', !cfg.deploymentAuthority ? 'NOT_AUTHORIZED' : launcherOk ? 'GRANTED' : 'UNAVAILABLE', !cfg.deploymentAuthority ? 'deployment authority is off in the Commander settings' : launcherOk ? `${launcher} is writable` : `${launcher} is missing or not writable`)

  // never granted by this system
  add('accounts', 'Create third-party accounts, spend money, or reach resources outside this machine', 'NOT_AUTHORIZED', 'always requires an explicit Commander decision; Foundry has no credentials for it')
  return out
}

export const bootId = (): string => { try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() } catch { return 'UNKNOWN' } }
