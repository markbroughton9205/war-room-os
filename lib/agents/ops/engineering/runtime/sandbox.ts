import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * OS-level isolation for commands that execute model-generated code (tests, servers, verifiers, validators).
 * Uses bubblewrap: the whole filesystem is read-only, HOME is replaced by an empty tmpfs (no keys, no .env files, no other projects),
 * /tmp is private, only the listed directories are writable, PID/IPC/UTS namespaces are private, and the network namespace is
 * private unless the command is a loopback server probed from outside (net: true).
 * Known limit: with net:true (servers probed over loopback) the host network namespace is shared, so model code could reach localhost services.
 * No privileges are needed and no Electron/Chromium sandbox setting is touched.
 * FOUNDRY_SANDBOX=off disables it explicitly (recorded by callers via `sandboxed:false`); when bwrap is missing the call is refused unless that opt-out is set.
 */
export class SandboxUnavailable extends Error { constructor(msg: string) { super(msg) } }

let probed: boolean | undefined
export function sandboxAvailable(): boolean {
  if (probed !== undefined) return probed
  try { probed = spawnSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-all', 'true'], { timeout: 5000 }).status === 0 } catch { probed = false }
  return probed
}
export const sandboxDisabled = () => process.env.FOUNDRY_SANDBOX === 'off'

export type SandboxOpts = {
  /** directories the command may write (workspace copy, private tmp/state). Must exist. */
  rw: string[]
  /** extra read-only directories that live under HOME and must stay visible (toolchains, the repo's node_modules). */
  ro?: string[]
  /** keep the host network namespace (loopback servers probed from the engine). Default false. */
  net?: boolean
  /** working directory inside the sandbox (default: first rw directory) */
  cwd?: string
}

const homeDirs = (p: string): string[] => {
  // the toolchain prefix of a binary under HOME, e.g. ~/.nvm/versions/node/v22/bin/node -> ~/.nvm/versions/node/v22
  const home = os.homedir()
  const out: string[] = []
  try {
    const real = realpathSync(p)
    if (real.startsWith(home + path.sep)) { const parts = real.slice(home.length + 1).split(path.sep); const i = parts.indexOf('bin'); out.push(path.join(home, ...parts.slice(0, i > 0 ? i : Math.max(1, parts.length - 1)))) }
  } catch { /* not resolvable */ }
  return out
}

/** Returns the argv to execute instead of `argv`. Throws SandboxUnavailable when isolation is required but impossible. */
export function wrapSandboxed(argv: string[], opts: SandboxOpts): { argv: string[]; sandboxed: boolean } {
  if (sandboxDisabled()) return { argv, sandboxed: false }
  if (!sandboxAvailable()) throw new SandboxUnavailable('bubblewrap (bwrap) is not available; refusing to run model-generated code unsandboxed (set FOUNDRY_SANDBOX=off to override explicitly)')
  const home = os.homedir()
  const args = ['--die-with-parent', '--new-session', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp']
  if (!opts.net) args.push('--unshare-net')
  // host unix sockets (ssh/gpg agent, dbus, docker) are reachable through the read-only root even without a network namespace
  for (const d of ['/run', '/mnt', '/media']) if (existsSync(d)) args.push('--tmpfs', d)
  if (home && home !== '/') args.push('--tmpfs', home)
  // executables found through PATH under HOME (nvm, ~/.local/bin) would vanish behind the HOME tmpfs: keep only those toolchain prefixes visible, read-only
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d.startsWith(home + path.sep)).map((d) => path.basename(d) === 'bin' ? path.dirname(d) : d)
  const ro = new Set<string>([...pathDirs, ...(process.env.WAR_ROOM_ENG_NODE ? homeDirs(process.env.WAR_ROOM_ENG_NODE) : []),...(opts.ro ?? []), ...homeDirs(process.execPath), ...homeDirs(argv[0].includes('/') ? argv[0] : '')])
  for (const d of ro) if (existsSync(d)) args.push('--ro-bind', d, d)
  for (const d of opts.rw) { if (!existsSync(d)) throw new SandboxUnavailable(`sandbox writable directory missing: ${d}`); args.push('--bind', d, d) }
  return { argv: ['bwrap', ...args, '--chdir', opts.cwd ?? opts.rw[0], '--', ...argv], sandboxed: true }
}
