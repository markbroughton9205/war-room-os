/**
 * Why a per-user install's chrome-sandbox helper is (or is not) root-owned (pure: no filesystem, network or clock).
 *
 * The installer never gains privilege on its own. `applyHelper` (desktop/workbench-host/prepare-linux-chrome-sandbox.cjs) tries `sudo -n` and then `pkexec`;
 * only an already-authorized sudo, or a desktop authorization prompt somebody approved (polkit keeps that approval for a short while, so a second request
 * right after the first can pass without another prompt), makes the helper root-owned. Otherwise the record says an operator command is required.
 * The result of that attempt is written next to the install as LINUX_CHROME_SANDBOX.json; this reads it in plain words.
 */
export type SandboxInstallRecord = {
  ok?: boolean
  applied?: boolean
  method?: string
  error?: string | null
  operatorCommand?: string | null
  inspect?: { uid?: number; mode?: string; rootOwned?: boolean; verdict?: string }
}

export const SANDBOX_METHODS = ['already', 'sudo-n', 'pkexec', 'operator-sudo-required'] as const

export function explainSandboxInstall(record: SandboxInstallRecord): { native: boolean; how: string; sentence: string } {
  const native = record.ok === true && record.inspect?.rootOwned === true && record.inspect?.mode === '4755'
  if (native && record.method === 'already') return { native, how: 'already', sentence: 'The helper was already root-owned and setuid, so nothing had to be changed.' }
  if (native && record.method === 'sudo-n') return { native, how: 'sudo-n', sentence: 'The installer used a sudo authorization that was already active on this machine to make the helper root-owned and setuid.' }
  if (native && record.method === 'pkexec') return { native, how: 'pkexec', sentence: 'The installer asked the desktop for authorization (pkexec). An approved prompt, or the short-lived approval polkit keeps after one, made the helper root-owned and setuid.' }
  if (record.method === 'operator-sudo-required') return { native: false, how: 'operator-sudo-required', sentence: `No authorization was available, so the helper is not root-owned yet. Run once: ${record.operatorCommand ?? 'sudo chown root:root <helper> && sudo chmod 4755 <helper>'}` }
  return { native: false, how: 'unknown', sentence: 'The install record does not show how the helper ownership was set, so it should be checked before the app is activated.' }
}
