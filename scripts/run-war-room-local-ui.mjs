/**
 * Start local Next War Room UI on 127.0.0.1:3848 (owned process).
 * Does not touch :3000 / :3001 / cloudflared / Ollama.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureLocalWarRoomUi } from '@/lib/sovereign-runtime/localUiRuntime'
import { LOCAL_UI_ORIGIN } from '@/lib/sovereign-runtime/constants'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ui = await ensureLocalWarRoomUi({ repoRoot: root, startIfMissing: true, waitMs: 120_000 })
console.log(`War Room Local UI READY at ${LOCAL_UI_ORIGIN} boot=${ui.boot} owned_pid=${ui.owned_pid}`)
console.log('Website fallback: DENIED. Press Ctrl+C to stop owned UI only.')

const stop = async () => {
  await ui.stop()
  process.exit(0)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
