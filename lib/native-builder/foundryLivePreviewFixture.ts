/**
 * The retained live preview several validations look at (the Commander's transportation project on 127.0.0.1:18780).
 *
 * Those validations are about how Foundry treats a retained preview, not about whether one happens to be running on this machine right now. When
 * nothing is listening on the live port this serves the project itself (a static server, registered like any retained preview) and hands back its pid so
 * the run that started it can stop it; when a preview is already there it is left alone and no pid is returned.
 */
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { httpGetNoKeepAlive } from './foundryApplicationBuilderLifecycle'
import { startProjectProcess } from './foundryProjectIsolation'

export const LIVE_PROJECT = path.join(os.homedir(), 'FoundryProjects', 'professional-website-for-a')
export const LIVE_PORT = 18780
export const LIVE_PROJECT_ID = 'dd4af6c3-5603-4584-b0ad-88ff900df5c0'

export async function ensureLivePreview(missionId: string): Promise<number | null> {
  if (!existsSync(LIVE_PROJECT)) return null
  if ((await httpGetNoKeepAlive(`http://127.0.0.1:${LIVE_PORT}/`)).ok) return null
  const started = await startProjectProcess({
    projectRoot: LIVE_PROJECT,
    cmd: 'python3',
    args: ['-m', 'http.server', String(LIVE_PORT), '--bind', '127.0.0.1'],
    label: 'foundry-app-preview',
    missionId,
    projectId: LIVE_PROJECT_ID,
    port: LIVE_PORT,
    processType: 'preview',
    retainAfterWrapper: true,
  })
  if (!started.ok) return null
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await httpGetNoKeepAlive(`http://127.0.0.1:${LIVE_PORT}/`)).ok) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return started.pid ?? null
}

/** Stops the preview this run started (never one it found). */
export function stopOwnLivePreview(pid: number | null): void {
  if (!pid) return
  try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
}
