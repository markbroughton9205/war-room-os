import { spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defaultLauncher } from './capabilities'
import type { PromoteResult } from './controller'

/**
 * Promotion = pointing the canonical launcher at a verified installation. Reversible by construction: the previous launcher is copied aside first, the new one is written atomically,
 * the old installation directory is never touched, and the rollback is one `cp`. Promotion is refused (not faked) whenever the new build could not actually start on this machine.
 */
export type PromoteInput = {
  installPath: string; launcher?: string; now?: Date
  /** override for tests: report whether the Electron sandbox helper is usable */
  sandboxHelperOk?: (exeDir: string) => { ok: boolean; why: string }
  /**
   * The deployment's own acceptance test, run AFTER the launcher points at the new build: it must start the build and see it work. If it says no (or throws, or times out), the launcher is
   * restored from the backup it just made and the promotion is reported as rolled back. A promotion without this hook is only structurally verified.
   */
  healthCheck?: (installPath: string) => Promise<{ ok: boolean; detail: string }>
}

export function sandboxHelperState(exeDir: string): { ok: boolean; why: string } {
  const f = path.join(exeDir, 'chrome-sandbox')
  if (!existsSync(f)) return { ok: false, why: 'chrome-sandbox is missing from the installation' }
  const st = statSync(f)
  if (st.uid === 0 && (st.mode & 0o4000) !== 0) return { ok: true, why: 'chrome-sandbox is root-owned with the setuid bit' }
  return { ok: false, why: `chrome-sandbox is owned by uid ${st.uid} with mode ${(st.mode & 0o7777).toString(8)}; Electron's sandbox helper must be root:root 4755 (a one-time \`sudo chown root:root\` + \`sudo chmod 4755\` on ${f}, which Foundry cannot run: sudo needs an interactive password)` }
}

export function parseLauncherTarget(text: string): string | null {
  const m = /^exec\s+"([^"]+)"/m.exec(text)
  return m ? m[1] : null
}

export async function promoteInstall(input: PromoteInput): Promise<PromoteResult> {
  const launcher = input.launcher ?? defaultLauncher()
  const exeDir = path.join(input.installPath, 'opt', 'War-Room-OS')
  const exe = path.join(exeDir, 'war-room-os')
  const stampFile = path.join(input.installPath, 'INSTALL_STAMP.json')
  if (!existsSync(exe)) return { ok: false, detail: `the installation has no executable at ${exe}` }
  let stamp: { gitDirty?: boolean; gitShort?: string } = {}
  try { stamp = JSON.parse(readFileSync(stampFile, 'utf8')) } catch { return { ok: false, detail: 'the installation has no readable INSTALL_STAMP.json; only stamped, clean builds are promoted' } }
  if (stamp.gitDirty !== false) return { ok: false, detail: 'the installation was not built from a clean tree (INSTALL_STAMP gitDirty is not false)' }
  const helper = (input.sandboxHelperOk ?? sandboxHelperState)(exeDir)
  if (!helper.ok) return { ok: false, detail: `not promoted, because the new build could not start: ${helper.why}` }
  if (!existsSync(launcher)) return { ok: false, detail: `the launcher ${launcher} does not exist` }
  const old = readFileSync(launcher, 'utf8')
  const previous = parseLauncherTarget(old)
  if (!previous) return { ok: false, detail: 'the launcher has an unexpected shape (no exec "…" line); it was not changed' }
  if (previous === exe) return { ok: true, detail: 'the launcher already points at this installation', launcher, previousTarget: previous, backup: '' }
  const ts = (input.now ?? new Date()).getTime()
  const prevShort = /war-room-os-[\d.]+-([0-9a-f]{6,10})/.exec(previous)?.[1] ?? 'previous'
  const backup = `${launcher}.rollback-${prevShort}-${ts}`
  copyFileSync(launcher, backup)
  const next = old.replace(`exec "${previous}"`, () => `exec "${exe}"`).replace(/^# .*Council Stage 3.*$/m, () => `# Promoted by Foundry (${stamp.gitShort ?? 'unknown'}) from a verified installation at ${new Date(ts).toISOString()}; rollback: cp -p ${backup} ${launcher}`)
  const journal = (state: string, extra: Record<string, unknown> = {}) => { try { appendFileSync(path.join(path.dirname(launcher), '.foundry-promotions.jsonl'), JSON.stringify({ at: new Date().toISOString(), state, launcher, previous, next: exe, backup, ...extra }) + '\n') } catch { /* evidence is best effort */ } }
  journal('PREPARED')
  const restore = (why: string): PromoteResult => {
    const rb = rollbackPromotion(backup, launcher)
    journal(rb.ok ? 'ROLLED_BACK' : 'ROLLBACK_FAILED', { why })
    return { ok: false, rolledBack: rb.ok, detail: `${why}; ${rb.ok ? `the launcher was restored automatically (${backup})` : `AUTOMATIC ROLLBACK FAILED (${rb.detail}); restore manually: cp -p ${backup} ${launcher}`}`, launcher, previousTarget: previous, backup }
  }
  const tmp = `${launcher}.${process.pid}.tmp`
  writeFileSync(tmp, next, { mode: 0o755 }); chmodSync(tmp, 0o755); renameSync(tmp, launcher)
  journal('APPLIED')
  // structural verification of what was just written: the target, the executable bit and the shell syntax
  const written = readFileSync(launcher, 'utf8')
  const syntax = spawnSync('bash', ['-n', launcher], { encoding: 'utf8', timeout: 10_000 })
  if (parseLauncherTarget(written) !== exe || (statSync(launcher).mode & 0o111) === 0 || syntax.status !== 0) return restore(`the rewritten launcher failed verification (${syntax.status !== 0 ? 'shell syntax: ' + String(syntax.stderr).slice(0, 120) : 'wrong target or not executable'})`)
  if (input.healthCheck) {
    let h: { ok: boolean; detail: string }
    try { h = await input.healthCheck(input.installPath) } catch (e) { h = { ok: false, detail: `the health check crashed: ${e instanceof Error ? e.message : String(e)}` } }
    if (!h.ok) return restore(`the new build failed its deployment health check (${h.detail.slice(0, 240)})`)
    journal('VERIFIED', { health: h.detail.slice(0, 200) })
    return { ok: true, detail: `the launcher now starts ${exe} and the build passed its health check (${h.detail.slice(0, 120)}); takes effect the next time War Room is launched (the running app was not restarted). Rollback: cp -p ${backup} ${launcher}`, launcher, previousTarget: previous, backup }
  }
  journal('VERIFIED', { health: 'structural only' })
  return { ok: true, detail: `the launcher now starts ${exe} (structurally verified only: no health check was supplied; takes effect the next time War Room is launched; the running app was not restarted). Rollback: cp -p ${backup} ${launcher}`, launcher, previousTarget: previous, backup }
}

export function rollbackPromotion(backup: string, launcher: string = defaultLauncher()): { ok: boolean; detail: string } {
  if (!existsSync(backup)) return { ok: false, detail: `${backup} does not exist` }
  if (lstatSync(backup).isSymbolicLink() || !parseLauncherTarget(readFileSync(backup, 'utf8'))) return { ok: false, detail: `${backup} is not a launcher rollback copy` }
  const tmp = `${launcher}.${process.pid}.rb`
  copyFileSync(backup, tmp); chmodSync(tmp, 0o755); renameSync(tmp, launcher)
  return { ok: true, detail: `the launcher was restored from ${backup}` }
}
